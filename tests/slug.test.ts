import { describe, expect, it } from "vitest";
import { isReservedSlug, slugify, uniqueSlug } from "@/lib/utils/slug";
import { pageSlugSchema } from "@/lib/validation/slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Digital Marketing In Gurgaon")).toBe("digital-marketing-in-gurgaon");
  });

  it("strips accents rather than dropping the letter", () => {
    expect(slugify("Café Noir")).toBe("cafe-noir");
  });

  it("collapses runs of punctuation and trims the edges", () => {
    expect(slugify("  --Hello,   World!!  ")).toBe("hello-world");
  });

  it("does not leave a trailing hyphen after truncating at 80 characters", () => {
    const slug = slugify(`${"a".repeat(79)} tail`);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("returns empty for text with no Latin equivalent, rather than inventing one", () => {
    expect(slugify("नमस्ते")).toBe("");
  });
});

describe("reserved slugs", () => {
  it("reserves paths that already have a real route", () => {
    for (const slug of ["services", "blog", "contact", "admin", "portal", "api", "home"]) {
      expect(isReservedSlug(slug)).toBe(true);
    }
  });

  it("leaves ordinary slugs alone", () => {
    expect(isReservedSlug("seo-audit-offer")).toBe(false);
  });

  it("is rejected by the page slug schema, not merely flagged", () => {
    expect(pageSlugSchema.safeParse("services").success).toBe(false);
    expect(pageSlugSchema.safeParse("seo-audit-offer").success).toBe(true);
  });

  it("still accepts a reserved word as part of a longer slug", () => {
    expect(pageSlugSchema.safeParse("services-for-startups").success).toBe(true);
  });
});

describe("uniqueSlug", () => {
  it("returns the base when it is free", async () => {
    const slug = await uniqueSlug("Landing Page", async () => false);
    expect(slug).toBe("landing-page");
  });

  it("suffixes until it finds a free slug", async () => {
    const taken = new Set(["landing-page", "landing-page-2"]);
    const slug = await uniqueSlug("Landing Page", async (c) => taken.has(c));
    expect(slug).toBe("landing-page-3");
  });

  it("skips reserved slugs instead of handing back a shadowed URL", async () => {
    const slug = await uniqueSlug("Services", async () => false);
    expect(slug).toBe("services-2");
  });

  it("throws rather than returning an empty slug", async () => {
    await expect(uniqueSlug("नमस्ते", async () => false)).rejects.toThrow(/derive a slug/);
  });

  it("gives up instead of looping forever when everything is taken", async () => {
    await expect(uniqueSlug("Landing Page", async () => true, 3)).rejects.toThrow(/free slug/);
  });
});
