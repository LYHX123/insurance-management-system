import { describe, it, expect } from "vitest";
import { buildContentDisposition } from "../contentDisposition";

// Decodes the filename*=UTF-8''... parameter the way a standards-compliant
// browser would (RFC 5987/6266), so tests can assert the original Unicode
// name round-trips exactly.
function decodeFilenameStar(header: string): string | null {
  const match = /filename\*=UTF-8''([^;]+)/.exec(header);
  return match ? decodeURIComponent(match[1]) : null;
}

function decodeAsciiFilename(header: string): string | null {
  const match = /filename="((?:[^"\\]|\\.)*)"/.exec(header);
  if (!match) return null;
  return match[1].replace(/\\(["\\])/g, "$1");
}

// The real bug: Headers/Response in Next.js (undici) throw when a header
// value contains a codepoint above 255. Constructing a real Headers object
// is the most direct way to prove the fix actually prevents the crash.
function assertHeaderConstructionSucceeds(value: string) {
  expect(() => new Headers({ "Content-Disposition": value })).not.toThrow();
}

describe("buildContentDisposition", () => {
  it("Chinese filename: does not throw and preserves the name via filename*", () => {
    const original = "中铁七局注册已公证文件.pdf";
    const header = buildContentDisposition({ mode: "attachment", filename: original });

    assertHeaderConstructionSucceeds(header);
    expect(header.startsWith("attachment;")).toBe(true);
    expect(header).toMatch(/filename\*=UTF-8''/);
    expect(decodeFilenameStar(header)).toBe(original);
    // ASCII fallback must preserve the extension even though the whole
    // basename was non-ASCII.
    expect(decodeAsciiFilename(header)).toBe("document.pdf");
  });

  it("English filename: passes through unchanged and still exposes filename*", () => {
    const original = "Registration Certificate.pdf";
    const header = buildContentDisposition({ mode: "inline", filename: original });

    assertHeaderConstructionSucceeds(header);
    expect(header.startsWith("inline;")).toBe(true);
    expect(decodeAsciiFilename(header)).toBe(original);
    expect(decodeFilenameStar(header)).toBe(original);
  });

  it("Mixed filename: ASCII fallback keeps Latin parts, filename* preserves everything", () => {
    const original = "China中铁PIN证书.pdf";
    const header = buildContentDisposition({ mode: "attachment", filename: original });

    assertHeaderConstructionSucceeds(header);
    expect(decodeFilenameStar(header)).toBe(original);
    const ascii = decodeAsciiFilename(header)!;
    expect(/^[\x20-\x7E]*$/.test(ascii)).toBe(true);
    expect(ascii).toContain("China");
    expect(ascii).toContain("PIN");
    expect(ascii.endsWith(".pdf")).toBe(true);
  });

  it("filename with spaces is preserved in both parts", () => {
    const original = "Annual Report 2026 Final.pdf";
    const header = buildContentDisposition({ mode: "attachment", filename: original });

    assertHeaderConstructionSucceeds(header);
    expect(decodeAsciiFilename(header)).toBe(original);
    expect(decodeFilenameStar(header)).toBe(original);
  });

  it("filename with an apostrophe is preserved and safely quoted", () => {
    const original = "Director's PIN.pdf";
    const header = buildContentDisposition({ mode: "attachment", filename: original });

    assertHeaderConstructionSucceeds(header);
    expect(decodeAsciiFilename(header)).toBe(original);
    expect(decodeFilenameStar(header)).toBe(original);
  });

  it("filename with quotation marks is escaped in the quoted-string and recoverable from filename*", () => {
    const original = 'My "Signed" Report.pdf';
    const header = buildContentDisposition({ mode: "attachment", filename: original });

    assertHeaderConstructionSucceeds(header);
    // The raw header must never contain an unescaped quote inside the value.
    expect(header).toContain('filename="My \\"Signed\\" Report.pdf"');
    expect(decodeAsciiFilename(header)).toBe(original);
    expect(decodeFilenameStar(header)).toBe(original);
  });

  it("CR/LF injection attempt is neutralized, no injected header survives", () => {
    const malicious = 'evil.pdf"\r\nX-Injected: 1\r\nSet-Cookie: a=b';
    const header = buildContentDisposition({ mode: "attachment", filename: malicious });

    assertHeaderConstructionSucceeds(header);
    // No literal CR/LF anywhere in the value — the attempted header lines
    // collapse into harmless text inside the filename, never a real header.
    expect(header).not.toMatch(/[\r\n]/);
    const res = new Response(null, { headers: { "Content-Disposition": header } });
    expect(res.headers.get("Content-Disposition")).not.toMatch(/[\r\n]/);
    // The only header actually present is Content-Disposition itself — no
    // X-Injected or Set-Cookie header was created.
    expect(res.headers.has("x-injected")).toBe(false);
    expect(res.headers.has("set-cookie")).toBe(false);
    expect(Array.from(res.headers.keys())).toEqual(["content-disposition"]);
  });

  it("filename with slash or backslash does not break the header and is recoverable", () => {
    const original = "Reports/2026\\Q1 Summary.pdf";
    const header = buildContentDisposition({ mode: "attachment", filename: original });

    assertHeaderConstructionSucceeds(header);
    expect(decodeFilenameStar(header)).toBe(original);
    // Backslash must be escaped inside the quoted-string per RFC 2616 grammar.
    expect(decodeAsciiFilename(header)).toBe(original);
  });

  it("filename with emoji / non-Latin Unicode round-trips via filename*", () => {
    const original = "🎉Celebration Invite 招待状.pdf";
    const header = buildContentDisposition({ mode: "inline", filename: original });

    assertHeaderConstructionSucceeds(header);
    expect(decodeFilenameStar(header)).toBe(original);
    expect(/^[\x20-\x7E]*$/.test(decodeAsciiFilename(header)!)).toBe(true);
  });

  it("blank filename falls back to a deterministic ASCII name, no filename* emitted", () => {
    const header = buildContentDisposition({ mode: "attachment", filename: "   " });

    assertHeaderConstructionSucceeds(header);
    expect(decodeAsciiFilename(header)).toBe("document.pdf");
    expect(header).not.toMatch(/filename\*=/);
  });

  it("malformed filename (only dots/control chars) falls back safely", () => {
    const header = buildContentDisposition({ mode: "attachment", filename: "....\x00\x01" });

    assertHeaderConstructionSucceeds(header);
    expect(decodeAsciiFilename(header)).toBe("document.pdf");
  });

  it("honors a custom fallbackFilename for blank input", () => {
    const header = buildContentDisposition({ mode: "attachment", filename: "", fallbackFilename: "quotation.xlsx" });

    expect(decodeAsciiFilename(header)).toBe("quotation.xlsx");
  });

  it("inline vs attachment mode is reflected exactly", () => {
    const inlineHeader = buildContentDisposition({ mode: "inline", filename: "a.pdf" });
    const attachmentHeader = buildContentDisposition({ mode: "attachment", filename: "a.pdf" });

    expect(inlineHeader.startsWith("inline;")).toBe(true);
    expect(attachmentHeader.startsWith("attachment;")).toBe(true);
  });

  it("never places a raw codepoint above 255 in the header string outside the pct-encoded filename* value", () => {
    const original = "中铁七局注册已公证文件.pdf";
    const header = buildContentDisposition({ mode: "attachment", filename: original });
    const withoutStarValue = header.replace(/filename\*=UTF-8''[^;]+/, "filename*=UTF-8''<encoded>");

    for (let i = 0; i < withoutStarValue.length; i++) {
      expect(withoutStarValue.charCodeAt(i)).toBeLessThanOrEqual(255);
    }
  });
});
