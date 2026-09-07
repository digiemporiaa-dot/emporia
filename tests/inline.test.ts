import { describe, expect, it } from "vitest";
import { inlineToText, parseInline } from "@/lib/content/inline";

describe("parseInline", () => {
  it("splits paragraphs on blank lines and joins soft wraps", () => {
    const paragraphs = parseInline("One line\nstill one.\n\nSecond.");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]?.spans[0]?.text).toBe("One line still one.");
  });

  it("marks bold and italic", () => {
    const [p] = parseInline("plain **bold** and *italic* end");
    expect(p?.spans).toEqual([
      { text: "plain " },
      { text: "bold", bold: true },
      { text: " and " },
      { text: "italic", italic: true },
      { text: " end" },
    ]);
  });

  it("links internal paths", () => {
    const [p] = parseInline("See [our services](/services).");
    expect(p?.spans[1]).toEqual({ text: "our services", href: "/services" });
  });

  it("renders an external link as text rather than an outbound link", () => {
    const [p] = parseInline("Go to [somewhere](https://evil.example.com) now.");
    expect(p?.spans[1]).toEqual({ text: "somewhere" });
    expect(p?.spans.some((s) => s.href)).toBe(false);
  });

  it("refuses a javascript: url the same way", () => {
    const [p] = parseInline("[click](javascript:alert(1))");
    expect(p?.spans[0]).toEqual({ text: "click" });
    expect(p?.spans[0]?.href).toBeUndefined();
  });

  it("leaves an unclosed marker as literal text", () => {
    const [p] = parseInline("two * three and **unclosed");
    expect(p?.spans).toEqual([{ text: "two * three and **unclosed" }]);
  });

  it("never emits markup, only text and flags", () => {
    const [p] = parseInline("<script>alert(1)</script> **x**");
    expect(p?.spans[0]?.text).toBe("<script>alert(1)</script> ");
    expect(p?.spans[1]).toEqual({ text: "x", bold: true });
  });

  it("drops empty paragraphs", () => {
    expect(parseInline("\n\n   \n\n")).toEqual([]);
  });

  it("flattens to plain text", () => {
    expect(inlineToText("**Bold** and [link](/x).\n\nNext.")).toBe("Bold and link.\n\nNext.");
  });
});
