// Phase 9 — WIBA / CPM Schedule Import. Small, dependency-free numeric/text
// parsing helpers shared by wibaParser.ts and cpmParser.ts. Deliberately not
// the same functions as quotation/actions.ts's parseRequiredNonNegative
// (Decimal-based, private to that file) — these operate on raw Excel cell
// values (number | string | null) and return a plain ok/value result the
// row-level parsers turn into a specific error code.

export type ParseResult<T> = { ok: true; value: T } | { ok: false };

function toNumber(raw: string | number | null): number | null {
  if (raw === null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function isCellBlank(raw: string | number | null): boolean {
  return raw === null || (typeof raw === "string" && raw.trim() === "");
}

export function parseRequiredText(raw: string | number | null, maxLength: number): ParseResult<string> {
  const text = raw === null ? "" : String(raw).trim();
  if (!text) return { ok: false };
  if (text.length > maxLength) return { ok: false };
  return { ok: true, value: text };
}

export function parseOptionalText(raw: string | number | null): string {
  const text = raw === null ? "" : String(raw).trim();
  return text;
}

// required, numeric, >= 0
export function parseRequiredNonNegativeNumber(raw: string | number | null): ParseResult<number> {
  if (isCellBlank(raw)) return { ok: false };
  const n = toNumber(raw);
  if (n === null || n < 0) return { ok: false };
  return { ok: true, value: n };
}

// optional — blank => 0, numeric, >= 0
export function parseOptionalNonNegativeNumber(raw: string | number | null): ParseResult<number> {
  if (isCellBlank(raw)) return { ok: true, value: 0 };
  const n = toNumber(raw);
  if (n === null || n < 0) return { ok: false };
  return { ok: true, value: n };
}

// required, integer, > 0
export function parseRequiredPositiveInt(raw: string | number | null): ParseResult<number> {
  if (isCellBlank(raw)) return { ok: false };
  const n = toNumber(raw);
  if (n === null || !Number.isInteger(n) || n <= 0) return { ok: false };
  return { ok: true, value: n };
}
