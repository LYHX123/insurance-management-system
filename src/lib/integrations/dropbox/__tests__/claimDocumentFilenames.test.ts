import { describe, it, expect } from "vitest";
import { buildStandardizedMotorClaimDocumentFilename, buildStandardizedNonMotorClaimDocumentFilename } from "../claimDocumentFilenames";

// Dropbox Integration Phase 7, Part 5 — standardized Claim document
// filenames are pure and deterministic, so they're covered with real unit
// tests rather than only source-text regression scans.

describe("buildStandardizedMotorClaimDocumentFilename", () => {
  it("uses the managed type's plain base name when no sibling has claimed it yet", () => {
    const name = buildStandardizedMotorClaimDocumentFilename({
      documentType: "CLAIM_FORM",
      originalFileName: "scan001.pdf",
      existingStandardizedNamesLower: new Set(),
    });
    expect(name).toBe("Claim Form.pdf");
  });

  it("falls through to the dated-suffix tier when the plain name is already taken by a sibling", () => {
    const name = buildStandardizedMotorClaimDocumentFilename({
      documentType: "POLICE_ABSTRACT",
      originalFileName: "abstract.pdf",
      existingStandardizedNamesLower: new Set(["police abstract.pdf"]),
    });
    expect(name).toMatch(/^Police Abstract - \d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it("falls through to the numbered-dated tier when both the plain and dated names are taken", () => {
    const today = new Date();
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const iso = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
    const name = buildStandardizedMotorClaimDocumentFilename({
      documentType: "LOGBOOK",
      originalFileName: "logbook.pdf",
      existingStandardizedNamesLower: new Set(["logbook.pdf", `logbook - ${iso}.pdf`.toLowerCase()]),
    });
    expect(name.toLowerCase()).toBe(`logbook - ${iso} (2).pdf`);
  });

  it("PHOTOS uses sequential '<Base> - N' numbering as its primary scheme, not the dated tier — even for the first upload", () => {
    const name = buildStandardizedMotorClaimDocumentFilename({
      documentType: "PHOTOS",
      originalFileName: "img1.jpg",
      existingStandardizedNamesLower: new Set(),
    });
    expect(name).toBe("Photos - 1.jpg");
  });

  it("PHOTOS picks the next free sequence number from existing siblings, never reusing or restarting", () => {
    const name = buildStandardizedMotorClaimDocumentFilename({
      documentType: "PHOTOS",
      originalFileName: "img4.jpg",
      existingStandardizedNamesLower: new Set(["photos - 1.jpg", "photos - 2.jpg", "photos - 5.jpg"]),
    });
    expect(name).toBe("Photos - 6.jpg");
  });

  it("OTHER derives its base name from the sanitized original filename, prefixed 'Other -'", () => {
    const name = buildStandardizedMotorClaimDocumentFilename({
      documentType: "OTHER",
      originalFileName: "misc notes.docx",
      existingStandardizedNamesLower: new Set(),
    });
    expect(name).toBe("Other - misc notes.docx");
  });

  it("strips path-breaking and control characters out of an OTHER document's derived base name", () => {
    const name = buildStandardizedMotorClaimDocumentFilename({
      documentType: "OTHER",
      originalFileName: "a/b\\c.pdf",
      existingStandardizedNamesLower: new Set(),
    });
    expect(name).toBe("Other - a-b-c.pdf");
  });
});

describe("buildStandardizedNonMotorClaimDocumentFilename", () => {
  it("uses the managed type's plain base name when no sibling has claimed it yet", () => {
    const name = buildStandardizedNonMotorClaimDocumentFilename({
      documentType: "INCIDENT_REPORT",
      originalFileName: "report.pdf",
      existingStandardizedNamesLower: new Set(),
    });
    expect(name).toBe("Incident Report.pdf");
  });

  it("SUPPORTING_DOCUMENT uses sequential '<Base> - N' numbering as its primary scheme", () => {
    const name = buildStandardizedNonMotorClaimDocumentFilename({
      documentType: "SUPPORTING_DOCUMENT",
      originalFileName: "doc.pdf",
      existingStandardizedNamesLower: new Set(["supporting document - 1.pdf"]),
    });
    expect(name).toBe("Supporting Document - 2.pdf");
  });

  it("Motor and Non-Motor numbered sequences are independent of each other (no cross-type counter bleed)", () => {
    const motorName = buildStandardizedMotorClaimDocumentFilename({
      documentType: "PHOTOS",
      originalFileName: "img.jpg",
      existingStandardizedNamesLower: new Set(["supporting document - 9.pdf"]),
    });
    expect(motorName).toBe("Photos - 1.jpg");
  });
});
