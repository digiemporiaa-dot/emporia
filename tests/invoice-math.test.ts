import { describe, expect, it } from "vitest";
import {
  applyPayment,
  canTransition,
  isOverdue,
  nextBillingDate,
  priceInvoice,
  transitionError,
} from "@/lib/finance/invoice";
import { fromMinorUnits, toMinorUnits } from "@/lib/payments/razorpay";
import { Decimal } from "@/lib/money";

/**
 * The phase 13 exit criterion, first half: invoice math under a decimal test
 * suite. Every figure is checked to the paisa.
 */

describe("invoice totals", () => {
  it("prices one plain line", () => {
    const priced = priceInvoice([
      { quantity: "1", unitPrice: "100000.00", discountRate: "0", taxRate: "18" },
    ]);

    expect(priced.subtotal).toBe("100000.00");
    expect(priced.discountTotal).toBe("0.00");
    expect(priced.taxTotal).toBe("18000.00");
    expect(priced.total).toBe("118000.00");
    expect(priced.lineTotals).toEqual(["118000.00"]);
  });

  it("takes tax on the discounted net, not the gross", () => {
    // 100000 less 10% is 90000; 18% of 90000 is 16200.
    const priced = priceInvoice([
      { quantity: "1", unitPrice: "100000.00", discountRate: "10", taxRate: "18" },
    ]);

    expect(priced.discountTotal).toBe("10000.00");
    expect(priced.taxTotal).toBe("16200.00");
    expect(priced.total).toBe("106200.00");

    // Tax on the gross would have been 18000, and the total 108000.
    expect(priced.taxTotal).not.toBe("18000.00");
  });

  it("adds up across lines to the paisa", () => {
    const priced = priceInvoice([
      { quantity: "3", unitPrice: "85000.00", discountRate: "10", taxRate: "18" },
      { quantity: "1", unitPrice: "12000.50", discountRate: "0", taxRate: "18" },
      { quantity: "2.5", unitPrice: "4000.00", discountRate: "5", taxRate: "12" },
    ]);

    // Line 1: 255000 − 25500 = 229500, tax 41310.00, total 270810.00
    // Line 2:  12000.50 − 0    =  12000.50, tax  2160.09, total  14160.59
    // Line 3:  10000    − 500  =   9500.00, tax  1140.00, total  10640.00
    expect(priced.lineTotals).toEqual(["270810.00", "14160.59", "10640.00"]);
    expect(priced.subtotal).toBe("277000.50");
    expect(priced.discountTotal).toBe("26000.00");
    expect(priced.taxTotal).toBe("44610.09");
    // 277000.50 − 26000.00 + 44610.09
    expect(priced.total).toBe("295610.59");

    // The printed lines must equal the printed total.
    const summed = priced.lineTotals.reduce((sum, line) => sum.plus(line), new Decimal(0));
    expect(summed.toFixed(2)).toBe(priced.total);
  });

  it("keeps a hundred one-paisa lines adding to exactly one rupee", () => {
    const lines = Array.from({ length: 100 }, () => ({
      quantity: "1",
      unitPrice: "0.01",
      discountRate: "0",
      taxRate: "0",
    }));

    expect(priceInvoice(lines).total).toBe("1.00");
  });

  it("rounds half up, once per line", () => {
    // 0.005 of 1.00 rounds up to 0.01, not down and not to even.
    const priced = priceInvoice([
      { quantity: "1", unitPrice: "1.00", discountRate: "0", taxRate: "0.5" },
    ]);
    expect(priced.taxTotal).toBe("0.01");
    expect(priced.total).toBe("1.01");
  });

  it("handles a fractional quantity without drift", () => {
    const priced = priceInvoice([
      { quantity: "7.333", unitPrice: "1500.00", discountRate: "0", taxRate: "18" },
    ]);
    // 10999.50 + 18% = 12979.41
    expect(priced.subtotal).toBe("10999.50");
    expect(priced.total).toBe("12979.41");
  });

  it("prices a zero-value line without producing a negative", () => {
    const priced = priceInvoice([
      { quantity: "1", unitPrice: "0.00", discountRate: "50", taxRate: "18" },
    ]);
    expect(priced.total).toBe("0.00");
    expect(priced.discountTotal).toBe("0.00");
  });
});

describe("applying a payment", () => {
  const base = {
    total: "118000.00",
    dueAt: new Date("2026-12-31T00:00:00Z"),
    now: new Date("2026-06-01T00:00:00Z"),
    status: "SENT" as const,
  };

  it("part payment leaves the rest owing", () => {
    const next = applyPayment({ ...base, paidTotal: "0.00", amount: "18000.00" });

    expect(next.paidTotal).toBe("18000.00");
    expect(next.dueTotal).toBe("100000.00");
    expect(next.status).toBe("PARTIALLY_PAID");
  });

  it("settles exactly", () => {
    const next = applyPayment({ ...base, paidTotal: "100000.00", amount: "18000.00" });

    expect(next.paidTotal).toBe("118000.00");
    expect(next.dueTotal).toBe("0.00");
    expect(next.status).toBe("PAID");
  });

  it("treats an overpayment as settled, never as a negative balance", () => {
    const next = applyPayment({ ...base, paidTotal: "118000.00", amount: "500.00" });

    expect(next.paidTotal).toBe("118500.00");
    expect(next.dueTotal).toBe("0.00");
    expect(next.status).toBe("PAID");
  });

  it("accumulates part payments to the paisa", () => {
    let paid = "0.00";
    for (const amount of ["0.01", "0.02", "0.03", "39999.94", "78000.00"]) {
      paid = applyPayment({ ...base, paidTotal: paid, amount }).paidTotal;
    }
    expect(paid).toBe("118000.00");
  });

  it("marks an unpaid invoice overdue once the date has passed", () => {
    const next = applyPayment({
      ...base,
      paidTotal: "0.00",
      amount: "0.00",
      dueAt: new Date("2026-05-01T00:00:00Z"),
    });
    expect(next.status).toBe("OVERDUE");
  });

  it("never marks a draft overdue", () => {
    const next = applyPayment({
      ...base,
      status: "DRAFT",
      paidTotal: "0.00",
      amount: "0.00",
      dueAt: new Date("2026-05-01T00:00:00Z"),
    });
    expect(next.status).toBe("DRAFT");
  });
});

describe("invoice lifecycle", () => {
  it("only a draft can be sent", () => {
    expect(canTransition("DRAFT", "SENT")).toBe(true);
    expect(canTransition("SENT", "SENT")).toBe(false);
    expect(canTransition("PAID", "SENT")).toBe(false);
  });

  it("refuses to change a paid invoice", () => {
    expect(transitionError("PAID", "CANCELLED")).toMatch(/refund it instead/i);
  });

  it("cannot reach paid or overdue by choosing them", () => {
    expect(canTransition("SENT", "PAID")).toBe(false);
    expect(canTransition("SENT", "OVERDUE")).toBe(false);
  });

  it("knows what is overdue", () => {
    const past = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-06-01T00:00:00Z");

    expect(isOverdue({ status: "SENT", dueAt: past }, now)).toBe(true);
    expect(isOverdue({ status: "PAID", dueAt: past }, now)).toBe(false);
    expect(isOverdue({ status: "DRAFT", dueAt: past }, now)).toBe(false);
    expect(isOverdue({ status: "CANCELLED", dueAt: past }, now)).toBe(false);
  });
});

describe("billing cycles", () => {
  it("advances by the cycle", () => {
    const from = new Date("2026-01-31T00:00:00Z");

    expect(nextBillingDate(from, "MONTHLY").getMonth()).toBe(2); // Feb has no 31st
    expect(nextBillingDate(new Date("2026-01-15T00:00:00Z"), "QUARTERLY").toISOString()).toContain(
      "2026-04-15",
    );
    expect(nextBillingDate(new Date("2026-01-15T00:00:00Z"), "HALF_YEARLY").toISOString()).toContain(
      "2026-07-15",
    );
    expect(nextBillingDate(new Date("2026-01-15T00:00:00Z"), "ANNUAL").toISOString()).toContain(
      "2027-01-15",
    );
  });
});

describe("minor units", () => {
  it("converts rupees to paise exactly", () => {
    expect(toMinorUnits("1.00")).toBe(100);
    expect(toMinorUnits("118000.00")).toBe(11800000);
    expect(toMinorUnits("0.01")).toBe(1);
    expect(toMinorUnits("4.10")).toBe(410);
  });

  it("does not lose paise to floating point", () => {
    // 4.1 * 100 is 410.00000000000006 as a JS number.
    expect(4.1 * 100).not.toBe(410);
    expect(toMinorUnits("4.1")).toBe(410);
    expect(toMinorUnits("1234567.89")).toBe(123456789);
  });

  it("refuses a fraction of a paisa", () => {
    expect(() => toMinorUnits("1.001")).toThrow();
  });

  it("round-trips", () => {
    for (const amount of ["0.01", "1.00", "99.99", "118000.00", "1234567.89"]) {
      expect(fromMinorUnits(toMinorUnits(amount))).toBe(amount);
    }
  });
});
