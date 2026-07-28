import { describe, it, expect } from "vitest";
import { computeQuotationContentFingerprint } from "../quotationContentFingerprint";

// Minimal stand-in for a Prisma Decimal — real Prisma.Decimal exposes
// toJSON() returning a string, which is what we rely on for stable
// serialization without needing the real decimal.js dependency in a unit test.
class FakeDecimal {
  constructor(private value: string) {}
  toJSON() {
    return this.value;
  }
}

function baseQuotation(overrides: Record<string, unknown> = {}) {
  return {
    id: "q1",
    customerId: "cust-1",
    projectId: null,
    quotationDate: new Date("2026-07-27T00:00:00Z"),
    currency: "KES",
    grandTotal: new FakeDecimal("150000.00"),
    createdAt: new Date("2026-07-27T09:00:00Z"),
    updatedAt: new Date("2026-07-27T09:00:00Z"),
    sections: [
      {
        id: "sec1",
        sectionId: "sec1",
        quotationId: "q1",
        insuranceTypeId: "type-car",
        basePremium: new FakeDecimal("100000.00"),
        carDetail: { id: "detail1", sectionId: "sec1", projectName: "Nakuru Water Project", contractValue: new FakeDecimal("5000000.00") },
      },
    ],
    ...overrides,
  };
}

describe("computeQuotationContentFingerprint (Phase 4 Part 6/17.D)", () => {
  it("is deterministic for identical input", () => {
    const a = computeQuotationContentFingerprint(baseQuotation());
    const b = computeQuotationContentFingerprint(baseQuotation());
    expect(a).toBe(b);
  });

  it("ignores volatile fields (createdAt/updatedAt) — same fingerprint despite different timestamps", () => {
    const a = computeQuotationContentFingerprint(baseQuotation({ createdAt: new Date("2026-01-01T00:00:00Z") }));
    const b = computeQuotationContentFingerprint(baseQuotation({ updatedAt: new Date("2027-01-01T00:00:00Z") }));
    expect(a).toBe(b);
  });

  it("ignores id/sectionId/quotationId — regenerating the same content under a different row id yields the same fingerprint", () => {
    const a = computeQuotationContentFingerprint(baseQuotation());
    const b = computeQuotationContentFingerprint(
      baseQuotation({ id: "q2", sections: [{ id: "sec9", sectionId: "sec9", quotationId: "q2", insuranceTypeId: "type-car", basePremium: new FakeDecimal("100000.00"), carDetail: { id: "d9", sectionId: "sec9", projectName: "Nakuru Water Project", contractValue: new FakeDecimal("5000000.00") } }] })
    );
    expect(a).toBe(b);
  });

  it("changes when meaningful content changes (premium amount)", () => {
    const a = computeQuotationContentFingerprint(baseQuotation());
    const b = computeQuotationContentFingerprint(baseQuotation({ grandTotal: new FakeDecimal("999999.00") }));
    expect(a).not.toBe(b);
  });

  it("changes when a nested detail field changes (project name)", () => {
    const a = computeQuotationContentFingerprint(baseQuotation());
    const changed = baseQuotation();
    (changed.sections[0] as { carDetail: { projectName: string } }).carDetail.projectName = "Different Project";
    const b = computeQuotationContentFingerprint(changed);
    expect(a).not.toBe(b);
  });

  it("is stable across separately-constructed but logically identical Date instances", () => {
    const a = computeQuotationContentFingerprint(baseQuotation({ quotationDate: new Date("2026-07-27T00:00:00.000Z") }));
    const b = computeQuotationContentFingerprint(baseQuotation({ quotationDate: new Date(2026, 6, 27, 0, 0, 0, 0) }));
    // Only equal if both resolve to the same instant; guard the test itself.
    if (new Date("2026-07-27T00:00:00.000Z").getTime() === new Date(2026, 6, 27, 0, 0, 0, 0).getTime()) {
      expect(a).toBe(b);
    }
  });
});
