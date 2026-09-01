import { afterEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  createRedirect,
  isExternal,
  normalisePath,
  resolveRedirect,
  updateRedirect,
  STATUS_BY_TYPE,
} from "@/lib/services/redirect.service";
import { ConflictError, ValidationError } from "@/lib/errors";

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

  afterEach(async () => {
    await prisma.redirect.deleteMany({ where: { fromPath: { startsWith: "/t-" } } });
  });

  it("creates a straightforward redirect", async () => {
    const created = await createRedirect({ fromPath: "/t-old", toPath: "/t-new" });
    expect(created.fromPath).toBe("/t-old");
    expect(created.type).toBe("PERMANENT_301");
  });

  it("rejects a redirect pointing at itself", async () => {
    await expect(createRedirect({ fromPath: "/t-self", toPath: "/t-self" })).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejects a two-hop cycle", async () => {
    await createRedirect({ fromPath: "/t-a", toPath: "/t-b" });
    // /t-b -> /t-a would make the pair circular.
    await expect(createRedirect({ fromPath: "/t-b", toPath: "/t-a" })).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejects a longer cycle through several hops", async () => {
    await createRedirect({ fromPath: "/t-1", toPath: "/t-2" });
    await createRedirect({ fromPath: "/t-2", toPath: "/t-3" });
    await createRedirect({ fromPath: "/t-3", toPath: "/t-4" });
    await expect(createRedirect({ fromPath: "/t-4", toPath: "/t-1" })).rejects.toThrow(
      ValidationError,
    );
  });

  it("allows a chain that terminates at a real page", async () => {
    await createRedirect({ fromPath: "/t-x", toPath: "/t-y" });
    const created = await createRedirect({ fromPath: "/t-y", toPath: "/t-final" });
    expect(created.toPath).toBe("/t-final");
  });

  it("allows a redirect off-site without walking further", async () => {
    const created = await createRedirect({
      fromPath: "/t-away",
      toPath: "https://elsewhere.example/page",
    });
    expect(created.toPath).toBe("https://elsewhere.example/page");
  });

  it("refuses a duplicate source path", async () => {
    await createRedirect({ fromPath: "/t-dupe", toPath: "/t-one" });
    await expect(createRedirect({ fromPath: "/t-dupe", toPath: "/t-two" })).rejects.toThrow(
      ConflictError,
    );
  });

  it("ignores an inactive redirect when walking the chain", async () => {
    await createRedirect({ fromPath: "/t-p", toPath: "/t-q", isActive: false });
    // /t-q -> /t-p is only a cycle if the inactive hop counts. It must not.
    const created = await createRedirect({ fromPath: "/t-q", toPath: "/t-p" });
    expect(created.fromPath).toBe("/t-q");
  });

  it("lets a redirect be edited without tripping on its own current row", async () => {
    const created = await createRedirect({ fromPath: "/t-edit", toPath: "/t-dest" });
    const updated = await updateRedirect(created.id, {
      fromPath: "/t-edit",
      toPath: "/t-other",
    });
    expect(updated.toPath).toBe("/t-other");
  });

  it("normalises both paths on the way in", async () => {
    const created = await createRedirect({ fromPath: "t-messy/", toPath: "t-clean/?x=1" });
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
    await createRedirect({ fromPath: "/t-hit", toPath: "/t-there", type: "FOUND_302" });
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
    await createRedirect({ fromPath: "/t-perm", toPath: "/t-dest", type: "PERMANENT_301" });
    const resolved = await resolveRedirect("/t-perm");
    expect(resolved?.permanent).toBe(true);
    expect(resolved?.servedStatus).toBe(308);
    expect(resolved?.intendedStatus).toBe(301);
  });

  it("matches regardless of a trailing slash or query string", async () => {
    await createRedirect({ fromPath: "/t-loose", toPath: "/t-target" });
    expect((await resolveRedirect("/t-loose/"))?.toPath).toBe("/t-target");
    expect((await resolveRedirect("/t-loose?utm=1"))?.toPath).toBe("/t-target");
  });

  it("does not resolve an inactive redirect", async () => {
    await createRedirect({ fromPath: "/t-off", toPath: "/t-nowhere", isActive: false });
    expect(await resolveRedirect("/t-off")).toBeNull();
  });

  it("returns null for a path with no redirect", async () => {
    expect(await resolveRedirect("/t-unknown")).toBeNull();
  });
});
