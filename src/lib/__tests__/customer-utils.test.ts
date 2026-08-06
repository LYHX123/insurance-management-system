import { describe, it, expect } from "vitest";
import {
  validateCustomerShortName,
  validateCustomerDocumentUpload,
  MAX_CUSTOMER_SHORT_NAME_LENGTH,
  MAX_UPLOAD_FILE_SIZE_BYTES,
} from "../customer-utils";

// Production Readiness Audit V1, finding H1: Customer Document upload
// previously trusted only the browser-supplied MIME type. These cover the
// fix — validateCustomerDocumentUpload now mirrors Policy/Quotation/Claim
// documents' byte-signature validation.
describe("validateCustomerDocumentUpload (Production Readiness Audit V1, H1)", () => {
  const pdfBytes = Buffer.from("%PDF-1.4\n%rest of a real pdf...");
  const jpegBytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("rest of jpeg bytes")]);

  // CASE H1-1: a legitimate PDF is allowed.
  it("H1-1: a real PDF (correct extension, MIME, and signature) is allowed", () => {
    const result = validateCustomerDocumentUpload("scan.pdf", "application/pdf", pdfBytes.length, pdfBytes);
    expect(result.ok).toBe(true);
  });

  // CASE H1-2: a legitimate JPEG is allowed.
  it("H1-2: a real JPEG (correct extension, MIME, and signature) is allowed", () => {
    const result = validateCustomerDocumentUpload("photo.jpg", "image/jpeg", jpegBytes.length, jpegBytes);
    expect(result.ok).toBe(true);
  });

  // CASE H1-3: extension/MIME claim PDF, but the actual bytes are HTML.
  it("H1-3: content is HTML but claims to be a PDF -> rejected", () => {
    const htmlBytes = Buffer.from("<!doctype html><html><body><script>alert(1)</script></body></html>");
    const result = validateCustomerDocumentUpload("scan.pdf", "application/pdf", htmlBytes.length, htmlBytes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("DANGEROUS_FILE_CONTENT");
  });

  // CASE H1-4: a disguised script/executable is rejected regardless of
  // claimed extension/MIME type.
  it("H1-4: a Windows executable disguised as a PDF -> rejected", () => {
    const exeBytes = Buffer.concat([Buffer.from("MZ"), Buffer.from("...rest of a fake exe...")]);
    const result = validateCustomerDocumentUpload("invoice.pdf", "application/pdf", exeBytes.length, exeBytes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("DANGEROUS_FILE_CONTENT");
  });

  it("H1-4b: a shebang script disguised as an image -> rejected", () => {
    const scriptBytes = Buffer.from("#!/bin/sh\nrm -rf /\n");
    const result = validateCustomerDocumentUpload("photo.jpg", "image/jpeg", scriptBytes.length, scriptBytes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("DANGEROUS_FILE_CONTENT");
  });

  // CASE H1-5: an empty file is rejected.
  it("H1-5: an empty file is rejected", () => {
    const result = validateCustomerDocumentUpload("empty.pdf", "application/pdf", 0, Buffer.alloc(0));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("FILE_EMPTY");
  });

  // CASE H1-6: a file over the configured size limit is rejected. Size is
  // checked as a plain number before any buffer content is read, so this
  // doesn't need to allocate a real oversized buffer.
  it("H1-6: a file over the maximum upload size is rejected", () => {
    const result = validateCustomerDocumentUpload("scan.pdf", "application/pdf", MAX_UPLOAD_FILE_SIZE_BYTES + 1, pdfBytes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("FILE_TOO_LARGE");
  });

  // CASE H1-7: a filename carrying path-traversal sequences is rejected —
  // the physical filename is always server-generated, but the originalFileName
  // is stored for display and must not be able to encode a traversal path.
  it("H1-7: a filename containing '../' is rejected", () => {
    const result = validateCustomerDocumentUpload("../../etc/passwd.pdf", "application/pdf", pdfBytes.length, pdfBytes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("UNSAFE_FILE_NAME");
  });

  it("H1-7b: a filename containing a backslash traversal sequence is rejected", () => {
    const result = validateCustomerDocumentUpload("..\\..\\windows\\win.ini", "application/pdf", pdfBytes.length, pdfBytes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("UNSAFE_FILE_NAME");
  });

  it("a claimed MIME type outside the customer document allowlist is rejected", () => {
    const result = validateCustomerDocumentUpload("archive.zip", "application/zip", pdfBytes.length, pdfBytes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("UNSUPPORTED_FILE_TYPE");
  });

  it("bytes that don't match the claimed type's signature are rejected", () => {
    // Claims to be a PNG but the bytes are really a JPEG signature.
    const result = validateCustomerDocumentUpload("photo.png", "image/png", jpegBytes.length, jpegBytes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("FILE_SIGNATURE_MISMATCH");
  });
});

describe("validateCustomerShortName (Phase 4 Part 2/17.A)", () => {
  it("accepts a normal short name", () => {
    const result = validateCustomerShortName("CRSG");
    expect(result).toEqual({ ok: true, value: "CRSG" });
  });

  it("trims leading/trailing spaces and collapses repeated spaces", () => {
    const result = validateCustomerShortName("  China   Railway  ");
    expect(result).toEqual({ ok: true, value: "China Railway" });
  });

  it("allows numbers and safe hyphens", () => {
    const result = validateCustomerShortName("CRSG-2026");
    expect(result.ok).toBe(true);
  });

  it("allows Chinese characters in the stored value", () => {
    const result = validateCustomerShortName("中铁七局");
    expect(result).toEqual({ ok: true, value: "中铁七局" });
  });

  it("8. rejects path separators", () => {
    expect(validateCustomerShortName("CRSG/2026").ok).toBe(false);
    expect(validateCustomerShortName("CRSG\\2026").ok).toBe(false);
  });

  it("9. rejects control characters", () => {
    const result = validateCustomerShortName("CRSG\r\nX");
    expect(result.ok).toBe(false);
  });

  it("rejects '.' and '..' as the complete value", () => {
    expect(validateCustomerShortName(".").ok).toBe(false);
    expect(validateCustomerShortName("..").ok).toBe(false);
    expect(validateCustomerShortName("  ..  ").ok).toBe(false);
  });

  it("7. a blank value is valid (the field is optional)", () => {
    const result = validateCustomerShortName("   ");
    expect(result).toEqual({ ok: true, value: "" });
  });

  it("enforces a maximum length", () => {
    const tooLong = "A".repeat(MAX_CUSTOMER_SHORT_NAME_LENGTH + 1);
    const result = validateCustomerShortName(tooLong);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SHORT_NAME_TOO_LONG");
  });

  it("a value at exactly the maximum length is accepted", () => {
    const exact = "A".repeat(MAX_CUSTOMER_SHORT_NAME_LENGTH);
    const result = validateCustomerShortName(exact);
    expect(result.ok).toBe(true);
  });
});
