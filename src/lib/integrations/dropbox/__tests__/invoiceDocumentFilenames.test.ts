import { describe, it, expect } from "vitest";
import { buildStandardizedInvoiceFilename, isPlausibleStandardizedInvoiceFilename } from "../invoiceDocumentFilenames";

// Category B — Invoice filename rules (Phase 6, Part 4/14.B).
describe("buildStandardizedInvoiceFilename", () => {
  it("B1: standard invoice number filename — <INVOICE_NUMBER>.<ext>", () => {
    expect(buildStandardizedInvoiceFilename("INV202607-0001", "INV202607-0001.xlsx")).toBe("INV202607-0001.xlsx");
  });

  it("B2: Excel extension preserved", () => {
    expect(buildStandardizedInvoiceFilename("INV202607-0001", "whatever.xlsx")).toBe("INV202607-0001.xlsx");
  });

  it("B3: PDF extension preserved (forward-compatible — no PDF path exists today, but the builder never hardcodes .xlsx)", () => {
    expect(buildStandardizedInvoiceFilename("INV202607-0001", "whatever.pdf")).toBe("INV202607-0001.pdf");
  });

  it("B4: unsafe characters sanitized (control chars / path separators stripped, meaning preserved)", () => {
    expect(buildStandardizedInvoiceFilename("INV202607-0001/../etc", "x.xlsx")).toBe("INV202607-0001-..-etc.xlsx");
    expect(buildStandardizedInvoiceFilename("INV202607-0001\x00\x1F", "x.xlsx")).toBe("INV202607-0001.xlsx");
  });

  it("B5: unicode in the number is preserved safely (defense in depth — real invoice numbers are always ASCII)", () => {
    expect(buildStandardizedInvoiceFilename("发票-0001", "x.xlsx")).toBe("发票-0001.xlsx");
  });

  it("B9: Excel and PDF filenames for the same invoice number coexist (different extensions, same base)", () => {
    const excel = buildStandardizedInvoiceFilename("INV202607-0001", "a.xlsx");
    const pdf = buildStandardizedInvoiceFilename("INV202607-0001", "a.pdf");
    expect(excel).not.toBe(pdf);
    expect(excel.replace(/\.xlsx$/, "")).toBe(pdf.replace(/\.pdf$/, ""));
  });

  it("falls back to a safe default extension when the generated filename has none", () => {
    expect(buildStandardizedInvoiceFilename("INV202607-0001", "noextension")).toBe("INV202607-0001.xlsx");
  });
});

describe("isPlausibleStandardizedInvoiceFilename", () => {
  it("accepts a filename this builder would have produced", () => {
    expect(isPlausibleStandardizedInvoiceFilename("INV202607-0001.xlsx", "INV202607-0001")).toBe(true);
  });

  it("rejects an unrelated filename", () => {
    expect(isPlausibleStandardizedInvoiceFilename("Some Other Document.xlsx", "INV202607-0001")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isPlausibleStandardizedInvoiceFilename("inv202607-0001.xlsx", "INV202607-0001")).toBe(true);
  });
});
