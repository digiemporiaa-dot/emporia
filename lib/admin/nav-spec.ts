import type { NavChild, NavItem } from "@/components/admin/nav";
import type { Permission } from "@/lib/auth/permissions";

/**
 * Sections, their sub-sections, and the permission that reveals each one.
 *
 * A sub-item carries its own permission rather than inheriting its parent's:
 * `catalog.view` shows the Catalog module, but Redirects under Settings needs
 * `redirects.view`, and someone with only `blog.view` should see Blog under
 * Website without seeing Case studies. Filtering by the parent would show
 * links that 403 on click.
 *
 * Items marked `pending` have no route yet and render inert — the phase that
 * builds the section turns it into a link.
 */
export type NavSpec = {
  item: NavItem;
  permission: Permission;
  /** Sub-sections, each gated on its own permission. */
  children?: readonly { href: NavChild["href"]; label: string; permission: Permission }[];
};

export const NAV: readonly NavSpec[] = [
  {
    item: { kind: "link", href: "/admin", label: "Dashboard", icon: "dashboard" },
    permission: "leads.view",
  },
  {
    item: { kind: "link", href: "/admin/leads", label: "Leads", icon: "leads" },
    permission: "leads.view",
    children: [{ href: "/admin/leads/pipeline", label: "Pipeline", permission: "leads.view" }],
  },
  {
    item: { kind: "link", href: "/admin/sales", label: "Sales", icon: "sales" },
    permission: "proposals.view",
    children: [
      {
        href: "/admin/sales/opportunities",
        label: "Opportunities",
        permission: "opportunities.view",
      },
      { href: "/admin/sales/proposals", label: "Proposals", permission: "proposals.view" },
      { href: "/admin/sales/contracts", label: "Contracts", permission: "contracts.view" },
      { href: "/admin/sales/catalog", label: "Price list", permission: "proposals.view" },
    ],
  },
  {
    item: { kind: "link", href: "/admin/clients", label: "Clients", icon: "clients" },
    permission: "clients.view",
  },
  {
    item: { kind: "link", href: "/admin/projects", label: "Projects", icon: "projects" },
    permission: "projects.view",
  },
  {
    item: { kind: "link", href: "/admin/website", label: "Website", icon: "pages" },
    permission: "pages.view",
    children: [
      { href: "/admin/website/library", label: "Content library", permission: "pages.view" },
      { href: "/admin/website/templates", label: "Templates", permission: "pages.view" },
      { href: "/admin/website/pages", label: "Pages", permission: "pages.view" },
      // Formerly a top-level item of its own. It is one of the Website
      // module's screens, and listing it twice in one sidebar read as two
      // different things.
      { href: "/admin/website/sections", label: "Reusable sections", permission: "pages.view" },
      { href: "/admin/website/blog", label: "Blog", permission: "blog.view" },
      { href: "/admin/website/case-studies", label: "Case studies", permission: "casestudies.view" },
      {
        href: "/admin/website/testimonials",
        label: "Testimonials",
        permission: "testimonials.view",
      },
      { href: "/admin/website/faqs", label: "FAQs", permission: "faqs.view" },
    ],
  },
  {
    item: { kind: "link", href: "/admin/catalog", label: "Catalog", icon: "content" },
    permission: "catalog.view",
    children: [
      { href: "/admin/catalog/services", label: "Services", permission: "catalog.view" },
      { href: "/admin/catalog/cities", label: "Cities", permission: "catalog.view" },
      { href: "/admin/catalog/packages", label: "Packages", permission: "catalog.view" },
      {
        href: "/admin/catalog/service-cities",
        label: "Service-city pages",
        permission: "catalog.view",
      },
    ],
  },
  {
    item: { kind: "link", href: "/admin/content", label: "Content", icon: "content" },
    permission: "content.view",
  },
  {
    item: { kind: "link", href: "/admin/approvals", label: "Approvals", icon: "approvals" },
    permission: "approvals.view",
  },
  {
    item: { kind: "link", href: "/admin/marketing", label: "Marketing", icon: "marketing" },
    permission: "popups.view",
    children: [
      { href: "/admin/marketing/campaigns", label: "Campaigns", permission: "campaigns.view" },
      { href: "/admin/marketing/popups", label: "Popups", permission: "popups.view" },
      { href: "/admin/marketing/tracking", label: "Tracking", permission: "settings.view" },
    ],
  },
  {
    item: { kind: "link", href: "/admin/finance", label: "Finance", icon: "finance" },
    permission: "invoices.view",
    children: [
      { href: "/admin/finance/invoices", label: "Invoices", permission: "invoices.view" },
      { href: "/admin/finance/retainers", label: "Retainers", permission: "retainers.view" },
    ],
  },
  {
    item: { kind: "link", href: "/admin/media", label: "Media", icon: "media" },
    permission: "media.view",
  },
  {
    item: { kind: "link", href: "/admin/analytics", label: "Analytics", icon: "analytics" },
    permission: "analytics.view",
    children: [
      { href: "/admin/analytics/pages", label: "Page performance", permission: "analytics.view" },
    ],
  },
  {
    item: { kind: "link", href: "/admin/automation", label: "Automation", icon: "automation" },
    permission: "automation.view",
  },
  {
    item: { kind: "link", href: "/admin/ai", label: "Assistant", icon: "ai" },
    permission: "ai.use",
  },
  {
    item: { kind: "link", href: "/admin/settings", label: "Settings", icon: "settings" },
    permission: "emails.view",
    children: [
      { href: "/admin/settings/navigation", label: "Navigation", permission: "settings.view" },
      { href: "/admin/settings/email", label: "Email templates", permission: "emails.view" },
      { href: "/admin/settings/redirects", label: "Redirects", permission: "redirects.view" },
      { href: "/admin/settings/ai", label: "AI and LLM", permission: "settings.view" },
    ],
  },
];
