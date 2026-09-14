import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A 204 carries no body.
 *
 * `NextResponse.json(x, { status: 204 })` throws "Invalid response status code
 * 204" at runtime, so a route meaning "quietly ignore this" answers 500
 * instead. The popup event route shipped with exactly that bug and every
 * beacon from a visitor with no cookie hit it; it was found by copying the
 * pattern into the experiment route and then actually calling it.
 *
 * Nothing in the type system catches it, so this does: no route may build a
 * 204 with a body.
 */

const ROUTES = [
  "app/api/popups/event/route.ts",
  "app/api/experiments/exposure/route.ts",
] as const;

describe("204 responses carry no body", () => {
  for (const route of ROUTES) {
    it(`${route} does not build a 204 with NextResponse.json`, () => {
      // Comments are stripped first: the fix carries an explanation that names
      // both `NextResponse.json` and `status: 204`, and matching that would be
      // the guard failing on the note that describes it.
      const source = readFileSync(route, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");

      const offending = source
        .split(";")
        .filter((line) => line.includes("status: 204") && line.includes("NextResponse.json"));
      expect(offending).toEqual([]);
    });

    it(`${route} still answers 204 somewhere, rather than having dropped the case`, () => {
      // Guarding against the other fix: deleting the branch instead of
      // correcting it would also make this file pass the check above.
      expect(readFileSync(route, "utf8")).toContain("status: 204");
    });
  }
});
