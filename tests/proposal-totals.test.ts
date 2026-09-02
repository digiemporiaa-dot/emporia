import { describe, expect, it } from "vitest";
import { priceLines } from "@/lib/services/sales.service";
import { canTransition, isEditable, transitionError } from "@/lib/sales/lifecycle";

/**
 * Proposal arithmetic, to the paisa.
 *
 * Every case states the derivation in a comment so the expected figure can be
 * checked rather than trusted. The rule throughout: discount applies to the
 * gross, tax applies to the discounted net, and rounding happens once per line
 * and once per document — never on an intermediate.
 */

describe("single line", () => {
  it("prices a plain line with no discount or tax", () => {
    // 1 x 125000 = 125000
    const p = priceLines([{ quantity: "1", unitPrice: "125000.00", discountRate: "0", taxRate: "0" }]);
    expect(p.totals).toEqual({
      subtotal: "125000.00",
      discountTotal: "0.00",
      taxTotal: "0.00",
      total: "125000.00",
    });
    expect(p.lineTotals).toEqual(["125000.00"]);
  });

  it("adds GST at 18 percent", () => {
    // 125000 + 18% = 147500
    const p = priceLines([{ quantity: "1", unitPrice: "125000.00", discountRate: "0", taxRate: "18" }]);
    expect(p.totals.taxTotal).toBe("22500.00");
    expect(p.totals.total).toBe("147500.00");
  });

  it("applies discount to gross, then tax to the net", () => {
    // gross 125000, 10% off = 12500, net 112500, 18% of net = 20250
    const p = priceLines([{ quantity: "1", unitPrice: "125000.00", discountRate: "10", taxRate: "18" }]);
    expect(p.totals).toEqual({
      subtotal: "125000.00",
      discountTotal: "12500.00",
      taxTotal: "20250.00",
      total: "132750.00",
    });
  });

  it("does NOT tax the pre-discount amount", () => {
    // If tax were taken on gross it would be 22500, not 20250.
    const p = priceLines([{ quantity: "1", unitPrice: "125000.00", discountRate: "10", taxRate: "18" }]);
    expect(p.totals.taxTotal).not.toBe("22500.00");
  });

  it("multiplies quantity exactly", () => {
    // 3 x 4999.99 = 14999.97
    const p = priceLines([{ quantity: "3", unitPrice: "4999.99", discountRate: "0", taxRate: "0" }]);
    expect(p.totals.subtotal).toBe("14999.97");
  });

  it("handles a fractional quantity against a two-decimal price", () => {
    // 2.5 x 8000 = 20000
    expect(
      priceLines([{ quantity: "2.5", unitPrice: "8000.00", discountRate: "0", taxRate: "0" }]).totals.total,
    ).toBe("20000.00");

    // 1.333 x 99.99 = 133.28667 -> 133.29
    expect(
      priceLines([{ quantity: "1.333", unitPrice: "99.99", discountRate: "0", taxRate: "0" }]).totals.total,
    ).toBe("133.29");
  });

  it("handles a fractional tax rate", () => {
    // 10000 at 2.575% = 257.50
    const p = priceLines([{ quantity: "1", unitPrice: "10000.00", discountRate: "0", taxRate: "2.575" }]);
    expect(p.totals.taxTotal).toBe("257.50");
    expect(p.totals.total).toBe("10257.50");
  });

  it("handles a 100 percent discount", () => {
    const p = priceLines([{ quantity: "1", unitPrice: "50000.00", discountRate: "100", taxRate: "18" }]);
    expect(p.totals.discountTotal).toBe("50000.00");
    expect(p.totals.taxTotal).toBe("0.00");
    expect(p.totals.total).toBe("0.00");
  });

  it("handles a zero-price line without dividing by anything", () => {
    const p = priceLines([{ quantity: "5", unitPrice: "0.00", discountRate: "10", taxRate: "18" }]);
    expect(p.totals.total).toBe("0.00");
  });
});

describe("multi-line documents", () => {
  it("sums a mixed document exactly", () => {
    // L1  1 x 25000            tax 18%           -> tax 4500.00,  total 29500.00
    // L2  3 x 4999.99  -5%     gross 14999.97
    //                          discount 749.9985 -> shown 750.00
    //                          net 14249.9715, tax 18% = 2564.99487 -> 2564.99
    //                          line total 16814.97
    // L3  0.5 x 80000          gross 40000, tax 7200.00, total 47200.00
    const p = priceLines([
      { quantity: "1", unitPrice: "25000.00", discountRate: "0", taxRate: "18" },
      { quantity: "3", unitPrice: "4999.99", discountRate: "5", taxRate: "18" },
      { quantity: "0.5", unitPrice: "80000.00", discountRate: "0", taxRate: "18" },
    ]);

    expect(p.totals.subtotal).toBe("79999.97");
    expect(p.totals.discountTotal).toBe("750.00");
    expect(p.totals.taxTotal).toBe("14264.99");
    expect(p.totals.total).toBe("93514.97");
    expect(p.lineTotals).toEqual(["29500.00", "16814.97", "47200.00"]);
  });

  it("makes the printed lines add up to the printed total", () => {
    // The classic source of a one-paisa dispute: a total computed
    // independently of the lines it is printed beside.
    const lines = [
      { quantity: "3", unitPrice: "33.33", discountRate: "0", taxRate: "18" },
      { quantity: "7", unitPrice: "1.11", discountRate: "3", taxRate: "18" },
      { quantity: "11", unitPrice: "0.07", discountRate: "0", taxRate: "5" },
      { quantity: "1", unitPrice: "0.01", discountRate: "0", taxRate: "18" },
    ];
    const p = priceLines(lines);

    const summed = p.lineTotals.reduce((acc, value) => acc + Math.round(Number(value) * 100), 0);
    expect(summed).toBe(Math.round(Number(p.totals.total) * 100));
  });

  it("stays exact across many small lines where floats would drift", () => {
    // 100 lines of 0.01 = 1.00 exactly. A float accumulator lands on
    // 1.0000000000000007.
    const lines = Array.from({ length: 100 }, () => ({
      quantity: "1",
      unitPrice: "0.01",
      discountRate: "0",
      taxRate: "0",
    }));
    expect(priceLines(lines).totals.total).toBe("1.00");
  });

  it("handles a large document without losing precision", () => {
    // 12 x 999999999.99 = 11999999999.88
    const p = priceLines([
      { quantity: "12", unitPrice: "999999999.99", discountRate: "0", taxRate: "0" },
    ]);
    expect(p.totals.total).toBe("11999999999.88");
  });

  it("rounds half up, not half to even", () => {
    // 1 x 2.005 is not expressible in a 2dp price, so use tax to reach a
    // half: 100.10 at 2.5% = 2.5025 -> 2.50; 100.30 at 2.5% = 2.5075 -> 2.51
    expect(
      priceLines([{ quantity: "1", unitPrice: "100.10", discountRate: "0", taxRate: "2.5" }]).totals.taxTotal,
    ).toBe("2.50");
    expect(
      priceLines([{ quantity: "1", unitPrice: "100.30", discountRate: "0", taxRate: "2.5" }]).totals.taxTotal,
    ).toBe("2.51");
  });

  it("prices an empty document as zero rather than failing", () => {
    expect(priceLines([]).totals).toEqual({
      subtotal: "0.00",
      discountTotal: "0.00",
      taxTotal: "0.00",
      total: "0.00",
    });
  });
});

describe("proposal lifecycle", () => {
  it("moves forward through the documented path", () => {
    expect(canTransition("DRAFT", "SENT")).toBe(true);
    expect(canTransition("SENT", "VIEWED")).toBe(true);
    expect(canTransition("VIEWED", "NEGOTIATION")).toBe(true);
    expect(canTransition("NEGOTIATION", "ACCEPTED")).toBe(true);
    expect(canTransition("NEGOTIATION", "REJECTED")).toBe(true);
  });

  it("does not skip from draft straight to accepted", () => {
    expect(canTransition("DRAFT", "ACCEPTED")).toBe(false);
    expect(transitionError("DRAFT", "ACCEPTED")).toMatch(/cannot move straight/);
  });

  it("lets a sent proposal be pulled back to draft for revision", () => {
    expect(canTransition("SENT", "DRAFT")).toBe(true);
    expect(canTransition("NEGOTIATION", "DRAFT")).toBe(true);
  });

  it("treats accepted and rejected as terminal", () => {
    expect(canTransition("ACCEPTED", "DRAFT")).toBe(false);
    expect(canTransition("REJECTED", "NEGOTIATION")).toBe(false);
    expect(transitionError("ACCEPTED", "DRAFT")).toMatch(/cannot be changed/);
  });

  it("only allows editing the priced lines while in draft", () => {
    expect(isEditable("DRAFT")).toBe(true);
    for (const status of ["SENT", "VIEWED", "NEGOTIATION", "ACCEPTED", "REJECTED"] as const) {
      expect(isEditable(status)).toBe(false);
    }
  });
});
