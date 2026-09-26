import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { commitImport, exportContent, planImport } from "@/lib/services/transfer.service";
import { parseCsv } from "@/lib/csv/parse";
import { TRANSFER, TRANSFER_TYPES } from "@/lib/transfer/columns";
import type { Actor } from "@/lib/actor/types";

/**
 * Import and export.
 *
 * The properties worth pinning are the ones whose failure destroys data
 * quietly: a column left out of the file must change nothing, a blank cell
 * must mean what the column says it means, a bad row must stop the whole run
 * rather than half-applying it, and a preview must never be what the server
 * acts on.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const SUFFIX = `xfer-${Date.now()}`;

function actorWith(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "Importer",
    email: "importer@emporia.test",
    type: "STAFF",
    roleName: "CONTENT_MANAGER",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

describeDb("content import and export", () => {
  const cities: string[] = [];
  let editor: Actor;
  let viewer: Actor;

  beforeAll(async () => {
    const staff = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    editor = actorWith(staff.id, [
      "catalog.view",
      "catalog.create",
      "catalog.edit",
      "catalog.publish",
      "faqs.view",
      "faqs.create",
      "faqs.edit",
      "blog.view",
      "blog.create",
      "blog.edit",
      "blog.publish",
      "testimonials.view",
      "testimonials.create",
      "testimonials.edit",
      "testimonials.publish",
    ]);
    viewer = actorWith(staff.id, ["catalog.view", "faqs.view"]);
  });

  afterAll(async () => {
    await db.fAQ.deleteMany({ where: { question: { startsWith: SUFFIX } } });
    if (cities.length > 0) await db.city.deleteMany({ where: { id: { in: cities } } });
    await db.city.deleteMany({ where: { slug: { startsWith: SUFFIX } } });
  });

  async function newCity(over: Partial<{ name: string; state: string; order: number; isActive: boolean }> = {}) {
    const city = await db.city.create({
      data: {
        slug: `${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
        name: over.name ?? "Testville",
        state: over.state ?? "Haryana",
        country: "India",
        order: over.order ?? 3,
        isActive: over.isActive ?? true,
      },
      select: { id: true, slug: true },
    });
    cities.push(city.id);
    return city;
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  it("exports every column the importer reads, in order", async () => {
    await newCity();
    const { csv, filename } = await exportContent(editor, "city");

    const [header] = parseCsv(csv);
    expect(header).toEqual([
      "id",
      "slug",
      "name",
      "state",
      "country",
      "latitude",
      "longitude",
      "population",
      "isActive",
      "order",
    ]);
    expect(filename).toMatch(/^city-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("every type exports exactly the columns it imports, and re-imports clean", async () => {
    // One record of every type first, so the round trip below actually runs
    // for each of them rather than passing on an empty table.
    const service = await db.service.create({
      data: {
        slug: `${SUFFIX}-svc`,
        name: "Round trip service",
        shortDescription: "A service used to check the round trip.",
      },
      select: { id: true },
    });
    const post = await db.blogPost.create({
      data: {
        slug: `${SUFFIX}-post`,
        title: "Round trip post",
        excerpt: 'An excerpt with a comma, a "quote" and a semicolon; all of it.',
        authorId: editor.userId,
      },
      select: { id: true },
    });
    const testimonial = await db.testimonial.create({
      data: {
        authorName: "Round Tripper",
        quote: 'They said "it, worked" — and it did.',
        rating: 4,
        serviceId: service.id,
      },
      select: { id: true },
    });
    const faq = await db.fAQ.create({
      data: { question: `${SUFFIX} round trip?`, answer: "Yes, it does.", serviceId: service.id },
      select: { id: true },
    });

    try {
      await roundTripEveryType();
    } finally {
      await db.fAQ.delete({ where: { id: faq.id } });
      await db.testimonial.delete({ where: { id: testimonial.id } });
      await db.blogPost.delete({ where: { id: post.id } });
      await db.service.delete({ where: { id: service.id } });
    }
  });

  async function roundTripEveryType() {
    // Run over all five rather than the one under test: a column added to a
    // type's table but not to its rules, or the reverse, is invisible until
    // somebody round-trips that type's whole catalogue.
    for (const type of TRANSFER_TYPES) {
      const { csv } = await exportContent(editor, type);
      const [header] = parseCsv(csv);
      expect(header, type).toEqual(TRANSFER[type].columns.map((column) => column.header));

      const rows = parseCsv(csv).length - 1;
      if (rows === 0) continue;
      const plan = await planImport(editor, type, csv);
      expect({ type, ...plan.counts }).toEqual({
        type,
        create: 0,
        update: 0,
        unchanged: rows,
        error: 0,
      });
    }
  }

  it("round-trips: exporting and importing back changes nothing", async () => {
    const city = await newCity();
    const { csv } = await exportContent(editor, "city");

    // The strongest property the two directions can have together. If a column
    // exported one thing and imported another, this is where it shows.
    const plan = await planImport(editor, "city", csv);
    expect(plan.counts.error).toBe(0);
    expect(plan.counts.create).toBe(0);
    expect(plan.counts.update).toBe(0);
    expect(plan.rows.find((row) => "id" in row && row.id === city.id)?.outcome).toBe("unchanged");
  });

  it("needs the view permission to export", async () => {
    await expect(exportContent(actorWith(editor.userId, []), "city")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("records the export in the audit log", async () => {
    await exportContent(editor, "city");
    const entry = await db.auditLog.findFirst({
      where: { action: "EXPORT", entityId: "city" },
      orderBy: { createdAt: "desc" },
      select: { entityType: true },
    });
    expect(entry?.entityType).toBe("City export");
  });

  // -------------------------------------------------------------------------
  // Planning
  // -------------------------------------------------------------------------

  it("plans a create for a row with no id and no matching slug", async () => {
    const plan = await planImport(
      editor,
      "city",
      `slug,name,state\n${SUFFIX}-new,Newtown,Punjab\n`,
    );
    expect(plan.counts).toMatchObject({ create: 1, update: 0, error: 0 });
  });

  it("matches an existing record by its natural key when the id is blank", async () => {
    const city = await newCity({ name: "Old name" });
    const plan = await planImport(editor, "city", `slug,name\n${city.slug},New name\n`);
    expect(plan.counts).toMatchObject({ create: 0, update: 1, error: 0 });
    expect(plan.rows[0]).toMatchObject({ outcome: "update", id: city.id, changed: ["name"] });
  });

  it("leaves a column the file does not carry exactly as it was", async () => {
    // The rule the whole importer turns on. Somebody who exports, keeps two
    // columns and imports the file back has edited two fields, not erased the
    // rest of the record.
    const city = await newCity({ state: "Kerala", order: 7 });
    await commitImport(editor, "city", `slug,name\n${city.slug},Renamed\n`);

    const after = await db.city.findUniqueOrThrow({
      where: { id: city.id },
      select: { name: true, state: true, order: true },
    });
    expect(after).toEqual({ name: "Renamed", state: "Kerala", order: 7 });
  });

  it("treats a blank cell in a keep column as 'left alone', not 'unset'", async () => {
    const city = await newCity({ order: 9, isActive: true });
    await commitImport(editor, "city", `slug,name,order,isActive\n${city.slug},Kept,,\n`);

    const after = await db.city.findUniqueOrThrow({
      where: { id: city.id },
      select: { order: true, isActive: true },
    });
    // A blank sort position is not position zero, and a blank flag does not
    // take a city off the website.
    expect(after).toEqual({ order: 9, isActive: true });
  });

  it("treats a blank cell in a clear column as a real instruction", async () => {
    const city = await newCity();
    await db.city.update({ where: { id: city.id }, data: { population: 500_000 } });

    await commitImport(editor, "city", `slug,population\n${city.slug},\n`);
    const after = await db.city.findUniqueOrThrow({
      where: { id: city.id },
      select: { population: true },
    });
    expect(after.population).toBeNull();
  });

  it("reports an unreadable cell against its line, and writes nothing", async () => {
    const plan = await planImport(
      editor,
      "city",
      `slug,name,state,isActive\n${SUFFIX}-bad,Bad,Goa,perhaps\n`,
    );
    expect(plan.counts.error).toBe(1);
    expect(plan.rows[0]).toMatchObject({ outcome: "error", line: 2 });
    expect(plan.rows[0]?.outcome === "error" ? plan.rows[0].errors[0] : "").toContain("yes or no");
  });

  it("reports a validation failure with the field that failed", async () => {
    const plan = await planImport(editor, "city", `slug,name,state\n${SUFFIX}-x,A,B\n`);
    expect(plan.counts.error).toBe(1);
    const errors = plan.rows[0]?.outcome === "error" ? plan.rows[0].errors : [];
    expect(errors.join(" ")).toMatch(/name/);
  });

  it("refuses an id that does not exist rather than creating one", async () => {
    const plan = await planImport(
      editor,
      "city",
      `id,slug,name,state\nnosuchid,${SUFFIX}-ghost,Ghost,Goa\n`,
    );
    expect(plan.rows[0]?.outcome).toBe("error");
  });

  it("catches a file that changes the same record twice", async () => {
    const city = await newCity();
    const plan = await planImport(
      editor,
      "city",
      `slug,name\n${city.slug},First\n${city.slug},Second\n`,
    );
    // Without this the second row silently wins and the first is a lie.
    expect(plan.counts.error).toBe(1);
    expect(plan.rows[1]?.outcome === "error" ? plan.rows[1].errors[0] : "").toContain("Line 2");
  });

  it("names the headers it does not recognise instead of ignoring them silently", async () => {
    const city = await newCity();
    const plan = await planImport(editor, "city", `slug,name,nonsense\n${city.slug},A,x\n`);
    expect(plan.unknownHeaders).toEqual(["nonsense"]);
  });

  it("resolves a relation by slug, and refuses one nothing matches", async () => {
    const city = await newCity();

    const good = await planImport(
      editor,
      "faq",
      `question,answer,city\n${SUFFIX} what,An answer long enough,${city.slug}\n`,
    );
    expect(good.counts.error).toBe(0);

    const bad = await planImport(
      editor,
      "faq",
      `question,answer,city\n${SUFFIX} what,An answer long enough,no-such-city\n`,
    );
    expect(bad.rows[0]?.outcome === "error" ? bad.rows[0].errors[0] : "").toContain("no-such-city");
  });

  // -------------------------------------------------------------------------
  // Committing
  // -------------------------------------------------------------------------

  it("refuses the whole file when any row has an error", async () => {
    const before = await db.city.count({ where: { slug: { startsWith: `${SUFFIX}-half` } } });

    await expect(
      commitImport(
        editor,
        "city",
        `slug,name,state\n${SUFFIX}-half-a,Fine,Goa\n${SUFFIX}-half-b,,Goa\n`,
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    // Not a single row of a rejected file is written, including the good one
    // above the bad one.
    expect(await db.city.count({ where: { slug: { startsWith: `${SUFFIX}-half` } } })).toBe(before);
  });

  it("refuses a file that changes nothing", async () => {
    const city = await newCity({ name: "Same" });
    await expect(
      commitImport(editor, "city", `slug,name\n${city.slug},Same\n`),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("creates and updates in one run, and reports both", async () => {
    const city = await newCity({ name: "Before" });
    const outcome = await commitImport(
      editor,
      "city",
      `slug,name,state\n${city.slug},After,Haryana\n${SUFFIX}-fresh,Fresh,Goa\n`,
    );
    expect(outcome).toMatchObject({ created: 1, updated: 1, stoppedAt: null });

    const fresh = await db.city.findUniqueOrThrow({ where: { slug: `${SUFFIX}-fresh` } });
    cities.push(fresh.id);
    expect(fresh.name).toBe("Fresh");
  });

  it("needs the create permission to create, and the edit permission to update", async () => {
    await expect(
      commitImport(viewer, "city", `slug,name,state\n${SUFFIX}-nope,Nope,Goa\n`),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const noCreate = actorWith(editor.userId, ["catalog.view", "catalog.edit"]);
    await expect(
      commitImport(noCreate, "city", `slug,name,state\n${SUFFIX}-nope2,Nope,Goa\n`),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("writes an audit row for the run, on top of the services' own", async () => {
    await commitImport(editor, "city", `slug,name,state\n${SUFFIX}-audited,Audited,Goa\n`);
    const fresh = await db.city.findUnique({ where: { slug: `${SUFFIX}-audited`}, select: { id: true } });
    if (fresh) cities.push(fresh.id);

    const entry = await db.auditLog.findFirst({
      where: { action: "IMPORT", entityId: "city" },
      orderBy: { createdAt: "desc" },
      select: { after: true },
    });
    expect(entry?.after).toMatchObject({ created: 1 });
  });

  it("labels a failed row by something the operator can find in the file", async () => {
    // The row whose name is blank is exactly the row that failed; labelling it
    // with the blank name leaves nothing to identify it by.
    const plan = await planImport(editor, "city", `slug,name,state\n${SUFFIX}-nameless,,Goa\n`);
    expect(plan.rows[0]).toMatchObject({ outcome: "error", label: `${SUFFIX}-nameless` });
  });

  it("carries a comma and a quote through export and back unharmed", async () => {
    // The end-to-end version of what the CSV reader is for. A naive split
    // would shift every column after the comma and nothing would say so.
    const awkward = 'They said "it, worked" — and it did.';
    const faq = await db.fAQ.create({
      data: { question: `${SUFFIX} awkward?`, answer: awkward, isActive: true },
      select: { id: true },
    });

    const { csv } = await exportContent(editor, "faq");
    const plan = await planImport(editor, "faq", csv);
    const row = plan.rows.find((entry) => "id" in entry && entry.id === faq.id);
    expect(row?.outcome).toBe("unchanged");

    const after = await db.fAQ.findUniqueOrThrow({
      where: { id: faq.id },
      select: { answer: true },
    });
    expect(after.answer).toBe(awkward);
  });

  // -------------------------------------------------------------------------
  // Bounds
  // -------------------------------------------------------------------------

  it("refuses a file with a header and no rows", async () => {
    await expect(planImport(editor, "city", "slug,name\n")).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses more rows than it will take in one go", async () => {
    const rows = Array.from({ length: 2_001 }, (_, i) => `${SUFFIX}-${i},N,Goa`).join("\n");
    await expect(planImport(editor, "city", `slug,name,state\n${rows}\n`)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("turns a malformed file into a line-numbered message, not a stack trace", async () => {
    await expect(
      planImport(editor, "city", 'slug,name\na,"never closed\n'),
    ).rejects.toThrow(/Line 2/);
  });
});
