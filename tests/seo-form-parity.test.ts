import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pageSeoSchema } from "@/lib/validation/seo";

/**
 * The two SEO forms must offer the same fields.
 *
 * `components/admin/seo-fields.tsx` was written to be the single definition of
 * the SEO form, but the page builder's panel carries its own copy — it wraps
 * the fields in a two-column layout with the score report beside them. That
 * duplication is real and is not resolved here.
 *
 * What is resolved is the failure mode. Adding `targetKeyword` to the shared
 * component and to the schema left the page builder — the screen the field
 * exists for — without it, and nothing failed: no type error, no test, just a
 * missing box that only opening the page revealed. This test is the thing that
 * would have caught it.
 *
 * It reads the source rather than rendering, because what matters is that a
 * field with the right `name` is posted; a form that renders it under a
 * different name is exactly as broken.
 */

const FORMS = [
  "components/admin/seo-fields.tsx",
  "app/admin/website/pages/[pageId]/seo-panel.tsx",
] as const;

/** Fields the schema accepts that no form is expected to render as an input. */
const NOT_A_TEXT_INPUT = new Set(["robotsIndex", "robotsFollow", "schemaType"]);

describe("SEO form parity", () => {
  const fields = Object.keys(pageSeoSchema.shape).filter((name) => !NOT_A_TEXT_INPUT.has(name));

  it("has fields to check", () => {
    expect(fields.length).toBeGreaterThan(5);
  });

  for (const form of FORMS) {
    it(`${form} offers every field the schema accepts`, () => {
      const source = readFileSync(form, "utf8");
      const missing = fields.filter((name) => !source.includes(`name="${name}"`));
      expect(missing).toEqual([]);
    });
  }

  for (const form of FORMS) {
    it(`${form} handles the checkboxes, which are absent rather than false`, () => {
      const source = readFileSync(form, "utf8");
      for (const name of ["robotsIndex", "robotsFollow", "schemaType"]) {
        expect(source).toContain(`name="${name}"`);
      }
    });
  }
});
