import { describe, expect, it } from "vitest";
import { looksLikeSvg, sniff, svgIsDangerous } from "@/lib/media/sniff";
import { objectKey, safeFilename } from "@/lib/media/keys";
import { allowedTypeFor, extensionFor, MAX_UPLOAD_BYTES } from "@/lib/media/types";

/**
 * The phase 11 exit criterion: an upload with a spoofed extension is rejected
 * server-side.
 *
 * These are the pure halves of that — sniffing, key generation and filename
 * sanitising. The service-level half (delete the object, refuse the row) is in
 * media-upload.test.ts.
 */

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
const GIF = text("GIF89a....");
const PDF = text("%PDF-1.7\n%âãÏÓ");
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00);
const MP4 = bytes(0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d);
const ELF = bytes(0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01);
const SCRIPT = text("#!/bin/sh\nrm -rf /\n");

function webp(): Uint8Array {
  const out = new Uint8Array(16);
  out.set(text("RIFF"), 0);
  out.set(text("WEBP"), 8);
  return out;
}

describe("supported types", () => {
  it("maps every supported type to exactly one extension", () => {
    expect(extensionFor("image/png")).toBe("png");
    expect(extensionFor("image/jpeg")).toBe("jpg");
    expect(extensionFor("application/pdf")).toBe("pdf");
    expect(
      extensionFor("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBe("docx");
  });

  it("does not recognise anything outside the allowlist", () => {
    expect(allowedTypeFor("application/x-msdownload")).toBeNull();
    expect(allowedTypeFor("text/html")).toBeNull();
    expect(allowedTypeFor("application/javascript")).toBeNull();
    expect(allowedTypeFor("image/svg")).toBeNull();
    expect(extensionFor("application/x-sh")).toBeNull();
  });

  it("caps uploads well below anything a bucket would choke on", () => {
    expect(MAX_UPLOAD_BYTES).toBe(200 * 1024 * 1024);
  });
});

describe("sniffing genuine files", () => {
  it("accepts each supported format by its own bytes", () => {
    expect(sniff(PNG, "image/png").ok).toBe(true);
    expect(sniff(JPEG, "image/jpeg").ok).toBe(true);
    expect(sniff(GIF, "image/gif").ok).toBe(true);
    expect(sniff(webp(), "image/webp").ok).toBe(true);
    expect(sniff(PDF, "application/pdf").ok).toBe(true);
    expect(sniff(MP4, "video/mp4").ok).toBe(true);
    expect(
      sniff(ZIP, "application/vnd.openxmlformats-officedocument.wordprocessingml.document").ok,
    ).toBe(true);
    expect(sniff(text("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"), "image/svg+xml").ok).toBe(
      true,
    );
  });
});

describe("spoofed files", () => {
  it("rejects a PNG claiming to be a PDF", () => {
    const result = sniff(PNG, "application/pdf");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/is a PNG, not a PDF/i);
  });

  it("rejects a PDF claiming to be an image", () => {
    const result = sniff(PDF, "image/png");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/is a PDF, not a PNG/i);
  });

  it("rejects an executable claiming to be an image", () => {
    const result = sniff(ELF, "image/jpeg");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not a valid JPG/i);
  });

  it("rejects a shell script claiming to be a document", () => {
    expect(sniff(SCRIPT, "application/pdf").ok).toBe(false);
  });

  it("rejects a type that is not on the allowlist at all", () => {
    const result = sniff(PNG, "text/html");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not supported/i);
  });

  it("is not fooled by a signature appearing later in the file", () => {
    const late = new Uint8Array(64);
    late.set(text("junk"), 0);
    late.set(text("%PDF-"), 20);
    expect(sniff(late, "application/pdf").ok).toBe(false);
  });

  it("rejects a truncated file whose signature never completes", () => {
    expect(sniff(bytes(0x89, 0x50), "image/png").ok).toBe(false);
    expect(sniff(new Uint8Array(0), "image/png").ok).toBe(false);
  });
});

describe("SVG, which has no magic number", () => {
  it("accepts a plain SVG, with or without a prolog", () => {
    expect(looksLikeSvg(text("<svg viewBox=\"0 0 1 1\"></svg>"))).toBe(true);
    expect(looksLikeSvg(text("<?xml version=\"1.0\"?><svg></svg>"))).toBe(true);
    expect(looksLikeSvg(text("\n  <svg></svg>"))).toBe(true);
    expect(looksLikeSvg(text("<!-- a comment --><svg></svg>"))).toBe(true);
  });

  it("refuses HTML dressed up as an SVG", () => {
    expect(looksLikeSvg(text("<html><body></body></html>"))).toBe(false);
    expect(looksLikeSvg(text("<div><svg></svg></div>"))).toBe(false);
    expect(sniff(text("<html></html>"), "image/svg+xml").ok).toBe(false);
  });

  it("refuses an SVG carrying script", () => {
    expect(svgIsDangerous(text("<svg><script>alert(1)</script></svg>"))).toBe(true);
    expect(svgIsDangerous(text("<svg onload=\"alert(1)\"></svg>"))).toBe(true);
    expect(svgIsDangerous(text("<svg><a href=\"javascript:alert(1)\"></a></svg>"))).toBe(true);
    expect(svgIsDangerous(text("<svg><foreignObject></foreignObject></svg>"))).toBe(true);
    expect(svgIsDangerous(text("<svg><use xlink:href=\"http://evil/x.svg#a\"/></svg>"))).toBe(true);

    const result = sniff(text("<svg><script>alert(1)</script></svg>"), "image/svg+xml");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/script or external references/i);
  });

  it("allows an ordinary drawing", () => {
    const drawing = "<svg xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0h10v10H0z\"/></svg>";
    expect(svgIsDangerous(text(drawing))).toBe(false);
    expect(sniff(text(drawing), "image/svg+xml").ok).toBe(true);
  });
});

describe("object keys", () => {
  it("is opaque, date-partitioned and carries the verified extension", () => {
    const key = objectKey("image/png", new Date("2026-03-09T00:00:00Z"));
    expect(key).toMatch(/^media\/2026\/03\/[0-9a-f]{32}\.png$/);
  });

  it("never repeats", () => {
    const keys = new Set(Array.from({ length: 500 }, () => objectKey("image/jpeg")));
    expect(keys.size).toBe(500);
  });

  it("cannot be steered by the uploader", () => {
    // The key is derived from the type alone — there is no filename input.
    const key = objectKey("application/pdf");
    expect(key.endsWith(".pdf")).toBe(true);
    expect(key).not.toContain("..");
  });
});

describe("filenames", () => {
  it("keeps a sensible name and forces the verified extension", () => {
    expect(safeFilename("Brand Guidelines.pdf", "application/pdf")).toBe("Brand Guidelines.pdf");
    expect(safeFilename("logo.png", "image/png")).toBe("logo.png");
  });

  it("strips path traversal", () => {
    expect(safeFilename("../../../etc/passwd", "application/pdf")).toBe("passwd.pdf");
    expect(safeFilename("..\\..\\windows\\system32\\cmd", "application/pdf")).toBe("cmd.pdf");
    expect(safeFilename("/absolute/path/file.png", "image/png")).toBe("file.png");
  });

  it("removes a second extension rather than keeping it", () => {
    expect(safeFilename("invoice.pdf.exe", "application/pdf")).toBe("invoice.pdf.pdf");
    expect(safeFilename("photo.jpg.php", "image/jpeg")).toBe("photo.jpg.jpg");
  });

  it("strips control characters and quoting tricks", () => {
    expect(safeFilename("re\u0000port.pdf", "application/pdf")).toBe("report.pdf");
    // Everything before the last slash is a path, so only the final segment
    // survives — and nothing usable is left of it.
    expect(safeFilename("a\"; rm -rf /; \".png", "image/png")).toBe("file.png");
    expect(safeFilename("a\"; rm -rf; \".png", "image/png")).toBe("a rm -rf.png");
    expect(safeFilename("<script>.png", "image/png")).toBe("script.png");
  });

  it("always produces something", () => {
    expect(safeFilename("", "image/png")).toBe("file.png");
    expect(safeFilename("...", "image/png")).toBe("file.png");
    expect(safeFilename("/////", "image/png")).toBe("file.png");
  });

  it("caps the length", () => {
    const long = "x".repeat(500) + ".png";
    const result = safeFilename(long, "image/png");
    expect(result.length).toBeLessThanOrEqual(124);
    expect(result.endsWith(".png")).toBe(true);
  });
});
