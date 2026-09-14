import { z } from "zod";

/** Experiments. */

export const experimentSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2, "Give the experiment a handle.")
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Lower-case letters, numbers and dashes only."),
  name: z.string().trim().min(2, "Name the experiment.").max(120),
  /**
   * What the test is trying to find out. Recorded so the result is read against
   * the question that was asked, rather than a question invented afterwards to
   * fit the numbers.
   */
  hypothesis: z
    .string()
    .trim()
    .max(500)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional(),
  /**
   * Exactly two arms. Comparing three at once needs a correction for multiple
   * comparisons that the reading does not apply, so the data model does not
   * allow a state the report cannot honestly read.
   */
  variants: z
    .array(
      z.object({
        key: z
          .string()
          .trim()
          .min(1)
          .max(40)
          .regex(/^[a-z0-9-]+$/, "Lower-case letters, numbers and dashes only."),
        name: z.string().trim().min(1, "Name the arm.").max(80),
        weight: z.coerce.number().int().min(0).max(100).default(1),
      }),
    )
    .length(2, "An experiment has two arms."),
});

export type ExperimentInput = z.infer<typeof experimentSchema>;
