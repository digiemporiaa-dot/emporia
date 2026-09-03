import { z } from "zod";

/** Finance input validation. Money is a string end to end. */

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

const id = z.string().trim().min(1).max(40);
const optionalId = z.string().trim().max(40).nullable().optional();

export const currencySchema = z.enum(["INR", "USD", "EUR", "GBP", "AED"]);

export const invoiceItemSchema = z.object({
  name: z.string().trim().min(2, "Every line needs a name.").max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  quantity: quantityString,
  unitPrice: moneyString,
  discountRate: rateString.default("0"),
  taxRate: rateString.default("0"),
});

export const invoiceSchema = z.object({
  clientId: id,
  projectId: optionalId,
  contractId: optionalId,
  retainerId: optionalId,
  currency: currencySchema.default("INR"),
  issuedAt: z.coerce.date().optional(),
  dueAt: z.coerce.date(),
  notes: z.string().trim().max(5000).nullable().optional(),
  items: z.array(invoiceItemSchema).min(1, "An invoice needs at least one line.").max(100),
});

export type InvoiceInput = z.infer<typeof invoiceSchema>;
export type InvoiceItemInput = z.infer<typeof invoiceItemSchema>;

export const manualPaymentSchema = z.object({
  invoiceId: id,
  amount: moneyString,
  gateway: z.enum(["BANK_TRANSFER", "CASH", "CHEQUE", "UPI", "OTHER"]),
  reference: z.string().trim().max(120).nullable().optional(),
  receivedAt: z.coerce.date().optional(),
});

export type ManualPaymentInput = z.infer<typeof manualPaymentSchema>;

export const refundSchema = z.object({
  paymentId: id,
  amount: moneyString,
  reason: z.string().trim().max(500).nullable().optional(),
});

export const retainerSchema = z.object({
  clientId: id,
  name: z.string().trim().min(2, "Name the retainer.").max(160),
  amount: moneyString,
  currency: currencySchema.default("INR"),
  cycle: z.enum(["MONTHLY", "QUARTERLY", "HALF_YEARLY", "ANNUAL"]).default("MONTHLY"),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullable().optional(),
});

export type RetainerInput = z.infer<typeof retainerSchema>;

export const invoiceListParamsSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(5).max(100).default(25),
  status: z.enum(["DRAFT", "SENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"]).optional(),
  clientId: z.string().trim().max(40).optional(),
  search: z.string().trim().max(200).optional(),
  // Not z.coerce.boolean(): that turns the string "false" into true, so a
  // shared URL carrying overdue=false would filter the opposite way.
  overdue: z
    .union([z.boolean(), z.literal("true"), z.literal("false")])
    .transform((value) => value === true || value === "true")
    .optional(),
});

export type InvoiceListParamsInput = z.infer<typeof invoiceListParamsSchema>;

/** What the browser sends back after Razorpay checkout. */
export const checkoutResultSchema = z.object({
  razorpay_order_id: z.string().trim().min(4).max(120),
  razorpay_payment_id: z.string().trim().min(4).max(120),
  razorpay_signature: z.string().trim().min(16).max(200),
});
