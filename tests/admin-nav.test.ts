import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NAV } from "@/lib/admin/nav-spec";
import { PERMISSIONS } from "@/lib/auth/permissions";

/**
 * The admin sidebar.
 *
 * Two things go wrong with a hand-written navigation: a link points at a route
 * that does not exist, and an item is revealed by a permission that does not
 * open the page behind it. Typed routes catch the first for literal hrefs, but
 * not that the sub-item's *permission* is the right one — so both are asserted
 * here against the filesystem and the permission catalogue.
 */

const permissions = new Set<string>(PERMISSIONS);

/** `/admin/website/blog` → the file Next would render. */
function routeFile(href: string): string {
  return `app${href}/page.tsx`;
}

const links = NAV.flatMap((entry) => (entry.item.kind === "link" ? [entry] : []));
const children = NAV.flatMap((entry) =>
  (entry.children ?? []).map((child) => ({ ...child, parent: entry.item.label })),
);

describe("admin navigation", () => {
  it("has something to check", () => {
    expect(links.length).toBeGreaterThan(10);
    expect(children.length).toBeGreaterThan(15);
  });

  it("points every module at a route that exists", () => {
    const missing = links.filter((entry) =>
      entry.item.kind === "link" ? !existsSync(routeFile(entry.item.href)) : false,
    );
    expect(missing.map((entry) => entry.item.label)).toEqual([]);
  });

  it("points every sub-section at a route that exists", () => {
    const missing = children.filter((child) => !existsSync(routeFile(child.href)));
    expect(missing.map((child) => child.href)).toEqual([]);
  });

  it("reveals every module with a permission that exists", () => {
    const unknown = links.filter((entry) => !permissions.has(entry.permission));
    expect(unknown.map((entry) => entry.permission)).toEqual([]);
  });

  it("reveals every sub-section with a permission that exists", () => {
    const unknown = children.filter((child) => !permissions.has(child.permission));
    expect(unknown.map((child) => child.permission)).toEqual([]);
  });

  it("gives each sub-section its own permission, not the parent's by default", () => {
    // Not that they must differ — Catalog's four screens share `catalog.view`
    // honestly. What matters is that the ones the project separates stay
    // separated, so a link that would 403 is never rendered.
    const website = NAV.find((entry) => entry.item.label === "Website");
    const byLabel = new Map(website?.children?.map((c) => [c.label, c.permission]));
    expect(byLabel.get("Blog")).toBe("blog.view");
    expect(byLabel.get("Case studies")).toBe("casestudies.view");
    expect(byLabel.get("FAQs")).toBe("faqs.view");

    const settings = NAV.find((entry) => entry.item.label === "Settings");
    const settingsBy = new Map(settings?.children?.map((c) => [c.label, c.permission]));
    expect(settingsBy.get("Redirects")).toBe("redirects.view");
    expect(settingsBy.get("Email templates")).toBe("emails.view");
  });

  it("nests a sub-section under the module it belongs to", () => {
    for (const entry of NAV) {
      if (entry.item.kind !== "link" || !entry.children) continue;
      for (const child of entry.children) {
        // The dashboard is the one module whose href is a prefix of everything.
        if (entry.item.href === "/admin") continue;
        expect(child.href.startsWith(`${entry.item.href}/`)).toBe(true);
      }
    }
  });

  it("lists no route twice", () => {
    const hrefs = [
      ...links.flatMap((entry) => (entry.item.kind === "link" ? [entry.item.href] : [])),
      ...children.map((child) => child.href),
    ];
    // Reusable sections used to appear as a top-level item *and* under Website;
    // one sidebar showing the same screen twice reads as two different things.
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("names every module and sub-section", () => {
    for (const entry of NAV) {
      expect(entry.item.label.trim().length).toBeGreaterThan(0);
      for (const child of entry.children ?? []) {
        expect(child.label.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
