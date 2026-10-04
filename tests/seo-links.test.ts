import { describe, expect, it } from "vitest";
import { MAX_TARGETS, QUERIES_PER_PAGE, SOURCES_PER_TARGET, suggestLinks } from "@/lib/seo-intel/engine/links";
import { parsePage } from "@/lib/seo-intel/crawler/parse";

const source = (url: string, text: string, clicks = 0, inlinks = 0) => ({ url, text, clicks, inlinks });
const target = (url: string, query: string, impressions = 100, position = 8) => ({ url, query, impressions, position });

describe("internal link suggestions", () => {
  it("suggests pages that mention the query as a phrase and do not link yet", () => {
    const found = suggestLinks(
      [target("/seo", "seo agency dubai")],
      [
        source("/blog/a", "We are the best SEO agency in Dubai.", 50), // words but not the phrase
        source("/blog/b", "Choosing an SEO-agency, Dubai edition: what to ask.", 10), // phrase across punctuation
        source("/blog/c", "Hiring an seo agency dubai firms trust is hard.", 30),
        source("/blog/d", "Our seo agency dubai guide.", 99), // already links
        source("/seo", "Our seo agency dubai page."), // the target itself
        source("/blog/e", "seo agency dubaiwide coverage"), // inside a longer word
        source("/blog/f", "seo matters. the xseo agency dubai network"), // has every word, but the phrase starts inside a longer word
      ],
      new Set(["/blog/d\n/seo"]),
    );
    expect(found.map((s) => s.source)).toEqual(["/blog/c", "/blog/b"]);
    expect(found[0]).toMatchObject({ target: "/seo", query: "seo agency dubai", sourceClicks: 30, impressions: 100, position: 8 });
    expect(found[0]?.snippet).toContain("seo agency dubai");
  });

  it("is case and width insensitive, and keeps the page's own spelling in the snippet", () => {
    const found = suggestLinks([target("/ppc", "ppc dubai")], [source("/x", "Ｐｐｃ Dubai pricing explained")], new Set());
    expect(found).toHaveLength(1);
    expect(found[0]?.snippet).toBe("Ppc Dubai pricing explained");
  });

  it("trims long text to a snippet around the match", () => {
    const long = `${"a ".repeat(200)}the ppc dubai offer ${"b ".repeat(200)}`;
    const snippet = suggestLinks([target("/ppc", "ppc dubai")], [source("/x", long)], new Set())[0]!.snippet;
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThan(220);
  });

  it("limits sources per target, queries per page and targets overall", () => {
    const many = Array.from({ length: 8 }, (_, i) => source(`/s${i}`, "about local seo here", i));
    const found = suggestLinks([target("/t", "local seo")], many, new Set());
    expect(found).toHaveLength(SOURCES_PER_TARGET);
    expect(found[0]?.source).toBe("/s7");

    const queries = Array.from({ length: 5 }, (_, i) => target("/t", `word${i}`, 100 - i));
    const pages = [source("/s", queries.map((q) => q.query).join(" "))];
    expect(suggestLinks(queries, pages, new Set()).map((s) => s.query)).toHaveLength(1);
    expect(QUERIES_PER_PAGE).toBe(3);

    const targets = Array.from({ length: MAX_TARGETS + 20 }, (_, i) => target(`/t${i}`, `term${i}`));
    const text = targets.map((t) => t.query).join(" ");
    expect(suggestLinks(targets, [source("/hub", text)], new Set())).toHaveLength(MAX_TARGETS);
  });

  it("does not suggest the same source for one target twice via two queries", () => {
    const found = suggestLinks([target("/t", "seo audit", 200), target("/t", "audit checklist", 100)], [source("/s", "an seo audit checklist")], new Set());
    expect(found).toHaveLength(1);
  });

  it("escapes queries that look like patterns", () => {
    expect(suggestLinks([target("/t", "c++ (course)")], [source("/s", "learn c++ course online")], new Set())).toHaveLength(1);
  });
});

describe("page text for suggestions", () => {
  it("is the visible text only, capped", () => {
    const page = parsePage(`<html><head><title>T</title><style>.x{}</style></head><body><p>Hello <b>world</b></p><script>var no = 1</script></body></html>`, "https://e.com/");
    expect(page.text).toBe("Hello world");
    expect(parsePage(`<p>${"word ".repeat(10_000)}</p>`, "https://e.com/").text.length).toBe(20_000);
  });
});
