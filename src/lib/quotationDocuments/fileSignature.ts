// Server-side file-signature (magic-byte) sniffing. Filename and
// browser-supplied MIME type are both attacker-controlled, so neither is
// trusted alone (see constants.ts's ALLOWED_DOCUMENT_TYPES check, which
// only validates the *claim*) — this validates the actual bytes.
//
// Deliberately hand-rolled rather than pulling in a file-signature npm
// package: the allowlist is small and fixed (Phase 2 never accepts
// arbitrary formats), so a few known byte prefixes cover every case with no
// new dependency.

const SIGNATURES: Record<string, (buf: Buffer) => boolean> = {
  ".pdf": (b) => b.subarray(0, 4).toString("latin1") === "%PDF",
  ".png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  ".jpg": (b) => b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  ".jpeg": (b) => b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  ".webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  // OOXML (xlsx/docx) is a zip container: PK\x03\x04 (or the empty-archive
  // variant PK\x05\x06, vanishingly rare for a real document but valid zip).
  ".xlsx": (b) => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
  ".docx": (b) => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
  // Legacy OLE compound format (xls/doc).
  ".xls": (b) => b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
  ".doc": (b) => b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
  // CSV/TXT have no binary magic number — validated instead by rejecting
  // content that looks like something else entirely (see looksDangerous).
  ".csv": () => true,
  ".txt": () => true,
};

// Signatures that must NEVER be accepted, regardless of claimed extension —
// executables, scripts, and HTML, even if someone renames them to .pdf.
const DANGEROUS_SIGNATURES: { name: string; test: (buf: Buffer) => boolean }[] = [
  { name: "Windows executable", test: (b) => b.subarray(0, 2).toString("latin1") === "MZ" },
  { name: "ELF executable", test: (b) => b.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) },
  { name: "shebang script", test: (b) => b.subarray(0, 2).toString("latin1") === "#!" },
  {
    name: "HTML document",
    test: (b) => /^\s*(<!doctype html|<html|<script)/i.test(b.subarray(0, 512).toString("latin1")),
  },
];

export function looksDangerous(buffer: Buffer): string | null {
  const found = DANGEROUS_SIGNATURES.find((sig) => sig.test(buffer));
  return found ? found.name : null;
}

/** True if `buffer`'s actual bytes match what `ext` claims to be. */
export function matchesFileSignature(ext: string, buffer: Buffer): boolean {
  const check = SIGNATURES[ext.toLowerCase()];
  if (!check) return false;
  try {
    return check(buffer);
  } catch {
    return false;
  }
}
