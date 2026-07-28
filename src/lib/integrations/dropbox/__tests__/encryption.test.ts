import { describe, it, expect } from "vitest";
import { randomBytes } from "crypto";
import { encryptToken, decryptToken, DropboxTokenDecryptionError } from "../encryption";

// Dummy 32-byte test keys only — never real credentials.
const KEY_A = randomBytes(32);
const KEY_B = randomBytes(32);

describe("Dropbox token encryption (Part 20.B)", () => {
  it("encrypts and decrypts a refresh token correctly", () => {
    const plaintext = "dummy-refresh-token-value-for-testing";
    const encrypted = encryptToken(plaintext, KEY_A);
    expect(decryptToken(encrypted, KEY_A)).toBe(plaintext);
  });

  it("uses a different IV (different ciphertext) for the same token encrypted twice", () => {
    const plaintext = "same-dummy-token";
    const first = encryptToken(plaintext, KEY_A);
    const second = encryptToken(plaintext, KEY_A);
    expect(first).not.toBe(second);
    // Same version + plaintext under the same key should still both decrypt correctly.
    expect(decryptToken(first, KEY_A)).toBe(plaintext);
    expect(decryptToken(second, KEY_A)).toBe(plaintext);
  });

  it("includes a version prefix in the stored payload", () => {
    const encrypted = encryptToken("x", KEY_A);
    expect(encrypted.startsWith("v1:")).toBe(true);
    expect(encrypted.split(":")).toHaveLength(4);
  });

  it("fails safely with the wrong key instead of returning garbage", () => {
    const encrypted = encryptToken("dummy-token", KEY_A);
    expect(() => decryptToken(encrypted, KEY_B)).toThrow(DropboxTokenDecryptionError);
  });

  it("fails safely on a tampered/corrupted payload", () => {
    const encrypted = encryptToken("dummy-token", KEY_A);
    const parts = encrypted.split(":");
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("tampered-ciphertext").toString("base64")].join(":");
    expect(() => decryptToken(tampered, KEY_A)).toThrow(DropboxTokenDecryptionError);
  });

  it("fails safely on a malformed payload (wrong shape)", () => {
    expect(() => decryptToken("not-a-valid-payload", KEY_A)).toThrow(DropboxTokenDecryptionError);
  });

  it("fails safely on an unknown version", () => {
    const encrypted = encryptToken("dummy-token", KEY_A);
    const parts = encrypted.split(":");
    const wrongVersion = ["v99", parts[1], parts[2], parts[3]].join(":");
    expect(() => decryptToken(wrongVersion, KEY_A)).toThrow(DropboxTokenDecryptionError);
  });

  it("never returns the plaintext token inside the encrypted payload string", () => {
    const plaintext = "super-secret-dummy-refresh-token";
    const encrypted = encryptToken(plaintext, KEY_A);
    expect(encrypted).not.toContain(plaintext);
  });
});
