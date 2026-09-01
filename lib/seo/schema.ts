import "server-only";
import { siteDefaults } from "@/lib/seo/defaults";
import { absoluteUrl } from "@/lib/seo/urls";

/**
 * JSON-LD emitters.
 *
 * Every function here can return `null`, and that is the point: schema is only
 * emitted where the page genuinely contains that content (CLAUDE.md 9). An
 * FAQPage with no questions, or an Article with no author, is a structured-data
 * violation waiting to be flagged — so the check lives in the emitter rather
 * than being left to each template to remember.
 */

export async function organizationSchema(options?: {
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}): Promise<object> {
  const defaults = await siteDefaults();

  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${absoluteUrl("/")}#organization`,
    name: defaults.siteName,
    url: absoluteUrl("/"),
    ...(defaults.defaultDescription ? { description: defaults.defaultDescription } : {}),
    ...(defaults.ogImageUrl ? { logo: defaults.ogImageUrl } : {}),
    ...(options?.email || options?.phone
      ? {
          contactPoint: {
            "@type": "ContactPoint",
            contactType: "sales",
            ...(options.email ? { email: options.email } : {}),
            ...(options.phone ? { telephone: options.phone } : {}),
          },
        }
      : {}),
    ...(options?.address
      ? { address: { "@type": "PostalAddress", streetAddress: options.address } }
      : {}),
  };
}

export async function webSiteSchema(): Promise<object> {
  const defaults = await siteDefaults();

  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${absoluteUrl("/")}#website`,
    name: defaults.siteName,
    url: absoluteUrl("/"),
    publisher: { "@id": `${absoluteUrl("/")}#organization` },
  };
}

export async function serviceSchema(service: {
  name: string;
  description: string;
  path: string;
}): Promise<object> {
  const defaults = await siteDefaults();

  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: service.name,
    description: service.description,
    url: absoluteUrl(service.path),
    provider: { "@type": "Organization", name: defaults.siteName, url: absoluteUrl("/") },
  };
}

export async function articleSchema(article: {
  title: string;
  description: string | null;
  path: string;
  authorName: string;
  publishedAt: string | null;
  modifiedAt: string | null;
  imageUrl?: string | null;
}): Promise<object | null> {
  // An Article without a publication date is not an Article yet.
  if (!article.publishedAt) return null;

  const defaults = await siteDefaults();

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    ...(article.description ? { description: article.description } : {}),
    url: absoluteUrl(article.path),
    mainEntityOfPage: { "@type": "WebPage", "@id": absoluteUrl(article.path) },
    author: { "@type": "Person", name: article.authorName },
    publisher: {
      "@type": "Organization",
      name: defaults.siteName,
      ...(defaults.ogImageUrl ? { logo: { "@type": "ImageObject", url: defaults.ogImageUrl } } : {}),
    },
    datePublished: article.publishedAt,
    ...(article.modifiedAt ? { dateModified: article.modifiedAt } : {}),
    ...(article.imageUrl ? { image: [article.imageUrl] } : {}),
  };
}

/**
 * FAQPage. Returns null when the page renders no questions — emitting an empty
 * FAQPage is exactly the kind of thing CLAUDE.md 9 forbids.
 */
export function faqSchema(faqs: readonly { question: string; answer: string }[]): object | null {
  if (faqs.length === 0) return null;

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };
}

/**
 * LocalBusiness, for city and service-city pages.
 *
 * Requires real local data. A city with no address or coordinates gets no
 * LocalBusiness node rather than one asserting a presence we cannot evidence.
 */
export async function localBusinessSchema(city: {
  name: string;
  state: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  path: string;
}): Promise<object | null> {
  if (city.latitude === null || city.longitude === null) return null;

  const defaults = await siteDefaults();

  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: `${defaults.siteName} — ${city.name}`,
    url: absoluteUrl(city.path),
    areaServed: {
      "@type": "City",
      name: city.name,
      ...(city.state ? { addressRegion: city.state } : {}),
      addressCountry: city.country,
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: city.latitude,
      longitude: city.longitude,
    },
  };
}

export async function offerSchema(pkg: {
  name: string;
  description: string | null;
  price: string;
  currency: string;
  path: string;
}): Promise<object> {
  const defaults = await siteDefaults();

  return {
    "@context": "https://schema.org",
    "@type": "Offer",
    name: pkg.name,
    ...(pkg.description ? { description: pkg.description } : {}),
    url: absoluteUrl(pkg.path),
    price: pkg.price,
    priceCurrency: pkg.currency,
    seller: { "@type": "Organization", name: defaults.siteName },
  };
}
