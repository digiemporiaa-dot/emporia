import { z } from "zod";

/** Popup CMS validation. */

export const popupTargetSchema = z.object({
  type: z.enum(["GLOBAL", "PAGE", "SERVICE", "CITY", "SERVICE_CITY", "PACKAGE"]),
  path: z.string().trim().max(500).nullable().optional(),
  serviceId: z.string().trim().max(40).nullable().optional(),
  cityId: z.string().trim().max(40).nullable().optional(),
  serviceCityPageId: z.string().trim().max(40).nullable().optional(),
  packageId: z.string().trim().max(40).nullable().optional(),
  visitorType: z.enum(["NEW", "RETURNING", "ANY"]).default("ANY"),
  device: z.enum(["DESKTOP", "TABLET", "MOBILE", "ANY"]).default("ANY"),
});

export const popupSchema = z
  .object({
    name: z.string().trim().min(2, "Give the popup an internal name.").max(120),
    title: z.string().trim().min(2, "Enter the heading visitors will see.").max(200),
    body: z.string().trim().max(1000).nullable().optional(),
    ctaLabel: z.string().trim().max(80).nullable().optional(),
    ctaHref: z.string().trim().max(500).nullable().optional(),
    trigger: z.enum(["PAGE_LOAD", "TIME_DELAY", "SCROLL_PERCENT", "EXIT_INTENT", "BUTTON_CLICK"]),
    triggerValue: z.coerce.number().int().min(0).max(600).nullable().optional(),
    frequency: z.enum([
      "EVERY_VISIT",
      "ONCE_PER_SESSION",
      "ONCE_PER_DAY",
      "ONCE_PER_WEEK",
      "ONCE_PER_USER",
    ]),
    priority: z.coerce.number().int().min(0).max(999).default(0),
    isActive: z.boolean().default(false),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    targets: z.array(popupTargetSchema).max(50).default([]),
  })
  .refine((data) => !(data.startsAt && data.endsAt) || data.endsAt >= data.startsAt, {
    message: "The end date must be after the start date.",
    path: ["endsAt"],
  })
  .refine(
    (data) =>
      !(data.trigger === "SCROLL_PERCENT") ||
      (typeof data.triggerValue === "number" && data.triggerValue > 0 && data.triggerValue <= 100),
    { message: "Enter a scroll percentage between 1 and 100.", path: ["triggerValue"] },
  )
  .refine(
    (data) =>
      !(data.trigger === "TIME_DELAY") ||
      (typeof data.triggerValue === "number" && data.triggerValue >= 0),
    { message: "Enter a delay in seconds.", path: ["triggerValue"] },
  )
  .refine((data) => !data.isActive || data.targets.length > 0, {
    // An active popup with no targets would never fire anyway; refusing it here
    // makes that obvious at save time rather than as silent nothing.
    message: "An active popup needs at least one targeting rule.",
    path: ["targets"],
  });

export type PopupInput = z.infer<typeof popupSchema>;
