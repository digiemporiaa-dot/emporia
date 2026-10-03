import { describe, expect, it } from "vitest";
import { countryCodeForName, countryName, isCountryCode, listCountries } from "@/lib/geo/countries";
import { INTERNAL_OWNER, seoPropertyCreateSchema, seoPropertyUpdateSchema } from "@/lib/validation/seo-intel";

/**
 * The pure half of SEO Phase 1: the country list (no market hardcoded) and
 * what the website form accepts.
 */

describe("countries", () => {
  it("lists the ISO 3166-1 countries plus Kosovo, once each", () => {
    const codes = listCountries().map((country) => country.code);
    expect(codes).toHaveLength(250);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of ["IN", "AE", "US", "GB", "SA", "SG", "AU", "XK"]) expect(codes).toContain(code);
  });

  it("leaves out groupings, placeholders and deprecated aliases", () => {
    for (const code of ["EU", "UN", "ZZ", "XA", "UK", "SU", "YU", "AN", "IC", "AC"]) expect(isCountryCode(code)).toBe(false);
  });

  it("is sorted by name", () => {
    const names = listCountries().map((country) => country.name);
    expect([...names].sort((a, b) => a.localeCompare(b, "en"))).toEqual(names);
  });

  it("names a code, and refuses what is not one", () => {
    expect(countryName("AE")).toBe("United Arab Emirates");
    expect(countryName("in")).toBeNull();
    expect(isCountryCode("in")).toBe(false);
    expect(isCountryCode("IND")).toBe(false);
  });

  it.each([
    ["India", "IN"],
    ["india", "IN"],
    ["  United   Arab Emirates ", "AE"],
    ["UAE", "AE"],
    ["USA", "US"],
    ["United States of America", "US"],
    ["United States", "US"],
    ["UK", "GB"],
    ["United Kingdom", "GB"],
    ["Turkey", "TR"],
    ["Türkiye", "TR"],
    ["Bosnia and Herzegovina", "BA"],
    ["Bosnia & Herzegovina", "BA"],
    ["Côte d’Ivoire", "CI"],
    ["AE", "AE"],
  ])("reads the name %s as %s", (name, code) => {
    expect(countryCodeForName(name)).toBe(code);
  });

  it("does not guess at a name it does not know", () => {
    expect(countryCodeForName("Atlantis")).toBeNull();
    expect(countryCodeForName("")).toBeNull();
    expect(countryCodeForName("EU")).toBeNull();
  });
});

describe("the website form", () => {
  const base = {
    owner: "client123",
    website: "https://www.Acme.com/about",
    protocol: "HTTPS",
    displayName: "Acme — main site",
    projectId: "",
    defaultCountry: "ae",
    defaultLanguage: "en-AE",
    timezone: "Asia/Dubai",
    isActive: true,
  };

  it("reduces the website to a host and keeps the typed scheme", () => {
    const parsed = seoPropertyCreateSchema.parse(base);
    expect(parsed.website).toEqual({ domain: "www.acme.com", protocol: "HTTPS" });
    expect(parsed.defaultCountry).toBe("AE");
    expect(parsed.projectId).toBeNull();
  });

  it("accepts the agency's own website as the owner", () => {
    expect(seoPropertyCreateSchema.parse({ ...base, owner: INTERNAL_OWNER }).owner).toBe(INTERNAL_OWNER);
  });

  it("requires an owner on create", () => {
    expect(seoPropertyCreateSchema.safeParse({ ...base, owner: "" }).success).toBe(false);
  });

  it("has no owner on edit, so a property cannot be moved to another client", () => {
    const parsed = seoPropertyUpdateSchema.parse({ ...base, owner: "someone-else" });
    expect("owner" in parsed).toBe(false);
  });

  it("refuses a private or unsafe website, with the reason", () => {
    const result = seoPropertyCreateSchema.safeParse({ ...base, website: "http://192.168.1.10" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/not an IP address/);
  });

  it("refuses a country that is not one", () => {
    expect(seoPropertyCreateSchema.safeParse({ ...base, defaultCountry: "EU" }).success).toBe(false);
    expect(seoPropertyCreateSchema.safeParse({ ...base, defaultCountry: "" }).data?.defaultCountry).toBeNull();
  });

  it("checks the time zone and language against the runtime, not a list in this repo", () => {
    expect(seoPropertyCreateSchema.safeParse({ ...base, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(seoPropertyCreateSchema.safeParse({ ...base, timezone: "America/Sao_Paulo" }).success).toBe(true);
    expect(seoPropertyCreateSchema.safeParse({ ...base, defaultLanguage: "english" }).success).toBe(false);
    expect(seoPropertyCreateSchema.safeParse({ ...base, defaultLanguage: "ar" }).success).toBe(true);
  });

  it("requires a name", () => {
    expect(seoPropertyCreateSchema.safeParse({ ...base, displayName: " " }).success).toBe(false);
  });
});
