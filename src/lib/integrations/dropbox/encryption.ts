// Server-only. First crypto-secret utility in this codebase (existing uses
// of Node's `crypto` module are limited to sha256 file checksums and
// bcrypt password hashing — see src/lib/quotationDocuments/storage.ts and
// src/lib/auth.ts). No external crypto library is used, matching the
// project's existing preference for Node's built-in `crypto`.
//
// AES-256-GCM, random 12-byte IV per encryption call, versioned payload so
// the scheme can be upgraded later without an unreadable-forever migration:
//   v1:<iv_base64>:<authTag_base64>:<ciphertext_base64>
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const CURRENT_VERSION = "v1";

export class DropboxTokenDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DropboxTokenDecryptionError";
  }
}

/** `key` must be exactly 32 bytes (see getDropboxEnv()'s length check). */
export function encryptToken(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [CURRENT_VERSION, iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

// Fails safely (throws DropboxTokenDecryptionError) on any problem — wrong
// key, tampered/corrupt payload, unknown version. Callers must NEVER
// silently overwrite the stored value on a decryption failure; treat the
// connection as unreadable and surface a safe error instead (see
// service.ts).
export function decryptToken(payload: string, key: Buffer): string {
  const parts = payload.split(":");
  if (parts.length !== 4) {
    throw new DropboxTokenDecryptionError("Malformed encrypted token payload.");
  }
  const [version, ivB64, authTagB64, ciphertextB64] = parts;
  if (version !== CURRENT_VERSION) {
    throw new DropboxTokenDecryptionError(`Unsupported encrypted token version: ${version}`);
  }

  try {
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(authTagB64, "base64");
    const ciphertext = Buffer.from(ciphertextB64, "base64");
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    // Deliberately no `cause`/original error included — GCM auth-tag
    // failures and Node crypto errors can echo back buffer contents in some
    // engines; keep this message generic and safe to log.
    throw new DropboxTokenDecryptionError("Failed to decrypt token: wrong key or corrupted payload.");
  }
}
