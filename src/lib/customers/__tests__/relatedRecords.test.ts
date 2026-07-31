import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthzUser } from "@/lib/permissions";

// Phase 8.1 Part 15.A — Customer Related Records. Verifies the contract
// every consumer depends on: a module the acting user lacks permission for
// is never queried at all (no DB call, no record-count leakage — Part 14,
// requirement 5), every query is scoped to the requested customerId, Claims
// additionally never drop the existing participant-scoping filter, and
// every list is capped at 5 rows.

const quotationCaseCountMock = vi.fn();
const quotationCaseFindManyMock = vi.fn();
const quotationFindManyMock = vi.fn();
const policyRecordCountMock = vi.fn();
const policyRecordFindManyMock = vi.fn();
const invoiceCountMock = vi.fn();
const invoiceFindManyMock = vi.fn();
const motorClaimCountMock = vi.fn();
const motorClaimFindManyMock = vi.fn();
const nonMotorClaimCountMock = vi.fn();
const nonMotorClaimFindManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    quotationCase: {
      count: (...args: unknown[]) => quotationCaseCountMock(...args),
      findMany: (...args: unknown[]) => quotationCaseFindManyMock(...args),
    },
    quotation: {
      findMany: (...args: unknown[]) => quotationFindManyMock(...args),
    },
    policyRecord: {
      count: (...args: unknown[]) => policyRecordCountMock(...args),
      findMany: (...args: unknown[]) => policyRecordFindManyMock(...args),
    },
    invoice: {
      count: (...args: unknown[]) => invoiceCountMock(...args),
      findMany: (...args: unknown[]) => invoiceFindManyMock(...args),
    },
    motorClaim: {
      count: (...args: unknown[]) => motorClaimCountMock(...args),
      findMany: (...args: unknown[]) => motorClaimFindManyMock(...args),
    },
    nonMotorClaim: {
      count: (...args: unknown[]) => nonMotorClaimCountMock(...args),
      findMany: (...args: unknown[]) => nonMotorClaimFindManyMock(...args),
    },
  },
}));

function baseUser(permissions: string[]): AuthzUser {
  return { role: "STAFF", status: "ACTIVE", permissions };
}

const ALL_PERMISSIONS = [
  "quotation",
  "invoice",
  "policy.motor",
  "policy.non_motor",
  "policy.bond",
  "policy.work_permit",
  "claim.motor",
  "claim.non_motor",
];

describe("getCustomerRelatedRecords", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    quotationCaseCountMock.mockResolvedValue(0);
    quotationCaseFindManyMock.mockResolvedValue([]);
    quotationFindManyMock.mockResolvedValue([]);
    policyRecordCountMock.mockResolvedValue(0);
    policyRecordFindManyMock.mockResolvedValue([]);
    invoiceCountMock.mockResolvedValue(0);
    invoiceFindManyMock.mockResolvedValue([]);
    motorClaimCountMock.mockResolvedValue(0);
    motorClaimFindManyMock.mockResolvedValue([]);
    nonMotorClaimCountMock.mockResolvedValue(0);
    nonMotorClaimFindManyMock.mockResolvedValue([]);
  });

  it("hides a module and makes no DB call at all when the user lacks its permission", async () => {
    const { getCustomerRelatedRecords } = await import("../relatedRecords");
    const user = baseUser([]); // no permissions at all
    const data = await getCustomerRelatedRecords("cust-1", "user-1", user);

    expect(data.quotations).toEqual({ visible: false, total: 0, rows: [] });
    expect(data.invoices).toEqual({ visible: false, total: 0, rows: [] });
    expect(data.motorClaims).toEqual({ visible: false, total: 0, rows: [] });
    expect(data.nonMotorClaims).toEqual({ visible: false, total: 0, rows: [] });
    expect(data.policies.visible).toBe(false);
    expect(data.policies.categoryTotals).toEqual([]);

    expect(quotationCaseFindManyMock).not.toHaveBeenCalled();
    expect(invoiceFindManyMock).not.toHaveBeenCalled();
    expect(motorClaimFindManyMock).not.toHaveBeenCalled();
    expect(nonMotorClaimFindManyMock).not.toHaveBeenCalled();
    expect(policyRecordFindManyMock).not.toHaveBeenCalled();
  });

  it("scopes every query to the requested customerId", async () => {
    const { getCustomerRelatedRecords } = await import("../relatedRecords");
    const user = baseUser(ALL_PERMISSIONS);
    await getCustomerRelatedRecords("cust-42", "user-1", user);

    const quotationWhere = quotationCaseFindManyMock.mock.calls[0][0].where;
    expect(quotationWhere).toMatchObject({ customerId: "cust-42" });

    const invoiceWhere = invoiceFindManyMock.mock.calls[0][0].where;
    expect(invoiceWhere).toMatchObject({ customerId: "cust-42" });

    // Policy is queried once per permitted category.
    for (const call of policyRecordFindManyMock.mock.calls) {
      expect(call[0].where).toMatchObject({ customerId: "cust-42", deletedAt: null });
    }
    expect(policyRecordFindManyMock.mock.calls.length).toBe(4);
  });

  it("caps every recent-records query at 5 rows", async () => {
    const { getCustomerRelatedRecords } = await import("../relatedRecords");
    const user = baseUser(ALL_PERMISSIONS);
    await getCustomerRelatedRecords("cust-1", "user-1", user);

    expect(quotationCaseFindManyMock.mock.calls[0][0].take).toBe(5);
    expect(invoiceFindManyMock.mock.calls[0][0].take).toBe(5);
    expect(motorClaimFindManyMock.mock.calls[0][0].take).toBe(5);
    expect(nonMotorClaimFindManyMock.mock.calls[0][0].take).toBe(5);
    for (const call of policyRecordFindManyMock.mock.calls) {
      expect(call[0].take).toBe(5);
    }
  });

  it("never queries a Policy category the user lacks permission for, and only counts permitted categories", async () => {
    const { getCustomerRelatedRecords } = await import("../relatedRecords");
    const user = baseUser(["policy.motor"]); // only Motor
    await getCustomerRelatedRecords("cust-1", "user-1", user);

    expect(policyRecordFindManyMock.mock.calls.length).toBe(1);
    expect(policyRecordFindManyMock.mock.calls[0][0].where).toMatchObject({ category: "MOTOR" });
  });

  it("Motor Claims: merges customerId into the where clause WITHOUT ever dropping participant-scoping", async () => {
    const { getCustomerRelatedRecords } = await import("../relatedRecords");
    const user = baseUser(["claim.motor"]);
    await getCustomerRelatedRecords("cust-7", "user-99", user);

    const where = motorClaimFindManyMock.mock.calls[0][0].where;
    expect(where).toMatchObject({
      customerId: "cust-7",
      deletedAt: null,
      participants: { some: { userId: "user-99" } },
    });
  });

  it("Non-Motor Claims: merges customerId into the where clause WITHOUT ever dropping participant-scoping", async () => {
    const { getCustomerRelatedRecords } = await import("../relatedRecords");
    const user = baseUser(["claim.non_motor"]);
    await getCustomerRelatedRecords("cust-7", "user-99", user);

    const where = nonMotorClaimFindManyMock.mock.calls[0][0].where;
    expect(where).toMatchObject({
      customerId: "cust-7",
      deletedAt: null,
      participants: { some: { userId: "user-99" } },
    });
  });

  it("an admin still only sees Claims they participate in (participant filter is never bypassed for admins)", async () => {
    const { getCustomerRelatedRecords } = await import("../relatedRecords");
    const admin: AuthzUser = { role: "ADMIN", status: "ACTIVE", permissions: [] };
    await getCustomerRelatedRecords("cust-1", "admin-1", admin);

    const where = motorClaimFindManyMock.mock.calls[0][0].where;
    expect(where).toMatchObject({ participants: { some: { userId: "admin-1" } } });
  });

  it("policies.categoryTotals excludes a permitted category with zero records for this customer", async () => {
    policyRecordCountMock.mockResolvedValueOnce(3); // MOTOR has records
    policyRecordCountMock.mockResolvedValueOnce(0); // NON_MOTOR has none
    policyRecordCountMock.mockResolvedValueOnce(0); // BOND has none
    policyRecordCountMock.mockResolvedValueOnce(0); // WORK_PERMIT has none

    const { getCustomerRelatedRecords } = await import("../relatedRecords");
    const user = baseUser(["policy.motor", "policy.non_motor", "policy.bond", "policy.work_permit"]);
    const data = await getCustomerRelatedRecords("cust-1", "user-1", user);

    expect(data.policies.categoryTotals).toEqual([{ category: "MOTOR", total: 3 }]);
    expect(data.policies.total).toBe(3);
  });
});
