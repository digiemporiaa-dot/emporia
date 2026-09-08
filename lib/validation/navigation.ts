import { z } from "zod";

/**
 * Header, footer and navigation validation.
 *
 * These values are typed by an admin and rendered into every page of the public
 * site, so the destination of a link is the one thing that has to be checked
 * properly: an `href` is an injection surface. Only three shapes are accepted —
 * a root-relative path, an absolute http(s) URL, or a `mailto:`/`tel:` address.
 * Everything else, `javascript:` and `data:` included, is rejected here rather
 * than sanitised in a component (CLAUDE.md 2 rule 4).
 */

const HREF_HELP = "Use a path like /services, a full https:// address, or mailto:/tel:.";

/** Absolute or scheme-relative destinations we are willing to render. */
const EXTERNAL = /^(https?:\/\/|mailto:|tel:)/i;

function isSafeHref(value: string): boolean {
  // Whitespace anywhere is either a paste artefact or an attempt to smuggle a
  // scheme past the check below; neither is a valid URL.
  if (/[\s<>"']/.test(value)) return false;
  // `//evil.example` inherits the page's scheme and leaves the site. A link
  // that leaves the site must say so with a scheme.
  if (value.startsWith("//")) return false;
  if (value.startsWith("/")) return true;
  if (value.startsWith("#")) return value.length > 1;
  return EXTERNAL.test(value);
}

export const navHref = z
  .string()
  .trim()
  .min(1, "A link needs a destination.")
  .max(300, "That destination is too long.")
  .refine(isSafeHref, HREF_HELP);

/** Same rule, but an empty value means "not set" rather than an error. */
export const optionalNavHref = z
  .string()
  .trim()
  .max(300, "That destination is too long.")
  .refine((value) => value === "" || isSafeHref(value), HREF_HELP);

export const navItemSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Every link needs a label.")
    .max(40, "Keep labels under 40 characters."),
  href: navHref,
  /** External links usually want a new tab; internal ones almost never do. */
  newTab: z.boolean(),
});

export type NavItemInput = z.infer<typeof navItemSchema>;

/**
 * Social platforms the footer knows how to label.
 *
 * A closed set rather than free text: the label shown to a visitor is derived
 * from it, and an accessible name assembled from whatever someone typed is how
 * a footer ends up announcing "Follow us on ".
 */
export const SOCIAL_PLATFORMS = [
  "linkedin",
  "instagram",
  "facebook",
  "x",
  "youtube",
  "whatsapp",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  youtube: "YouTube",
  whatsapp: "WhatsApp",
};

export const socialLinkSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  url: z
    .string()
    .trim()
    .min(1, "A social link needs a URL.")
    .max(300)
    .refine(
      (value) => /^https:\/\//i.test(value) && !/[\s<>"']/.test(value),
      "Use the full https:// address of the profile.",
    ),
});

export type SocialLinkInput = z.infer<typeof socialLinkSchema>;

const list = <T extends z.ZodTypeAny>(item: T, max: number, what: string) =>
  z.array(item, { error: `Could not read the ${what}.` }).max(max, `At most ${max} ${what}.`);

export const navigationSettingsSchema = z
  .object({
    brandName: z
      .string()
      .trim()
      .min(1, "The site needs a name.")
      .max(40, "Keep the name under 40 characters."),
    headerLinks: list(navItemSchema, 8, "header links"),
    ctaEnabled: z.boolean(),
    ctaLabel: z.string().trim().max(30, "Keep the button label under 30 characters."),
    ctaHref: optionalNavHref,

    tagline: z.string().trim().max(160, "Keep the tagline under 160 characters."),
    // Footer contact details. Blank means "do not show that line" — an agency
    // that does not publish a phone number should not be forced to invent one.
    contactEmail: z
      .string()
      .trim()
      .max(120)
      .refine(
        (value) => value === "" || z.email().safeParse(value).success,
        "Enter a valid email address, or leave it blank.",
      ),
    contactPhone: z.string().trim().max(40, "Keep the phone number under 40 characters."),
    contactAddress: z.string().trim().max(200, "Keep the address under 200 characters."),
    footerCompanyLinks: list(navItemSchema, 10, "company links"),
    footerLegalLinks: list(navItemSchema, 6, "legal links"),
    socialLinks: list(socialLinkSchema, 8, "social links"),
    copyrightName: z
      .string()
      .trim()
      .min(1, "The copyright line needs a name.")
      .max(60, "Keep the copyright name under 60 characters."),
  })
  .superRefine((value, ctx) => {
    // A button with no label or nowhere to go renders as a dead control, so the
    // two fields are only optional while the button is switched off.
    if (!value.ctaEnabled) return;
    if (value.ctaLabel === "") {
      ctx.addIssue({ code: "custom", path: ["ctaLabel"], message: "The button needs a label." });
    }
    if (value.ctaHref === "") {
      ctx.addIssue({
        code: "custom",
        path: ["ctaHref"],
        message: "The button needs a destination.",
      });
    }
  });

export type NavigationSettingsInput = z.infer<typeof navigationSettingsSchema>;
