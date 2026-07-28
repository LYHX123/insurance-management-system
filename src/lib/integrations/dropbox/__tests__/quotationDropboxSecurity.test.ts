import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 4 Part 16/17.F — security regression coverage for the Quotation
// Dropbox sync service: no arbitrary/traversal paths ever reach Dropbox, no
// public sharing API is ever called, and no secret ever appears in a result.
// Correction 1: the business file/version rows are keyed by quotationCaseId
// (case-owned), not quotationId — this mock mirrors that directly rather
// than the old per-revision keying.

vi.mock("@/lib/quotationTemplateEngine", () => ({
  generateQuotationExcel: vi.fn(async () => ({ buffer: Buffer.from("fake-xlsx-bytes"), filename: "test.xlsx", warnings: [] })),
  TemplateGenerationError: class TemplateGenerationError extends Error {},
}));

const saveFile = vi.fn();
const openFile = vi.fn();
const fileExists = vi.fn();
const getMetadata = vi.fn();
vi.mock("@/lib/quotationDocuments/storage", () => ({
  documentStorageService: {
    saveFile: (...args: unknown[]) => saveFile(...args),
    openFile: (...args: unknown[]) => openFile(...args),
    fileExists: (...args: unknown[]) => fileExists(...args),
    getMetadata: (...args: unknown[]) => getMetadata(...args),
  },
}));

const getAuthenticatedDropboxClient = vi.fn();
vi.mock("@/lib/integrations/dropbox/service", () => ({
  getAuthenticatedDropboxClient: (...args: unknown[]) => getAuthenticatedDropboxClient(...args),
}));

const syncCustomerFolder = vi.fn();
vi.mock("@/lib/integrations/dropbox/customer-folders", () => ({
  syncCustomerFolder: (...args: unknown[]) => syncCustomerFolder(...args),
}));

type QuotationRow = {
  id: string;
  quotationNumber: string;
  quotationCaseId: string | null;
  customerId: string;
  quotationDate: Date;
  customer: { companyName: string; shortName: string | null; customerNumber: string };
  sections: Array<{ insuranceType: { code: string }; carDetail?: { projectName: string | null } | null }>;
};
type BusinessFileRow = {
  id: string;
  quotationCaseId: string;
  businessDate: Date;
  insuranceTypeCode: string;
  customerShortName: string;
  businessTitle: string;
  businessFolderName: string;
  dropboxFolderId: string | null;
  dropboxDisplayPath: string | null;
  dropboxPathLower: string | null;
  syncStatus: string;
  createdAt: Date;
};
type VersionRow = {
  id: string;
  businessFileId: string;
  quotationCaseId: string;
  sourceQuotationId: string;
  versionNumber: number;
  baseFileName: string;
  excelLocalStorageKey: string | null;
  excelDropboxFileId: string | null;
  excelSyncStatus: string;
  contentFingerprint: string | null;
  generatedAt: Date;
  updatedAt: Date;
};

let quotations: Map<string, QuotationRow>;
let businessFiles: Map<string, BusinessFileRow>; // keyed by quotationCaseId
let versions: Map<string, VersionRow>;
let customerDropboxFolders: Map<string, { syncStatus: string; displayPath: string | null }>;
let idCounter = 0;

function findAnyQuotationForCase(caseId: string): QuotationRow {
  const found = Array.from(quotations.values()).find((q) => q.quotationCaseId === caseId);
  if (!found) throw new Error(`No quotation found for case ${caseId}`);
  return found;
}

function makeDelegates() {
  return {
    quotation: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => quotations.get(where.id) ?? null),
    },
    quotationDropboxBusinessFile: {
      findUnique: vi.fn(async ({ where }: { where: { quotationCaseId: string } }) => businessFiles.get(where.quotationCaseId) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { quotationCaseId: string } }) => {
        const row = businessFiles.get(where.quotationCaseId);
        if (!row) throw new Error("not found");
        return row;
      }),
      create: vi.fn(async ({ data }: { data: Partial<BusinessFileRow> & { quotationCaseId: string } }) => {
        const row = {
          id: `bf-${++idCounter}`,
          dropboxFolderId: null,
          dropboxDisplayPath: null,
          dropboxPathLower: null,
          syncStatus: "PENDING",
          createdAt: new Date(),
          ...data,
        } as BusinessFileRow;
        businessFiles.set(data.quotationCaseId, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<BusinessFileRow> }) => {
        const row = Array.from(businessFiles.values()).find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    quotationDropboxVersion: {
      findFirst: vi.fn(async ({ where }: { where: { businessFileId: string } }) => {
        const rows = Array.from(versions.values())
          .filter((v) => v.businessFileId === where.businessFileId)
          .sort((a, b) => b.versionNumber - a.versionNumber);
        return rows[0] ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Partial<VersionRow> & { businessFileId: string; versionNumber: number } }) => {
        const row = {
          id: `ver-${++idCounter}`,
          excelLocalStorageKey: null,
          excelDropboxFileId: null,
          excelSyncStatus: "PENDING",
          contentFingerprint: null,
          updatedAt: new Date(),
          ...data,
        } as VersionRow;
        versions.set(row.id, row);
        return row;
      }),
      findUnique: vi.fn(async ({ where, include }: { where: { id?: string }; include?: unknown }) => {
        const row = where.id ? (versions.get(where.id) ?? null) : null;
        if (!row) return null;
        if (!include) return row;
        const businessFile = businessFiles.get(row.quotationCaseId)!;
        const quotation = findAnyQuotationForCase(row.quotationCaseId);
        const dropboxFolder = customerDropboxFolders.get(quotation.customerId) ?? null;
        return {
          ...row,
          businessFile: {
            ...businessFile,
            quotationCase: {
              id: row.quotationCaseId,
              quotationNumber: quotation.quotationNumber,
              customerId: quotation.customerId,
              customer: { ...quotation.customer, dropboxFolder },
            },
          },
        };
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = versions.get(where.id);
        if (!row) throw new Error("not found");
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<VersionRow> }) => {
        const row = versions.get(where.id)!;
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
    },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "$transaction") {
          return vi.fn(async (cb: (tx: unknown) => unknown) => cb(makeDelegates()));
        }
        return (makeDelegates() as unknown as Record<string, unknown>)[prop as string];
      },
    }
  ),
}));

const ROOT = "/Insurance Management System";
const CUSTOMER_FOLDER_PATH = `${ROOT}/Customers/CUST-0002 - China Railway Seventh Group Co., Limited`;

function notFoundError() {
  return { status: 409, error: { error_summary: "path/not_found/.." } };
}

describe("Quotation Dropbox sync — security regression (Phase 4 Part 16/17.F)", () => {
  let calledMethods: string[];
  let fakeClient: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    idCounter = 0;
    quotations = new Map([
      [
        "quo-1",
        {
          id: "quo-1",
          quotationNumber: "QT202607-006",
          quotationCaseId: "case-1",
          customerId: "cust-1",
          quotationDate: new Date("2026-07-27T00:00:00Z"),
          customer: { companyName: "China Railway Seventh Group Co., Limited", shortName: "CRSG", customerNumber: "CUST-0002" },
          sections: [{ insuranceType: { code: "CAR" }, carDetail: { projectName: "Nakuru Water Project" } }],
        },
      ],
    ]);
    businessFiles = new Map();
    versions = new Map();
    customerDropboxFolders = new Map([["cust-1", { syncStatus: "SYNCED", displayPath: CUSTOMER_FOLDER_PATH }]]);

    saveFile.mockResolvedValue({ storagePath: "case-1/generated/quo-1/v1/x.xlsx" });
    fileExists.mockResolvedValue(true);
    getMetadata.mockResolvedValue({ size: 42 });
    openFile.mockResolvedValue(
      (async function* () {
        yield Buffer.from("fake-xlsx-bytes");
      })()
    );

    calledMethods = [];
    const filesGetMetadata = vi.fn().mockRejectedValue(notFoundError());
    const filesCreateFolderV2 = vi.fn(async ({ path }: { path: string }) => ({ result: { metadata: { id: `id:${path}`, path_display: path } } }));
    const filesUpload = vi.fn().mockResolvedValue({
      result: { id: "id:excel1", rev: "rev1", path_display: `${CUSTOMER_FOLDER_PATH}/20260727-CAR-NAKURU WATER PROJECT/Quotation/CAR-CRSG-20260727-V1.xlsx`, name: "CAR-CRSG-20260727-V1.xlsx", size: 42 },
    });
    fakeClient = new Proxy(
      { filesGetMetadata, filesUpload, filesCreateFolderV2 },
      {
        get(target, prop: string) {
          calledMethods.push(prop);
          if (prop in target) return (target as Record<string, unknown>)[prop];
          throw new Error(`Unexpected Dropbox SDK method invoked: ${prop}`);
        },
      }
    );
    getAuthenticatedDropboxClient.mockResolvedValue({ ok: true, client: fakeClient, env: {}, row: { rootFolder: ROOT } });
    syncCustomerFolder.mockResolvedValue({ success: true, status: "SYNCED", path: CUSTOMER_FOLDER_PATH });
  });

  it("never calls any sharing/link-creation Dropbox API — only filesGetMetadata/filesUpload/filesCreateFolderV2", async () => {
    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");

    const result = await generateAndSyncQuotationExcel("quo-1");

    expect(result.success).toBe(true);
    const uniqueMethods = new Set(calledMethods);
    for (const m of uniqueMethods) {
      expect(["filesGetMetadata", "filesUpload", "filesCreateFolderV2"]).toContain(m);
    }
  });

  it("a tampered business folder name containing '..' is rejected before any upload (defense in depth)", async () => {
    businessFiles.set("case-1", {
      id: "bf-tampered",
      quotationCaseId: "case-1",
      businessDate: new Date("2026-07-27T00:00:00Z"),
      insuranceTypeCode: "CAR",
      customerShortName: "CRSG",
      businessTitle: "NAKURU WATER PROJECT",
      businessFolderName: "../../Escape Attempt",
      dropboxFolderId: "id:existing",
      dropboxDisplayPath: `${ROOT}/../../Escape Attempt`,
      dropboxPathLower: `${ROOT}/../../escape attempt`,
      syncStatus: "SYNCED",
      createdAt: new Date(),
    });
    versions.set("ver-tampered", {
      id: "ver-tampered",
      quotationCaseId: "case-1",
      sourceQuotationId: "quo-1",
      businessFileId: "bf-tampered",
      versionNumber: 1,
      baseFileName: "CAR-CRSG-20260727-V1",
      excelLocalStorageKey: "case-1/x.xlsx",
      excelDropboxFileId: null,
      excelSyncStatus: "PENDING",
      contentFingerprint: "abc",
      generatedAt: new Date(),
      updatedAt: new Date(),
    });

    const { syncQuotationVersionToDropbox } = await import("../quotationDropboxSync");
    const result = await syncQuotationVersionToDropbox("ver-tampered");

    expect(result.success).toBe(false);
    expect(result.code).toBe("DROPBOX_FILE_OUTSIDE_ROOT");
    expect(calledMethods.filter((m) => m === "filesUpload")).toHaveLength(0);
  });

  it("no secret/token ever appears in the sync result", async () => {
    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");

    const result = await generateAndSyncQuotationExcel("quo-1");

    const serialized = JSON.stringify({ ...result, buffer: undefined });
    expect(serialized).not.toMatch(/refresh|access_token|clientSecret|appSecret/i);
  });

  it("a document always resolves through its OWN customer's folder — never a caller-supplied path", async () => {
    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");
    await generateAndSyncQuotationExcel("quo-1");

    const uploadCalls = (fakeClient as { filesUpload: ReturnType<typeof vi.fn> }).filesUpload.mock.calls;
    expect(uploadCalls[0][0].path.startsWith(CUSTOMER_FOLDER_PATH)).toBe(true);
  });

  it("CR/LF and control characters in a project name never survive into the Dropbox folder/file path", async () => {
    quotations.set("quo-1", {
      ...quotations.get("quo-1")!,
      sections: [{ insuranceType: { code: "CAR" }, carDetail: { projectName: "Evil\r\nProject\x00Name" } }],
    });
    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");

    const result = await generateAndSyncQuotationExcel("quo-1");

    expect(result.success).toBe(true);
    const businessFile = businessFiles.get("case-1")!;
    expect(businessFile.businessFolderName).not.toMatch(/[\r\n\x00]/);
  });
});
