import { z } from "zod";

/** Sales input validation. Money stays a string end to end. */

const moneyString = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount like 45000 or 45000.00");

const quantityString = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,3})?$/, "Enter a quantity like 1 or 2.5");

const rateString = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,3})?$/, "Enter a percentage like 18 or 18.5");

export const currencySchema = z.enum(["INR", "USD", "EUR", "GBP", "AED"]);

export const catalogItemSchema = z.object({
  name: z.string().trim().min(2, "Name the item.").max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  unit: z.string().trim().min(1).max(40).default("unit"),
  unitPrice: moneyString,
  currency: currencySchema.default("INR"),
  taxRate: rateString.default("0"),
  serviceId: z.string().trim().max(40).nullable().optional(),
  isActive: z.boolean().default(true),
  order: z.coerce.number().int().min(0).max(9999).default(0),
});

export type CatalogItemInput = z.infer<typeof catalogItemSchema>;

export const proposalItemSchema = z.object({
  catalogItemId: z.string().trim().max(40).nullable().optional(),
  name: z.string().trim().min(2, "Every line needs a name.").max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  quantity: quantityString,
  unitPrice: moneyString,
  discountRate: rateString.default("0"),
  taxRate: rateString.default("0"),
});

export const proposalSchema = z.object({
  title: z.string().trim().min(3, "Give the proposal a title.").max(200),
  currency: currencySchema.default("INR"),
  leadId: z.string().trim().max(40).nullable().optional(),
  clientId: z.string().trim().max(40).nullable().optional(),
  opportunityId: z.string().trim().max(40).nullable().optional(),
  validUntil: z.coerce.date().nullable().optional(),
  items: z.array(proposalItemSchema).min(1, "A proposal needs at least one line.").max(100),
});

export type ProposalInput = z.infer<typeof proposalSchema>;
export type ProposalItemInput = z.infer<typeof proposalItemSchema>;

export const opportunitySchema = z.object({
  title: z.string().trim().min(3, "Give the opportunity a title.").max(200),
  value: moneyString,
  currency: currencySchema.default("INR"),
  stage: z.enum(["DISCOVERY", "SCOPING", "PROPOSAL", "NEGOTIATION", "WON", "LOST"]).default("DISCOVERY"),
  probability: z.coerce.number().int().min(0).max(100).default(0),
  expectedCloseAt: z.coerce.date().nullable().optional(),
  ownerId: z.string().min(1, "Choose an owner."),
  leadId: z.string().trim().max(40).nullable().optional(),
  clientId: z.string().trim().max(40).nullable().optional(),
});

export type OpportunityInput = z.infer<typeof opportunitySchema>;

export const contractSchema = z.object({
  clientId: z.string().min(1, "Choose a client."),
  proposalId: z.string().trim().max(40).nullable().optional(),
  title: z.string().trim().min(3, "Give the contract a title.").max(200),
  value: moneyString,
  currency: currencySchema.default("INR"),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullable().optional(),
  renewalAt: z.coerce.date().nullable().optional(),
  terms: z.string().trim().max(20000).nullable().optional(),
});

export type ContractInput = z.infer<typeof contractSchema>;

export const acceptProposalSchema = z.object({
  proposalId: z.string().min(1).max(40),
  /** Overrides the name taken from the lead when converting. */
  clientName: z.string().trim().max(160).optional(),
});
