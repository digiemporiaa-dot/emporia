import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, toDbDate } from "@/lib/seo-intel/dates";
import { TRACKED_KEYWORDS_CAP } from "@/lib/seo-intel/engine/rankings";
import {
  addKeywords,
  keywordDetail,
  keywordOpportunities,
  keywordSuggestions,
  listKeywords,
  removeKeywords,
  setKeywordTags,
} from "@/lib/services/seo-intel/keyword.service";
import type { Actor } from "@/lib/actor/types";

/**
 * Tracked keywords against stored Search Console rows: tracking and its cap,
 * movement between periods, the ranking page, suggestions, opportunities and
 * the keyword detail — every number traced back to the seeded rows.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `kw${Date.now().toString(36)}`;
const LATEST = "2026-09-30";
const PAGE = `https://${TAG}.example.com/services/seo`;

describeDb("SEO keywords", () => {
  let staffId = "";
  let clientId = "";
  let propertyId = "";

  const staff = (permissions: string[], overrides: Partial<Actor> = {}): Actor =>
    ({ userId: staffId, name: "Staff", email: "s@x.test", type: "STAFF", roleName: "ADMIN", roleId: "r", clientId: null, ip: null, userAgent: null, permissions: new Set(permissions), ...overrides }) as Actor;
  const manager = () => staff(["seo.intelligence.view", "seo.intelligence.manage"]);
  const viewer = () => staff(["seo.intelligence.view"]);

  beforeAll(async () => {
    staffId = (await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } })).id;
    clientId = (await db.client.create({ data: { name: `Keywords ${TAG}`, slug: `keywords-${TAG}`, ownerId: staffId }, select: { id: true } })).id;
    propertyId = (await db.seoProperty.create({ data: { clientId, domain: `${TAG}.example.com`, displayName: "Keyword test", crawlFrequency: "MANUAL" }, select: { id: true } })).id;

    const totals = [];
    const queries = [];
    const pairs = [];
    for (let i = 0; i < 56; i++) {
      const day = addDays(LATEST, -i);
      const date = toDbDate(day);
      const recent = i < 28;
      totals.push({ propertyId, date, clicks: 100, impressions: 2_000, position: 9 });
      // Climbed from 12 to 5.
      queries.push({ propertyId, date, query: "seo agency dubai", clicks: recent ? 3 : 1, impressions: 40, position: recent ? 5 : 12 });
      // Fell out of the top 10.
      queries.push({ propertyId, date, query: "ppc dubai", clicks: recent ? 0 : 4, impressions: 20, position: recent ? 14 : 4 });
      // A strong top-3 query that teaches the site's own CTR at position 3.
      queries.push({ propertyId, date, query: "digital marketing agency", clicks: 15, impressions: 100, position: 3 });
      // Only in the recent period: new.
      if (recent) queries.push({ propertyId, date, query: "local seo services", clicks: 0, impressions: 1, position: 18 });
      pairs.push({ propertyId, date, query: "seo agency dubai", page: PAGE, clicks: recent ? 3 : 1, impressions: 30, position: 5 });
      pairs.push({ propertyId, date, query: "seo agency dubai", page: `https://${TAG}.example.com/`, clicks: 0, impressions: 10, position: 9 });
    }
    await db.gscDailyTotal.createMany({ data: totals });
    await db.gscQueryDaily.createMany({ data: queries });
    await db.gscQueryPageDaily.createMany({ data: pairs });
  });

  afterAll(async () => {
    if (!clientId) return;
    await db.seoProperty.deleteMany({ where: { clientId } });
    await db.client.delete({ where: { id: clientId } });
  });

  it("tracks keywords in Search Console's form, once each", async () => {
    await expect(addKeywords(viewer(), propertyId, { keywords: "x", tags: "", source: "MANUAL" })).rejects.toThrow(ForbiddenError);
    await expect(addKeywords(manager(), propertyId, { keywords: " \n ", tags: "", source: "MANUAL" })).rejects.toThrow(ValidationError);
    const result = await addKeywords(manager(), propertyId, { keywords: "SEO  Agency Dubai\nppc dubai, seo agency dubai\nmissing keyword", tags: "Dubai, SEO", source: "MANUAL" });
    expect(result).toMatchObject({ added: 3, alreadyTracked: 0 });
    const again = await addKeywords(manager(), propertyId, { keywords: "ppc dubai", tags: "", source: "MANUAL" });
    expect(again).toMatchObject({ added: 0, alreadyTracked: 1 });
    const row = await db.seoKeyword.findFirstOrThrow({ where: { propertyId, keyword: "seo agency dubai" } });
    expect(row.tags).toEqual(["dubai", "seo"]);
  });

  it("is staff-only", async () => {
    const portal = staff(["seo.intelligence.view"], { type: "CLIENT", clientId });
    await expect(listKeywords(portal, propertyId)).rejects.toThrow(ForbiddenError);
  });

  it("refuses to go over the cap, saying how many fit", async () => {
    const used = await db.seoKeyword.count({ where: { propertyId } });
    await db.seoKeyword.createMany({ data: Array.from({ length: TRACKED_KEYWORDS_CAP - used - 1 }, (_, i) => ({ propertyId, keyword: `filler ${i}` })) });
    await expect(addKeywords(manager(), propertyId, { keywords: "one\ntwo", tags: "", source: "MANUAL" })).rejects.toThrow(/1 more fit/);
    await expect(addKeywords(manager(), propertyId, { keywords: "one", tags: "", source: "MANUAL" })).resolves.toMatchObject({ added: 1 });
    await db.seoKeyword.deleteMany({ where: { propertyId, OR: [{ keyword: { startsWith: "filler " } }, { keyword: "one" }] } });
  });

  it("lists rankings with movement against the previous period and the ranking page", async () => {
    const result = await listKeywords(viewer(), propertyId, { period: "28d", perPage: 50 });
    expect(result.hasData).toBe(true);
    expect(result.period?.current).toEqual({ start: addDays(LATEST, -27), end: LATEST });
    const byKeyword = new Map(result.list.rows.map((row) => [row.keyword, row]));

    const climbing = byKeyword.get("seo agency dubai")!;
    expect(climbing.current).toMatchObject({ clicks: 84, impressions: 1_120 });
    expect(climbing.current.position).toBeCloseTo(5);
    expect(climbing.movement).toMatchObject({ status: "improved", entered: "top10" });
    expect(climbing.movement.change).toBeCloseTo(7);
    expect(climbing.page).toBe(PAGE);

    expect(byKeyword.get("ppc dubai")!.movement).toMatchObject({ status: "declined", left: "top10" });
    expect(byKeyword.get("missing keyword")!.movement.status).toBe("absent");

    expect(result.counts).toMatchObject({ improved: 1, declined: 1, "entered-top10": 1, "left-top10": 1, "not-ranking": 1 });
    expect(result.rankProvider).toBeNull();
    expect(result.pairsSince).toBe(addDays(LATEST, -55));
  });

  it("filters, searches and sorts", async () => {
    const improved = await listKeywords(viewer(), propertyId, { filter: "improved" });
    expect(improved.list.rows.map((row) => row.keyword)).toEqual(["seo agency dubai"]);
    const tagged = await listKeywords(viewer(), propertyId, { tag: "dubai" });
    expect(tagged.list.rows.map((row) => row.keyword)).toEqual(["seo agency dubai", "ppc dubai", "missing keyword"]);
    const searched = await listKeywords(viewer(), propertyId, { q: "PPC" });
    expect(searched.list.rows.map((row) => row.keyword)).toEqual(["ppc dubai"]);
    const byPosition = await listKeywords(viewer(), propertyId, { sort: "position" });
    expect(byPosition.list.rows.map((row) => row.keyword)).toEqual(["seo agency dubai", "ppc dubai", "missing keyword"]);
  });

  it("suggests untracked Search Console queries, most impressions first", async () => {
    const result = await keywordSuggestions(viewer(), propertyId);
    expect(result.list.rows.map((row) => row.query)).toEqual(["digital marketing agency", "local seo services"]);
    const searched = await keywordSuggestions(viewer(), propertyId, { q: "local" });
    expect(searched.list.total).toBe(1);
    // LIKE wildcards in the search are literal.
    expect((await keywordSuggestions(viewer(), propertyId, { q: "%" })).list.total).toBe(0);
  });

  it("finds 4–20 opportunities with the site's own CTR estimate, marking tracked ones", async () => {
    const result = await keywordOpportunities(viewer(), propertyId);
    // Own CTR at position 3: 15/100 = 0.15.
    expect(result.curve[3]).toBeCloseTo(0.15);
    const seo = result.list.rows.find((row) => row.query === "seo agency dubai")!;
    // 1,120 impressions × (0.15 − 84/1,120) = 84.
    expect(seo).toMatchObject({ band: "near-top", extraClicks: 84 });
    expect(seo.trackedId).not.toBeNull();
    const ppc = result.list.rows.find((row) => row.query === "ppc dubai")!;
    expect(ppc.band).toBe("page-two");
    // 28 impressions, below 50: not an opportunity.
    expect(result.list.rows.some((row) => row.query === "local seo services")).toBe(false);
    expect((await keywordOpportunities(viewer(), propertyId, { band: "page-two" })).list.rows.map((row) => row.query)).toEqual(["ppc dubai"]);
  });

  it("shows one keyword's daily positions and its ranking pages", async () => {
    const keyword = await db.seoKeyword.findFirstOrThrow({ where: { propertyId, keyword: "seo agency dubai" } });
    const detail = await keywordDetail(viewer(), propertyId, keyword.id);
    if (!detail.hasData) throw new Error("expected data");
    expect(detail.series).toHaveLength(56);
    expect(detail.series.at(-1)).toMatchObject({ date: LATEST, position: 5 });
    expect(detail.pages.map((row) => row.page)).toEqual([PAGE, `https://${TAG}.example.com/`]);
    await expect(keywordDetail(viewer(), "another-property", keyword.id)).rejects.toThrow(NotFoundError);
  });

  it("retags and untracks", async () => {
    const keyword = await db.seoKeyword.findFirstOrThrow({ where: { propertyId, keyword: "ppc dubai" } });
    // Another website's id cannot reach this website's keyword.
    const other = await db.seoProperty.create({ data: { clientId, domain: `other-${TAG}.example.com`, displayName: "Other", crawlFrequency: "MANUAL" }, select: { id: true } });
    await expect(removeKeywords(manager(), other.id, [keyword.id])).rejects.toThrow(NotFoundError);
    await expect(setKeywordTags(manager(), other.id, keyword.id, "x")).rejects.toThrow(NotFoundError);
    expect(await db.seoKeyword.count({ where: { id: keyword.id } })).toBe(1);
    expect(await setKeywordTags(manager(), propertyId, keyword.id, "Paid, Dubai")).toEqual(["paid", "dubai"]);
    await expect(removeKeywords(viewer(), propertyId, [keyword.id])).rejects.toThrow(ForbiddenError);
    expect(await removeKeywords(manager(), propertyId, [keyword.id])).toBe(1);
    await expect(removeKeywords(manager(), propertyId, [keyword.id])).rejects.toThrow(NotFoundError);
  });

  it("hides a deleted client's keywords", async () => {
    await db.client.update({ where: { id: clientId }, data: { deletedAt: new Date() } });
    try {
      await expect(listKeywords(viewer(), propertyId)).rejects.toThrow(NotFoundError);
    } finally {
      await db.client.update({ where: { id: clientId }, data: { deletedAt: null } });
    }
  });
});
