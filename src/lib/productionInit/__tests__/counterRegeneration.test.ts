import { describe, it, expect, vi } from "vitest";

// Scenario 42: after Production Initialization empties the five
// *NumberCounter tables, the next Quotation/Policy/Invoice/MotorClaim/
// NonMotorClaim created must generate a fresh 001 sequence for the current
// year-month, with no code changes to the existing generators (this
// feature's spec, Part 13: "不修改编号生成代码，除非测试发现现有代码无法在空Counter表下正常工作").
// The generators use `INSERT ... ON CONFLICT DO UPDATE`, which is a plain
// INSERT (sequence 1) when the table has no matching row — exactly the
// post-initialization state — so this is a pure regression check, not new
// behavior.

function fakeTxReturningFirstInsert() {
  // Simulates the counter table being empty: the INSERT branch of
  // `ON CONFLICT DO UPDATE` fires, RETURNING the freshly inserted row.
  return {
    $queryRaw: vi.fn(async () => [{ lastSequence: 1 }]),
  };
}

describe("Number generators produce a fresh 001 sequence against an emptied counter table", () => {
  it("generateQuotationNumber", async () => {
    const { generateQuotationNumber } = await import("@/lib/quotation-utils");
    const tx = fakeTxReturningFirstInsert();
    const result = await generateQuotationNumber(tx as never);
    expect(result).toMatch(/^QT\d{6}-001$/);
  });

  it("generatePolicyRecordNumber (all four categories)", async () => {
    const { generatePolicyRecordNumber } = await import("@/lib/policy/recordNumber");
    for (const [category, prefix] of [
      ["MOTOR", "PM"],
      ["NON_MOTOR", "PN"],
      ["BOND", "PB"],
      ["WORK_PERMIT", "PW"],
    ] as const) {
      const tx = fakeTxReturningFirstInsert();
      const result = await generatePolicyRecordNumber(tx as never, category);
      expect(result).toMatch(new RegExp(`^${prefix}\\d{6}-0001$`));
    }
  });

  it("generateInvoiceNumber", async () => {
    const { generateInvoiceNumber } = await import("@/lib/invoice/recordNumber");
    const tx = fakeTxReturningFirstInsert();
    const result = await generateInvoiceNumber(tx as never);
    expect(result).toMatch(/^INV\d{6}-0001$/);
  });

  it("generateMotorClaimNumber", async () => {
    const { generateMotorClaimNumber } = await import("@/lib/claims/motorClaimNumber");
    const tx = fakeTxReturningFirstInsert();
    const result = await generateMotorClaimNumber(tx as never);
    expect(result).toMatch(/^MC\d{6}-0001$/);
  });

  it("generateNonMotorClaimNumber", async () => {
    const { generateNonMotorClaimNumber } = await import("@/lib/claims/nonMotorClaimNumber");
    const tx = fakeTxReturningFirstInsert();
    const result = await generateNonMotorClaimNumber(tx as never);
    expect(result).toMatch(/^NC\d{6}-0001$/);
  });
});
