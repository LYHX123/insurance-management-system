import { createReadStream, type ReadStream } from "fs";
import { promises as fs } from "fs";
import path from "path";

// Mirrors src/lib/quotationDocuments/storage.ts's exact pattern (and
// src/lib/policyDocuments/storage.ts's copy of the same pattern) — this
// project's established convention for a new persistent-file storage area
// is its own small module with its own storage root, not a shared base
// class (see that file's own doc comment for why). sha256Checksum is
// intentionally NOT duplicated here — it's a plain utility already reused
// directly from quotationDocuments/storage.ts by every other module that
// needs it (policy import actions, etc.).
const STORAGE_ROOT = path.resolve(
  process.env.INVOICE_DOCUMENT_STORAGE_ROOT ||
    path.join(/* turbopackIgnore: true */ process.cwd(), "invoice-documents")
);

function resolveSafePath(relativeKey: string): string {
  const resolved = path.resolve(STORAGE_ROOT, relativeKey);
  if (resolved !== STORAGE_ROOT && !resolved.startsWith(STORAGE_ROOT + path.sep)) {
    throw new Error("Resolved path escapes the invoice document storage root");
  }
  return resolved;
}

export type SaveInvoiceFileInput = { invoiceNumber: string; fileName: string; buffer: Buffer };
export type InvoiceFileMetadata = { size: number };

export interface InvoiceDocumentStorage {
  saveFile(input: SaveInvoiceFileInput): Promise<{ storagePath: string }>;
  openFile(storagePath: string): Promise<ReadStream>;
  deleteFile(storagePath: string): Promise<void>;
  fileExists(storagePath: string): Promise<boolean>;
  getMetadata(storagePath: string): Promise<InvoiceFileMetadata | null>;
}

// Keyed by invoiceNumber (e.g. "INV202607/INV202607-0001.xlsx" via the
// yearMonth prefix embedded in the number) rather than a random folder id —
// an Invoice has exactly one generated file for its whole lifetime (see
// Invoice.generatedStoragePath's schema comment), unlike
// Quotation/Policy documents which are many-per-parent.
export class LocalInvoiceDocumentStorage implements InvoiceDocumentStorage {
  async saveFile(input: SaveInvoiceFileInput): Promise<{ storagePath: string }> {
    const storagePath = path.posix.join(input.invoiceNumber, input.fileName);
    const target = resolveSafePath(storagePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, input.buffer);
    return { storagePath };
  }

  async openFile(storagePath: string): Promise<ReadStream> {
    return createReadStream(resolveSafePath(storagePath));
  }

  async deleteFile(storagePath: string): Promise<void> {
    await fs.rm(resolveSafePath(storagePath), { force: true });
  }

  async fileExists(storagePath: string): Promise<boolean> {
    try {
      await fs.access(resolveSafePath(storagePath));
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(storagePath: string): Promise<InvoiceFileMetadata | null> {
    try {
      const stat = await fs.stat(resolveSafePath(storagePath));
      return { size: stat.size };
    } catch {
      return null;
    }
  }
}

export const invoiceDocumentStorage: InvoiceDocumentStorage = new LocalInvoiceDocumentStorage();
