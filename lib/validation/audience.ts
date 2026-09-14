import { z } from "zod";

/**
 * Audience rules on a section.
 *
 * Only attributes this application genuinely knows: the device from the user
 * agent, new-versus-returning from the visitor cookie, and the UTM and referrer
 * values already captured for attribution. No visitor city — there is no geo-IP
 * and a guessed one would be a fabricated audience.
 */

const tag = z
  .string()
  .trim()
  .max(120)
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional();

export const audienceRuleSchema = z
  .object({
    visitorType: z.enum(["ANY", "NEW", "RETURNING"]).default("ANY"),
    device: z.enum(["ANY", "DESKTOP", "TABLET", "MOBILE"]).default("ANY"),
    utmSource: tag,
    utmMedium: tag,
    utmCampaign: tag,
    referrerContains: tag,
  })
  .refine(
    (rule) =>
      rule.visitorType !== "ANY" ||
      rule.device !== "ANY" ||
      Boolean(rule.utmSource) ||
      Boolean(rule.utmMedium) ||
      Boolean(rule.utmCampaign) ||
      Boolean(rule.referrerContains),
    // A rule with nothing set matches everyone, which is what having no rule
    // already means. Saving one would read as "targeted" while doing nothing.
    "Set at least one condition, or remove the rule.",
  );

export const sectionAudienceSchema = z.object({
  sectionId: z.string().min(1).max(40),
  rules: z.array(audienceRuleSchema).max(10, "Ten rules is plenty for one band."),
});

export type SectionAudienceInput = z.infer<typeof sectionAudienceSchema>;

/** The visitor an editor is previewing the page as. */
export const previewVisitorSchema = z.object({
  device: z.enum(["DESKTOP", "TABLET", "MOBILE"]).default("DESKTOP"),
  visitor: z.enum(["NEW", "RETURNING"]).default("NEW"),
  utmSource: z.string().trim().max(120).optional(),
  utmMedium: z.string().trim().max(120).optional(),
  utmCampaign: z.string().trim().max(120).optional(),
  referrer: z.string().trim().max(500).optional(),
});

export type PreviewVisitorInput = z.infer<typeof previewVisitorSchema>;
