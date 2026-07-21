// Storage abstraction for Phase 2 underwriting documents. Mirrors the
// safety pattern already proven by src/lib/storage/local-storage-provider.ts
// (defense-in-depth path resolution, folder-scoped keys) but is its own
// module — a separate storage root (QUOTATION_DOCUMENT_STORAGE_ROOT, not
// customer documents' UPLOADS_DIR) and a streaming-capable interface, since
// download must not load an entire large file into memory. Phase 3's
// Dropbox provider implements this same interface; nothing here assumes
// LOCAL is the only possibility.
import { createReadStream, type ReadStream } from "fs";
import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";

// turbopackIgnore: runtime-only path, not a module to bundle — see
// local-storage-provider.ts's identical comment for why this annotation is
// required (without it Next's file tracer bundles the whole project).
const STORAGE_ROOT = path.resolve(
  process.env.QUOTATION_DOCUMENT_STORAGE_ROOT ||
    path.join(/* turbopackIgnore: true */ process.cwd(), "quotation-documents")
);

// Defense in depth: every path touched must resolve inside STORAGE_ROOT,
// even though quotationCaseId/documentFolderId are always server-generated
// ids, never raw user input.
function resolveSafePath(relativeKey: string): string {
  const resolved = path.resolve(STORAGE_ROOT, relativeKey);
  if (resolved !== STORAGE_ROOT && !resolved.startsWith(STORAGE_ROOT + path.sep)) {
    throw new Error("Resolved path escapes the quotation document storage root");
  }
  return resolved;
}

export type SaveFileInput = {
  quotationCaseId: string;
  documentFolderId: string;
  fileName: string;
  buffer: Buffer;
};

export type DocumentMetadata = {
  size: number;
};

export interface DocumentStorageProvider {
  /** Writes the file and returns the storagePath to persist on the DB row. */
  saveFile(input: SaveFileInput): Promise<{ storagePath: string }>;
  /** Opens a readable stream for download — never buffers the whole file. */
  openFile(storagePath: string): Promise<ReadStream>;
  deleteFile(storagePath: string): Promise<void>;
  fileExists(storagePath: string): Promise<boolean>;
  getMetadata(storagePath: string): Promise<DocumentMetadata | null>;
}

export class LocalDocumentStorageProvider implements DocumentStorageProvider {
  async saveFile(input: SaveFileInput): Promise<{ storagePath: string }> {
    const storagePath = path.posix.join(input.quotationCaseId, input.documentFolderId, input.fileName);
    const target = resolveSafePath(storagePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, input.buffer);
    return { storagePath };
  }

  async openFile(storagePath: string): Promise<ReadStream> {
    const target = resolveSafePath(storagePath);
    return createReadStream(target);
  }

  async deleteFile(storagePath: string): Promise<void> {
    const target = resolveSafePath(storagePath);
    await fs.rm(target, { force: true });
  }

  async fileExists(storagePath: string): Promise<boolean> {
    try {
      await fs.access(resolveSafePath(storagePath));
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(storagePath: string): Promise<DocumentMetadata | null> {
    try {
      const stat = await fs.stat(resolveSafePath(storagePath));
      return { size: stat.size };
    } catch {
      return null;
    }
  }
}

// Single swap point for Phase 3: introduce a DropboxDocumentStorageProvider
// implementing the same interface and select it here (e.g. based on an env
// var), without touching any upload/download/business logic.
export const documentStorageService: DocumentStorageProvider = new LocalDocumentStorageProvider();

export function sha256Checksum(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
