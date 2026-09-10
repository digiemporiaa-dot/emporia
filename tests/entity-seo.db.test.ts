import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getEntitySeo, isSeoEntity, updateEntitySeo, SEO_ENTITIES } from "@/lib/services/seo.service";
import { ForbiddenError } from "@/lib/errors";
import type { Actor } from "@/lib/actor/types";

/**
 * SEO for catalog entities.
 *
 * The point of this module is that every entity carrying the shared `Seo`
 * relation can have all of it edited, through one code path rather than each
 * module growing its own upsert.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

function actorWith(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "SEO editor",
    email: null,
    type: "STAFF",
    roleName: "MARKETING_MANAGER",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

const EMPTY = {
  metaTitle: null,
  metaDescription: null,
  canonical: null,
  targetKeyword: null,
  ogTitle: null,
  ogDescription: null,
  ogImageId: null,
  ogImageAlt: null,
  twitterTitle: null,
  twitterDescription: null,
  twitterImageId: null,
  robotsIndex: true,
  robotsFollow: true,
  schemaType: "NONE" as const,
};

describeDb("entity SEO", () => {
  let editor: Actor;
  let cityId = "";

  beforeAll(async () => {
    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    editor = actorWith(user.id, ["seo.view", "seo.edit"]);

    const city = await db.city.create({
      data: { name: "SEO Test City", slug: `seo-test-city-${Date.now()}`, state: "Testland" },
      select: { id: true },
    });
    cityId = city.id;
  });

  afterAll(async () => {
    if (cityId) await db.city.deleteMany({ where: { id: cityId } });
  });

  it("only recognises entities that actually carry the relation", () => {
    for (const key of Object.keys(SEO_ENTITIES)) expect(isSeoEntity(key)).toBe(true);
    // A form field is not a model name.
    for (const bad of ["user", "invoice", "lead", "db", "__proto__"]) {
      expect(isSeoEntity(bad)).toBe(false);
    }
  });

  it("creates the record on first save for an entity that had none", async () => {
    const before = await getEntitySeo(editor, "city", cityId);
    expect(before.seoId).toBeNull();

    const after = await updateEntitySeo(editor, "city", cityId, {
      ...EMPTY,
      metaTitle: "Digital marketing in SEO Test City",
      metaDescription: "A description long enough to be worth having in a search result listing.",
      schemaType: "LOCAL_BUSINESS",
      robotsIndex: false,
    });

    expect(after.seoId).not.toBeNull();
    expect(after.seo?.metaTitle).toBe("Digital marketing in SEO Test City");
    expect(after.seo?.schemaType).toBe("LOCAL_BUSINESS");
    expect(after.seo?.robotsIndex).toBe(false);
  });

  it("updates in place rather than orphaning the first record", async () => {
    const first = await getEntitySeo(editor, "city", cityId);
    const second = await updateEntitySeo(editor, "city", cityId, {
      ...EMPTY,
      metaTitle: "Changed",
    });
    expect(second.seoId).toBe(first.seoId);
    expect(second.seo?.metaTitle).toBe("Changed");
    // Cleared fields really clear, rather than persisting the old value.
    expect(second.seo?.schemaType).toBe("NONE");
    expect(second.seo?.robotsIndex).toBe(true);
  });

  it("carries the whole record, not just the meta fields", async () => {
    const saved = await updateEntitySeo(editor, "city", cityId, {
      ...EMPTY,
      ogTitle: "Share title",
      ogDescription: "Share description",
      ogImageAlt: "A photograph of the city",
      twitterTitle: "Tweet title",
      robotsFollow: false,
    });
    expect(saved.seo).toMatchObject({
      ogTitle: "Share title",
      ogDescription: "Share description",
      ogImageAlt: "A photograph of the city",
      twitterTitle: "Tweet title",
      robotsFollow: false,
    });
  });

  it("is gated on seo.edit, not on the entity's own edit permission", async () => {
    const catalogOnly = actorWith(editor.userId, ["seo.view", "catalog.edit"]);
    await expect(updateEntitySeo(catalogOnly, "city", cityId, EMPTY)).rejects.toThrow(ForbiddenError);

    const noView = actorWith(editor.userId, []);
    await expect(getEntitySeo(noView, "city", cityId)).rejects.toThrow(ForbiddenError);
  });

  it("refuses an id that does not exist", async () => {
    await expect(getEntitySeo(editor, "city", "nosuchcity")).rejects.toThrow(/does not exist/i);
  });
});
