import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  createRedirect,
  deleteRedirect,
  isExternal,
  listRedirects,
  normalisePath,
  resolveRedirect,
  updateRedirect,
  STATUS_BY_TYPE,
} from "@/lib/services/redirect.service";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/actor/types";

/**
 * Redirects change where the public site sends people, so the service now takes
 * an actor and checks `redirects.edit`. These tests supply one holding exactly
 * that permission — not a SUPER_ADMIN, which would bypass the check and prove
 * nothing about it.
 */
const editor: Actor = {
  // A real user id: the audit row this now writes carries a foreign key, and a
  // made-up actor would only prove the test can dodge it.
  userId: "",
  name: "Redirect editor",
  email: null,
  type: "STAFF",
  roleName: "CONTENT_MANAGER",
  roleId: null,
  clientId: null,
  permissions: new Set(["redirects.view", "redirects.edit"]),
  ip: null,
  userAgent: "vitest",
};

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

describe("path normalisation", () => {
  it("adds a leading slash and drops a trailing one", () => {
    expect(normalisePath("old-page/")).toBe("/old-page");
    expect(normalisePath("/old-page/")).toBe("/old-page");
  });

  it("strips query strings and fragments, which are not part of the match", () => {
    expect(normalisePath("/old?utm_source=x")).toBe("/old");
    expect(normalisePath("/old#section")).toBe("/old");
  });

  it("keeps the root as a single slash", () => {
    expect(normalisePath("/")).toBe("/");
    expect(normalisePath("")).toBe("/");
  });

  it("leaves an absolute URL alone", () => {
    expect(normalisePath("https://example.com/x")).toBe("https://example.com/x");
    expect(isExternal("https://example.com/x")).toBe(true);
    expect(isExternal("/x")).toBe(false);
  });
});

describe("redirect status mapping", () => {
  it("maps each type to its HTTP status", () => {
    expect(STATUS_BY_TYPE.PERMANENT_301).toBe(301);
    expect(STATUS_BY_TYPE.FOUND_302).toBe(302);
    expect(STATUS_BY_TYPE.TEMPORARY_307).toBe(307);
    expect(STATUS_BY_TYPE.PERMANENT_308).toBe(308);
  });
});

describeDb("loop detection at write time", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: connectionString as string }),
  });

  beforeAll(async () => {
    const staff = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    editor.userId = staff.id;
  });

  afterEach(async () => {
    await prisma.redirect.deleteMany({ where: { fromPath: { startsWith: "/t-" } } });
  });

  it("creates a straightforward redirect", async () => {
    const created = await createRedirect(editor, { fromPath: "/t-old", toPath: "/t-new" });
    expect(created.fromPath).toBe("/t-old");
    expect(created.type).toBe("PERMANENT_301");
  });

  it("rejects a redirect pointing at itself", async () => {
    await expect(createRedirect(editor, { fromPath: "/t-self", toPath: "/t-self" })).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejects a two-hop cycle", async () => {
    await createRedirect(editor, { fromPath: "/t-a", toPath: "/t-b" });
    // /t-b -> /t-a would make the pair circular.
    await expect(createRedirect(editor, { fromPath: "/t-b", toPath: "/t-a" })).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejects a longer cycle through several hops", async () => {
    await createRedirect(editor, { fromPath: "/t-1", toPath: "/t-2" });
    await createRedirect(editor, { fromPath: "/t-2", toPath: "/t-3" });
    await createRedirect(editor, { fromPath: "/t-3", toPath: "/t-4" });
    await expect(createRedirect(editor, { fromPath: "/t-4", toPath: "/t-1" })).rejects.toThrow(
      ValidationError,
    );
  });

  it("allows a chain that terminates at a real page", async () => {
    await createRedirect(editor, { fromPath: "/t-x", toPath: "/t-y" });
    const created = await createRedirect(editor, { fromPath: "/t-y", toPath: "/t-final" });
    expect(created.toPath).toBe("/t-final");
  });

  it("allows a redirect off-site without walking further", async () => {
    const created = await createRedirect(editor, {
      fromPath: "/t-away",
      toPath: "https://elsewhere.example/page",
    });
    expect(created.toPath).toBe("https://elsewhere.example/page");
  });

  it("refuses a duplicate source path", async () => {
    await createRedirect(editor, { fromPath: "/t-dupe", toPath: "/t-one" });
    await expect(createRedirect(editor, { fromPath: "/t-dupe", toPath: "/t-two" })).rejects.toThrow(
      ConflictError,
    );
  });

  it("ignores an inactive redirect when walking the chain", async () => {
    await createRedirect(editor, { fromPath: "/t-p", toPath: "/t-q", isActive: false });
    // /t-q -> /t-p is only a cycle if the inactive hop counts. It must not.
    const created = await createRedirect(editor, { fromPath: "/t-q", toPath: "/t-p" });
    expect(created.fromPath).toBe("/t-q");
  });

  it("lets a redirect be edited without tripping on its own current row", async () => {
    const created = await createRedirect(editor, { fromPath: "/t-edit", toPath: "/t-dest" });
    const updated = await updateRedirect(editor, created.id, {
      fromPath: "/t-edit",
      toPath: "/t-other",
    });
    expect(updated.toPath).toBe("/t-other");
  });

  it("normalises both paths on the way in", async () => {
    const created = await createRedirect(editor, { fromPath: "t-messy/", toPath: "t-clean/?x=1" });
    expect(created.fromPath).toBe("/t-messy");
    expect(created.toPath).toBe("/t-clean");
  });
});

describeDb("redirect resolution", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: connectionString as string }),
  });

  afterEach(async () => {
    await prisma.redirect.deleteMany({ where: { fromPath: { startsWith: "/t-" } } });
  });

  it("resolves an active redirect, reporting both intended and served status", async () => {
    await createRedirect(editor, { fromPath: "/t-hit", toPath: "/t-there", type: "FOUND_302" });
    const resolved = await resolveRedirect("/t-hit");
    expect(resolved).toEqual({
      toPath: "/t-there",
      intendedStatus: 302,
      // Next emits the method-preserving equivalent; 307 for a temporary.
      servedStatus: 307,
      permanent: false,
    });
  });

  it("serves a permanent redirect as 308", async () => {
    await createRedirect(editor, { fromPath: "/t-perm", toPath: "/t-dest", type: "PERMANENT_301" });
    const resolved = await resolveRedirect("/t-perm");
    expect(resolved?.permanent).toBe(true);
    expect(resolved?.servedStatus).toBe(308);
    expect(resolved?.intendedStatus).toBe(301);
  });

  it("matches regardless of a trailing slash or query string", async () => {
    await createRedirect(editor, { fromPath: "/t-loose", toPath: "/t-target" });
    expect((await resolveRedirect("/t-loose/"))?.toPath).toBe("/t-target");
    expect((await resolveRedirect("/t-loose?utm=1"))?.toPath).toBe("/t-target");
  });

  it("does not resolve an inactive redirect", async () => {
    await createRedirect(editor, { fromPath: "/t-off", toPath: "/t-nowhere", isActive: false });
    expect(await resolveRedirect("/t-off")).toBeNull();
  });

  it("returns null for a path with no redirect", async () => {
    expect(await resolveRedirect("/t-unknown")).toBeNull();
  });
});

/**
 * Redirects as a managed resource: permissions, audit, listing, deletion.
 *
 * The service had none of this — it was written for an engine with no screen,
 * so nothing checked who was asking. A redirect can point the site's own
 * addresses at somebody else's domain, which makes it a privileged mutation.
 */
describeDb("redirects as a managed resource", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: connectionString as string }),
  });

  const nobody: Actor = { ...editor, permissions: new Set<string>() };

  afterEach(async () => {
    await prisma.redirect.deleteMany({ where: { fromPath: { startsWith: "/t-" } } });
  });

  it("refuses to create without redirects.edit", async () => {
    await expect(
      createRedirect(nobody, { fromPath: "/t-denied", toPath: "/t-there" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses to delete without redirects.edit", async () => {
    const created = await createRedirect(editor, { fromPath: "/t-guard", toPath: "/t-there" });
    await expect(deleteRedirect(nobody, created.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses to list without redirects.view", async () => {
    await expect(
      listRedirects(nobody, { page: 1, perPage: 25 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("audits a create, so who pointed what where is on the record", async () => {
    // Audit rows are permanent by design, so the path is unique per run —
    // otherwise this counts every previous run's row as well.
    const path = `/t-audited-${Date.now()}`;
    await createRedirect(editor, { fromPath: path, toPath: "/t-dest" });

    const entries = await db.auditLog.count({
      where: { entityType: "Redirect", entityId: path, action: "CREATE" },
    });
    expect(entries).toBe(1);
  });

  it("deletes a redirect outright, since isActive already means 'off'", async () => {
    const created = await createRedirect(editor, { fromPath: "/t-gone", toPath: "/t-dest" });
    await deleteRedirect(editor, created.id);

    expect(await prisma.redirect.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it("refuses to delete something that is not there", async () => {
    await expect(deleteRedirect(editor, "cnosuchredirect000000000")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("normalises a loose destination into a path rather than rejecting it", async () => {
    // The service normalises; the form is what refuses what someone typed.
    const created = await createRedirect(editor, { fromPath: "/t-loose2", toPath: "/t-dest" });
    const updated = await updateRedirect(editor, created.id, {
      fromPath: "/t-loose2",
      toPath: "somewhere",
    });
    expect(updated.toPath).toBe("/somewhere");
  });

  it("lists the busiest redirects first, because those are the ones doing work", async () => {
    const quiet = await createRedirect(editor, { fromPath: "/t-quiet", toPath: "/t-dest" });
    const busy = await createRedirect(editor, { fromPath: "/t-busy", toPath: "/t-dest" });
    await prisma.redirect.update({ where: { id: busy.id }, data: { hits: 500 } });

    const listed = await listRedirects(editor, { page: 1, perPage: 100 });
    const ids = listed.rows.map((row) => row.id);
    expect(ids.indexOf(busy.id)).toBeLessThan(ids.indexOf(quiet.id));
  });

  it("filters the list by whether a redirect is switched on", async () => {
    await createRedirect(editor, { fromPath: "/t-on", toPath: "/t-dest", isActive: true });
    await createRedirect(editor, { fromPath: "/t-offlist", toPath: "/t-dest", isActive: false });

    const off = await listRedirects(editor, { page: 1, perPage: 100, active: "off" });
    const paths = off.rows.map((row) => row.fromPath);
    expect(paths).toContain("/t-offlist");
    expect(paths).not.toContain("/t-on");
  });

  it("searches either address", async () => {
    await createRedirect(editor, { fromPath: "/t-findme", toPath: "/t-dest" });
    const found = await listRedirects(editor, { page: 1, perPage: 100, search: "findme" });
    expect(found.rows.map((row) => row.fromPath)).toContain("/t-findme");
  });
});
