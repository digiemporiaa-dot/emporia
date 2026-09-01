import Link from "next/link";
import type { Route } from "next";
import { publishedServices, siteSettings } from "@/lib/content/queries";

/**
 * Site footer.
 *
 * Service links come from the database, so the footer cannot drift out of sync
 * with what is actually published. Contact details come from SiteSetting rather
 * than being hardcoded here.
 */

const COMPANY: readonly { href: Route; label: string }[] = [
  { href: "/about", label: "About" },
  { href: "/case-studies", label: "Work" },
  { href: "/blog", label: "Insights" },
  { href: "/careers", label: "Careers" },
  { href: "/contact", label: "Contact" },
];

export async function SiteFooter() {
  const [services, settings] = await Promise.all([
    publishedServices(),
    siteSettings(["site.email", "site.phone", "site.address", "site.tagline"]),
  ]);

  const year = new Date().getFullYear();

  return (
    <footer className="bg-navy-800 text-navy-100">
      <div className="mx-auto max-w-(--container-page) px-5 py-14 lg:px-8 lg:py-20">
        <div className="grid gap-10 border-b border-navy-700 pb-12 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr] lg:gap-8">
          <div>
            <p className="font-display text-xl font-semibold tracking-tightest text-white">
              Emporia
            </p>
            {settings["site.tagline"] ? (
              <p className="mt-3 max-w-xs text-sm text-navy-300">{settings["site.tagline"]}</p>
            ) : null}
          </div>

          <div>
            <h2 className="text-2xs font-semibold uppercase tracking-widest text-navy-300">
              Services
            </h2>
            <ul className="mt-4 space-y-2.5">
              {services.map((service) => (
                <li key={service.slug}>
                  <Link
                    href={{ pathname: "/services/[serviceSlug]", query: { serviceSlug: service.slug } }}
                    className="text-sm text-navy-100 transition-colors hover:text-white"
                  >
                    {service.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-2xs font-semibold uppercase tracking-widest text-navy-300">
              Company
            </h2>
            <ul className="mt-4 space-y-2.5">
              {COMPANY.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-sm text-navy-100 transition-colors hover:text-white"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-2xs font-semibold uppercase tracking-widest text-navy-300">
              Contact
            </h2>
            <address className="mt-4 space-y-2.5 text-sm not-italic text-navy-100">
              {settings["site.email"] ? (
                <p>
                  <a
                    href={`mailto:${settings["site.email"]}`}
                    className="transition-colors hover:text-white"
                  >
                    {settings["site.email"]}
                  </a>
                </p>
              ) : null}
              {settings["site.phone"] ? (
                <p>
                  <a
                    href={`tel:${settings["site.phone"].replace(/\s+/g, "")}`}
                    className="transition-colors hover:text-white"
                  >
                    {settings["site.phone"]}
                  </a>
                </p>
              ) : null}
              {settings["site.address"] ? (
                <p className="text-navy-300">{settings["site.address"]}</p>
              ) : null}
            </address>
          </div>
        </div>

        <div className="flex flex-col gap-3 pt-6 text-xs text-navy-300 sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} Emporia. All rights reserved.</p>
          <div className="flex gap-5">
            <Link href="/privacy-policy" className="transition-colors hover:text-white">
              Privacy policy
            </Link>
            <Link href="/terms-and-conditions" className="transition-colors hover:text-white">
              Terms
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
