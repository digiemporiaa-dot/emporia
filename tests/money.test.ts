import { describe, expect, it } from "vitest";
import {
  Decimal,
  amountDue,
  add,
  documentTotals,
  formatMoney,
  lineTotals,
  money,
  percentOf,
  round,
  toMoneyString,
} from "@/lib/money";

/**
 * Money is Decimal everywhere (CLAUDE.md 2 rule 1). These tests are the ones
 * that must never be allowed to go yellow — they encode the arithmetic behind
 * every proposal and invoice.
 */

describe("money coercion", () => {
  it("accepts strings, numbers and Decimals", () => {
    expect(money("1234.56").toFixed(2)).toBe("1234.56");
    expect(money(0).toFixed(2)).toBe("0.00");
    expect(money(new Decimal("9.99")).toFixed(2)).toBe("9.99");
  });

  it("rejects non-finite values rather than producing NaN money", () => {
    expect(() => money(Number.NaN)).toThrow(TypeError);
    expect(() => money(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe("float error", () => {
  it("adds values that JS numbers get wrong", () => {
    // 0.1 + 0.2 === 0.30000000000000004 as a float.
    expect(add("0.1", "0.2").toFixed(2)).toBe("0.30");
  });

  it("keeps a long chain of additions exact", () => {
    let total = money(0);
    for (let i = 0; i < 1000; i += 1) total = total.plus(money("0.01"));
    expect(total.toFixed(2)).toBe("10.00");
  });
});

describe("rounding", () => {
  it("rounds half up, not half to even", () => {
    expect(round("2.005").toFixed(2)).toBe("2.01");
    expect(round("2.015").toFixed(2)).toBe("2.02");
    expect(round("2.025").toFixed(2)).toBe("2.03");
  });

  it("leaves already-rounded values untouched", () => {
    expect(round("199.99").toFixed(2)).toBe("199.99");
  });
});

describe("percentOf", () => {
  it("computes GST at 18 percent", () => {
    expect(round(percentOf("10000", "18")).toFixed(2)).toBe("1800.00");
  });

  it("handles fractional rates stored as Decimal(6,3)", () => {
    expect(round(percentOf("10000", "2.575")).toFixed(2)).toBe("257.50");
  });
});

describe("lineTotals", () => {
  it("applies discount to gross and tax to the discounted net, in that order", () => {
    const t = lineTotals({
      quantity: "2",
      unitPrice: "5000.00",
      discountRate: "10",
      taxRate: "18",
    });
    expect(t.gross.toFixed(2)).toBe("10000.00");
    expect(t.discount.toFixed(2)).toBe("1000.00");
    expect(t.net.toFixed(2)).toBe("9000.00");
    expect(t.tax.toFixed(2)).toBe("1620.00");
    expect(t.total.toFixed(2)).toBe("10620.00");
  });

  it("taxes the discounted amount, never the gross", () => {
    const discounted = lineTotals({ quantity: 1, unitPrice: "100", discountRate: "50", taxRate: "10" });
    const undiscounted = lineTotals({ quantity: 1, unitPrice: "100", taxRate: "10" });
    expect(discounted.tax.toFixed(2)).toBe("5.00");
    expect(undiscounted.tax.toFixed(2)).toBe("10.00");
  });

  it("keeps fractional quantities exact through to the total", () => {
    // 3 decimal quantity against a 2 decimal price.
    const t = lineTotals({ quantity: "1.333", unitPrice: "99.99" });
    expect(t.gross.toFixed(2)).toBe("133.29");
    expect(t.total.toFixed(2)).toBe("133.29");
  });

  it("treats missing discount and tax as zero", () => {
    const t = lineTotals({ quantity: "3", unitPrice: "33.33" });
    expect(t.discount.toFixed(2)).toBe("0.00");
    expect(t.tax.toFixed(2)).toBe("0.00");
    expect(t.total.toFixed(2)).toBe("99.99");
  });
});

describe("documentTotals", () => {
  it("sums a multi-line document to the paisa", () => {
    const totals = documentTotals([
      { quantity: "1", unitPrice: "25000.00", taxRate: "18" },
      { quantity: "3", unitPrice: "4999.99", discountRate: "5", taxRate: "18" },
      { quantity: "0.5", unitPrice: "80000.00", taxRate: "18" },
    ]);

    // Derivation, so these numbers can be checked rather than trusted:
    //   L1  gross 25000.00              tax 18%          =  4500.00
    //   L2  gross 14999.97  less 5%     -> net 14249.9715
    //                                      tax 18%       =  2564.99
    //   L3  gross 40000.00              tax 18%          =  7200.00
    // Tax is taken on the UNROUNDED net, so L2 is 2564.99 and not 2565.00 —
    // rounding the net first would drift the document total.
    expect(totals.subtotal.toFixed(2)).toBe("79999.97");
    expect(totals.discountTotal.toFixed(2)).toBe("750.00");
    expect(totals.taxTotal.toFixed(2)).toBe("14264.99");
    expect(totals.total.toFixed(2)).toBe("93514.97");
  });

  it("makes the printed lines add up to the printed total", () => {
    const lines = [
      { quantity: "3", unitPrice: "33.33", taxRate: "18" },
      { quantity: "7", unitPrice: "1.11", taxRate: "18" },
      { quantity: "11", unitPrice: "0.07", taxRate: "5" },
    ];
    const totals = documentTotals(lines);
    const summed = lines.reduce((acc, l) => acc.plus(lineTotals(l).total), money(0));
    expect(totals.total.toFixed(2)).toBe(summed.toFixed(2));
  });

  it("returns zeros for an empty document", () => {
    const totals = documentTotals([]);
    expect(totals.subtotal.toFixed(2)).toBe("0.00");
    expect(totals.total.toFixed(2)).toBe("0.00");
  });
});

describe("amountDue", () => {
  it("subtracts payments from the total", () => {
    expect(amountDue("10000.00", "2500.00").toFixed(2)).toBe("7500.00");
  });

  it("never goes negative on an overpayment", () => {
    expect(amountDue("100.00", "150.00").toFixed(2)).toBe("0.00");
  });

  it("is zero when fully paid", () => {
    expect(amountDue("999.99", "999.99").toFixed(2)).toBe("0.00");
  });
});

describe("serialisation across the RSC boundary", () => {
  it("produces a fixed 2dp string, never a float", () => {
    expect(toMoneyString("1234.5")).toBe("1234.50");
    expect(toMoneyString(new Decimal("0.005"))).toBe("0.01");
    expect(typeof toMoneyString("10")).toBe("string");
  });

  it("formats INR for display", () => {
    expect(formatMoney("125000", "INR")).toContain("1,25,000.00");
  });
});
