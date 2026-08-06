import { describe, it, expect, vi } from "vitest";
import { claimIdempotencyKey, fulfillIdempotencyClaim } from "../claim";

class FakeUniqueConstraintError extends Error {
  code = "P2002";
}

function buildFakeTx(initialRows: { key: string; scope: string; resourceId: string }[] = []) {
  const rows = new Map(initialRows.map((r) => [r.key, { ...r }]));
  return {
    idempotencyClaim: {
      create: vi.fn(async ({ data }: { data: { key: string; scope: string; resourceId: string } }) => {
        if (rows.has(data.key)) throw new FakeUniqueConstraintError("Unique constraint failed on the fields: (`key`)");
        rows.set(data.key, { ...data });
        return { id: `claim-${data.key}`, ...data, createdAt: new Date() };
      }),
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null),
      update: vi.fn(async ({ where, data }: { where: { key: string }; data: { resourceId: string } }) => {
        const row = rows.get(where.key);
        if (!row) throw new Error("not found");
        row.resourceId = data.resourceId;
        return row;
      }),
    },
    rows,
  };
}

describe("claimIdempotencyKey / fulfillIdempotencyClaim", () => {
  it("a brand-new key is claimed", async () => {
    const tx = buildFakeTx();
    const result = await claimIdempotencyKey(tx as never, "policy.customerReceipt", "key-1");
    expect(result).toEqual({ kind: "claimed" });
  });

  it("fulfilling then re-claiming the same key returns a replay with the stored resourceId", async () => {
    const tx = buildFakeTx();
    const claim1 = await claimIdempotencyKey(tx as never, "policy.customerReceipt", "key-2");
    expect(claim1).toEqual({ kind: "claimed" });
    await fulfillIdempotencyClaim(tx as never, "key-2", "receipt-123");

    const claim2 = await claimIdempotencyKey(tx as never, "policy.customerReceipt", "key-2");
    expect(claim2).toEqual({ kind: "replay", resourceId: "receipt-123" });
  });

  it("two different keys are independent — both claim successfully", async () => {
    const tx = buildFakeTx();
    const a = await claimIdempotencyKey(tx as never, "policy.customerReceipt", "key-a");
    const b = await claimIdempotencyKey(tx as never, "policy.customerReceipt", "key-b");
    expect(a).toEqual({ kind: "claimed" });
    expect(b).toEqual({ kind: "claimed" });
  });

  it("an unfulfilled (still-pending) existing claim re-throws rather than fabricating a replay", async () => {
    const tx = buildFakeTx([{ key: "key-pending", scope: "policy.customerReceipt", resourceId: "" }]);
    await expect(claimIdempotencyKey(tx as never, "policy.customerReceipt", "key-pending")).rejects.toBeInstanceOf(FakeUniqueConstraintError);
  });

  it("a non-unique-constraint error is propagated, not swallowed", async () => {
    const tx = {
      idempotencyClaim: {
        create: vi.fn(async () => {
          throw new Error("connection lost");
        }),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };
    await expect(claimIdempotencyKey(tx as never, "policy.customerReceipt", "key-x")).rejects.toThrow("connection lost");
    expect(tx.idempotencyClaim.findUnique).not.toHaveBeenCalled();
  });
});
