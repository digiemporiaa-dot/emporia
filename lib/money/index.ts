import { Decimal } from "decimal.js";

/**
 * All monetary arithmetic. Money is `Decimal` everywhere — never a JS `number`
 * (CLAUDE.md 2 rule 1) — and every proposal, invoice and report total is
 * computed here so the logic exists in exactly one place (CLAUDE.md 4).
 *
 * Rounding policy: half-up to 2 decimal places, applied once at the line total
 * and once at each document total. Intermediate products are never rounded,
 * which is what keeps a 3-decimal quantity times a 2-decimal price exact.
 */

export const MONEY_DP = 2;

// decimal.js rounds ROUND_HALF_UP = 4.
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export type MoneyInput = Decimal | string | number;

/**
 * Coerce to Decimal. `number` is accepted only for literals such as 0 and for
 * values that originate outside the money path (percent, counts); values read
 * from the database are already Decimal.
 */
export function money(value: MoneyInput): Decimal {
  const d = value instanceof Decimal ? value : new Decimal(value);
  if (!d.isFinite()) {
    throw new TypeError(`Not a finite monetary value: ${String(value)}`);
  }
  return d;
}

export const ZERO = new Decimal(0);

export function add(...values: MoneyInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(money(v)), ZERO);
}

export function sub(a: MoneyInput, b: MoneyInput): Decimal {
  return money(a).minus(money(b));
}

export function mul(a: MoneyInput, b: MoneyInput): Decimal {
  return money(a).times(money(b));
}

export function div(a: MoneyInput, b: MoneyInput): Decimal {
  const divisor = money(b);
  if (divisor.isZero()) throw new RangeError("Division by zero in money calculation");
  return money(a).dividedBy(divisor);
}

/** Round to storage precision. Call at line and document boundaries only. */
export function round(value: MoneyInput): Decimal {
  return money(value).toDecimalPlaces(MONEY_DP, Decimal.ROUND_HALF_UP);
}

export function isNegative(value: MoneyInput): boolean {
  return money(value).isNegative();
}

export function eq(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).equals(money(b));
}

export function gt(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).greaterThan(money(b));
}

export function gte(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).greaterThanOrEqualTo(money(b));
}

/** A percentage rate, e.g. 18 for 18%. Stored as Decimal(6,3). */
export function percentOf(base: MoneyInput, rate: MoneyInput): Decimal {
  return mul(base, div(money(rate), 100));
}

export type LineInput = {
  quantity: MoneyInput;
  unitPrice: MoneyInput;
  /** Percent, e.g. 10 for 10% off. */
  discountRate?: MoneyInput;
  /** Percent, e.g. 18 for 18% GST. */
  taxRate?: MoneyInput;
};

export type LineTotals = {
  gross: Decimal;
  discount: Decimal;
  net: Decimal;
  tax: Decimal;
  /** Net + tax, rounded once. This is what gets stored as `lineTotal`. */
  total: Decimal;
};

/**
 * One line's arithmetic. Discount applies to the gross; tax applies to the
 * discounted net — the order matters and is fixed here so no caller can get it
 * the other way around.
 */
export function lineTotals(input: LineInput): LineTotals {
  const gross = mul(input.quantity, input.unitPrice);
  const discount = input.discountRate ? percentOf(gross, input.discountRate) : ZERO;
  const net = sub(gross, discount);
  const tax = input.taxRate ? percentOf(net, input.taxRate) : ZERO;
  return {
    gross: round(gross),
    discount: round(discount),
    net: round(net),
    tax: round(tax),
    total: round(add(net, tax)),
  };
}

export type DocumentTotals = {
  subtotal: Decimal;
  discountTotal: Decimal;
  taxTotal: Decimal;
  total: Decimal;
};

/**
 * Document totals from raw lines.
 *
 * Subtotal is the sum of gross line values; discountTotal and taxTotal are
 * summed from the per-line rounded amounts so the printed lines always add up
 * to the printed total — a total computed independently of its lines is the
 * classic source of one-paisa disputes.
 */
export function documentTotals(lines: readonly LineInput[]): DocumentTotals {
  let subtotal = ZERO;
  let discountTotal = ZERO;
  let taxTotal = ZERO;
  let total = ZERO;

  for (const line of lines) {
    const t = lineTotals(line);
    subtotal = subtotal.plus(t.gross);
    discountTotal = discountTotal.plus(t.discount);
    taxTotal = taxTotal.plus(t.tax);
    total = total.plus(t.total);
  }

  return {
    subtotal: round(subtotal),
    discountTotal: round(discountTotal),
    taxTotal: round(taxTotal),
    total: round(total),
  };
}

/** Amount still owed on an invoice, never negative. */
export function amountDue(total: MoneyInput, paid: MoneyInput): Decimal {
  const due = sub(money(total), money(paid));
  return due.isNegative() ? ZERO : round(due);
}

/**
 * Serialisation for the RSC boundary.
 *
 * Prisma `Decimal` instances are not serialisable into client components, and a
 * `Number()` cast there would silently reintroduce float error. Every money
 * value crossing into a `"use client"` component goes through this first, and
 * client components render strings rather than doing arithmetic
 * (docs/ARCHITECTURE.md 4.1).
 */
export function toMoneyString(value: MoneyInput): string {
  return round(value).toFixed(MONEY_DP);
}

const CURRENCY_LOCALE: Record<string, string> = {
  INR: "en-IN",
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
  AED: "ar-AE",
};

/** Display formatting. Takes the already-serialised string, not a Decimal. */
export function formatMoney(value: MoneyInput, currency = "INR"): string {
  const locale = CURRENCY_LOCALE[currency] ?? "en-IN";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: MONEY_DP,
    maximumFractionDigits: MONEY_DP,
  }).format(round(value).toNumber());
}

export { Decimal };
