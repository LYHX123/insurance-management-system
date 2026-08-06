import { describe, it, expect, vi, beforeEach } from "vitest";

// Production Readiness Audit V1, finding H2: uploadMotorClaimDocumentAction /
// deleteMotorClaimDocumentAction only checked access.kind === "ok" (module
// VIEW-or-above + claim participation), never access.canEdit — so a VIEW-only
// participant could upload/delete Claim documents by calling the Server
// Action directly, bypassing the frontend's canEdit-gated buttons
// (claim-documents-section.tsx). These prove the fix at the action layer.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const checkMotorClaimAccess = vi.fn();
vi.mock("@/lib/claims/access", () => ({
  checkMotorClaimAccess: (...args: unknown[]) => checkMotorClaimAccess(...args),
}));

const saveFile = vi.fn();
const deleteFile = vi.fn();
vi.mock("@/lib/claimDocuments/storage", () => ({
  motorClaimDocumentStorage: {
    saveFile: (...args: unknown[]) => saveFile(...args),
    deleteFile: (...args: unknown[]) => deleteFile(...args),
  },
}));

const syncMotorClaimDocumentWithTimeout = vi.fn();
vi.mock("@/lib/integrations/dropbox/motorClaimDocumentSync", () => ({
  syncMotorClaimDocumentWithTimeout: (...args: unknown[]) => syncMotorClaimDocumentWithTimeout(...args),
}));

const documentCreateMock = vi.fn();
const documentFindUniqueMock = vi.fn();
const documentDeleteMock = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    motorClaimDocument: {
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
  formData.set("motorClaimId", "claim-1");
  formData.set("documentType", "POLICE_ABSTRACT");
  formData.set("notes", "");
  formData.set("file", new File(["%PDF-1.4"], "evidence.pdf", { type: "application/pdf" }));
  return formData;
}

describe("Motor Claim documentActions — H2 canEdit enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveFile.mockResolvedValue({ storagePath: "claim-1/doc/evidence.pdf" });
    deleteFile.mockResolvedValue(undefined);
    syncMotorClaimDocumentWithTimeout.mockResolvedValue(undefined);
    documentCreateMock.mockResolvedValue({ id: "doc-1" });
    documentFindUniqueMock.mockResolvedValue({ motorClaimId: "claim-1", storagePath: "claim-1/doc/evidence.pdf" });
    documentDeleteMock.mockResolvedValue({});
  });

  it("VIEW-only participant (canEdit=false) cannot upload a claim document", async () => {
    checkMotorClaimAccess.mockResolvedValue(okAccess({ canEdit: false }));
    const { uploadMotorClaimDocumentAction } = await import("../documentActions");

    const result = await uploadMotorClaimDocumentAction(buildFormData());

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(saveFile).not.toHaveBeenCalled();
    expect(documentCreateMock).not.toHaveBeenCalled();
  });

  it("VIEW-only participant (canEdit=false) cannot delete a claim document", async () => {
    checkMotorClaimAccess.mockResolvedValue(okAccess({ canEdit: false }));
    const { deleteMotorClaimDocumentAction } = await import("../documentActions");

    const result = await deleteMotorClaimDocumentAction("doc-1");

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(documentDeleteMock).not.toHaveBeenCalled();
  });

  it("EDIT participant (canEdit=true) can upload a claim document", async () => {
    checkMotorClaimAccess.mockResolvedValue(okAccess({ canEdit: true }));
    const { uploadMotorClaimDocumentAction } = await import("../documentActions");

    const result = await uploadMotorClaimDocumentAction(buildFormData());

    expect(result).toEqual({ success: true, id: "doc-1" });
    expect(saveFile).toHaveBeenCalled();
  });

  it("EDIT participant (canEdit=true) can delete a claim document", async () => {
    checkMotorClaimAccess.mockResolvedValue(okAccess({ canEdit: true }));
    const { deleteMotorClaimDocumentAction } = await import("../documentActions");

    const result = await deleteMotorClaimDocumentAction("doc-1");

    expect(result).toEqual({ success: true });
    expect(documentDeleteMock).toHaveBeenCalled();
  });

  it("a non-participant / no module access cannot upload (FORBIDDEN, never reaches canEdit check)", async () => {
    checkMotorClaimAccess.mockResolvedValue({ kind: "no-module-access" });
    const { uploadMotorClaimDocumentAction } = await import("../documentActions");

    const result = await uploadMotorClaimDocumentAction(buildFormData());

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("an unauthenticated/not-found claim cannot upload (CLAIM_NOT_FOUND)", async () => {
    checkMotorClaimAccess.mockResolvedValue({ kind: "not-found" });
    const { uploadMotorClaimDocumentAction } = await import("../documentActions");

    const result = await uploadMotorClaimDocumentAction(buildFormData());

    expect(result).toEqual({ success: false, error: "CLAIM_NOT_FOUND" });
  });

  it("EDIT participant still cannot upload to a CLOSED claim (existing OPEN-only rule preserved)", async () => {
    checkMotorClaimAccess.mockResolvedValue(okAccess({ canEdit: true, status: "CLOSED" }));
    const { uploadMotorClaimDocumentAction } = await import("../documentActions");

    const result = await uploadMotorClaimDocumentAction(buildFormData());

    expect(result).toEqual({ success: false, error: "CLAIM_NOT_OPEN" });
  });
});
