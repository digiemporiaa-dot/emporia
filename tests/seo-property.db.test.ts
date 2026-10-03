import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { linkCityCountries } from "@/lib/geo/country-rows";
import {
  createProperty,
  getProperty,
  listProperties,
  propertyFormOptions,
  updateProperty,
} from "@/lib/services/seo-intel/property.service";
import { createCity } from "@/lib/services/city.service";
import { INTERNAL_OWNER, seoPropertyCreateSchema, seoPropertyUpdateSchema } from "@/lib/validation/seo-intel";
import type { Actor } from "@/lib/actor/types";

/**
 * SEO Phase 1 against the database: properties belong to exactly one client,
 * stay with it, never borrow another client's project, and are invisible to
 * anyone without the permission — portal users included.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const TAG = `sp${Date.now().toString(36)}`;

describeDb("SEO properties", () => {
  let userId = "";
  let clientA = "";
  let clientB = "";
  let projectA = "";
  let projectB = "";
  let internalExisted = false;
  const cityIds: string[] = [];

  function actor(permissions: string[], overrides: Partial<Actor> = {}): Actor {
    return {
      userId,
      name: "SEO Tester",
      email: "seo@test.example",
      type: "STAFF",
      roleName: "ADMIN",
      roleId: "r",
      clientId: null,
      ip: null,
      userAgent: null,
      permissions: new Set(permissions),
      ...overrides,
    } as Actor;
  }

  const manager = () => actor(["seo.intelligence.view", "seo.intelligence.manage"]);
  const viewer = () => actor(["seo.intelligence.view"]);

  const raw = (overrides: Record<string, unknown> = {}) => ({
      owner: clientA,
      website: `${TAG}-a.com`,
      protocol: "HTTPS",
      displayName: "A main site",
      projectId: "",
      defaultCountry: "AE",
      defaultLanguage: "en",
      timezone: "Asia/Dubai",
      isActive: true,
      ...overrides,
    });
  const form = (overrides: Record<string, unknown> = {}) => seoPropertyCreateSchema.parse(raw(overrides));

  beforeAll(async () => {
    userId = (await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } })).id;
    internalExisted = Boolean(await db.client.findFirst({ where: { isInternal: true, deletedAt: null } }));
    const [a, b] = await Promise.all(
      ["A", "B"].map((x) => db.client.create({ data: { name: `SEO ${x} ${TAG}`, slug: `seo-${x.toLowerCase()}-${TAG}` }, select: { id: true } })),
    );
    clientA = a!.id;
    clientB = b!.id;
    const [pa, pb] = await Promise.all(
      [clientA, clientB].map((clientId, i) =>
        db.project.create({
          data: { code: `${i ? "SB" : "SA"}-${TAG}`.slice(0, 20), name: "SEO retainer", clientId, managerId: userId, startsAt: new Date(), status: "ACTIVE" },
          select: { id: true },
        }),
      ),
    );
    projectA = pa!.id;
    projectB = pb!.id;
  });

  afterAll(async () => {
    const internal = await db.client.findFirst({ where: { isInternal: true }, select: { id: true } });
    const ownedBy = [clientA, clientB, ...(internal && !internalExisted ? [internal.id] : [])];
    await db.seoProperty.deleteMany({ where: { OR: [{ clientId: { in: ownedBy } }, { domain: { contains: TAG } }] } });
    await db.project.deleteMany({ where: { id: { in: [projectA, projectB] } } });
    await db.auditLog.deleteMany({ where: { entityType: { in: ["SeoProperty", "Client"] }, entityId: { in: ownedBy } } });
    await db.client.deleteMany({ where: { id: { in: ownedBy } } });
    await db.city.deleteMany({ where: { id: { in: cityIds } } });
  });

  // ---------------------------------------------------------------------------
  // Who may do what
  // ---------------------------------------------------------------------------

  it("refuses everything without seo.intelligence.view — including the old seo.view", async () => {
    const editor = actor(["seo.view", "seo.edit"]);
    await expect(listProperties(editor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createProperty(editor, form())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets a viewer read but not add or edit", async () => {
    await expect(listProperties(viewer())).resolves.toBeInstanceOf(Array);
    await expect(createProperty(viewer(), form())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(propertyFormOptions(viewer())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a portal user outright, even holding the permission", async () => {
    const portal = actor(["seo.intelligence.view", "seo.intelligence.manage"], { type: "CLIENT", clientId: clientA });
    await expect(listProperties(portal)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createProperty(portal, form())).rejects.toBeInstanceOf(ForbiddenError);
  });

  // ---------------------------------------------------------------------------
  // Creating
  // ---------------------------------------------------------------------------

  it("adds a client's website, linking its country and recording who did it", async () => {
    const property = await createProperty(manager(), form({ projectId: projectA }));
    expect(property.client.id).toBe(clientA);
    expect(property.domain).toBe(`${TAG}-a.com`);
    expect(property.defaultCountry).toEqual({ code: "AE", name: "United Arab Emirates" });
    expect(property.project?.id).toBe(projectA);
    expect(property.verifiedAt).toBeNull();

    const audit = await db.auditLog.findFirst({ where: { entityType: "SeoProperty", entityId: property.id, action: "CREATE" } });
    expect(audit?.actorId).toBe(userId);
  });

  it("refuses a second property for the same domain on the same client", async () => {
    await expect(createProperty(manager(), form({ website: `https://${TAG}-a.com/other` }))).rejects.toBeInstanceOf(ConflictError);
  });

  it("allows the same domain under a different client — each keeps its own data", async () => {
    const property = await createProperty(manager(), form({ owner: clientB }));
    expect(property.client.id).toBe(clientB);
  });

  it("never files tasks into another client's project", async () => {
    await expect(createProperty(manager(), form({ website: `${TAG}-x.com`, projectId: projectB }))).rejects.toBeInstanceOf(ValidationError);
    expect(await db.seoProperty.count({ where: { domain: `${TAG}-x.com` } })).toBe(0);
  });

  it("refuses an owner that is not a client, or a deleted one", async () => {
    await expect(createProperty(manager(), form({ owner: "nope", website: `${TAG}-n.com` }))).rejects.toBeInstanceOf(NotFoundError);
    const gone = await db.client.create({ data: { name: `Gone ${TAG}`, slug: `gone-${TAG}`, deletedAt: new Date() }, select: { id: true } });
    try {
      await expect(createProperty(manager(), form({ owner: gone.id, website: `${TAG}-g.com` }))).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      await db.client.delete({ where: { id: gone.id } });
    }
  });

  it("files the agency's own website under one internal client, even when added twice at once", async () => {
    const [one, two] = await Promise.all([
      createProperty(manager(), form({ owner: INTERNAL_OWNER, website: `${TAG}-own.com`, defaultCountry: "IN" })),
      createProperty(manager(), form({ owner: INTERNAL_OWNER, website: `${TAG}-own2.com`, defaultCountry: "" })),
    ]);
    expect(one.client.isInternal).toBe(true);
    expect(one.client.id).toBe(two.client.id);
    expect(await db.client.count({ where: { isInternal: true, deletedAt: null } })).toBe(1);

    const options = await propertyFormOptions(manager());
    expect(options.internal?.id).toBe(one.client.id);
    expect(options.clients.some((client) => client.id === one.client.id)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Reading — scoped
  // ---------------------------------------------------------------------------

  it("lists one client's websites when asked, and nothing of the other's", async () => {
    const onlyA = await listProperties(viewer(), { client: clientA });
    expect(onlyA.length).toBeGreaterThan(0);
    expect(onlyA.every((property) => property.client.id === clientA)).toBe(true);
  });

  it("hides the websites of a deleted client", async () => {
    const property = (await listProperties(viewer(), { client: clientB }))[0]!;
    await db.client.update({ where: { id: clientB }, data: { deletedAt: new Date() } });
    try {
      await expect(getProperty(viewer(), property.id)).rejects.toBeInstanceOf(NotFoundError);
      expect((await listProperties(viewer())).some((p) => p.id === property.id)).toBe(false);
    } finally {
      await db.client.update({ where: { id: clientB }, data: { deletedAt: null } });
    }
  });

  it("filters by status and search", async () => {
    const property = (await listProperties(viewer(), { client: clientA }))[0]!;
    await updateProperty(manager(), property.id, seoPropertyUpdateSchema.parse({ ...raw(), isActive: false }));
    expect((await listProperties(viewer(), { client: clientA })).some((p) => p.id === property.id)).toBe(false);
    expect((await listProperties(viewer(), { client: clientA, status: "inactive" })).some((p) => p.id === property.id)).toBe(true);
    expect((await listProperties(viewer(), { status: "all", q: `${TAG}-A.COM` })).some((p) => p.id === property.id)).toBe(true);
    await updateProperty(manager(), property.id, seoPropertyUpdateSchema.parse({ ...raw(), isActive: true }));
  });

  // ---------------------------------------------------------------------------
  // Editing
  // ---------------------------------------------------------------------------

  it("edits fields, audits before and after, and keeps the owner", async () => {
    const property = (await listProperties(viewer(), { client: clientA }))[0]!;
    const updated = await updateProperty(
      manager(),
      property.id,
      seoPropertyUpdateSchema.parse({ ...raw(), owner: clientB, displayName: "Renamed", defaultCountry: "SA", timezone: "Asia/Riyadh" }),
    );
    expect(updated.client.id).toBe(clientA);
    expect(updated.displayName).toBe("Renamed");
    expect(updated.defaultCountry?.code).toBe("SA");

    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: "SeoProperty", entityId: property.id, action: "UPDATE" }, orderBy: { createdAt: "desc" } });
    expect((audit.before as { displayName: string }).displayName).not.toBe("Renamed");
    expect((audit.after as { displayName: string }).displayName).toBe("Renamed");
  });

  it("refuses moving tasks into another client's project on edit", async () => {
    const property = (await listProperties(viewer(), { client: clientA }))[0]!;
    await expect(updateProperty(manager(), property.id, seoPropertyUpdateSchema.parse({ ...raw(), projectId: projectB }))).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses renaming onto a domain the client already has", async () => {
    await createProperty(manager(), form({ website: `${TAG}-second.com` }));
    const first = (await listProperties(viewer(), { client: clientA, q: `${TAG}-a.com` }))[0]!;
    await expect(updateProperty(manager(), first.id, seoPropertyUpdateSchema.parse({ ...raw(), website: `${TAG}-second.com` }))).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses editing a property that does not exist", async () => {
    await expect(updateProperty(manager(), "missing", seoPropertyUpdateSchema.parse(raw()))).rejects.toBeInstanceOf(NotFoundError);
  });

  // ---------------------------------------------------------------------------
  // Cities and countries
  // ---------------------------------------------------------------------------

  it("links a new city to its country, and leaves an unknown name unlinked", async () => {
    const admin = actor(["catalog.create", "catalog.edit", "catalog.view"]);
    const dubai = await createCity(admin, { name: "Dubai", slug: `dubai-${TAG}`, state: "Dubai", country: "UAE", isActive: true, order: 0 } as never);
    const nowhere = await createCity(admin, { name: "Nowhere", slug: `nowhere-${TAG}`, state: "X", country: "Atlantis", isActive: true, order: 0 } as never);
    cityIds.push(dubai.id, nowhere.id);

    const rows = await db.city.findMany({ where: { id: { in: cityIds } }, select: { slug: true, countryRef: { select: { code: true } } } });
    expect(rows.find((row) => row.slug.startsWith("dubai"))?.countryRef?.code).toBe("AE");
    expect(rows.find((row) => row.slug.startsWith("nowhere"))?.countryRef).toBeNull();
  });

  it("the deploy-time backfill links existing cities and reports the names it cannot", async () => {
    const legacy = await db.city.create({ data: { name: "Riyadh", slug: `riyadh-${TAG}`, state: "Riyadh", country: "Saudi Arabia" }, select: { id: true } });
    cityIds.push(legacy.id);
    const result = await linkCityCountries(db);
    expect(result.unrecognised).toContain("Atlantis");
    const row = await db.city.findUniqueOrThrow({ where: { id: legacy.id }, select: { countryRef: { select: { code: true } } } });
    expect(row.countryRef?.code).toBe("SA");
    // Running it again changes nothing.
    expect((await linkCityCountries(db)).linked).toBe(0);
  });
});
