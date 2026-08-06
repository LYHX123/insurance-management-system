import { describe, it, expect, vi, beforeEach } from "vitest";

// Production Readiness Audit V1, finding H2 — Non-Motor Claim counterpart to
// motor-claim/__tests__/documentActions.permission.test.ts. See that file's
// header comment for the full rationale.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const checkNonMotorClaimAccess = vi.fn();
vi.mock("@/lib/claims/access", () => ({
  checkNonMotorClaimAccess: (...args: unknown[]) => checkNonMotorClaimAccess(...args),
}));

const saveFile = vi.fn();
const deleteFile = vi.fn();
vi.mock("@/lib/claimDocuments/storage", () => ({
  nonMotorClaimDocumentStorage: {
    saveFile: (...args: unknown[]) => saveFile(...args),
    deleteFile: (...args: unknown[]) => deleteFile(...args),
  },
}));

const syncNonMotorClaimDocumentWithTimeout = vi.fn();
vi.mock("@/lib/integrations/dropbox/nonMotorClaimDocumentSync", () => ({
  syncNonMotorClaimDocumentWithTimeout: (...args: unknown[]) => syncNonMotorClaimDocumentWithTimeout(...args),
}));

const documentCreateMock = vi.fn();
const documentFindUniqueMock = vi.fn();
const documentDeleteMock = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    nonMotorClaimDocument: {
      create: (...args: unknown[]) => documentCreateMock(...args),
      findUnique: (...args: unknown[]) => documentFindUniqueMock(...args),
      delete: (...args: unknown[]) => documentDeleteMock(...args),
    },
  },
}));

function okAccess(overrides: Partial<{ canEdit: boolean; status: string }> = {}) {
  return {
    kind: "ok" as const,
    userId: "user-1",
    claimId: "claim-1",
    createdById: "creator-1",
    status: overrides.status ?? "OPEN",
    isCreator: false,
    canEdit: overrides.canEdit ?? true,
  };
}

function buildFormData() {
  const formData = new FormData();
  formData.set("nonMotorClaimId", "claim-1");
  formData.set("documentType", "SUPPORTING_DOCUMENT");
  formData.set("notes", "");
  formData.set("file", new File(["%PDF-1.4"], "evidence.pdf", { type: "application/pdf" }));
  return formData;
}

describe("Non-Motor Claim documentActions — H2 canEdit enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveFile.mockResolvedValue({ storagePath: "claim-1/doc/evidence.pdf" });
    deleteFile.mockResolvedValue(undefined);
    syncNonMotorClaimDocumentWithTimeout.mockResolvedValue(undefined);
    documentCreateMock.mockResolvedValue({ id: "doc-1" });
    documentFindUniqueMock.mockResolvedValue({ nonMotorClaimId: "claim-1", storagePath: "claim-1/doc/evidence.pdf" });
    documentDeleteMock.mockResolvedValue({});
  });

  it("VIEW-only participant (canEdit=false) cannot upload a claim document", async () => {
    checkNonMotorClaimAccess.mockResolvedValue(okAccess({ canEdit: false }));
    const { uploadNonMotorClaimDocumentAction } = await import("../documentActions");

    const result = await uploadNonMotorClaimDocumentAction(buildFormData());

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(saveFile).not.toHaveBeenCalled();
    expect(documentCreateMock).not.toHaveBeenCalled();
  });

  it("VIEW-only participant (canEdit=false) cannot delete a claim document", async () => {
    checkNonMotorClaimAccess.mockResolvedValue(okAccess({ canEdit: false }));
    const { deleteNonMotorClaimDocumentAction } = await import("../documentActions");

    const result = await deleteNonMotorClaimDocumentAction("doc-1");

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(documentDeleteMock).not.toHaveBeenCalled();
  });

  it("EDIT participant (canEdit=true) can upload a claim document", async () => {
    checkNonMotorClaimAccess.mockResolvedValue(okAccess({ canEdit: true }));
    const { uploadNonMotorClaimDocumentAction } = await import("../documentActions");

    const result = await uploadNonMotorClaimDocumentAction(buildFormData());

    expect(result).toEqual({ success: true, id: "doc-1" });
    expect(saveFile).toHaveBeenCalled();
  });

  it("EDIT participant (canEdit=true) can delete a claim document", async () => {
    checkNonMotorClaimAccess.mockResolvedValue(okAccess({ canEdit: true }));
    const { deleteNonMotorClaimDocumentAction } = await import("../documentActions");

    const result = await deleteNonMotorClaimDocumentAction("doc-1");

    expect(result).toEqual({ success: true });
    expect(documentDeleteMock).toHaveBeenCalled();
  });

  it("a non-participant / no module access cannot upload (FORBIDDEN, never reaches canEdit check)", async () => {
    checkNonMotorClaimAccess.mockResolvedValue({ kind: "no-module-access" });
    const { uploadNonMotorClaimDocumentAction } = await import("../documentActions");

    const result = await uploadNonMotorClaimDocumentAction(buildFormData());

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("an unauthenticated/not-found claim cannot upload (CLAIM_NOT_FOUND)", async () => {
    checkNonMotorClaimAccess.mockResolvedValue({ kind: "not-found" });
    const { uploadNonMotorClaimDocumentAction } = await import("../documentActions");

    const result = await uploadNonMotorClaimDocumentAction(buildFormData());

    expect(result).toEqual({ success: false, error: "CLAIM_NOT_FOUND" });
  });

  it("EDIT participant still cannot upload to a CLOSED claim (existing OPEN-only rule preserved)", async () => {
    checkNonMotorClaimAccess.mockResolvedValue(okAccess({ canEdit: true, status: "CLOSED" }));
    const { uploadNonMotorClaimDocumentAction } = await import("../documentActions");

    const result = await uploadNonMotorClaimDocumentAction(buildFormData());

    expect(result).toEqual({ success: false, error: "CLAIM_NOT_OPEN" });
  });
});
