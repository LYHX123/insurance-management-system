// Storage abstraction for Dropbox Integration Phase 7 — Motor/Non-Motor
// Claim documents. Mirrors policyDocuments/storage.ts's exact pattern
// (defense-in-depth path resolution, folder-scoped keys, streaming-capable
// interface). One shared factory (not two duplicated ~90-line modules)
// because Motor and Non-Motor Claim document storage is byte-for-byte
// identical file-handling logic — the two claim TYPES genuinely differ
// (separate Prisma models/enums, per this schema's stated "no polymorphic
// entityType+entityId" convention), but the local filesystem storage layer
// underneath them does not, so each still gets its own storage root (own
// env var, own directory) via its own factory-produced instance.
import { createReadStream, type ReadStream } from "fs";
import { promises as fs } from "fs";
import path from "path";

export type SaveClaimFileInput = {
  claimId: string;
  documentFolderId: string;
  fileName: string;
  buffer: Buffer;
};

export type ClaimDocumentMetadata = {
  size: number;
};

export interface ClaimDocumentStorage {
  saveFile(input: SaveClaimFileInput): Promise<{ storagePath: string }>;
  openFile(storagePath: string): Promise<ReadStream>;
  deleteFile(storagePath: string): Promise<void>;
  fileExists(storagePath: string): Promise<boolean>;
  getMetadata(storagePath: string): Promise<ClaimDocumentMetadata | null>;
}

function createClaimDocumentStorage(rootEnvVar: string, fallbackDirName: string): ClaimDocumentStorage {
  const STORAGE_ROOT = path.resolve(
    process.env[rootEnvVar] || path.join(/* turbopackIgnore: true */ process.cwd(), fallbackDirName)
  );

  function resolveSafePath(relativeKey: string): string {
    const resolved = path.resolve(STORAGE_ROOT, relativeKey);
    if (resolved !== STORAGE_ROOT && !resolved.startsWith(STORAGE_ROOT + path.sep)) {
      throw new Error(`Resolved path escapes the ${fallbackDirName} storage root`);
    }
    return resolved;
  }

  return {
    async saveFile(input) {
      const storagePath = path.posix.join(input.claimId, input.documentFolderId, input.fileName);
      const target = resolveSafePath(storagePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, input.buffer);
      return { storagePath };
    },
    async openFile(storagePath) {
      return createReadStream(resolveSafePath(storagePath));
    },
    async deleteFile(storagePath) {
      await fs.rm(resolveSafePath(storagePath), { force: true });
    },
    async fileExists(storagePath) {
      try {
        await fs.access(resolveSafePath(storagePath));
        return true;
      } catch {
        return false;
      }
    },
    async getMetadata(storagePath) {
      try {
        const stat = await fs.stat(resolveSafePath(storagePath));
        return { size: stat.size };
      } catch {
        return null;
      }
    },
  };
}

export const motorClaimDocumentStorage: ClaimDocumentStorage = createClaimDocumentStorage(
  "MOTOR_CLAIM_DOCUMENT_STORAGE_ROOT",
  "motor-claim-documents"
);
export const nonMotorClaimDocumentStorage: ClaimDocumentStorage = createClaimDocumentStorage(
  "NON_MOTOR_CLAIM_DOCUMENT_STORAGE_ROOT",
  "non-motor-claim-documents"
);
