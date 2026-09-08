import { publishedServices } from "@/lib/content/queries";
import { siteNavigation } from "@/lib/services/navigation.service";
import { NavLink } from "@/components/website/nav-link";
import { SOCIAL_LABELS } from "@/lib/validation/navigation";

/**
 * Site footer.
 *
 * Service links come from the database, so the footer cannot drift out of sync
 * with what is actually published. Everything else — the company and legal
 * columns, the social profiles, the contact details and the copyright line —
 * comes from Settings → Navigation rather than being hardcoded here.
 */
export async function SiteFooter() {
  const [services, nav] = await Promise.all([publishedServices(), siteNavigation()]);

  const year = new Date().getFullYear();
  const hasContact = Boolean(nav.contactEmail || nav.contactPhone || nav.contactAddress);

  return (
    <footer className="bg-navy-800 text-navy-100">
      <div className="mx-auto max-w-(--container-page) px-5 py-14 lg:px-8 lg:py-20">
        <div className="grid gap-10 border-b border-navy-700 pb-12 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr] lg:gap-8">
          <div>
            <p className="font-display text-xl font-semibold tracking-tightest text-white">
              {nav.brandName}
            </p>
            {nav.tagline ? (
              <p className="mt-3 max-w-xs text-sm text-navy-300">{nav.tagline}</p>
            ) : null}

            {nav.socialLinks.length > 0 ? (
              <nav aria-label="Social" className="mt-5">
                <ul className="flex flex-wrap gap-x-4 gap-y-2">
                  {nav.socialLinks.map((social) => (
                    <li key={social.platform}>
                      <a
                        href={social.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-navy-100 underline-offset-4 transition-colors hover:text-white hover:underline"
                      >
                        {SOCIAL_LABELS[social.platform]}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
          </div>

          {services.length > 0 ? (
            <div>
              <h2 className="text-2xs font-semibold uppercase tracking-widest text-navy-300">
                Services
              </h2>
              <ul className="mt-4 space-y-2.5">
                {services.map((service) => (
                  <li key={service.slug}>
                    <NavLink
                      href={`/services/${service.slug}`}
                      className="text-sm text-navy-100 transition-colors hover:text-white"
                    >
                      {service.name}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {nav.footerCompanyLinks.length > 0 ? (
            <div>
              <h2 className="text-2xs font-semibold uppercase tracking-widest text-navy-300">
                Company
              </h2>
              <ul className="mt-4 space-y-2.5">
                {nav.footerCompanyLinks.map((item) => (
                  <li key={`${item.href}-${item.label}`}>
                    <NavLink
                      href={item.href}
                      newTab={item.newTab}
                      className="text-sm text-navy-100 transition-colors hover:text-white"
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {hasContact ? (
            <div>
              <h2 className="text-2xs font-semibold uppercase tracking-widest text-navy-300">
                Contact
              </h2>
              <address className="mt-4 space-y-2.5 text-sm not-italic text-navy-100">
                {nav.contactEmail ? (
                  <p>
                    <a
                      href={`mailto:${nav.contactEmail}`}
                      className="transition-colors hover:text-white"
                    >
                      {nav.contactEmail}
                    </a>
                  </p>
                ) : null}
                {nav.contactPhone ? (
                  <p>
                    <a
                      href={`tel:${nav.contactPhone.replace(/\s+/g, "")}`}
                      className="transition-colors hover:text-white"
                    >
                      {nav.contactPhone}
                    </a>
                  </p>
                ) : null}
                {nav.contactAddress ? <p className="text-navy-300">{nav.contactAddress}</p> : null}
              </address>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 pt-6 text-xs text-navy-300 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {nav.copyrightName}. All rights reserved.
          </p>
          {nav.footerLegalLinks.length > 0 ? (
            <div className="flex gap-5">
              {nav.footerLegalLinks.map((item) => (
                <NavLink
                  key={`${item.href}-${item.label}`}
                  href={item.href}
                  newTab={item.newTab}
                  className="transition-colors hover:text-white"
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
