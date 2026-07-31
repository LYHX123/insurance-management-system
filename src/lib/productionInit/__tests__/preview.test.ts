import { describe, it, expect, vi, beforeEach } from "vitest";

// Every mocked model delegate exposes ONLY read methods (count/findUnique)
// — if getProductionInitializationPreview ever called anything else
// (create/update/delete/deleteMany), that call would be `undefined(...)`
// and throw, which is exactly the guardrail this file relies on for "Part
// 6: Preview must never modify any data" / test scenario 7.
function countDelegate(n: number) {
  return { count: vi.fn(async () => n) };
}
function findUniqueDelegate(row: { id: string } | null) {
  return { findUnique: vi.fn(async () => row) };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: countDelegate(3),
    customerProject: countDelegate(5),
    customerDocument: countDelegate(7),
    quotationCase: countDelegate(11),
    quotation: countDelegate(13),
    policyRecord: countDelegate(17),
    invoice: countDelegate(19),
    task: countDelegate(23),
    motorClaim: countDelegate(2),
    nonMotorClaim: countDelegate(4),
    ledgerManualEntry: countDelegate(6),
    policyImportBatch: countDelegate(1),
    policyImportRow: countDelegate(8),
    quotationDocument: countDelegate(9),
    policyDocument: countDelegate(10),
    motorClaimDocument: countDelegate(1),
    nonMotorClaimDocument: countDelegate(1),
    customerDropboxFolder: countDelegate(1),
    customerDocumentDropboxSync: countDelegate(1),
    quotationDropboxBusinessFile: countDelegate(1),
    quotationDropboxVersion: countDelegate(1),
    policyDropboxBusinessFile: countDelegate(1),
    policyDocumentDropboxSync: countDelegate(1),
    invoiceDropboxBusinessFile: countDelegate(1),
    invoiceDocumentDropboxSync: countDelegate(1),
    motorClaimDropboxBusinessFile: countDelegate(1),
    nonMotorClaimDropboxBusinessFile: countDelegate(1),
    motorClaimDocumentDropboxSync: countDelegate(1),
    nonMotorClaimDocumentDropboxSync: countDelegate(1),
    quotationNumberCounter: countDelegate(1),
    policyRecordNumberCounter: countDelegate(1),
    invoiceNumberCounter: countDelegate(1),
    motorClaimNumberCounter: countDelegate(1),
    nonMotorClaimNumberCounter: countDelegate(1),
    user: countDelegate(4),
    systemSettings: findUniqueDelegate({ id: "singleton" }),
    dropboxIntegration: findUniqueDelegate({ id: "singleton" }),
    dropboxNamespaceConfig: findUniqueDelegate({ id: "singleton" }),
    insuranceType: countDelegate(20),
    ledgerCategory: countDelegate(6),
    dropboxMigrationJob: countDelegate(2),
    dropboxMigrationObjectLedger: countDelegate(100),
  },
}));

describe("getProductionInitializationPreview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the exact counts from each model with no aggregation surprises", async () => {
    const { getProductionInitializationPreview } = await import("../preview");
    const result = await getProductionInitializationPreview();

    expect(result.toDelete.customers).toBe(3);
    expect(result.toDelete.quotationCases).toBe(11);
    expect(result.toDelete.quotationRevisions).toBe(13);
    expect(result.toDelete.policies).toBe(17);
    expect(result.toDelete.invoices).toBe(19);
    expect(result.toDelete.tasks).toBe(23);
    expect(result.toDelete.motorClaims).toBe(2);
    expect(result.toDelete.nonMotorClaims).toBe(4);
    expect(result.toDelete.manualLedgerEntries).toBe(6);
    expect(result.toDelete.policyImportBatches).toBe(1);
    expect(result.toDelete.policyImportRows).toBe(8);
  });

  it("sums the four non-customer document tables into businessDocumentRecordsTotal without double-counting CustomerDocument", async () => {
    const { getProductionInitializationPreview } = await import("../preview");
    const result = await getProductionInitializationPreview();
    // quotationDocuments(9) + policyDocuments(10) + motorClaimDocuments(1) + nonMotorClaimDocuments(1)
    expect(result.toDelete.businessDocumentRecordsTotal).toBe(21);
    expect(result.toDelete.customerDocuments).toBe(7); // reported separately, not folded in
  });

  it("sums all twelve Dropbox mapping tables into dropboxMappingRecords", async () => {
    const { getProductionInitializationPreview } = await import("../preview");
    const result = await getProductionInitializationPreview();
    expect(result.toDelete.dropboxMappingRecords).toBe(12); // 12 tables x 1 row each
  });

  it("sums all five number counter tables into numberCounterRows", async () => {
    const { getProductionInitializationPreview } = await import("../preview");
    const result = await getProductionInitializationPreview();
    expect(result.toDelete.numberCounterRows).toBe(5);
  });

  it("reports preserved counts and singleton existence correctly", async () => {
    const { getProductionInitializationPreview } = await import("../preview");
    const result = await getProductionInitializationPreview();
    expect(result.toPreserve).toEqual({
      users: 4,
      systemSettingsExists: true,
      dropboxIntegrationExists: true,
      dropboxNamespaceConfigExists: true,
      insuranceTypes: 20,
      ledgerCategories: 6,
      dropboxMigrationJobs: 2,
      dropboxMigrationObjectLedgers: 100,
    });
  });

  it("never calls any mutating method — only count/findUnique (Preview must never modify data)", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { getProductionInitializationPreview } = await import("../preview");
    await getProductionInitializationPreview();

    for (const [name, delegate] of Object.entries(prisma as unknown as Record<string, Record<string, unknown>>)) {
      for (const methodName of Object.keys(delegate)) {
        expect(["create", "update", "delete", "deleteMany", "updateMany", "upsert"]).not.toContain(methodName);
      }
      void name;
    }
  });

  it("reports singleton config as absent (not merely empty) when the row is missing", async () => {
    vi.resetModules();
    vi.doMock("@/lib/prisma", () => ({
      prisma: new Proxy(
        {},
        {
          get: () => ({ count: vi.fn(async () => 0), findUnique: vi.fn(async () => null) }),
        }
      ),
    }));
    const { getProductionInitializationPreview } = await import("../preview");
    const result = await getProductionInitializationPreview();
    expect(result.toPreserve.systemSettingsExists).toBe(false);
    expect(result.toPreserve.dropboxIntegrationExists).toBe(false);
    expect(result.toPreserve.dropboxNamespaceConfigExists).toBe(false);
    vi.doUnmock("@/lib/prisma");
  });
});
