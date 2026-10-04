import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compareNap,
  localitiesMatch,
  missingSchemaFields,
  namesMatch,
  napReport,
  phonesMatch,
  streetsMatch,
  type NapTruth,
} from "@/lib/seo-intel/engine/nap";
import { monthlyReviews, reviewStats } from "@/lib/seo-intel/engine/reviews";
import { GoogleBusinessProvider } from "@/lib/social/google-business";
import { startGoogleBusinessDouble, type GoogleBusinessDouble } from "./support/google-business-double";
import type { BusinessEntity } from "@/lib/seo-intel/crawler/parse";

const truth: NapTruth = {
  names: ["Northwind Studio", "Northwind Studio Pvt Ltd"],
  street: "12, MG Road, Camp",
  locality: "Pune",
  region: "MH",
  postalCode: "411 001",
  country: "IN",
  phone: "+91 98765 43210",
};
const entity = (over: Partial<BusinessEntity> = {}): BusinessEntity => ({
  types: ["ProfessionalService"],
  name: "Northwind Studio",
  telephone: "098765 43210",
  address: { street: "12 M.G. Rd, Camp", locality: "Pune", region: "Maharashtra", postalCode: "411001", country: "IN" },
  hasGeo: true,
  hasHours: true,
  url: null,
  ...over,
});

describe("NAP comparisons", () => {
  it("phones by their last ten digits", () => {
    expect(phonesMatch("+91 98765 43210", "098765-43210")).toBe(true);
    expect(phonesMatch("+91 98765 43210", "+91 98765 43211")).toBe(false);
    expect(phonesMatch("020 2612 3456", "+91 20 2612 3456")).toBe(true);
    expect(phonesMatch("12345", "12345")).toBe(false);
  });

  it("names, streets and cities forgivingly", () => {
    expect(namesMatch("Northwind Studio — Pune", truth.names)).toBe(true);
    expect(namesMatch("northwind", truth.names)).toBe(true);
    expect(namesMatch("Contoso Media", truth.names)).toBe(false);
    expect(namesMatch("---", truth.names)).toBe(false);
    expect(streetsMatch("12 M.G. Rd, Camp", "12, MG Road, Camp")).toBe(true); // 3 of 4 words agree
    expect(streetsMatch("12 MG Rd, Camp", "12, MG Road, Camp")).toBe(true);
    expect(streetsMatch("Shop No 4, 12 MG Road", "12 MG Road")).toBe(true);
    expect(streetsMatch("7 Park Street", "12 MG Road")).toBe(false);
    expect(streetsMatch("", "12 MG Road")).toBe(false);
    expect(localitiesMatch("Pune", "PUNE")).toBe(true);
    expect(localitiesMatch("Navi Mumbai", "Mumbai")).toBe(true);
    expect(localitiesMatch("Pune", "Mumbai")).toBe(false);
    expect(localitiesMatch("", "Pune")).toBe(false);
  });

  it("compareNap reports each disagreeing field; missing is not a mismatch", () => {
    expect(compareNap(truth, { name: "Northwind Studio", phone: "9876543210", street: "12 MG Rd Camp", locality: "Pune", postalCode: "411001" })).toEqual([]);
    expect(compareNap(truth, { name: null, phone: null, street: null, locality: null, postalCode: null })).toEqual([]);
    expect(compareNap(truth, { name: "Contoso", phone: "+91 11 2222 3333", street: "7 Park Street", locality: "Mumbai", postalCode: "400001" }).map((m) => m.field)).toEqual([
      "name", "phone", "street", "locality", "postalCode",
    ]);
    expect(compareNap({ ...truth, names: [] }, { name: "Anything", phone: null, street: null, locality: null, postalCode: null })).toEqual([]);
    expect(compareNap(truth, { name: null, phone: "1", street: null, locality: null, postalCode: null })[0]).toEqual({ field: "phone", expected: truth.phone, found: "1" });
  });

  it("schema fields: required and recommended", () => {
    expect(missingSchemaFields(entity())).toEqual({ required: [], recommended: [] });
    expect(missingSchemaFields(entity({ name: null, telephone: null, address: null, hasGeo: false, hasHours: false }))).toEqual({
      required: ["name", "telephone", "streetAddress", "addressLocality", "postalCode", "addressCountry"],
      recommended: ["geo", "openingHours"],
    });
  });

  it("the report: schema mismatches, incomplete entities, the phone on the site, other phones, listings", () => {
    const pages = [
      { url: "https://e.com/", localBusiness: [entity({ address: { street: "12 MG Road, Camp", locality: "Pune", region: null, postalCode: "411002", country: null } })], phones: ["+91-98765-43210", "+91 22 1111 2222"] },
      { url: "https://e.com/contact", localBusiness: [], phones: ["022 1111 2222"] },
      { url: "https://e.com/about", localBusiness: [entity({ hasGeo: false })], phones: [] },
    ];
    const report = napReport(truth, pages, [{ name: "Pune", subject: { name: "Northwind Studio", phone: "+91 20 5555 6666", street: null, locality: "Pune", postalCode: null } }]);
    expect(report.schemaPages).toBe(2);
    expect(report.schemaMismatches).toEqual([{ url: "https://e.com/", entity: "Northwind Studio", mismatches: [{ field: "postalCode", expected: "411 001", found: "411002" }] }]);
    expect(report.incomplete).toEqual([
      { url: "https://e.com/", entity: "Northwind Studio", required: ["addressCountry"], recommended: [] },
      { url: "https://e.com/about", entity: "Northwind Studio", required: [], recommended: ["geo"] },
    ]);
    expect(report.phoneOnSite).toBe(true);
    expect(report.otherPhones).toEqual([{ phone: "+91 22 1111 2222", pages: 2 }]);
    expect(report.listing).toEqual([{ name: "Pune", mismatches: [{ field: "phone", expected: truth.phone, found: "+91 20 5555 6666" }] }]);
  });

  it("phone on site: found only through schema, missing, or unknowable without a profile phone", () => {
    expect(napReport(truth, [{ url: "u", localBusiness: [entity()], phones: [] }], []).phoneOnSite).toBe(true);
    expect(napReport(truth, [{ url: "u", localBusiness: [], phones: ["+1 555 0100 999"] }], []).phoneOnSite).toBe(false);
    expect(napReport({ ...truth, phone: null }, [{ url: "u", localBusiness: [], phones: ["+1 555 0100 999"] }], []).phoneOnSite).toBeNull();
  });
});

describe("review figures", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const daysAgo = (n: number, hours = 0) => new Date(now.getTime() - n * 86_400_000 - hours * 3_600_000);
  const r = (rating: number, days: number, replyAfterHours: number | null = null) => ({
    rating,
    createdAt: daysAgo(days),
    replyComment: replyAfterHours === null ? null : "Thanks!",
    repliedAt: replyAfterHours === null ? null : new Date(daysAgo(days).getTime() + replyAfterHours * 3_600_000),
  });

  it("velocity, averages, unanswered, reply time and quiet days", () => {
    const reviews = [r(5, 2, 4), r(2, 5), r(4, 20), r(5, 40, 10), r(1, 45, 30), r(3, 200)];
    const stats = reviewStats(reviews, now, { unansweredDays: 30, lowRating: 3 });
    expect(stats).toEqual({
      total: 6,
      last30: 3,
      previous30: 2,
      recentAverage: (5 + 2 + 4 + 5 + 1) / 5,
      allAverage: 20 / 6,
      unanswered: 2,
      unansweredLow: 1,
      medianReplyHours: 10,
      daysSinceLast: 2,
    });
    expect(reviewStats(reviews, now, { unansweredDays: 3, lowRating: 3 }).unanswered).toBe(0);
    expect(reviewStats([r(5, 1, 2), r(5, 1, 6)], now, { unansweredDays: 30, lowRating: 3 }).medianReplyHours).toBe(4);
    expect(reviewStats([], now, { unansweredDays: 30, lowRating: 3 })).toMatchObject({ total: 0, recentAverage: null, allAverage: null, medianReplyHours: null, daysSinceLast: null });
  });

  it("monthly counts and averages, oldest first, months with none included", () => {
    const months = monthlyReviews([r(5, 2), r(3, 3), r(4, 40), r(5, 400)], now, 3);
    expect(months).toEqual([
      { month: "2026-08", count: 1, average: 4 },
      { month: "2026-09", count: 0, average: null },
      { month: "2026-10", count: 2, average: 4 },
    ]);
  });
});

describe("Business Profile adapter: listing and reviews", () => {
  let double: GoogleBusinessDouble;
  let provider: GoogleBusinessProvider;
  const credentials = { accessToken: "gbp-access", refreshToken: null, expiresAt: null };
  const ref = { externalId: "locations/1001", externalParentId: "accounts/111" };

  beforeAll(async () => {
    double = await startGoogleBusinessDouble();
    provider = new GoogleBusinessProvider({ clientId: "c", clientSecret: "s", accountsBase: double.url, infoBase: double.url, postsBase: double.url, timeoutMs: 2_000 });
  });
  afterAll(() => double.close());

  it("reads the listing's title, address, phone and website", async () => {
    expect(await provider.getListing(credentials, ref)).toEqual({
      title: "Northwind Studio",
      address: { lines: ["14 Hill Road"], locality: "Bandra", region: "Maharashtra", postalCode: "400050", country: "IN" },
      phone: "022 4000 1001",
      website: "https://northwind.example/",
    });
    expect(double.requests.at(-1)?.query["readMask"]).toContain("phoneNumbers");
    await expect(provider.getListing(credentials, { externalId: "nope", externalParentId: null })).rejects.toThrow(/not a Business Profile location/);
  });

  it("pages through reviews, maps stars, hides anonymous names, skips unusable rows", async () => {
    const list = Array.from({ length: 120 }, (_, i) => ({
      reviewId: `r${i}`,
      reviewer: { displayName: `Person ${i}`, isAnonymous: i === 1 },
      starRating: ["ONE", "TWO", "THREE", "FOUR", "FIVE"][i % 5],
      comment: i === 0 ? "Great work" : undefined,
      createTime: new Date(Date.UTC(2026, 8, 1) - i * 86_400_000).toISOString(),
      updateTime: new Date(Date.UTC(2026, 8, 2) - i * 86_400_000).toISOString(),
      ...(i === 0 ? { reviewReply: { comment: "Thank you", updateTime: "2026-09-01T10:00:00Z" } } : {}),
    }));
    list.push({ reviewId: "bad", starRating: "STAR_RATING_UNSPECIFIED", createTime: "2026-01-01T00:00:00Z" } as (typeof list)[number]);
    double.setReviews("locations/1001", list, { averageRating: 4.2, totalReviewCount: 121 });
    const page = await provider.listReviews(credentials, ref);
    expect(page.reviews).toHaveLength(120);
    expect(page).toMatchObject({ averageRating: 4.2, totalReviewCount: 121, complete: true });
    expect(page.reviews[0]).toEqual({
      externalId: "r0",
      rating: 1,
      comment: "Great work",
      reviewerName: "Person 0",
      createdAt: new Date("2026-09-01T00:00:00Z"),
      updatedAt: new Date("2026-09-02T00:00:00Z"),
      replyComment: "Thank you",
      repliedAt: new Date("2026-09-01T10:00:00Z"),
    });
    expect(page.reviews[1]).toMatchObject({ reviewerName: null, rating: 2, replyComment: null, repliedAt: null });
    const reviewCalls = double.requests.filter((req) => req.path.endsWith("/reviews"));
    expect(reviewCalls.slice(-3).map((req) => req.query["pageToken"] ?? null)).toEqual([null, "50", "100"]);
    expect(reviewCalls.at(-1)?.path).toBe("/v4/accounts/111/locations/1001/reviews");
  });

  it("stops at the cap and says the read was incomplete", async () => {
    double.setReviews("locations/1001", Array.from({ length: 120 }, (_, i) => ({ reviewId: `c${i}`, starRating: "FIVE", createTime: "2026-09-01T00:00:00Z" })));
    const page = await provider.listReviews(credentials, ref, 60);
    expect(page.reviews).toHaveLength(60);
    expect(page.complete).toBe(false);
    expect((await provider.listReviews(credentials, ref, 120)).complete).toBe(true);
  });

  it("needs the location's account, and explains Google's refusals", async () => {
    await expect(provider.listReviews(credentials, { externalId: "locations/1001", externalParentId: null })).rejects.toThrow(/missing its Google account/);
    double.failWith("reviews", 429, { error: { status: "RESOURCE_EXHAUSTED" } });
    await expect(provider.listReviews(credentials, ref)).rejects.toThrow(/quota/);
  });
});
