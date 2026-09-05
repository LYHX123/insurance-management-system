import { describe, it, expect } from "vitest";
import { buildMotorListFilterWhere } from "@/lib/policy/motorListFilters";

// Phase 12A — Contact Person + Expiry-range filters compose at the
// database/query level (never client-side filtering of the full dataset).
// The real ILIKE matching semantics ("John" -> "John Kamau", case-
// insensitive) and cross-filter composition are exercised against a real
// Postgres in motorContactFilter.integration.test.ts.

describe("buildMotorListFilterWhere — Contact Person", () => {
  it("no contact filter -> no customerContactPerson condition", () => {
    expect(buildMotorListFilterWhere({}).customerContactPerson).toBeUndefined();
    expect(buildMotorListFilterWhere({ contact: "" }).customerContactPerson).toBeUndefined();
    expect(buildMotorListFilterWhere({ contact: "   " }).customerContactPerson).toBeUndefined();
  });

  it("a fragment -> trimmed, case-insensitive substring match", () => {
    expect(buildMotorListFilterWhere({ contact: "  John  " }).customerContactPerson).toEqual({
      contains: "John",
      mode: "insensitive",
    });
  });
});

describe("buildMotorListFilterWhere — Expiry date range", () => {
  it("no dates -> no expiryDate condition", () => {
    expect(buildMotorListFilterWhere({}).expiryDate).toBeUndefined();
  });

  it("From only -> gte start-of-day, no upper bound", () => {
    expect(buildMotorListFilterWhere({ expiryFrom: "2026-09-01" }).expiryDate).toEqual({
      gte: new Date("2026-09-01T00:00:00.000Z"),
    });
  });

  it("To only -> lte end-of-day (entire calendar day included), no lower bound", () => {
    expect(buildMotorListFilterWhere({ expiryTo: "2026-09-30" }).expiryDate).toEqual({
      lte: new Date("2026-09-30T23:59:59.999Z"),
    });
  });

  it("both -> closed range covering both endpoint days", () => {
    expect(buildMotorListFilterWhere({ expiryFrom: "2026-09-01", expiryTo: "2026-09-30" }).expiryDate).toEqual({
      gte: new Date("2026-09-01T00:00:00.000Z"),
      lte: new Date("2026-09-30T23:59:59.999Z"),
    });
  });

  it("a policy expiring later in the day on the 'To' date is still inside the bound", () => {
    const { expiryDate } = buildMotorListFilterWhere({ expiryTo: "2026-09-30" });
    const lte = (expiryDate as { lte: Date }).lte;
    expect(new Date("2026-09-30T14:30:00.000Z") <= lte).toBe(true);
    expect(new Date("2026-10-01T00:00:00.000Z") <= lte).toBe(false);
  });

  it("ignores malformed date values", () => {
    expect(
      buildMotorListFilterWhere({ expiryFrom: "not-a-date", expiryTo: "2026/09/30" }).expiryDate
    ).toBeUndefined();
  });
});

describe("buildMotorListFilterWhere — composition", () => {
  it("Contact Person + expiry range compose as AND on one where object", () => {
    expect(
      buildMotorListFilterWhere({ contact: "kamau", expiryFrom: "2026-09-01", expiryTo: "2026-12-31" })
    ).toEqual({
      customerContactPerson: { contains: "kamau", mode: "insensitive" },
      expiryDate: {
        gte: new Date("2026-09-01T00:00:00.000Z"),
        lte: new Date("2026-12-31T23:59:59.999Z"),
      },
    });
  });
});
