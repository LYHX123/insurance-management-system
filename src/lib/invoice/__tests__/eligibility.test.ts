import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@/generated/prisma/client";

// Phase 5 "Combined Invoice grouping" — getEligiblePoliciesForCustomer now
// (a) derives quotationCaseId/quotationNumber via
// PolicyRecord.sourceQuotation (null-safe for historical/manual records),
// and (b) includes a Policy whose ONLY ineligibility reason is
// ALREADY_INVOICED (annotated isEligible:false + activeInvoiceRef) instead
// of silently dropping it, while every other ineligibility reason
// (CANCELLED_POLICY/MISSING_POLICY_NUMBER/MISSING_DETAIL) is still excluded
// exactly as before this phase.

const policyRecordFindManyMock = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { policyRecord: { findMany: (...args: unknown[]) => policyRecordFindManyMock(...args) } },
}));

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

type Fixture = {
  id: string;
  recordNumber: string;
  category: "MOTOR" | "NON_MOTOR" | "BOND" | "WORK_PERMIT";
  customerId: string;
  processingDate: Date;
  effectiveDate: Date;
  expiryDate: Date;
  businessStatus: string;
  customerPremium: Prisma.Decimal;
  customer: { companyName: string; pinNumber: string };
  motorDetail: { insuranceType: string; policyNumber: string | null } | null;
  nonMotorDetail: { insuranceType: string; policyNumber: string | null } | null;
  bondDetail: { bondType: string; customBondType: string | null; policyNumber: string | null } | null;
  workPermitDetail: { permitType: string; otherPermitType: string | null; permitNumber: string | null } | null;
  invoiceItems: { invoice: { id: string; invoiceNumber: string; status: "ISSUED" | "CANCELLED" } }[];
  sourceQuotation: { quotationNumber: string; quotationCaseId: string } | null;
};

function nonMotorPolicy(overrides: Partial<Fixture> = {}): Fixture {
  return {
    id: "pol-x",
    recordNumber: "PN202608-0001",
    category: "NON_MOTOR",
    customerId: "cust-1",
    processingDate: new Date("2026-08-16"),
    effectiveDate: new Date("2026-09-01"),
    expiryDate: new Date("2027-08-31"),
    businessStatus: "ACTIVE",
    customerPremium: decimal(500000),
    customer: { companyName: "Acme Ltd", pinNumber: "P000111222A" },
    motorDetail: null,
    nonMotorDetail: { insuranceType: "CONTRACTORS_ALL_RISKS", policyNumber: "CAR/2026/001" },
    bondDetail: null,
    workPermitDetail: null,
    invoiceItems: [],
    sourceQuotation: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getEligiblePoliciesForCustomer — Phase 5 grouping + already-invoiced visibility", () => {
  it("derives quotationCaseId/quotationNumber from sourceQuotation for a quotation-linked Policy", async () => {
    policyRecordFindManyMock.mockResolvedValue([
      nonMotorPolicy({ id: "pol-car", sourceQuotation: { quotationNumber: "QT202608-006", quotationCaseId: "case-1" } }),
    ]);
    const { getEligiblePoliciesForCustomer } = await import("../eligibility");
    const rows = await getEligiblePoliciesForCustomer("cust-1");

    expect(rows).toHaveLength(1);
    expect(rows[0].quotationCaseId).toBe("case-1");
    expect(rows[0].quotationNumber).toBe("QT202608-006");
    expect(rows[0].isEligible).toBe(true);
    expect(rows[0].activeInvoiceRef).toBeNull();
  });

  it("Case 8: a historical Policy with no sourceQuotation (null) works fine — quotationCaseId/quotationNumber are null, never throws", async () => {
    policyRecordFindManyMock.mockResolvedValue([nonMotorPolicy({ id: "pol-hist", sourceQuotation: null })]);
    const { getEligiblePoliciesForCustomer } = await import("../eligibility");
    const rows = await getEligiblePoliciesForCustomer("cust-1");

    expect(rows).toHaveLength(1);
    expect(rows[0].quotationCaseId).toBeNull();
    expect(rows[0].quotationNumber).toBeNull();
    expect(rows[0].isEligible).toBe(true);
  });

  it("Case 6: a Policy with an active ISSUED invoice is INCLUDED (not dropped), flagged isEligible:false with activeInvoiceRef", async () => {
    policyRecordFindManyMock.mockResolvedValue([
      nonMotorPolicy({
        id: "pol-wiba",
        recordNumber: "PN202608-0002",
        invoiceItems: [{ invoice: { id: "inv-1", invoiceNumber: "INV202608-0001", status: "ISSUED" } }],
      }),
    ]);
    const { getEligiblePoliciesForCustomer } = await import("../eligibility");
    const rows = await getEligiblePoliciesForCustomer("cust-1");

    expect(rows).toHaveLength(1);
    expect(rows[0].isEligible).toBe(false);
    expect(rows[0].activeInvoiceRef).toEqual({ id: "inv-1", invoiceNumber: "INV202608-0001" });
  });

  it("Case 7: once that Invoice is CANCELLED, the same Policy is reported eligible again", async () => {
    policyRecordFindManyMock.mockResolvedValue([
      nonMotorPolicy({
        id: "pol-wiba",
        invoiceItems: [{ invoice: { id: "inv-1", invoiceNumber: "INV202608-0001", status: "CANCELLED" } }],
      }),
    ]);
    const { getEligiblePoliciesForCustomer } = await import("../eligibility");
    const rows = await getEligiblePoliciesForCustomer("cust-1");

    expect(rows).toHaveLength(1);
    expect(rows[0].isEligible).toBe(true);
    expect(rows[0].activeInvoiceRef).toBeNull();
  });

  it("a Policy with no policy number is still excluded entirely (unchanged pre-existing behavior)", async () => {
    policyRecordFindManyMock.mockResolvedValue([nonMotorPolicy({ id: "pol-no-number", nonMotorDetail: { insuranceType: "WIBA", policyNumber: null } })]);
    const { getEligiblePoliciesForCustomer } = await import("../eligibility");
    const rows = await getEligiblePoliciesForCustomer("cust-1");

    expect(rows).toHaveLength(0);
  });

  it("multiple policies from the same quotationCaseId all carry that same id/number for grouping", async () => {
    policyRecordFindManyMock.mockResolvedValue([
      nonMotorPolicy({ id: "pol-car", recordNumber: "PN-1", sourceQuotation: { quotationNumber: "QT202608-006", quotationCaseId: "case-1" } }),
      nonMotorPolicy({ id: "pol-wiba", recordNumber: "PN-2", sourceQuotation: { quotationNumber: "QT202608-006", quotationCaseId: "case-1" } }),
      nonMotorPolicy({ id: "pol-fire", recordNumber: "PN-3", sourceQuotation: { quotationNumber: "QT202608-009", quotationCaseId: "case-2" } }),
    ]);
    const { getEligiblePoliciesForCustomer } = await import("../eligibility");
    const rows = await getEligiblePoliciesForCustomer("cust-1");

    expect(rows).toHaveLength(3);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("pol-car")!.quotationCaseId).toBe("case-1");
    expect(byId.get("pol-wiba")!.quotationCaseId).toBe("case-1");
    expect(byId.get("pol-fire")!.quotationCaseId).toBe("case-2");
  });
});
