import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, publicationKey } from "@/lib/social/idempotency";

describe("publication keys", () => {
  it("is derived, so the same attempt always produces the same key", () => {
    expect(publicationKey("post-1", 1)).toBe(publicationKey("post-1", 1));
  });

  it("separates posts and attempts", () => {
    expect(publicationKey("post-1", 1)).not.toBe(publicationKey("post-2", 1));
    expect(publicationKey("post-1", 1)).not.toBe(publicationKey("post-1", 2));
  });

  it("refuses an attempt number that cannot be one", () => {
    expect(() => publicationKey("post-1", 0)).toThrow();
    expect(() => publicationKey("post-1", -1)).toThrow();
    expect(() => publicationKey("post-1", 1.5)).toThrow();
  });

  it("caps automatic retries", () => {
    expect(MAX_ATTEMPTS).toBeGreaterThan(1);
    expect(MAX_ATTEMPTS).toBeLessThan(10);
  });
});
