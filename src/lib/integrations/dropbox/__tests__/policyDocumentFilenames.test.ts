import { describe, it, expect } from "vitest";
import { PolicyDocumentType } from "@/generated/prisma/enums";
import { buildStandardizedPolicyDocumentFilename, isPlausibleStandardizedPolicyFilename } from "../policyDocumentFilenames";

const noExisting = new Set<string>();

describe("buildStandardizedPolicyDocumentFilename — managed document types (Phase 5 Part 5)", () => {
  it("Policy Schedule PDF", () => {
    const name = buildStandardizedPolicyDocumentFilename({
      documentType: PolicyDocumentType.POLICY_SCHEDULE,
      originalFileName: "whatever-scan-013.pdf",
      existingStandardizedNamesLower: noExisting,
    });
    expect(name).toBe("Policy Schedule.pdf");
  });

  it("Certificate PDF", () => {
    const name = buildStandardizedPolicyDocumentFilename({
      documentType: PolicyDocumentType.CERTIFICATE,
      originalFileName: "cert.pdf",
      existingStandardizedNamesLower: noExisting,
    });
    expect(name).toBe("Certificate.pdf");
  });

  it("Sticker image preserves its own extension", () => {
    const name = buildStandardizedPolicyDocumentFilename({
      documentType: PolicyDocumentType.STICKER,
      originalFileName: "sticker.jpg",
      existingStandardizedNamesLower: noExisting,
    });
    expect(name).toBe("Sticker.jpg");
  });

  it("Debit Note, Receipt, Cancellation each map to a fixed name", () => {
    expect(
      buildStandardizedPolicyDocumentFilename({ documentType: PolicyDocumentType.DEBIT_NOTE, originalFileName: "x.pdf", existingStandardizedNamesLower: noExisting })
    ).toBe("Debit Note.pdf");
    expect(
      buildStandardizedPolicyDocumentFilename({ documentType: PolicyDocumentType.RECEIPT, originalFileName: "x.pdf", existingStandardizedNamesLower: noExisting })
    ).toBe("Receipt.pdf");
    expect(
      buildStandardizedPolicyDocumentFilename({ documentType: PolicyDocumentType.CANCELLATION, originalFileName: "x.pdf", existingStandardizedNamesLower: noExisting })
    ).toBe("Cancellation.pdf");
  });
});

describe("buildStandardizedPolicyDocumentFilename — ENDORSEMENT numbering (Part 5, requirement 11)", () => {
  it("first endorsement is numbered 01", () => {
    const name = buildStandardizedPolicyDocumentFilename({
      documentType: PolicyDocumentType.ENDORSEMENT,
      originalFileName: "endorsement.pdf",
      existingStandardizedNamesLower: noExisting,
    });
    expect(name).toBe("Endorsement-01.pdf");
  });

  it("second endorsement is numbered 02, collision-safe from existing names", () => {
    const existing = new Set(["endorsement-01.pdf"]);
    const name = buildStandardizedPolicyDocumentFilename({
      documentType: PolicyDocumentType.ENDORSEMENT,
      originalFileName: "endorsement.pdf",
      existingStandardizedNamesLower: existing,
    });
    expect(name).toBe("Endorsement-02.pdf");
  });

  it("skips over gaps deterministically (never reuses a lower number)", () => {
    const existing = new Set(["endorsement-01.pdf", "endorsement-03.pdf"]);
    const name = buildStandardizedPolicyDocumentFilename({
      documentType: PolicyDocumentType.ENDORSEMENT,
      originalFileName: "endorsement.pdf",
      existingStandardizedNamesLower: existing,
    });
    expect(name).toBe("Endorsement-04.pdf");
  });
});

describe("buildStandardizedPolicyDocumentFilename — duplicate/version resolution (Part 5, requirement 10)", () => {
  const NOW = new Date("2026-07-29T00:00:00Z");

  it("plain name when no collision exists", () => {
    const name = buildStandardizedPolicyDocumentFilename({
      documentType: PolicyDocumentType.POLICY_SCHEDULE,
      originalFileName: "x.pdf",
      existingStandardizedNamesLower: noExisting,
      now: NOW,
    });
    expect(name).toBe("Policy Schedule.pdf");
  });

  it("dated suffix on first collision", () => {
    const existing = new Set(["policy schedule.pdf"]);
    const name = buildStandardizedPolicyDocumentFilename({
      documentType: PolicyDocumentType.POLICY_SCHEDULE,
      originalFileName: "x.pdf",
      existingStandardizedNamesLower: existing,
      now: NOW,
    });
    expect(name).toBe("Policy Schedule - 2026-07-29.pdf");
  });

  it("numbered suffix on second same-day collision", () => {
    const existing = new Set(["policy schedule.pdf", "policy schedule - 2026-07-29.pdf"]);
    const name = buildStandardizedPolicyDocumentFilename({
      documentType: PolicyDocumentType.POLICY_SCHEDULE,
      originalFileName: "x.pdf",
      existingStandardizedNamesLower: existing,
      now: NOW,
    });
    expect(name).toBe("Policy Schedule - 2026-07-29 (2).pdf");
  });
});

describe("buildStandardizedPolicyDocumentFilename — OTHER document type", () => {
  it("preserves a Unicode original filename", () => {
    const name = buildStandardizedPolicyDocumentFilename({
      documentType: PolicyDocumentType.OTHER,
      originalFileName: "保单附加条款.pdf",
      existingStandardizedNamesLower: noExisting,
    });
    expect(name).toBe("保单附加条款.pdf");
  });

  it("strips path separators and control characters from the base name (no traversal is possible in the result)", () => {
    const name = buildStandardizedPolicyDocumentFilename({
      documentType: PolicyDocumentType.OTHER,
      originalFileName: "../../etc/passwd\r\n.pdf",
      existingStandardizedNamesLower: noExisting,
    });
    // Path separators become hyphens (never left as literal "/" or "\\"),
    // and control characters (CR/LF) are stripped — the standardized name
    // is always a single, safe filename component, never a multi-segment
    // path, regardless of what "../.." characters remain as plain text.
    expect(name).not.toContain("/");
    expect(name).not.toContain("\\");
    expect(name).not.toContain("\r");
    expect(name).not.toContain("\n");
    expect(name).not.toBe("..pdf");
    expect(name).not.toBe(".pdf");
  });

  it("falls back to a safe default name when the original is empty after sanitization", () => {
    const name = buildStandardizedPolicyDocumentFilename({
      documentType: PolicyDocumentType.OTHER,
      originalFileName: "....pdf",
      existingStandardizedNamesLower: noExisting,
    });
    expect(name).toBe("Document.pdf");
  });
});

describe("isPlausibleStandardizedPolicyFilename", () => {
  it("accepts a managed-type name with the right base and extension", () => {
    expect(isPlausibleStandardizedPolicyFilename("Policy Schedule.pdf", PolicyDocumentType.POLICY_SCHEDULE, "x.pdf")).toBe(true);
  });

  it("rejects a managed-type name with the wrong base", () => {
    expect(isPlausibleStandardizedPolicyFilename("Certificate.pdf", PolicyDocumentType.POLICY_SCHEDULE, "x.pdf")).toBe(false);
  });

  it("accepts a numbered endorsement name", () => {
    expect(isPlausibleStandardizedPolicyFilename("Endorsement-07.pdf", PolicyDocumentType.ENDORSEMENT, "x.pdf")).toBe(true);
  });

  it("rejects a non-endorsement name for ENDORSEMENT type", () => {
    expect(isPlausibleStandardizedPolicyFilename("Certificate.pdf", PolicyDocumentType.ENDORSEMENT, "x.pdf")).toBe(false);
  });
});
