import { createHash } from "node:crypto";
import { Parser } from "htmlparser2";
import { normalizeUrl } from "@/lib/seo-intel/crawler/url";

/**
 * What the crawler reads from one HTML page. Static HTML only: content a page
 * builds in the browser with JavaScript is not seen, and the screens say so.
 */
export type ParsedLink = { url: string; anchor: string; nofollow: boolean };

export type ParsedPage = {
  title: string | null;
  description: string | null;
  metaRobots: string | null;
  canonical: string | null;
  lang: string | null;
  hreflang: { lang: string; href: string }[];
  h1: string | null;
  h1Count: number;
  h2Count: number;
  wordCount: number;
  contentHash: string | null;
  schemaTypes: string[];
  /** Business entities from JSON-LD, for NAP and local schema checks. */
  localBusiness: BusinessEntity[];
  /** `tel:` link targets, as written, deduplicated. */
  phones: string[];
  imageCount: number;
  imagesMissingAlt: number;
  links: ParsedLink[];
  /** Visible text, single-spaced, capped — for internal link suggestions only, never kept. */
  text: string;
};

export type BusinessAddress = { street: string | null; locality: string | null; region: string | null; postalCode: string | null; country: string | null };

export type BusinessEntity = {
  types: string[];
  name: string | null;
  telephone: string | null;
  /** A PostalAddress, or a plain string address kept in `street`. */
  address: BusinessAddress | null;
  hasGeo: boolean;
  hasHours: boolean;
  url: string | null;
};

export const MAX_PAGE_TEXT = 20_000;
const MAX_ENTITIES = 5;
const MAX_PHONES = 10;

/**
 * Direct LocalBusiness subtypes in schema.org plus the common deeper ones.
 * Anything else counts as a business entity only when it carries an address.
 */
export const LOCAL_BUSINESS_TYPES = new Set([
  "LocalBusiness", "AnimalShelter", "ArchiveOrganization", "AutomotiveBusiness", "ChildCare", "Dentist",
  "DryCleaningOrLaundry", "EmergencyService", "EmploymentAgency", "EntertainmentBusiness", "FinancialService",
  "FoodEstablishment", "GovernmentOffice", "HealthAndBeautyBusiness", "HomeAndConstructionBusiness", "InternetCafe",
  "LegalService", "Library", "LodgingBusiness", "MedicalBusiness", "ProfessionalService", "RadioStation",
  "RealEstateAgent", "RecyclingCenter", "SelfStorage", "ShoppingCenter", "SportsActivityLocation", "Store",
  "TelevisionStation", "TouristInformationCenter", "TravelAgency", "AccountingService", "Attorney", "AutoRepair",
  "Bakery", "BeautySalon", "Cafe", "CafeOrCoffeeShop", "Electrician", "GeneralContractor", "HairSalon", "Hotel",
  "InsuranceAgency", "Locksmith", "MedicalClinic", "Notary", "Physician", "Plumber", "Restaurant", "RoofingContractor",
]);

const SKIP_TEXT = new Set(["script", "style", "noscript", "template", "svg", "head", "title"]);
const BLOCK = new Set(["p", "div", "li", "br", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "tr", "section", "article", "header", "footer", "nav", "main", "aside", "blockquote", "pre"]);
const MAX_LINKS = 1_000;
const MAX_TEXT = 2_000;

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cap(value: string | null, length = MAX_TEXT): string | null {
  if (value === null) return null;
  const cleaned = clean(value);
  return cleaned ? cleaned.slice(0, length) : null;
}

/** `@type` values from JSON-LD, following `@graph` and nested objects. */
function collectTypes(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 6 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectTypes(item, into, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  const type = record["@type"];
  if (typeof type === "string") into.add(type);
  else if (Array.isArray(type)) for (const t of type) if (typeof t === "string") into.add(t);
  for (const [key, child] of Object.entries(record)) {
    if (key !== "@context") collectTypes(child, into, depth + 1);
  }
}

function str(value: unknown): string | null {
  if (typeof value === "string") return cap(value, 300);
  if (typeof value === "number") return String(value);
  return null;
}

function typesOf(record: Record<string, unknown>): string[] {
  const type = record["@type"];
  if (typeof type === "string") return [type];
  if (Array.isArray(type)) return type.filter((t): t is string => typeof t === "string");
  return [];
}

function addressOf(value: unknown): BusinessAddress | null {
  if (Array.isArray(value)) return addressOf(value[0]);
  if (typeof value === "string") return value.trim() ? { street: cap(value, 300), locality: null, region: null, postalCode: null, country: null } : null;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const country = record["addressCountry"];
  const address = {
    street: str(record["streetAddress"]),
    locality: str(record["addressLocality"]),
    region: str(record["addressRegion"]),
    postalCode: str(record["postalCode"]),
    country: str(country) ?? (country && typeof country === "object" ? str((country as Record<string, unknown>)["name"]) : null),
  };
  return Object.values(address).some(Boolean) ? address : null;
}

/** Business entities in JSON-LD, following `@graph` and nesting like `collectTypes`. */
function collectBusinesses(value: unknown, into: BusinessEntity[], depth = 0): void {
  if (depth > 6 || value === null || typeof value !== "object" || into.length >= MAX_ENTITIES) return;
  if (Array.isArray(value)) {
    for (const item of value) collectBusinesses(item, into, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  const types = typesOf(record);
  const address = addressOf(record["address"]);
  if (types.length && (types.some((type) => LOCAL_BUSINESS_TYPES.has(type)) || address)) {
    into.push({
      types: types.slice(0, 5),
      name: str(record["name"]),
      telephone: str(record["telephone"]),
      address,
      hasGeo: !!record["geo"] && typeof record["geo"] === "object",
      hasHours: !!(record["openingHoursSpecification"] || record["openingHours"]),
      url: str(record["url"]),
    });
  }
  for (const [key, child] of Object.entries(record)) {
    if (key !== "@context" && key !== "address" && key !== "geo") collectBusinesses(child, into, depth + 1);
  }
}

export function parsePage(html: string, pageUrl: string): ParsedPage {
  let base = pageUrl;
  let title: string | null = null;
  let titleBuffer: string | null = null;
  let description: string | null = null;
  const robots: string[] = [];
  let canonical: string | null = null;
  let lang: string | null = null;
  const hreflang: { lang: string; href: string }[] = [];
  let h1: string | null = null;
  let h1Buffer: string | null = null;
  let h1Count = 0;
  let h2Count = 0;
  const types = new Set<string>();
  const businesses: BusinessEntity[] = [];
  const phones = new Set<string>();
  let jsonLd: string | null = null;
  let imageCount = 0;
  let imagesMissingAlt = 0;
  const links = new Map<string, ParsedLink>();
  let anchor: { href: string; nofollow: boolean; text: string } | null = null;
  let skipDepth = 0;
  const textParts: string[] = [];

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        const tag = name.toLowerCase();
        if (SKIP_TEXT.has(tag)) skipDepth += 1;
        if (BLOCK.has(tag)) textParts.push(" ");

        switch (tag) {
          case "html":
            if (attrs["lang"]) lang = attrs["lang"].trim() || null;
            break;
          case "base":
            if (attrs["href"]) base = normalizeUrl(attrs["href"], pageUrl) ?? base;
            break;
          case "title":
            if (title === null && titleBuffer === null) titleBuffer = "";
            break;
          case "meta": {
            const metaName = (attrs["name"] ?? "").toLowerCase();
            const content = attrs["content"] ?? "";
            if (metaName === "description" && description === null) description = content;
            if (metaName === "robots" || metaName === "googlebot") robots.push(content);
            break;
          }
          case "link": {
            const rel = (attrs["rel"] ?? "").toLowerCase().split(/\s+/);
            const href = attrs["href"];
            if (!href) break;
            if (rel.includes("canonical") && canonical === null) canonical = normalizeUrl(href, base);
            if (rel.includes("alternate") && attrs["hreflang"]) {
              const target = normalizeUrl(href, base);
              if (target) hreflang.push({ lang: attrs["hreflang"].trim().toLowerCase(), href: target });
            }
            break;
          }
          case "h1":
            h1Count += 1;
            if (h1 === null && h1Buffer === null) h1Buffer = "";
            break;
          case "h2":
            h2Count += 1;
            break;
          case "img":
            imageCount += 1;
            if (!("alt" in attrs)) imagesMissingAlt += 1;
            break;
          case "a": {
            const href = attrs["href"];
            if (href && /^\s*tel:/i.test(href) && phones.size < MAX_PHONES) {
              let phone = href.trim().slice(4);
              try {
                phone = decodeURIComponent(phone);
              } catch {
                // Kept as written.
              }
              phone = phone.trim().slice(0, 40);
              if (phone) phones.add(phone);
            }
            const target = href ? normalizeUrl(href, base) : null;
            const rel = (attrs["rel"] ?? "").toLowerCase();
            anchor = target ? { href: target, nofollow: /\bnofollow\b/.test(rel), text: "" } : null;
            break;
          }
          case "script":
            if ((attrs["type"] ?? "").toLowerCase() === "application/ld+json") jsonLd = "";
            break;
        }
        if (attrs["itemtype"]) {
          for (const itemType of attrs["itemtype"].split(/\s+/)) {
            const last = itemType.replace(/\/+$/, "").split("/").pop();
            if (last) types.add(last);
          }
        }
      },
      ontext(text) {
        if (titleBuffer !== null) titleBuffer += text;
        if (jsonLd !== null) jsonLd += text;
        if (skipDepth > 0) return;
        if (h1Buffer !== null) h1Buffer += text;
        if (anchor) anchor.text += text;
        textParts.push(text);
      },
      onclosetag(name) {
        const tag = name.toLowerCase();
        if (SKIP_TEXT.has(tag)) skipDepth = Math.max(0, skipDepth - 1);
        if (BLOCK.has(tag)) textParts.push(" ");
        if (tag === "title" && titleBuffer !== null) {
          title = titleBuffer;
          titleBuffer = null;
        }
        if (tag === "h1" && h1Buffer !== null) {
          h1 = h1Buffer;
          h1Buffer = null;
        }
        if (tag === "script" && jsonLd !== null) {
          try {
            const data: unknown = JSON.parse(jsonLd);
            collectTypes(data, types);
            collectBusinesses(data, businesses);
          } catch {
            // Invalid JSON-LD is not structured data; nothing to record.
          }
          jsonLd = null;
        }
        if (tag === "a" && anchor) {
          if (!links.has(anchor.href) && links.size < MAX_LINKS) {
            links.set(anchor.href, { url: anchor.href, anchor: clean(anchor.text).slice(0, 200), nofollow: anchor.nofollow });
          }
          anchor = null;
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(html);
  parser.end();

  const text = clean(textParts.join(""));
  const words = text ? text.split(" ").filter((word) => /[\p{L}\p{N}]/u.test(word)) : [];

  return {
    title: cap(title, 500),
    description: cap(description, 1_000),
    metaRobots: robots.length ? cap(robots.join(", "), 200) : null,
    canonical,
    lang,
    hreflang: hreflang.slice(0, 100),
    h1: cap(h1, 500),
    h1Count,
    h2Count,
    wordCount: words.length,
    contentHash: text ? createHash("sha256").update(text.toLowerCase()).digest("hex") : null,
    schemaTypes: [...types].slice(0, 50),
    localBusiness: businesses,
    phones: [...phones],
    imageCount,
    imagesMissingAlt,
    links: [...links.values()],
    text: text.slice(0, MAX_PAGE_TEXT),
  };
}

/** `noindex` / `none` in a meta robots value or an X-Robots-Tag header. */
export function hasNoindex(...values: (string | null | undefined)[]): boolean {
  return values.some((value) => !!value && /\b(noindex|none)\b/i.test(value));
}
