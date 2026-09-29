import { z } from "zod";

/**
 * Occasions and the monthly planner.
 *
 * A fixed occasion has a month and a day that exist together (30 February is
 * refused); a moving one has neither, and gets its dates one year at a time.
 */

export const OCCASION_CATEGORIES = [
  "FESTIVAL",
  "NATIONAL_DAY",
  "AWARENESS_DAY",
  "INDUSTRY_EVENT",
  "BRAND",
] as const;

/** Days per month, February counted at 29 so an anniversary on the 29th is allowed. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const occasionSchema = z
  .object({
    name: z.string().trim().min(2, "Name the occasion.").max(120),
    category: z.enum(OCCASION_CATEGORIES),
    description: z
      .string()
      .trim()
      .max(500)
      .nullable()
      .or(z.literal(""))
      .transform((v) => (v ? v : null))
      .default(null),
    fixedMonth: z.coerce.number().int().min(1).max(12).nullable().default(null),
    fixedDay: z.coerce.number().int().min(1).max(31).nullable().default(null),
  })
  .superRefine((value, ctx) => {
    if ((value.fixedMonth === null) !== (value.fixedDay === null)) {
      ctx.addIssue({ code: "custom", path: ["fixedDay"], message: "Give both the month and the day, or neither." });
      return;
    }
    if (value.fixedMonth !== null && value.fixedDay! > DAYS_IN_MONTH[value.fixedMonth - 1]!) {
      ctx.addIssue({ code: "custom", path: ["fixedDay"], message: "That month does not have that many days." });
    }
  });

export type OccasionInput = z.infer<typeof occasionSchema>;

/** A calendar day, `YYYY-MM-DD`, and a real one. */
export const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-08.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "That is not a real date.");

/** A month to plan, `YYYY-MM`. */
export const isoMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2026-10.");
