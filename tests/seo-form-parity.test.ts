import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pageSeoSchema } from "@/lib/validation/seo";

/**
 * There is one SEO form, and it offers every field the schema accepts.
 *
 * There were two. `components/admin/seo-fields.tsx` was written to be the
 * single definition, and the page builder's panel carried its own copy anyway.
 * Adding `targetKeyword` to the shared component and to the schema left the
 * page builder — the screen the field exists for — without it, and nothing
 * failed: no type error, no test, just a missing box that only opening the
 * page revealed.
 *
 * The panel now renders the shared component. This test holds both halves of
 * that: the one form covers the schema, and nothing else posts SEO fields of
 * its own. A second copy would pass any test that only checked the first.
 *
 * It reads the source rather than rendering, because what matters is that a
 * field with the right `name` is posted; a form that renders it under a
 * different name is exactly as broken.
 */

const FORM = "components/admin/seo-fields.tsx";

/**
 * Files that render an SEO form around the shared fields. Each must contain no
 * `name="…"` input of its own for a field the shared component owns — that is
 * what a fork looks like on the way in.
 */
const WRAPPERS = [
  "components/admin/entity-seo-panel.tsx",
  "app/admin/website/pages/[pageId]/seo-panel.tsx",
] as const;

/** Fields the schema accepts that the form renders as something else. */
const NOT_A_TEXT_INPUT = new Set(["robotsIndex", "robotsFollow", "schemaType"]);

describe("the SEO form", () => {
  const textFields = Object.keys(pageSeoSchema.shape).filter(
    (name) => !NOT_A_TEXT_INPUT.has(name),
  );

  it("has fields to check", () => {
    expect(textFields.length).toBeGreaterThan(5);
  });

  it("offers every field the schema accepts", () => {
    const source = readFileSync(FORM, "utf8");
    const missing = textFields.filter((name) => !source.includes(`name="${name}"`));
    expect(missing).toEqual([]);
  });

  it("handles the checkboxes and the select, which are absent rather than false", () => {
    const source = readFileSync(FORM, "utf8");
    for (const name of NOT_A_TEXT_INPUT) {
      expect(source).toContain(`name="${name}"`);
    }
  });

  for (const wrapper of WRAPPERS) {
    it(`${wrapper} renders the shared fields rather than its own`, () => {
      const source = readFileSync(wrapper, "utf8");
      expect(source).toContain("<SeoFields");

      // Its own hidden inputs (pageId, entity, id) are the form's subject, not
      // SEO fields, so only the SEO names are forbidden here.
      const forked = [...textFields, ...NOT_A_TEXT_INPUT].filter((name) =>
        source.includes(`name="${name}"`),
      );
      expect(forked).toEqual([]);
    });
  }
});
