import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@/generated/prisma/client";

// Phase 9 — WIBA / CPM Schedule Import. Regression + new-field coverage for
// the section-save path (prepareWiba/buildWibaSection, buildCpmSection in
// actions.ts) after adding monthlyOtherEarnings/chassisOrPlate — mirrors the
// exact mocked-DB technique already proven in customsBondQuotationSave.test.ts
// (mock @/lib/prisma, capture the nested Prisma create payload, assert on
// it) so this exercises the REAL prepareWiba/calculateWiba/buildCpmSection
// code, not a reimplementation of it.

const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => auth(...args) }));

vi.mock("@/lib/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return { ...actual, canEdit: () => true };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/integrations/dropbox/quotationDropboxSync", () => ({
  generateAndSyncQuotationExcel: vi.fn(async () => ({ success: true, buffer: Buffer.from("x"), versionNumber: 1, dropboxStatus: "SYNCED" })),
}));

let caseRow: { id: string; quotationNumber: string; currentRevisionId: string | null } | null;
let customerRow: { id: string } | null;
let insuranceTypeRows: { id: string; name: string }[];
let createdQuotationId: string;

const quotationCreateMock = vi.fn();

function buildTx() {
  return {
    quotationCase: {
      findUniqueOrThrow: vi.fn(async () => caseRow!),
      update: vi.fn(async () => caseRow!),
    },
    quotation: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        quotationCreateMock(data);
        return { id: createdQuotationId, quotationNumber: data.quotationNumber };
      }),
    },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    quotationCase: { findUnique: vi.fn(async () => caseRow) },
    customer: { findUnique: vi.fn(async () => customerRow) },
    customerProject: { findUnique: vi.fn(async () => null) },
    insuranceType: { findMany: vi.fn(async () => insuranceTypeRows) },
    $transaction: vi.fn(async (cb: (tx: ReturnType<typeof buildTx>) => unknown) => cb(buildTx())),
  },
}));

function wibaSection(payrollRows: {
  occupation: string;
  employeeCount: number;
  annualWages?: number | null;
  basicMonthlySalary?: number | null;
  monthlyAllowance?: number | null;
  monthlyOtherEarnings?: number | null;
}[]) {
  return { sectionKind: "WIBA" as const, insuranceTypeId: "it-wiba", description: null, wiba: { wibaRate: 0.5, payrollRows } };
}

function cpmSection(equipmentRows: { equipmentName: string; quantity: number; unitValue: number; chassisOrPlate?: string | null }[]) {
  return {
    sectionKind: "CPM_STANDALONE" as const,
    insuranceTypeId: "it-cpm",
    description: null,
    cpm: { cpmRate: 0.3, pvtLoadingEnabled: false, equipmentRows },
  };
}

function extractWibaPayrollRowCreates(data: Record<string, unknown>) {
  const sections = (data.sections as { create: Record<string, unknown>[] }).create;
  const wiba = sections.find((s) => s.sectionKind === "WIBA")!;
  const detail = wiba.wibaDetail as { create: { payrollRows: { create: Record<string, unknown>[] } } };
  return detail.create.payrollRows.create;
}

function extractCpmEquipmentRowCreates(data: Record<string, unknown>) {
  const sections = (data.sections as { create: Record<string, unknown>[] }).create;
  const cpm = sections.find((s) => s.sectionKind === "CPM_STANDALONE")!;
  const detail = cpm.cpmDetail as { create: { equipmentRows: { create: Record<string, unknown>[] } } };
  return detail.create.equipmentRows.create;
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id: "u1", role: "Staff", status: "ACTIVE", permissions: ["quotation"] } });
  caseRow = { id: "case-1", quotationNumber: "QT202608-001", currentRevisionId: null };
  customerRow = { id: "cust-1" };
  insuranceTypeRows = [
    { id: "it-wiba", name: "WIBA" },
    { id: "it-cpm", name: "CPM" },
  ];
  createdQuotationId = "quo-r01";
});

describe("WIBA section save — monthlyOtherEarnings", () => {
  it("a row with basic/allowance/otherEarnings computes annualWages including all three components", async () => {
    const { startFirstQuotationAction } = await import("../actions");

    const result = await startFirstQuotationAction("case-1", {
      customerId: "cust-1",
      sections: [wibaSection([{ occupation: "Mason", employeeCount: 2, basicMonthlySalary: 10000, monthlyAllowance: 1000, monthlyOtherEarnings: 500 }])],
    });

    expect(result.success).toBe(true);
    const rows = extractWibaPayrollRowCreates(quotationCreateMock.mock.calls[0][0]);
    expect(rows).toHaveLength(1);
    // (10000 + 1000 + 500) * 2 * 12 = 276000
    const annualWages = rows[0].annualWages as Prisma.Decimal;
    expect(annualWages.toString()).toBe("276000");
    const otherEarnings = rows[0].monthlyOtherEarnings as Prisma.Decimal;
    expect(otherEarnings.toString()).toBe("500");
  });

  it("Backward compatibility: a row with only basic/allowance (monthlyOtherEarnings omitted) computes exactly as it did before this field existed", async () => {
    const { startFirstQuotationAction } = await import("../actions");

    const result = await startFirstQuotationAction("case-1", {
      customerId: "cust-1",
      sections: [wibaSection([{ occupation: "Mason", employeeCount: 2, basicMonthlySalary: 10000, monthlyAllowance: 1000 }])],
    });

    expect(result.success).toBe(true);
    const rows = extractWibaPayrollRowCreates(quotationCreateMock.mock.calls[0][0]);
    // (10000 + 1000 + 0) * 2 * 12 = 264000 — identical to the pre-existing formula.
    const annualWages = rows[0].annualWages as Prisma.Decimal;
    expect(annualWages.toString()).toBe("264000");
    expect(rows[0].monthlyOtherEarnings).toBeNull();
  });

  it("Backward compatibility: a legacy row with only annualWages (no salary components at all) is untouched", async () => {
    const { startFirstQuotationAction } = await import("../actions");

    const result = await startFirstQuotationAction("case-1", {
      customerId: "cust-1",
      sections: [wibaSection([{ occupation: "Legacy Row", employeeCount: 3, annualWages: 500000 }])],
    });

    expect(result.success).toBe(true);
    const rows = extractWibaPayrollRowCreates(quotationCreateMock.mock.calls[0][0]);
    const annualWages = rows[0].annualWages as Prisma.Decimal;
    expect(annualWages.toString()).toBe("500000");
    expect(rows[0].basicMonthlySalary).toBeNull();
    expect(rows[0].monthlyOtherEarnings).toBeNull();
  });

  it("otherEarnings alone (basic/allowance blank) still triggers the formula branch, treating basic/allowance as 0", async () => {
    const { startFirstQuotationAction } = await import("../actions");

    const result = await startFirstQuotationAction("case-1", {
      customerId: "cust-1",
      sections: [wibaSection([{ occupation: "Bonus Only", employeeCount: 1, basicMonthlySalary: null, monthlyOtherEarnings: 2000 } as never])],
    });

    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toBe("WIBA_ROW_BASIC_SALARY_INVALID");
  });

  it("a negative monthlyOtherEarnings is rejected", async () => {
    const { startFirstQuotationAction } = await import("../actions");

    const result = await startFirstQuotationAction("case-1", {
      customerId: "cust-1",
      sections: [wibaSection([{ occupation: "Bad Row", employeeCount: 1, basicMonthlySalary: 10000, monthlyOtherEarnings: -1 }])],
    });

    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toBe("WIBA_ROW_OTHER_EARNINGS_INVALID");
  });
});

describe("CPM section save — chassisOrPlate", () => {
  it("a row with chassisOrPlate persists it exactly as entered, unrelated to totalValue", async () => {
    const { startFirstQuotationAction } = await import("../actions");

    const result = await startFirstQuotationAction("case-1", {
      customerId: "cust-1",
      sections: [cpmSection([{ equipmentName: "Excavator", quantity: 2, unitValue: 500000, chassisOrPlate: "KDX 123X" }])],
    });

    expect(result.success).toBe(true);
    const rows = extractCpmEquipmentRowCreates(quotationCreateMock.mock.calls[0][0]);
    expect(rows[0].chassisOrPlate).toBe("KDX 123X");
    const totalValue = rows[0].totalValue as Prisma.Decimal;
    expect(totalValue.toString()).toBe("1000000");
  });

  it("Backward compatibility: a row with chassisOrPlate omitted persists null and computes totalValue exactly as before", async () => {
    const { startFirstQuotationAction } = await import("../actions");

    const result = await startFirstQuotationAction("case-1", {
      customerId: "cust-1",
      sections: [cpmSection([{ equipmentName: "Excavator", quantity: 2, unitValue: 500000 }])],
    });

    expect(result.success).toBe(true);
    const rows = extractCpmEquipmentRowCreates(quotationCreateMock.mock.calls[0][0]);
    expect(rows[0].chassisOrPlate).toBeNull();
    const totalValue = rows[0].totalValue as Prisma.Decimal;
    expect(totalValue.toString()).toBe("1000000");
  });

  it("blank/whitespace-only chassisOrPlate is normalized to null, never an empty string", async () => {
    const { startFirstQuotationAction } = await import("../actions");

    const result = await startFirstQuotationAction("case-1", {
      customerId: "cust-1",
      sections: [cpmSection([{ equipmentName: "Excavator", quantity: 1, unitValue: 100, chassisOrPlate: "   " }])],
    });

    expect(result.success).toBe(true);
    const rows = extractCpmEquipmentRowCreates(quotationCreateMock.mock.calls[0][0]);
    expect(rows[0].chassisOrPlate).toBeNull();
  });
});
