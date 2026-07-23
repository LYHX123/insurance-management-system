// Storage abstraction for Phase 1B Policy Documents. Mirrors
// quotationDocuments/storage.ts's exact pattern (defense-in-depth path
// resolution, folder-scoped keys, streaming-capable interface) — its own
// module with its own storage root (POLICY_DOCUMENT_STORAGE_ROOT), since
// Policy Documents are a separate domain from Quotation/underwriting
// documents. A future Dropbox-backed implementation (Section 6 of this
// phase's spec — DropboxPolicyDocumentStorage, not built yet) implements
// this same interface and is selected here, without touching any
// upload/download/business logic; PolicyDocument.storageProvider,
// externalFileId and externalPath already exist on the schema for that.
import { createReadStream, type ReadStream } from "fs";
import { promises as fs } from "fs";
import path from "path";

// turbopackIgnore: runtime-only path, not a module to bundle — see
// quotationDocuments/storage.ts's identical comment for why this annotation
// is required (without it Next's file tracer bundles the whole project).
const STORAGE_ROOT = path.resolve(
  process.env.POLICY_DOCUMENT_STORAGE_ROOT ||
    path.join(/* turbopackIgnore: true */ process.cwd(), "policy-documents")
);

// Defense in depth: every path touched must resolve inside STORAGE_ROOT,
// even though policyRecordId/documentFolderId are always server-generated
// ids, never raw user input.
function resolveSafePath(relativeKey: string): string {
  const resolved = path.resolve(STORAGE_ROOT, relativeKey);
  if (resolved !== STORAGE_ROOT && !resolved.startsWith(STORAGE_ROOT + path.sep)) {
    throw new Error("Resolved path escapes the policy document storage root");
  }
  return resolved;
}

export type SaveFileInput = {
  policyRecordId: string;
  documentFolderId: string;
  fileName: string;
  buffer: Buffer;
};

export type DocumentMetadata = {
  size: number;
};

export interface PolicyDocumentStorage {
  /** Writes the file and returns the storagePath to persist on the DB row. */
  saveFile(input: SaveFileInput): Promise<{ storagePath: string }>;
  /** Opens a readable stream for download — never buffers the whole file. */
  openFile(storagePath: string): Promise<ReadStream>;
  deleteFile(storagePath: string): Promise<void>;
  fileExists(storagePath: string): Promise<boolean>;
  getMetadata(storagePath: string): Promise<DocumentMetadata | null>;
}

export class LocalPolicyDocumentStorage implements PolicyDocumentStorage {
  async saveFile(input: SaveFileInput): Promise<{ storagePath: string }> {
    const storagePath = path.posix.join(input.policyRecordId, input.documentFolderId, input.fileName);
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

// Single swap point for a future Dropbox phase: introduce a
// DropboxPolicyDocumentStorage implementing the same interface and select it
// here (e.g. based on an env var), without touching any upload/download/
// business logic. Not implemented in Phase 1B — LOCAL is the only provider
// any code path writes.
export const policyDocumentStorage: PolicyDocumentStorage = new LocalPolicyDocumentStorage();
