import { describe, it, expect } from "vitest";
import { CustomerDocumentType } from "@/generated/prisma/enums";
import {
  buildStandardizedDropboxFilename,
  resolveSafeExtension,
  isPlausibleStandardizedFilename,
} from "../customerDocumentFilenames";

const noExisting = new Set<string>();

describe("buildStandardizedDropboxFilename — managed document types (Phase 3 Part 3/17.A)", () => {
  it("1. Registration Certificate PDF", () => {
    const name = buildStandardizedDropboxFilename({
      documentType: CustomerDocumentType.REGISTRATION_CERTIFICATE,
      originalFileName: "whatever-scan-013.pdf",
      mimeType: "application/pdf",
      existingStandardizedNamesLower: noExisting,
    });
    expect(name).toBe("Registration Certificate.pdf");
  });

  it("2. PIN Certificate PDF", () => {
    const name = buildStandardizedDropboxFilename({
      documentType: CustomerDocumentType.PIN_CERTIFICATE,
      originalFileName: "pin.pdf",
      mimeType: "application/pdf",
      existingStandardizedNamesLower: noExisting,
    });
    expect(name).toBe("PIN Certificate.pdf");
  });

  it("3. CR12 PDF", () => {
    const name = buildStandardizedDropboxFilename({
      documentType: CustomerDocumentType.CR12,
      originalFileName: "CR12_2026.pdf",
      mimeType: "application/pdf",
      existingStandardizedNamesLower: noExisting,
    });
    expect(name).toBe("CR12.pdf");
  });

  // VAT Certificate / Company Profile are not implemented CustomerDocumentType
  // values in this system (Part 1 finding) — only REGISTRATION_CERTIFICATE,
  // PIN_CERTIFICATE, CR12, and OTHER exist, so there is nothing to map for
  // those two names.
});

describe("buildStandardizedDropboxFilename — OTHER document type", () => {
  it("6. Chinese original filename is preserved (Dropbox paths are UTF-8, not ByteString-limited)", () => {
    const name = buildStandardizedDropboxFilename({
      documentType: CustomerDocumentType.OTHER,
      originalFileName: "中铁七局注册已公证文件.pdf",
      mimeType: "application/pdf",
      existingStandardizedNamesLower: noExisting,
    });
    expect(name).toBe("中铁七局注册已公证文件.pdf");
  });

  it("7. Filename with spaces is preserved", () => {
    const name = buildStandardizedDropboxFilename({
      documentType: CustomerDocumentType.OTHER,
      originalFileName: "Annual Report 2026 Final.pdf",
      mimeType: "application/pdf",
      existingStandardizedNamesLower: noExisting,
    });
    expect(name).toBe("Annual Report 2026 Final.pdf");
  });

  it("8. Slash/backslash never survive as literal path separators", () => {
    const name = buildStandardizedDropboxFilename({
      documentType: CustomerDocumentType.OTHER,
      originalFileName: "Reports/2026\\Q1 Summary.pdf",
      mimeType: "application/pdf",
      existingStandardizedNamesLower: noExisting,
    });
    expect(name).not.toContain("/");
    expect(name).not.toContain("\\");
    expect(name.endsWith(".pdf")).toBe(true);
  });

  it("9. Unicode/emoji filename is preserved", () => {
    const name = buildStandardizedDropboxFilename({
      documentType: CustomerDocumentType.OTHER,
      originalFileName: "🎉Celebration Invite 招待状.pdf",
      mimeType: "application/pdf",
      existingStandardizedNamesLower: noExisting,
    });
    expect(name).toBe("🎉Celebration Invite 招待状.pdf");
  });

  it("10. Blank filename falls back to a deterministic base name", () => {
    const name = buildStandardizedDropboxFilename({
      documentType: CustomerDocumentType.OTHER,
      originalFileName: "   .pdf",
      mimeType: "application/pdf",
      existingStandardizedNamesLower: noExisting,
    });
    expect(name).toBe("Other Document.pdf");
  });

  it("blank filename with no extension falls back safely (no crash, no empty name)", () => {
    const name = buildStandardizedDropboxFilename({
      documentType: CustomerDocumentType.OTHER,
      originalFileName: "",
      mimeType: "application/octet-stream",
      existingStandardizedNamesLower: noExisting,
    });
    expect(name.length).toBeGreaterThan(0);
    expect(name.startsWith("Other Document")).toBe(true);
  });

  it("14. Control characters are removed", () => {
    const name = buildStandardizedDropboxFilename({
      documentType: CustomerDocumentType.OTHER,
      originalFileName: "evil\r\nname\x00here.pdf",
      mimeType: "application/pdf",
      existingStandardizedNamesLower: noExisting,
    });
    expect(name).not.toMatch(/[\r\n\x00]/);
  });

  it("never produces a literal '.' or '..' base name", () => {
    const dot = buildStandardizedDropboxFilename({
      documentType: CustomerDocumentType.OTHER,
      originalFileName: "...pdf",
      mimeType: "application/pdf",
      existingStandardizedNamesLower: noExisting,
    });
    expect(dot).not.toBe(".pdf");
    expect(dot).not.toBe("..pdf");
    expect(dot.startsWith("Other Document")).toBe(true);
  });

  it("15. Maximum length is enforced", () => {
    const longName = "A".repeat(500) + ".pdf";
    const name = buildStandardizedDropboxFilename({
      documentType: CustomerDocumentType.OTHER,
      originalFileName: longName,
      mimeType: "application/pdf",
      existingStandardizedNamesLower: noExisting,
    });
    expect(name.length).toBeLessThanOrEqual(160);
  });
});

describe("buildStandardizedDropboxFilename — versioning / collisions (Part 4, Part 17.A.11)", () => {
  it("11. Same-type duplicate gets a dated version suffix, never overwrites the plain name", () => {
    const existing = new Set(["registration certificate.pdf"]);
    const now = new Date("2026-07-28T10:00:00Z");
    const name = buildStandardizedDropboxFilename({
      documentType: CustomerDocumentType.REGISTRATION_CERTIFICATE,
      originalFileName: "scan.pdf",
      mimeType: "application/pdf",
      existingStandardizedNamesLower: existing,
      now,
    });
    expect(name).toBe("Registration Certificate - 2026-07-28.pdf");
  });

  it("a second same-day duplicate gets a numbered suffix, no collision", () => {
    const existing = new Set(["registration certificate.pdf", "registration certificate - 2026-07-28.pdf"]);
    const now = new Date("2026-07-28T10:00:00Z");
    const name = buildStandardizedDropboxFilename({
      documentType: CustomerDocumentType.REGISTRATION_CERTIFICATE,
      originalFileName: "scan2.pdf",
      mimeType: "application/pdf",
      existingStandardizedNamesLower: existing,
      now,
    });
    expect(name).toBe("Registration Certificate - 2026-07-28 (2).pdf");
  });

  it("Other-type collisions resolve deterministically the same way", () => {
    const existing = new Set(["company brochure.pdf"]);
    const now = new Date("2026-07-28T10:00:00Z");
    const name = buildStandardizedDropboxFilename({
      documentType: CustomerDocumentType.OTHER,
      originalFileName: "Company Brochure.pdf",
      mimeType: "application/pdf",
      existingStandardizedNamesLower: existing,
      now,
    });
    expect(name).toBe("Company Brochure - 2026-07-28.pdf");
  });

  it("is deterministic: same inputs always produce the same output", () => {
    const existing = new Set(["cr12.pdf"]);
    const now = new Date("2026-07-28T10:00:00Z");
    const args = {
      documentType: CustomerDocumentType.CR12,
      originalFileName: "x.pdf",
      mimeType: "application/pdf",
      existingStandardizedNamesLower: existing,
      now,
    };
    expect(buildStandardizedDropboxFilename(args)).toBe(buildStandardizedDropboxFilename(args));
  });
});

describe("resolveSafeExtension (Part 3, requirement #4)", () => {
  it("13. Preserves a valid, allowed extension from the original filename", () => {
    expect(resolveSafeExtension("file.PDF", "application/pdf")).toBe(".pdf");
    expect(resolveSafeExtension("file.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(".docx");
  });

  it("never trusts an extension inconsistent with the app's allowed set, falls back to MIME-derived extension", () => {
    expect(resolveSafeExtension("file.exe", "application/pdf")).toBe(".pdf");
    expect(resolveSafeExtension("file", "image/png")).toBe(".png");
  });

  it("normalizes extension case to lowercase", () => {
    expect(resolveSafeExtension("FILE.JPG", "image/jpeg")).toBe(".jpg");
  });
});

describe("isPlausibleStandardizedFilename (Part 9 verify support)", () => {
  it("recognizes a plain standardized managed-type name", () => {
    expect(isPlausibleStandardizedFilename("Registration Certificate.pdf", CustomerDocumentType.REGISTRATION_CERTIFICATE, "x.pdf", "application/pdf")).toBe(true);
  });

  it("recognizes a versioned standardized managed-type name", () => {
    expect(
      isPlausibleStandardizedFilename("Registration Certificate - 2026-07-28.pdf", CustomerDocumentType.REGISTRATION_CERTIFICATE, "x.pdf", "application/pdf")
    ).toBe(true);
  });

  it("rejects a name with the wrong extension", () => {
    expect(isPlausibleStandardizedFilename("Registration Certificate.docx", CustomerDocumentType.REGISTRATION_CERTIFICATE, "x.pdf", "application/pdf")).toBe(false);
  });

  it("rejects a name that doesn't match the managed type's base name", () => {
    expect(isPlausibleStandardizedFilename("Some Random File.pdf", CustomerDocumentType.REGISTRATION_CERTIFICATE, "x.pdf", "application/pdf")).toBe(false);
  });
});
