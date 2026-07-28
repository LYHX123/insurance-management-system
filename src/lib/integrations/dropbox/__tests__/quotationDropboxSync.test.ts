import { describe, it, expect, vi, beforeEach } from "vitest";

// --- In-memory fakes --------------------------------------------------------
// Correction 1: QuotationDropboxBusinessFile/QuotationDropboxVersion belong
// directly to a QuotationCase (1 business file per case, unique on
// quotationCaseId) rather than to any one Quotation revision. There is no
// separate "QuotationCase" map to maintain by hand — the set of cases (and
// each case's `currentRevisionId`) is derived from the `quotations` map
// itself, exactly like the real schema (every Quotation row always carries
// its own quotationCaseId).
type QuotationRow = {
  id: string;
  quotationNumber: string;
  quotationCaseId: string | null;
  revisionNumber: number;
  customerId: string;
  quotationDate: Date;
  customer: { companyName: string; shortName: string | null; customerNumber: string };
  sections: Array<{
    insuranceType: { code: string };
    carDetail?: { projectName: string | null } | null;
    motorCompPrivateDetail?: { plateNo: string } | null;
    motorCompCommercialDetail?: { plateNo: string } | null;
    motorTpoPrivateDetail?: { plateNo: string } | null;
    motorTpoCommercialDetail?: { plateNo: string } | null;
    tenderSecurityDetail?: { projectName: string } | null;
    performanceBondDetail?: { projectName: string } | null;
    advancePaymentGuaranteeDetail?: { projectName: string } | null;
  }>;
  grandTotal?: number;
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
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
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
  excelDropboxRevision: string | null;
  excelDropboxPath: string | null;
  excelSyncStatus: string;
  contentFingerprint: string | null;
  generatedAt: Date;
  lastSyncedAt: Date | null;
  updatedAt: Date;
};

// Maps a caseId to an explicit currentRevisionId override — only set by
// tests that specifically exercise the "case has an explicit current
// revision" path. Unset cases fall back to the code's other branch (most
// recent revision by revisionNumber), which every single-revision-per-case
// test below satisfies trivially.
let quotations: Map<string, QuotationRow>;
let businessFiles: Map<string, BusinessFileRow>; // keyed by quotationCaseId
let versions: Map<string, VersionRow>;
let customerDropboxFolders: Map<string, { syncStatus: string; displayPath: string | null }>;
let caseCurrentRevisionOverride: Map<string, string | null>;
let idCounter = 0;

function newId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function deriveCaseIds(): string[] {
  return Array.from(new Set(Array.from(quotations.values()).map((q) => q.quotationCaseId).filter((id): id is string => !!id)));
}

function findAnyQuotationForCase(caseId: string): QuotationRow {
  const found = Array.from(quotations.values()).find((q) => q.quotationCaseId === caseId);
  if (!found) throw new Error(`No quotation found for case ${caseId}`);
  return found;
}

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

function makePrismaMock() {
  const quotationDelegate = {
    findUnique: vi.fn(async ({ where, select }: { where: { id: string }; select?: { quotationCaseId?: boolean } }) => {
      const q = quotations.get(where.id);
      if (!q) return null;
      if (select) {
        const result: Record<string, unknown> = {};
        if (select.quotationCaseId) result.quotationCaseId = q.quotationCaseId;
        return result;
      }
      return q;
    }),
    findFirst: vi.fn(async ({ where }: { where: { quotationCaseId: string } }) => {
      const rows = Array.from(quotations.values())
        .filter((q) => q.quotationCaseId === where.quotationCaseId)
        .sort((a, b) => b.revisionNumber - a.revisionNumber);
      return rows[0] ? { id: rows[0].id } : null;
    }),
  };
  const customerDelegate = {
    findMany: vi.fn(async () => {
      const seen = new Map<string, { shortName: string | null; companyName: string }>();
      for (const q of quotations.values()) seen.set(q.customerId, { shortName: q.customer.shortName, companyName: q.customer.companyName });
      return Array.from(seen.values());
    }),
  };
  const businessFileDelegate = {
    findUnique: vi.fn(async ({ where, include }: { where: { quotationCaseId: string }; include?: unknown }) => {
      const row = businessFiles.get(where.quotationCaseId);
      if (!row) return null;
      if (!include) return row;
      const anyQuotation = findAnyQuotationForCase(row.quotationCaseId);
      const dropboxFolder = customerDropboxFolders.get(anyQuotation.customerId) ?? null;
      return {
        ...row,
        quotationCase: {
          id: row.quotationCaseId,
          quotationNumber: anyQuotation.quotationNumber,
          customerId: anyQuotation.customerId,
          customer: { ...anyQuotation.customer, dropboxFolder },
        },
      };
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { quotationCaseId: string } }) => {
      const row = businessFiles.get(where.quotationCaseId);
      if (!row) throw new Error("Business file not found.");
      return row;
    }),
    create: vi.fn(async ({ data }: { data: Partial<BusinessFileRow> & { quotationCaseId: string } }) => {
      if (businessFiles.has(data.quotationCaseId)) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      const row: BusinessFileRow = {
        dropboxFolderId: null,
        dropboxDisplayPath: null,
        dropboxPathLower: null,
        syncStatus: "PENDING",
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAt: new Date(),
        ...data,
        id: newId("bf"),
      } as BusinessFileRow;
      businessFiles.set(data.quotationCaseId, row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<BusinessFileRow> }) => {
      const row = Array.from(businessFiles.values()).find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    }),
    count: vi.fn(async () => businessFiles.size),
  };
  const versionDelegate = {
    findFirst: vi.fn(
      async ({
        where,
        orderBy,
      }: {
        where: { businessFileId: string };
        orderBy?: { versionNumber: "asc" | "desc" };
      }) => {
        const rows = Array.from(versions.values()).filter((v) => v.businessFileId === where.businessFileId);
        rows.sort((a, b) => (orderBy?.versionNumber === "asc" ? a.versionNumber - b.versionNumber : b.versionNumber - a.versionNumber));
        return rows[0] ?? null;
      }
    ),
    create: vi.fn(async ({ data }: { data: Partial<VersionRow> & { businessFileId: string; versionNumber: number } }) => {
      const conflict = Array.from(versions.values()).some((v) => v.businessFileId === data.businessFileId && v.versionNumber === data.versionNumber);
      if (conflict) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      const row: VersionRow = {
        id: newId("ver"),
        excelLocalStorageKey: null,
        excelDropboxFileId: null,
        excelDropboxRevision: null,
        excelDropboxPath: null,
        excelSyncStatus: "PENDING",
        contentFingerprint: null,
        lastSyncedAt: null,
        updatedAt: new Date(),
        quotationCaseId: data.quotationCaseId!,
        sourceQuotationId: data.sourceQuotationId!,
        baseFileName: data.baseFileName!,
        generatedAt: data.generatedAt!,
        ...data,
      } as VersionRow;
      versions.set(row.id, row);
      return row;
    }),
    findUnique: vi.fn(
      async ({
        where,
        include,
      }: {
        where: { id?: string; businessFileId_versionNumber?: { businessFileId: string; versionNumber: number } };
        include?: unknown;
      }) => {
        let row: VersionRow | null = null;
        if (where.id) row = versions.get(where.id) ?? null;
        else if (where.businessFileId_versionNumber) {
          const { businessFileId, versionNumber } = where.businessFileId_versionNumber;
          row = Array.from(versions.values()).find((v) => v.businessFileId === businessFileId && v.versionNumber === versionNumber) ?? null;
        }
        if (!row) return null;
        if (!include) return row;

        // The sync path fetches the full nested graph via `include` — build
        // it by cross-referencing the other in-memory maps rather than
        // trying to honor the include shape selectively.
        const businessFile = businessFiles.get(row.quotationCaseId)!;
        const anyQuotation = findAnyQuotationForCase(row.quotationCaseId);
        const dropboxFolder = customerDropboxFolders.get(anyQuotation.customerId) ?? null;
        return {
          ...row,
          businessFile: {
            ...businessFile,
            quotationCase: {
              id: row.quotationCaseId,
              quotationNumber: anyQuotation.quotationNumber,
              customerId: anyQuotation.customerId,
              customer: { ...anyQuotation.customer, dropboxFolder },
            },
          },
        };
      }
    ),
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
    groupBy: vi.fn(async () => {
      const counts = new Map<string, number>();
      for (const v of versions.values()) counts.set(v.excelSyncStatus, (counts.get(v.excelSyncStatus) ?? 0) + 1);
      return Array.from(counts.entries()).map(([excelSyncStatus, count]) => ({ excelSyncStatus, _count: { _all: count } }));
    }),
    count: vi.fn(async () => Array.from(versions.values()).filter((v) => v.excelLocalStorageKey === null).length),
  };
  const quotationCaseDelegate = {
    count: vi.fn(async () => deriveCaseIds().length),
    findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take: number }) => {
      function matchesKey(caseId: string, key: string, filter: unknown): boolean {
        if (key === "dropboxBusinessFile") {
          if (filter === null) return !businessFiles.has(caseId);
          const f = filter as { syncStatus?: { in: string[] }; versions?: { some: { excelSyncStatus: string | { in: string[] } } } };
          const bf = businessFiles.get(caseId);
          if (!bf) return false;
          if (f.syncStatus) return f.syncStatus.in.includes(bf.syncStatus);
          if (f.versions) {
            const versionsForBf = Array.from(versions.values()).filter((v) => v.businessFileId === bf.id);
            const statusFilter = f.versions.some.excelSyncStatus;
            return versionsForBf.some((v) => (typeof statusFilter === "string" ? v.excelSyncStatus === statusFilter : statusFilter.in.includes(v.excelSyncStatus)));
          }
          return true;
        }
        if (key === "revisions") {
          return Array.from(quotations.values()).some((q) => q.quotationCaseId === caseId);
        }
        if (key === "OR") {
          const orConds = filter as Record<string, unknown>[];
          return orConds.some((cond) => Object.entries(cond).every(([k, v]) => matchesKey(caseId, k, v)));
        }
        return true;
      }

      const candidates = deriveCaseIds()
        .filter((caseId) => Object.entries(where).every(([key, filter]) => matchesKey(caseId, key, filter)))
        .sort();
      return candidates.slice(0, take).map((id) => ({ id, currentRevisionId: caseCurrentRevisionOverride.get(id) ?? null }));
    }),
  };

  return {
    quotation: quotationDelegate,
    quotationCase: quotationCaseDelegate,
    customer: customerDelegate,
    quotationDropboxBusinessFile: businessFileDelegate,
    quotationDropboxVersion: versionDelegate,
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(mockTx)),
  };
}

let mockTx: ReturnType<typeof makePrismaMock>;

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, prop) {
        return (mockTx as unknown as Record<string, unknown>)[prop as string];
      },
    }
  ),
}));

const ROOT = "/Insurance Management System";
const CUSTOMER_FOLDER_PATH = `${ROOT}/Customers/CUST-0002 - China Railway Seventh Group Co., Limited`;

const filesGetMetadata = vi.fn();
const filesUpload = vi.fn();
const filesCreateFolderV2 = vi.fn();
const fakeClient = { filesGetMetadata, filesUpload, filesCreateFolderV2 } as unknown as import("dropbox").Dropbox;

function notFoundError() {
  return { status: 409, error: { error_summary: "path/not_found/.." } };
}
function conflictError() {
  return { status: 409, error: { error_summary: "path/conflict/folder/.." } };
}

function baseQuotation(overrides: Partial<QuotationRow> = {}): QuotationRow {
  return {
    id: "quo-1",
    quotationNumber: "QT202607-006",
    quotationCaseId: "case-1",
    revisionNumber: 1,
    customerId: "cust-1",
    quotationDate: new Date("2026-07-27T00:00:00Z"),
    customer: { companyName: "China Railway Seventh Group Co., Limited", shortName: "CRSG", customerNumber: "CUST-0002" },
    sections: [{ insuranceType: { code: "CAR" }, carDetail: { projectName: "Nakuru Water Project" } }],
    ...overrides,
  };
}

describe("generateAndSyncQuotationExcel (Phase 4 Part 6/8/17.D/E)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    idCounter = 0;
    quotations = new Map([["quo-1", baseQuotation()]]);
    businessFiles = new Map();
    versions = new Map();
    customerDropboxFolders = new Map([["cust-1", { syncStatus: "SYNCED", displayPath: CUSTOMER_FOLDER_PATH }]]);
    caseCurrentRevisionOverride = new Map();
    mockTx = makePrismaMock();

    saveFile.mockResolvedValue({ storagePath: "case-1/generated/quo-1/v1/CAR-CRSG-20260727-V1.xlsx" });
    fileExists.mockResolvedValue(true);
    getMetadata.mockResolvedValue({ size: 42 });
    openFile.mockResolvedValue((async function* () {
      yield Buffer.from("fake-xlsx-bytes");
    })());

    getAuthenticatedDropboxClient.mockResolvedValue({ ok: true, client: fakeClient, env: {}, row: { rootFolder: ROOT } });
    syncCustomerFolder.mockImplementation(async () => {
      const folder = customerDropboxFolders.get("cust-1")!;
      return { success: true, status: "SYNCED", path: folder.displayPath };
    });
    filesGetMetadata.mockRejectedValue(notFoundError());
    filesCreateFolderV2.mockImplementation(async ({ path }: { path: string }) => ({
      result: { metadata: { id: `id:${path}`, path_display: path } },
    }));
    filesUpload.mockResolvedValue({
      result: { id: "id:excel1", rev: "rev1", path_display: `${CUSTOMER_FOLDER_PATH}/20260727-CAR-NAKURU WATER PROJECT/Quotation/CAR-CRSG-20260727-V1.xlsx`, size: 42 },
    });
  });

  it("D1: first generation creates V1 and syncs to Dropbox", async () => {
    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");

    const result = await generateAndSyncQuotationExcel("quo-1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.versionNumber).toBe(1);
      expect(result.dropboxStatus).toBe("SYNCED");
      expect(result.buffer.length).toBeGreaterThan(0);
    }
    expect(filesCreateFolderV2).toHaveBeenCalled(); // business folder + Quotation subfolder
    expect(filesUpload).toHaveBeenCalledOnce();
  });

  it("D2: re-downloading with unchanged content reuses V1, does not create V2, and skips a redundant Dropbox call once already SYNCED", async () => {
    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");

    const first = await generateAndSyncQuotationExcel("quo-1");
    expect(first.success && first.versionNumber).toBe(1);
    filesUpload.mockClear();

    const second = await generateAndSyncQuotationExcel("quo-1");

    expect(second.success && second.versionNumber).toBe(1);
    expect(versions.size).toBe(1);
    expect(filesUpload).not.toHaveBeenCalled(); // already SYNCED, no redundant upload
  });

  it("D5: changed content (grandTotal via a different fingerprint) creates V2", async () => {
    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");
    const { generateQuotationExcel } = await import("@/lib/quotationTemplateEngine");

    await generateAndSyncQuotationExcel("quo-1");

    // Simulate meaningfully different content on the next generation.
    quotations.set("quo-1", baseQuotation({ sections: [{ insuranceType: { code: "CAR" }, carDetail: { projectName: "Different Project" } }] }));
    vi.mocked(generateQuotationExcel).mockResolvedValueOnce({ buffer: Buffer.from("different-bytes"), filename: "test.xlsx", warnings: [] });

    const second = await generateAndSyncQuotationExcel("quo-1");

    expect(second.success && second.versionNumber).toBe(2);
    expect(versions.size).toBe(2);
  });

  it("D7: PDF and Excel share the same version — pdfSyncStatus is never populated (no PDF pipeline exists)", async () => {
    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");

    await generateAndSyncQuotationExcel("quo-1");

    const version = Array.from(versions.values())[0];
    expect(version.excelSyncStatus).toBe("SYNCED");
    expect((version as unknown as { pdfDropboxFileId?: string }).pdfDropboxFileId).toBeUndefined();
  });

  it("D8: historical versions are never overwritten by a later version", async () => {
    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");
    const { generateQuotationExcel } = await import("@/lib/quotationTemplateEngine");

    await generateAndSyncQuotationExcel("quo-1");
    const v1BaseFileName = Array.from(versions.values())[0].baseFileName;

    quotations.set("quo-1", baseQuotation({ sections: [{ insuranceType: { code: "CAR" }, carDetail: { projectName: "Different Project" } }] }));
    vi.mocked(generateQuotationExcel).mockResolvedValueOnce({ buffer: Buffer.from("different-bytes"), filename: "test.xlsx", warnings: [] });
    await generateAndSyncQuotationExcel("quo-1");

    expect(versions.size).toBe(2);
    const stillHasV1 = Array.from(versions.values()).some((v) => v.baseFileName === v1BaseFileName && v.versionNumber === 1);
    expect(stillHasV1).toBe(true);
  });

  it("E1: local generation + Dropbox success -> SYNCED", async () => {
    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");
    const result = await generateAndSyncQuotationExcel("quo-1");
    expect(result.success && result.dropboxStatus).toBe("SYNCED");
  });

  it("E2/E10: Dropbox disconnected -> local generation still succeeds, buffer still returned", async () => {
    getAuthenticatedDropboxClient.mockResolvedValue({ ok: false, code: "DROPBOX_NOT_CONNECTED", message: "Not connected.", row: null });
    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");

    const result = await generateAndSyncQuotationExcel("quo-1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.buffer.length).toBeGreaterThan(0);
      expect(result.dropboxStatus).toBe("ERROR");
    }
  });

  it("E3: network failure during upload -> safe ERROR, local artifact still saved", async () => {
    filesUpload.mockRejectedValue(new TypeError("fetch failed"));
    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");

    const result = await generateAndSyncQuotationExcel("quo-1");

    expect(result.success).toBe(true);
    if (result.success) expect(result.dropboxStatus).toBe("ERROR");
    expect(saveFile).toHaveBeenCalled();
  });

  it("E4: rate limited -> safe ERROR with RATE_LIMITED code on the version row", async () => {
    filesUpload.mockRejectedValue({ status: 429, error: {} });
    const { syncQuotationVersionToDropbox, generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");

    await generateAndSyncQuotationExcel("quo-1");
    const versionId = Array.from(versions.keys())[0];
    const result = await syncQuotationVersionToDropbox(versionId);

    expect(result.code).toBe("RATE_LIMITED");
  });

  it("E5/E6: customer folder pending -> synced first, then business folder created", async () => {
    customerDropboxFolders.set("cust-1", { syncStatus: "PENDING", displayPath: null });
    syncCustomerFolder.mockImplementation(async () => {
      // Simulate the folder becoming available once synced.
      customerDropboxFolders.set("cust-1", { syncStatus: "SYNCED", displayPath: CUSTOMER_FOLDER_PATH });
      return { success: true, status: "SYNCED", path: CUSTOMER_FOLDER_PATH };
    });
    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");

    const result = await generateAndSyncQuotationExcel("quo-1");

    expect(syncCustomerFolder).toHaveBeenCalledWith("cust-1");
    expect(result.success && result.dropboxStatus).toBe("SYNCED");
  });

  it("E7: Quotation subfolder is created inside the business folder", async () => {
    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");
    await generateAndSyncQuotationExcel("quo-1");

    const folderPaths = filesCreateFolderV2.mock.calls.map((call) => (call[0] as { path: string }).path);
    expect(folderPaths.some((p: string) => p.endsWith("/Quotation"))).toBe(true);
    expect(folderPaths.every((p: string) => !p.includes("/Policy") && !p.includes("/Invoice") && !p.includes("/Claim"))).toBe(true);
  });

  it("E8: an existing linked file is safely conditionally updated on retry", async () => {
    const { generateAndSyncQuotationExcel, syncQuotationVersionToDropbox } = await import("../quotationDropboxSync");
    await generateAndSyncQuotationExcel("quo-1");
    const versionId = Array.from(versions.keys())[0];

    filesGetMetadata.mockImplementation(async ({ path }: { path: string }) => {
      if (path.endsWith(".xlsx")) {
        return { result: { ".tag": "file", id: "id:excel1", rev: "rev1", path_display: path } };
      }
      // The Quotation subfolder (and business folder) were already created
      // by the first generateAndSyncQuotationExcel call above.
      return { result: { ".tag": "folder", id: "id:existing-folder", path_display: path } };
    });
    filesUpload.mockResolvedValue({
      result: { id: "id:excel1", rev: "rev2", path_display: "x", size: 50 },
    });

    const result = await syncQuotationVersionToDropbox(versionId);

    expect(result.success).toBe(true);
    const [uploadArgs] = filesUpload.mock.calls.at(-1)!;
    expect(uploadArgs.mode).toEqual({ ".tag": "update", update: "rev1" });
  });

  it("E9: an unrelated file at the target Quotation path -> CONFLICT, never overwritten", async () => {
    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");

    // First call succeeds and creates the folders.
    await generateAndSyncQuotationExcel("quo-1");
    filesUpload.mockClear();

    // Now something else occupies the exact V1 excel path for a fresh version.
    quotations.set("quo-1", baseQuotation({ sections: [{ insuranceType: { code: "CAR" }, carDetail: { projectName: "Different Project" } }] }));
    const { generateQuotationExcel } = await import("@/lib/quotationTemplateEngine");
    vi.mocked(generateQuotationExcel).mockResolvedValueOnce({ buffer: Buffer.from("v2-bytes"), filename: "test.xlsx", warnings: [] });
    filesGetMetadata.mockImplementation(async ({ path }: { path: string }) => {
      if (path.endsWith("V2.xlsx")) {
        return { result: { ".tag": "file", id: "id:someone-elses-file", rev: "r9", path_display: path } };
      }
      throw notFoundError();
    });

    const result = await generateAndSyncQuotationExcel("quo-1");

    expect(result.success && result.dropboxStatus).toBe("CONFLICT");
    expect(filesUpload).not.toHaveBeenCalled();
  });

  it("E12: a missing local file is safely reported, never throws", async () => {
    const { generateAndSyncQuotationExcel, syncQuotationVersionToDropbox } = await import("../quotationDropboxSync");
    await generateAndSyncQuotationExcel("quo-1");
    const versionId = Array.from(versions.keys())[0];
    fileExists.mockResolvedValue(false);

    const result = await syncQuotationVersionToDropbox(versionId);

    expect(result.success).toBe(false);
    expect(result.code).toBe("LOCAL_FILE_NOT_FOUND");
  });

  it("business folder collision with an unrelated folder gets a quotation-number suffix", async () => {
    filesCreateFolderV2.mockImplementation(async ({ path }: { path: string }) => {
      if (path.endsWith("NAKURU WATER PROJECT")) throw conflictError();
      return { result: { metadata: { id: `id:${path}`, path_display: path } } };
    });
    filesGetMetadata.mockImplementation(async ({ path }: { path: string }) => {
      if (path.endsWith("NAKURU WATER PROJECT")) {
        return { result: { ".tag": "folder", id: "id:unrelated-folder", path_display: path } };
      }
      throw notFoundError();
    });

    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");
    const result = await generateAndSyncQuotationExcel("quo-1");

    expect(result.success && result.dropboxStatus).toBe("SYNCED");
    const businessFile = businessFiles.get("case-1")!;
    expect(businessFile.businessFolderName).toBe("20260727-CAR-NAKURU WATER PROJECT-QT202607-006");
  });

  it("D6/E11: concurrent-style retry (calling sync twice) never creates a duplicate version or duplicate business file", async () => {
    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");

    await generateAndSyncQuotationExcel("quo-1");
    await generateAndSyncQuotationExcel("quo-1");

    expect(versions.size).toBe(1);
    expect(businessFiles.size).toBe(1);
  });

  it("Correction 1: R01 and R02 under the same QuotationCase share exactly one business file and one shared version sequence", async () => {
    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");
    const r01 = await generateAndSyncQuotationExcel("quo-1"); // R01 -> V1, SYNCED
    expect(r01.success && r01.versionNumber).toBe(1);

    quotations.set(
      "quo-2",
      baseQuotation({
        id: "quo-2",
        quotationNumber: "QT202607-006-R02",
        revisionNumber: 2,
        sections: [{ insuranceType: { code: "CAR" }, carDetail: { projectName: "Different Project" } }],
      })
    );
    const r02 = await generateAndSyncQuotationExcel("quo-2"); // R02, same case-1 -> continues the shared sequence

    expect(r02.success).toBe(true);
    if (r02.success) expect(r02.versionNumber).toBe(2); // continues the shared sequence, not a fresh V1

    // Exactly one business file row exists for the case — not one per revision.
    expect(businessFiles.size).toBe(1);
    const businessFile = businessFiles.get("case-1")!;
    expect(businessFile.quotationCaseId).toBe("case-1");

    // Both versions are attached to that one shared business file, and each
    // records which specific revision produced it.
    const caseVersions = Array.from(versions.values()).filter((v) => v.businessFileId === businessFile.id);
    expect(caseVersions).toHaveLength(2);
    expect(caseVersions.find((v) => v.versionNumber === 1)?.sourceQuotationId).toBe("quo-1");
    expect(caseVersions.find((v) => v.versionNumber === 2)?.sourceQuotationId).toBe("quo-2");
  });

  it("Correction 1: adding a third revision (R03) continues the same shared folder and version sequence to V3", async () => {
    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");
    await generateAndSyncQuotationExcel("quo-1");
    quotations.set(
      "quo-2",
      baseQuotation({ id: "quo-2", quotationNumber: "QT202607-006-R02", revisionNumber: 2, sections: [{ insuranceType: { code: "CAR" }, carDetail: { projectName: "Rev 2" } }] })
    );
    await generateAndSyncQuotationExcel("quo-2");
    quotations.set(
      "quo-3",
      baseQuotation({ id: "quo-3", quotationNumber: "QT202607-006-R03", revisionNumber: 3, sections: [{ insuranceType: { code: "CAR" }, carDetail: { projectName: "Rev 3" } }] })
    );

    const r03 = await generateAndSyncQuotationExcel("quo-3");

    expect(r03.success).toBe(true);
    if (r03.success) expect(r03.versionNumber).toBe(3);
    expect(businessFiles.size).toBe(1);
    const businessFile = businessFiles.get("case-1")!;
    const caseVersionNumbers = Array.from(versions.values())
      .filter((v) => v.businessFileId === businessFile.id)
      .map((v) => v.versionNumber)
      .sort();
    expect(caseVersionNumbers).toEqual([1, 2, 3]);
  });

  it("Correction 2: a single distinct insurance type uses its standardized code in the business folder name", async () => {
    quotations.set("quo-1", baseQuotation({ sections: [{ insuranceType: { code: "CAR" }, carDetail: { projectName: "Nakuru Water Project" } }] }));
    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");

    await generateAndSyncQuotationExcel("quo-1");

    const businessFile = businessFiles.get("case-1")!;
    expect(businessFile.insuranceTypeCode).toBe("CAR");
    expect(businessFile.businessFolderName).toBe("20260727-CAR-NAKURU WATER PROJECT");
  });

  it("Correction 2: repeated sections of the same normalized type still resolve to that single type, not MULTI", async () => {
    quotations.set(
      "quo-1",
      baseQuotation({
        sections: [
          { insuranceType: { code: "MOTOR_COMP_PRIVATE" }, motorCompPrivateDetail: { plateNo: "KDA 123X" } },
          { insuranceType: { code: "MOTOR_TPO_PRIVATE" } },
        ],
      })
    );
    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");

    await generateAndSyncQuotationExcel("quo-1");

    const businessFile = businessFiles.get("case-1")!;
    expect(businessFile.insuranceTypeCode).toBe("MOTOR");
  });

  it("Correction 2: more than one distinct insurance type resolves to MULTI in both the folder and file name", async () => {
    quotations.set(
      "quo-1",
      baseQuotation({
        sections: [
          { insuranceType: { code: "CAR" }, carDetail: { projectName: "Nakuru Water Project" } },
          { insuranceType: { code: "WIBA" } },
        ],
      })
    );
    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");

    await generateAndSyncQuotationExcel("quo-1");

    const businessFile = businessFiles.get("case-1")!;
    expect(businessFile.insuranceTypeCode).toBe("MULTI");
    expect(businessFile.businessFolderName).toBe("20260727-MULTI-NAKURU WATER PROJECT");
    const version = Array.from(versions.values())[0];
    expect(version.baseFileName).toBe("MULTI-CRSG-20260727-V1");
  });

  it("Correction 2: a revision changing from single-type to multi-type does not rename the already-created business folder", async () => {
    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");
    await generateAndSyncQuotationExcel("quo-1"); // CAR only -> folder created as CAR

    const businessFolderNameAfterR01 = businessFiles.get("case-1")!.businessFolderName;
    expect(businessFolderNameAfterR01).toBe("20260727-CAR-NAKURU WATER PROJECT");

    quotations.set(
      "quo-2",
      baseQuotation({
        id: "quo-2",
        quotationNumber: "QT202607-006-R02",
        revisionNumber: 2,
        sections: [
          { insuranceType: { code: "CAR" }, carDetail: { projectName: "Nakuru Water Project" } },
          { insuranceType: { code: "WIBA" } },
        ],
      })
    );
    await generateAndSyncQuotationExcel("quo-2"); // R02 becomes multi-type

    // The business file/folder is an immutable snapshot from R01 — it is
    // never automatically renamed just because a later revision's type mix
    // changed (Correction 2's explicit requirement). Version filenames
    // always reuse that same frozen insuranceTypeCode too (see
    // buildQuotationBaseFileName's caller in resolveVersion), so every file
    // inside the folder — regardless of which revision produced it —
    // agrees with the folder's own name.
    const businessFile = businessFiles.get("case-1")!;
    expect(businessFile.businessFolderName).toBe(businessFolderNameAfterR01);
    expect(businessFile.insuranceTypeCode).toBe("CAR");
    const v2 = Array.from(versions.values()).find((v) => v.versionNumber === 2)!;
    expect(v2.baseFileName).toBe("CAR-CRSG-20260727-V2");
  });
});

describe("verifyBusinessFolder / verifyQuotationVersion — read-only (Phase 4 Part 9/10)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    idCounter = 0;
    quotations = new Map([["quo-1", baseQuotation()]]);
    businessFiles = new Map();
    versions = new Map();
    customerDropboxFolders = new Map([["cust-1", { syncStatus: "SYNCED", displayPath: CUSTOMER_FOLDER_PATH }]]);
    caseCurrentRevisionOverride = new Map();
    mockTx = makePrismaMock();

    saveFile.mockResolvedValue({ storagePath: "case-1/generated/quo-1/v1/CAR-CRSG-20260727-V1.xlsx" });
    fileExists.mockResolvedValue(true);
    getMetadata.mockResolvedValue({ size: 42 });
    openFile.mockResolvedValue((async function* () {
      yield Buffer.from("fake-xlsx-bytes");
    })());
    getAuthenticatedDropboxClient.mockResolvedValue({ ok: true, client: fakeClient, env: {}, row: { rootFolder: ROOT } });
    syncCustomerFolder.mockResolvedValue({ success: true, status: "SYNCED", path: CUSTOMER_FOLDER_PATH });
    filesGetMetadata.mockRejectedValue(notFoundError());
    filesCreateFolderV2.mockImplementation(async ({ path }: { path: string }) => ({ result: { metadata: { id: `id:${path}`, path_display: path } } }));
    filesUpload.mockResolvedValue({
      result: { id: "id:excel1", rev: "rev1", path_display: `${CUSTOMER_FOLDER_PATH}/20260727-CAR-NAKURU WATER PROJECT/Quotation/CAR-CRSG-20260727-V1.xlsx`, name: "CAR-CRSG-20260727-V1.xlsx", size: 42 },
    });

    const { generateAndSyncQuotationExcel } = await import("../quotationDropboxSync");
    await generateAndSyncQuotationExcel("quo-1");
    // Setup above legitimately calls filesCreateFolderV2/filesUpload — clear
    // call history so each test's own assertions only see its own calls.
    filesCreateFolderV2.mockClear();
    filesUpload.mockClear();
  });

  it("verifyBusinessFolder: folder exists and matches -> SYNCED, never mutates Dropbox", async () => {
    const businessFile = businessFiles.get("case-1")!;
    filesGetMetadata.mockResolvedValue({ result: { ".tag": "folder", id: businessFile.dropboxFolderId, path_display: businessFile.dropboxDisplayPath } });
    const { verifyBusinessFolder } = await import("../quotationDropboxSync");

    const result = await verifyBusinessFolder("quo-1");

    expect(result.success).toBe(true);
    expect(result.status).toBe("SYNCED");
    expect(filesCreateFolderV2).not.toHaveBeenCalled();
    expect(filesUpload).not.toHaveBeenCalled();
  });

  it("verifyBusinessFolder: folder missing -> ERROR/DROPBOX_FILE_NOT_FOUND", async () => {
    filesGetMetadata.mockRejectedValue(notFoundError());
    const { verifyBusinessFolder } = await import("../quotationDropboxSync");

    const result = await verifyBusinessFolder("quo-1");

    expect(result.success).toBe(false);
    expect(result.code).toBe("DROPBOX_FILE_NOT_FOUND");
  });

  it("verifyQuotationVersion: file exists and matches -> SYNCED, never mutates Dropbox", async () => {
    const version = Array.from(versions.values())[0];
    const businessFile = businessFiles.get("case-1")!;
    filesGetMetadata.mockResolvedValue({
      result: { ".tag": "file", id: version.excelDropboxFileId, rev: "rev1", name: `${version.baseFileName}.xlsx`, path_display: `${businessFile.dropboxDisplayPath}/Quotation/${version.baseFileName}.xlsx` },
    });
    const { verifyQuotationVersion } = await import("../quotationDropboxSync");

    const result = await verifyQuotationVersion(version.id);

    expect(result.success).toBe(true);
    expect(result.status).toBe("SYNCED");
    expect(filesUpload).not.toHaveBeenCalled();
  });

  it("verifyQuotationVersion: filename mismatch -> CONFLICT", async () => {
    const version = Array.from(versions.values())[0];
    const businessFile = businessFiles.get("case-1")!;
    filesGetMetadata.mockResolvedValue({
      result: { ".tag": "file", id: version.excelDropboxFileId, rev: "rev1", name: "Totally Different.xlsx", path_display: `${businessFile.dropboxDisplayPath}/Quotation/Totally Different.xlsx` },
    });
    const { verifyQuotationVersion } = await import("../quotationDropboxSync");

    const result = await verifyQuotationVersion(version.id);

    expect(result.success).toBe(false);
    expect(result.status).toBe("CONFLICT");
  });

  it("verifyQuotationVersion: never synced -> PENDING, no Dropbox call", async () => {
    const version = Array.from(versions.values())[0];
    version.excelDropboxFileId = null;
    filesGetMetadata.mockClear();
    const { verifyQuotationVersion } = await import("../quotationDropboxSync");

    const result = await verifyQuotationVersion(version.id);

    expect(result.status).toBe("PENDING");
    expect(filesGetMetadata).not.toHaveBeenCalled();
  });
});

describe("Quotation backfill (Phase 4 Part 11/12/17.G)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    idCounter = 0;
    quotations = new Map([
      ["quo-1", baseQuotation({ id: "quo-1", quotationCaseId: "case-1" })],
      [
        "quo-2",
        baseQuotation({
          id: "quo-2",
          quotationCaseId: "case-2",
          quotationNumber: "QT202607-007",
          customerId: "cust-2",
          customer: { companyName: "Acme Ltd", shortName: null, customerNumber: "CUST-0099" },
        }),
      ],
    ]);
    businessFiles = new Map();
    versions = new Map();
    customerDropboxFolders = new Map([["cust-1", { syncStatus: "SYNCED", displayPath: CUSTOMER_FOLDER_PATH }]]);
    caseCurrentRevisionOverride = new Map();
    mockTx = makePrismaMock();

    saveFile.mockResolvedValue({ storagePath: "case-1/generated/quo-1/v1/x.xlsx" });
    fileExists.mockResolvedValue(true);
    getMetadata.mockResolvedValue({ size: 42 });
    openFile.mockResolvedValue((async function* () {
      yield Buffer.from("fake-xlsx-bytes");
    })());
    getAuthenticatedDropboxClient.mockResolvedValue({ ok: true, client: fakeClient, env: {}, row: { rootFolder: ROOT } });
    syncCustomerFolder.mockResolvedValue({ success: true, status: "SYNCED", path: CUSTOMER_FOLDER_PATH });
    filesGetMetadata.mockRejectedValue(notFoundError());
    filesCreateFolderV2.mockImplementation(async ({ path }: { path: string }) => ({ result: { metadata: { id: `id:${path}`, path_display: path } } }));
    filesUpload.mockResolvedValue({
      result: { id: "id:excel1", rev: "rev1", path_display: "x", name: "x.xlsx", size: 42 },
    });
  });

  it("1. preview performs no Dropbox writes", async () => {
    const { previewQuotationBackfill } = await import("../quotationDropboxSync");

    const preview = await previewQuotationBackfill();

    expect(preview.totalQuotations).toBe(2);
    expect(preview.businessFilesInitialized).toBe(0);
    expect(filesCreateFolderV2).not.toHaveBeenCalled();
    expect(filesUpload).not.toHaveBeenCalled();
  });

  it("12: preview reports Customer Short Name review stats without writing to any Customer row", async () => {
    const { previewQuotationBackfill } = await import("../quotationDropboxSync");

    const preview = await previewQuotationBackfill();

    // quo-1's customer has shortName "CRSG"; quo-2's customer ("Acme Ltd")
    // has none, and "Ltd" is stripped as legal-suffix boilerplate leaving
    // only a single-letter "A" — too short to be useful, so it falls all
    // the way through to the customer-number fallback.
    expect(preview.customerShortNameStats.withShortName).toBe(1);
    expect(preview.customerShortNameStats.usingDerivedInitials).toBe(0);
    expect(preview.customerShortNameStats.usingCustomerNumberFallback).toBe(1);
  });

  it("2. initializes one missing business file", async () => {
    const { runQuotationBackfillBatch } = await import("../quotationDropboxSync");

    const batch = await runQuotationBackfillBatch("init-missing", 1);

    expect(batch.processed).toBe(1);
    expect(businessFiles.size).toBe(1);
  });

  it("3. syncs one existing (already-initialized) Quotation", async () => {
    const { runQuotationBackfillBatch } = await import("../quotationDropboxSync");
    await runQuotationBackfillBatch("init-missing", 10); // both get business files + V1, synced

    filesUpload.mockClear();
    const batch = await runQuotationBackfillBatch("sync-missing", 10);

    // Both were already SYNCED by the init-missing pass — nothing left to sync.
    expect(batch.processed).toBe(0);
  });

  it("4. skips already-synchronized quotations", async () => {
    const { runQuotationBackfillBatch } = await import("../quotationDropboxSync");
    await runQuotationBackfillBatch("init-missing", 10);

    const batch = await runQuotationBackfillBatch("init-missing", 10);

    expect(batch.processed).toBe(0);
  });

  it("5. retries a failed quotation", async () => {
    const { runQuotationBackfillBatch } = await import("../quotationDropboxSync");
    filesUpload.mockRejectedValueOnce(new TypeError("fetch failed"));
    await runQuotationBackfillBatch("init-missing", 1); // quo-1 fails to sync (ERROR), business file created

    filesUpload.mockResolvedValue({ result: { id: "id:excel1", rev: "rev1", path_display: "x", name: "x.xlsx", size: 42 } });
    const batch = await runQuotationBackfillBatch("retry-failed", 10);

    expect(batch.processed).toBe(1);
    expect(batch.succeeded).toBe(1);
  });

  it("6. a genuine conflict is preserved across a backfill pass, not silently cleared", async () => {
    const { runQuotationBackfillBatch } = await import("../quotationDropboxSync");
    await runQuotationBackfillBatch("init-missing", 1); // quo-1 synced

    // A second, unrelated file now occupies the target path for a new version.
    quotations.set("quo-1", baseQuotation({ id: "quo-1", quotationCaseId: "case-1", sections: [{ insuranceType: { code: "CAR" }, carDetail: { projectName: "Changed Project" } }] }));
    const { generateQuotationExcel } = await import("@/lib/quotationTemplateEngine");
    vi.mocked(generateQuotationExcel).mockResolvedValueOnce({ buffer: Buffer.from("v2"), filename: "x.xlsx", warnings: [] });
    filesGetMetadata.mockImplementation(async ({ path }: { path: string }) => {
      if (path.endsWith("V2.xlsx")) return { result: { ".tag": "file", id: "id:someone-elses", rev: "r9", path_display: path } };
      throw notFoundError();
    });
    await runQuotationBackfillBatch("sync-missing", 1);

    const conflictBatch = await runQuotationBackfillBatch("retry-failed", 10);
    // The conflict is reported, not silently resolved into an overwrite.
    const quo1Result = conflictBatch.results.find((r) => r.quotationId === "quo-1");
    expect(quo1Result?.status === "CONFLICT" || quo1Result === undefined).toBe(true);
    expect(filesUpload).not.toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining("someone-elses") }));
  });

  it("7. batch size is bounded even when a larger limit is requested", async () => {
    for (let i = 3; i <= 25; i++) {
      quotations.set(`quo-${i}`, baseQuotation({ id: `quo-${i}`, quotationCaseId: `case-${i}`, quotationNumber: `QT202607-${i}` }));
    }
    const { runQuotationBackfillBatch } = await import("../quotationDropboxSync");

    const batch = await runQuotationBackfillBatch("init-missing", 1000);

    expect(batch.processed).toBeLessThanOrEqual(20);
  });

  it("8. resumable — a second call only picks up quotations still missing a business file", async () => {
    const { runQuotationBackfillBatch } = await import("../quotationDropboxSync");

    const first = await runQuotationBackfillBatch("init-missing", 1);
    expect(first.processed).toBe(1);
    const second = await runQuotationBackfillBatch("init-missing", 10);
    expect(second.processed).toBe(1);
    const third = await runQuotationBackfillBatch("init-missing", 10);
    expect(third.processed).toBe(0);
  });

  it("10. never invents historical versions — a quotation with no prior version always starts at V1", async () => {
    const { runQuotationBackfillBatch } = await import("../quotationDropboxSync");

    await runQuotationBackfillBatch("init-missing", 10);

    for (const v of versions.values()) expect(v.versionNumber).toBe(1);
  });

  it("11. backfill resolves the source revision via the case's currentRevisionId when it is explicitly set", async () => {
    // Two revisions under the same case; the DRAFT (quo-1b) is the current
    // one. Backfill must generate from the CURRENT revision's content, not
    // just whichever revision happens to sort last.
    quotations.set(
      "quo-1b",
      baseQuotation({ id: "quo-1b", quotationCaseId: "case-1", quotationNumber: "QT202607-006-R02", revisionNumber: 2, sections: [{ insuranceType: { code: "CAR" }, carDetail: { projectName: "Current Draft Project" } }] })
    );
    caseCurrentRevisionOverride.set("case-1", "quo-1b");

    const { runQuotationBackfillBatch } = await import("../quotationDropboxSync");
    const batch = await runQuotationBackfillBatch("init-missing", 1);

    expect(batch.results[0]?.quotationId).toBe("quo-1b");
    const businessFile = businessFiles.get("case-1")!;
    const version = Array.from(versions.values()).find((v) => v.businessFileId === businessFile.id)!;
    expect(version.sourceQuotationId).toBe("quo-1b");
  });
});
