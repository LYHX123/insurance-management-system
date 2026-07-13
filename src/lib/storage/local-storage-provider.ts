import { promises as fs } from "fs";
import path from "path";
import type { StorageProvider, StoredFile, UploadFileInput } from "./types";

// turbopackIgnore: this is a runtime-only path, not a module to bundle —
// without the annotation Next's file tracer misreads it as a dynamic
// require and bundles the whole project into the standalone output.
const UPLOADS_ROOT = path.resolve(
  process.env.UPLOADS_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "uploads")
);

// Defense in depth: every path we touch must resolve inside UPLOADS_ROOT,
// even though folderPath/storageKey are always built from server-generated
// ids rather than raw user input.
function resolveSafePath(relativeKey: string): string {
  const resolved = path.resolve(UPLOADS_ROOT, relativeKey);
  if (
    resolved !== UPLOADS_ROOT &&
    !resolved.startsWith(UPLOADS_ROOT + path.sep)
  ) {
    throw new Error("Resolved path escapes the uploads root");
  }
  return resolved;
}

export class LocalStorageProvider implements StorageProvider {
  async createFolder(folderPath: string): Promise<void> {
    const target = resolveSafePath(folderPath);
    await fs.mkdir(target, { recursive: true });
  }

  async uploadFile(input: UploadFileInput): Promise<{ storageKey: string }> {
    const storageKey = path.posix.join(
      input.folderPath.split(path.sep).join("/"),
      input.fileName
    );
    const target = resolveSafePath(storageKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, input.buffer);
    return { storageKey };
  }

  async downloadFile(storageKey: string): Promise<Buffer> {
    const target = resolveSafePath(storageKey);
    return fs.readFile(target);
  }

  async getFile(storageKey: string): Promise<StoredFile | null> {
    try {
      const target = resolveSafePath(storageKey);
      const buffer = await fs.readFile(target);
      return { buffer, mimeType: "application/octet-stream" };
    } catch {
      return null;
    }
  }

  async deleteFile(storageKey: string): Promise<void> {
    const target = resolveSafePath(storageKey);
    await fs.rm(target, { force: true });
  }

  async fileExists(storageKey: string): Promise<boolean> {
    try {
      const target = resolveSafePath(storageKey);
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }
}
