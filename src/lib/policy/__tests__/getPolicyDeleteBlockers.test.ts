import { describe, it, expect, vi } from "vitest";
import { getPolicyDeleteBlockers } from "../getPolicyDeleteBlockers";
import type { Prisma } from "@/generated/prisma/client";

// Phase 13D — the reusable "is this policy safe to permanently delete?"
// helper. Fully isolated: a hand-built fake client, no DB, no module mocks.

type Counts = {
  invoiceItem?: number;
  customerReceipt?: number;
  providerPayment?: number;
  motorClaim?: number;
  nonMotorClaim?: number;
  renewalChild?: number;
};

type RecordShape = {
  commissionReceived?: boolean;
  commissionAmount?: unknown;
  commissionReceivedDate?: unknown;
  renewedFromId?: string | null;
  renewedBy?: { id: string } | null;
} | null;

function fakeClient(record: RecordShape, counts: Counts = {}) {
  const c = {
    invoiceItem: 0,
    customerReceipt: 0,
    providerPayment: 0,
    motorClaim: 0,
    nonMotorClaim: 0,
    renewalChild: 0,
    ...counts,
  };
  return {
    policyRecord: {
      findUnique: vi.fn(async () =>
        record === null
          ? null
          : {
              id: "pol-1",
              commissionReceived: record.commissionReceived ?? false,
              commissionAmount: record.commissionAmount ?? null,
              commissionReceivedDate: record.commissionReceivedDate ?? null,
              renewedFromId: record.renewedFromId ?? null,
              renewedBy: record.renewedBy ?? null,
            }
      ),
      count: vi.fn(async ({ where }: { where: { rootPolicyId?: string } }) =>
        where.rootPolicyId ? c.renewalChild : 0
      ),
    },
    invoiceItem: { count: vi.fn(async () => c.invoiceItem) },
    policyCustomerReceipt: { count: vi.fn(async () => c.customerReceipt) },
    policyProviderPayment: { count: vi.fn(async () => c.providerPayment) },
    motorClaim: { count: vi.fn(async () => c.motorClaim) },
    nonMotorClaim: { count: vi.fn(async () => c.nonMotorClaim) },
  } as unknown as Prisma.TransactionClient;
}

describe("getPolicyDeleteBlockers", () => {
  it("returns null for an unknown policy id (caller maps to NOT_FOUND)", async () => {
    const result = await getPolicyDeleteBlockers(fakeClient(null), "missing");
    expect(result).toBeNull();
  });

  it("a clean policy with no downstream records is deletable", async () => {
    const result = await getPolicyDeleteBlockers(fakeClient({}), "pol-1");
    expect(result).toEqual({ canDelete: true, blockers: [] });
  });

  it("blocks on a linked invoice item", async () => {
    const result = await getPolicyDeleteBlockers(fakeClient({}, { invoiceItem: 2 }), "pol-1");
    expect(result?.canDelete).toBe(false);
    expect(result?.blockers).toContainEqual({ type: "INVOICE", count: 2 });
  });

  it("blocks on a non-deleted customer receipt and provider payment separately", async () => {
    const result = await getPolicyDeleteBlockers(
      fakeClient({}, { customerReceipt: 1, providerPayment: 3 }),
      "pol-1"
    );
    expect(result?.canDelete).toBe(false);
    expect(result?.blockers).toContainEqual({ type: "CUSTOMER_RECEIPT", count: 1 });
    expect(result?.blockers).toContainEqual({ type: "PROVIDER_PAYMENT", count: 3 });
  });

  it("blocks on a commission ledger posting only when amount AND date are both present", async () => {
    const withPosting = await getPolicyDeleteBlockers(
      fakeClient({ commissionReceived: true, commissionAmount: 100, commissionReceivedDate: new Date() }),
      "pol-1"
    );
    expect(withPosting?.blockers).toContainEqual({ type: "LEDGER_RECORD", count: 1 });

    // commissionReceived=true but no amount/date (matches the System Ledger's
    // own exclusion) — not a blocker.
    const withoutPosting = await getPolicyDeleteBlockers(
      fakeClient({ commissionReceived: true, commissionAmount: null, commissionReceivedDate: null }),
      "pol-1"
    );
    expect(withoutPosting).toEqual({ canDelete: true, blockers: [] });
  });

  it("blocks on Motor and Non-Motor claims", async () => {
    const result = await getPolicyDeleteBlockers(
      fakeClient({}, { motorClaim: 1, nonMotorClaim: 2 }),
      "pol-1"
    );
    expect(result?.blockers).toContainEqual({ type: "MOTOR_CLAIM", count: 1 });
    expect(result?.blockers).toContainEqual({ type: "NON_MOTOR_CLAIM", count: 2 });
  });

  it("blocks a policy that is itself a renewal (renewedFromId set)", async () => {
    const result = await getPolicyDeleteBlockers(fakeClient({ renewedFromId: "orig-1" }), "pol-1");
    expect(result?.canDelete).toBe(false);
    expect(result?.blockers).toContainEqual({ type: "RENEWAL", count: 1 });
  });

  it("blocks a policy that has a direct renewal successor (renewedBy set)", async () => {
    const result = await getPolicyDeleteBlockers(fakeClient({ renewedBy: { id: "next-1" } }), "pol-1");
    expect(result?.canDelete).toBe(false);
    expect(result?.blockers?.find((b) => b.type === "RENEWAL")).toBeTruthy();
  });

  it("blocks the root of a chain that still has renewal members", async () => {
    const result = await getPolicyDeleteBlockers(fakeClient({}, { renewalChild: 2 }), "pol-1");
    expect(result?.canDelete).toBe(false);
    expect(result?.blockers).toContainEqual({ type: "RENEWAL", count: 2 });
  });

  it("reports every applicable blocker at once", async () => {
    const result = await getPolicyDeleteBlockers(
      fakeClient(
        { commissionReceived: true, commissionAmount: 1, commissionReceivedDate: new Date(), renewedFromId: "o" },
        { invoiceItem: 1, customerReceipt: 1, providerPayment: 1, motorClaim: 1, nonMotorClaim: 1 }
      ),
      "pol-1"
    );
    expect(result?.canDelete).toBe(false);
    expect(result?.blockers.map((b) => b.type).sort()).toEqual(
      ["CUSTOMER_RECEIPT", "INVOICE", "LEDGER_RECORD", "MOTOR_CLAIM", "NON_MOTOR_CLAIM", "PROVIDER_PAYMENT", "RENEWAL"].sort()
    );
  });
});
