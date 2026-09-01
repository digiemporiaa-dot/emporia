import Link from "next/link";
import { Container, CtaButton, Eyebrow } from "@/components/website/primitives";

/**
 * Website 404, rendered inside the site shell so a visitor keeps the header,
 * footer and navigation.
 *
 * Note there is deliberately no `loading.tsx` above the public routes. A
 * loading boundary makes Next stream the shell immediately, which means the 200
 * is already sent by the time `notFound()` runs and a dead URL answers 200 with
 * a loading skeleton — which search engines would treat as a real page.
 */
export default function WebsiteNotFound() {
  return (
    <section>
      <Container className="py-20 lg:py-28">
        <Eyebrow>404</Eyebrow>
        <h1 className="mt-4 max-w-2xl text-4xl text-navy-800">
          That page doesn&rsquo;t exist.
        </h1>
        <p className="mt-5 max-w-md text-lg text-ink-muted">
          It may have moved, or the address may be mistyped.
        </p>

        <div className="mt-9 flex flex-wrap gap-3">
          <CtaButton href="/">Back to home</CtaButton>
          <CtaButton href="/services" variant="outline">
            Browse services
          </CtaButton>
        </div>

        <nav aria-label="Useful links" className="mt-14 border-t border-line pt-6">
          <ul className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            {(
              [
                { href: "/case-studies", label: "Case studies" },
                { href: "/packages", label: "Packages" },
                { href: "/blog", label: "Insights" },
                { href: "/contact", label: "Contact" },
              ] as const
            ).map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-ink-muted underline underline-offset-4 hover:text-brand-red">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Container>
    </section>
  );
}
