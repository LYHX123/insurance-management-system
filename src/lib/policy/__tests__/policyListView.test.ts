import { describe, it, expect } from "vitest";
import {
  matchesMotorListFilters,
  matchesNonMotorListFilters,
  matchesBondListFilters,
  matchesWorkPermitListFilters,
  toMotorListRow,
} from "@/lib/policy/policyListView";
import type { MotorListRow, NonMotorListRow, BondListRow, WorkPermitListRow } from "@/components/policy/types";

// Phase 13A — the shared list predicates are the single source of truth for
// "which rows the list shows", now reused by the Excel export routes.

const motorRow = (o: Partial<MotorListRow> = {}): MotorListRow => ({
  id: "1",
  recordNumber: "PM-0001",
  processingDate: "2026-09-01T00:00:00.000Z",
  customerId: "c1",
  customerName: "Alpha Ltd",
  insuranceType: "COMPREHENSIVE",
  registrationNumber: "KAA 111A",
  insurerName: "Jubilee",
  expiryDate: "2026-10-15T00:00:00.000Z",
  clientPremium: "1000.00",
  clientBalance: "0.00",
  insurerBalance: "0.00",
  businessStatus: "ACTIVE",
  renewalIndex: 0,
  renewalDecision: null,
  contactPerson: "Jane",
  valuationStatus: null,
  ...o,
});

describe("matchesMotorListFilters", () => {
  it("no filters -> everything matches", () => {
    expect(matchesMotorListFilters(motorRow(), {})).toBe(true);
  });
  it("search matches record no / customer / registration / insurer, case-insensitive", () => {
    expect(matchesMotorListFilters(motorRow(), { search: "pm-0001" })).toBe(true);
    expect(matchesMotorListFilters(motorRow(), { search: "alpha" })).toBe(true);
    expect(matchesMotorListFilters(motorRow(), { search: "kaa 111a" })).toBe(true);
    expect(matchesMotorListFilters(motorRow(), { search: "jubilee" })).toBe(true);
    expect(matchesMotorListFilters(motorRow(), { search: "zzz" })).toBe(false);
  });
  it("customer / type / insurer / status filters", () => {
    expect(matchesMotorListFilters(motorRow(), { customer: "Alpha Ltd" })).toBe(true);
    expect(matchesMotorListFilters(motorRow(), { customer: "Beta" })).toBe(false);
    expect(matchesMotorListFilters(motorRow(), { type: "COMPREHENSIVE" })).toBe(true);
    expect(matchesMotorListFilters(motorRow(), { type: "THIRD PARTY" })).toBe(false);
    expect(matchesMotorListFilters(motorRow(), { insurer: "Jubilee" })).toBe(true);
    expect(matchesMotorListFilters(motorRow(), { insurer: "APA" })).toBe(false);
    expect(matchesMotorListFilters(motorRow({ businessStatus: "EXPIRED" }), { status: "ACTIVE" })).toBe(false);
  });
  it("outstanding-balance filters compose with AND", () => {
    const owing = motorRow({ clientBalance: "500.00", insurerBalance: "0.00" });
    expect(matchesMotorListFilters(owing, { outstandingClientOnly: true })).toBe(true);
    expect(matchesMotorListFilters(owing, { outstandingInsurerOnly: true })).toBe(false);
    expect(
      matchesMotorListFilters(owing, { customer: "Alpha Ltd", status: "ACTIVE", outstandingClientOnly: true })
    ).toBe(true);
    expect(
      matchesMotorListFilters(owing, { customer: "Beta", outstandingClientOnly: true })
    ).toBe(false);
  });
});

describe("matchesNonMotorListFilters — expiry exact-match", () => {
  const row: NonMotorListRow = {
    id: "1",
    recordNumber: "PN-1",
    processingDate: "2026-09-01T00:00:00.000Z",
    customerId: "c1",
    customerName: "Alpha Ltd",
    insuranceType: "WIBA",
    insurerName: "APA",
    expiryDate: "2026-10-15T00:00:00.000Z",
    clientPremium: "1.00",
    clientBalance: "0.00",
    insurerBalance: "0.00",
    businessStatus: "ACTIVE",
    renewalIndex: 0,
    renewalDecision: null,
  };
  it("matches only the exact expiry date", () => {
    expect(matchesNonMotorListFilters(row, { expiryDate: "2026-10-15" })).toBe(true);
    expect(matchesNonMotorListFilters(row, { expiryDate: "2026-10-14" })).toBe(false);
  });
  it("type filter is on the cover-type enum value", () => {
    expect(matchesNonMotorListFilters(row, { type: "WIBA" })).toBe(true);
    expect(matchesNonMotorListFilters(row, { type: "MARINE" })).toBe(false);
  });
});

describe("matchesBondListFilters", () => {
  const row: BondListRow = {
    id: "1",
    recordNumber: "PB-1",
    processingDate: "2026-09-01T00:00:00.000Z",
    customerId: "c1",
    customerName: "Alpha Ltd",
    bondType: "TENDER_BOND",
    customBondType: null,
    policyNumber: "BND-999",
    insurerName: "APA",
    expiryDate: "2026-10-15T00:00:00.000Z",
    clientPremium: "1.00",
    clientBalance: "0.00",
    insurerBalance: "0.00",
    businessStatus: "ACTIVE",
    renewalIndex: 0,
    renewalDecision: null,
  };
  it("search also covers policy number", () => {
    expect(matchesBondListFilters(row, { search: "bnd-999" })).toBe(true);
  });
  it("type filter is the bond-type enum value", () => {
    expect(matchesBondListFilters(row, { type: "TENDER_BOND" })).toBe(true);
    expect(matchesBondListFilters(row, { type: "PERFORMANCE_BOND" })).toBe(false);
  });
});

describe("matchesWorkPermitListFilters — no insurer filter", () => {
  const row: WorkPermitListRow = {
    id: "1",
    recordNumber: "PW-1",
    processingDate: "2026-09-01T00:00:00.000Z",
    customerId: "c1",
    customerName: "Alpha Ltd",
    permitType: "CLASS_D",
    otherPermitType: null,
    expiryDate: "2026-10-15T00:00:00.000Z",
    clientPremium: "1.00",
    clientBalance: "0.00",
    insurerBalance: "0.00",
    businessStatus: "ACTIVE",
    renewalIndex: 0,
    renewalDecision: null,
  };
  it("permit type + expiry + customer compose with AND; an insurer filter is a no-op", () => {
    expect(matchesWorkPermitListFilters(row, { type: "CLASS_D", expiryDate: "2026-10-15", customer: "Alpha Ltd" })).toBe(true);
    expect(matchesWorkPermitListFilters(row, { type: "CLASS_G" })).toBe(false);
    // Work Permit has no insurer filter — a stray insurer value must not exclude rows.
    expect(matchesWorkPermitListFilters(row, { insurer: "APA" })).toBe(true);
  });
});

describe("toMotorListRow — mapper parity", () => {
  it("computes balances and never loses the excluded-from-export premium", () => {
    const row = toMotorListRow(
      {
        id: "x",
        recordNumber: "PM-9",
        processingDate: new Date("2026-09-01T00:00:00.000Z"),
        customerId: "c1",
        customer: { companyName: "Alpha Ltd" },
        effectiveDate: new Date("2026-08-01T00:00:00.000Z"),
        expiryDate: new Date("2027-08-01T00:00:00.000Z"),
        businessStatus: "ACTIVE",
        customerPremium: { toNumber: () => 1000 },
        insurerCost: { toNumber: () => 800 },
        insurerName: "Jubilee",
        renewalIndex: 0,
        renewalDecision: null,
        customerContactPerson: "Jane",
        motorDetail: { insuranceType: "COMPREHENSIVE", registrationNumber: "KAA 1A", valuationStatus: "IN_PROGRESS" },
      },
      { totalReceived: 400, totalPaid: 0 },
      new Date("2026-09-06T00:00:00.000Z")
    );
    expect(row.clientBalance).toBe("600.00");
    expect(row.insurerBalance).toBe("800.00");
    expect(row.businessStatus).toBe("ACTIVE");
    expect(row.valuationStatus).toBe("IN_PROGRESS");
  });
});
