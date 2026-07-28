// Content-Disposition header values are ByteStrings (Latin-1 only) in the
// Fetch/undici Headers implementation Next.js uses — any raw filename with a
// codepoint above 255 (e.g. Chinese, emoji) throws
// "Cannot convert argument to a ByteString" at response-construction time.
// This builds an RFC 6266 header with an ASCII-safe `filename` fallback plus
// an RFC 5987 `filename*=UTF-8''...` parameter that carries the exact
// original name, so browsers that support the extended parameter (all
// current ones) show/save the real Unicode filename.

export type ContentDispositionMode = "inline" | "attachment";

const DEFAULT_FALLBACK_FILENAME = "document.pdf";

function stripControlChars(value: string): string {
  return value.replace(/[\x00-\x1F\x7F]/g, "");
}

function escapeQuotedString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// RFC 5987 attr-char is stricter than encodeURIComponent's unreserved set
// (it excludes ' ( ) *), so those four are percent-encoded on top of the
// normal encodeURIComponent output. Over-encoding other attr-chars is valid
// too — pct-encoded octets are always legal in value-chars.
function encodeRFC5987ValueChars(value: string): string {
  return encodeURIComponent(value)
    .replace(/['()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/\*/g, "%2A");
}

function toAsciiSafeFilename(cleaned: string, fallback: string): string {
  let ascii = cleaned.replace(/[^\x20-\x7E]/g, "_");
  ascii = ascii.replace(/_+/g, "_").trim();

  if (!ascii || /^[_.]+$/.test(ascii)) {
    return fallback;
  }

  // Name collapsed down to (at most) an extension, e.g. an all-CJK
  // basename — keep the real extension but give it a deterministic stem.
  const extOnly = /^_?(\.[A-Za-z0-9]{1,15})$/.exec(ascii);
  if (extOnly) {
    return `document${extOnly[1]}`;
  }

  return ascii;
}

export function buildContentDisposition(params: {
  mode: ContentDispositionMode;
  filename: string;
  fallbackFilename?: string;
}): string {
  const fallback = params.fallbackFilename?.trim() || DEFAULT_FALLBACK_FILENAME;
  const cleaned = stripControlChars(params.filename ?? "").trim();
  const asciiName = toAsciiSafeFilename(cleaned, fallback);

  let header = `${params.mode}; filename="${escapeQuotedString(asciiName)}"`;
  if (cleaned.length > 0) {
    header += `; filename*=UTF-8''${encodeRFC5987ValueChars(cleaned)}`;
  }
  return header;
}
