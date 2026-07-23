// Historical-import normalization helpers for Phase 1A Motor. Every rule
// here is backed by the actual BUSINESS RECORD(MOTOR) workbook inspection
// (1,436 real data rows) — see the Phase 1A completion report for the exact
// counts each rule is based on, rather than a guessed/generic Excel importer.

// Excel's epoch (1900 date system) with the well-known leap-year bug offset
// — same conversion ExcelJS itself does not perform for numeric serials
// (only for cells it recognizes as date-formatted). Handles both a real
// exceljs Date object (already-parsed date cells) and a bare numeric serial.
export function excelValueToDate(value: unknown): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

// Handles thousands-separator commas and a "KES"/"Ksh" prefix or suffix —
// both appear in free-text remarks in the source data (e.g. "TPO Excess
// 30000Ksh"), and defensively for any amount cell entered as text rather
// than a number. Returns null (not 0) for blank so callers can tell "no
// value" apart from "zero".
export function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value)
    .replace(/,/g, "")
    .replace(/kes|ksh/gi, "")
    .trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export type BalanceWarningReason = "BROKEN_SOURCE_FORMULA" | "BLANK_SOURCE_BALANCE" | "OTHER_UNREADABLE_BALANCE";

export type ParsedBalanceCell = {
  parsed: number | null;
  raw: string | null;
  reason: BalanceWarningReason | null;
};

// Parses a historical ACCOUNT PAYABLE / ACCOUNTS RECEIVABLE cell, keeping
// the raw source text and a specific failure reason whenever the value
// can't be trusted — this phase's inspection found exactly two rows (587,
// 1411) where this matters: one has a broken self-referencing formula
// ("J587-J587", no cached result), one is a genuinely blank cell. Both must
// surface as UNVERIFIED rather than silently defaulting to "no balance
// issue" (see PolicyBalanceVerificationStatus's schema comment) — takes the
// UNPROCESSED exceljs cell value (before the generic resultOf() collapsing
// used everywhere else), since only the raw shape lets us tell "blank" apart
// from "formula with no result" apart from "a real, readable number".
export function parseBalanceCell(rawCellValue: unknown): ParsedBalanceCell {
  if (rawCellValue === null || rawCellValue === undefined || rawCellValue === "") {
    return { parsed: null, raw: null, reason: "BLANK_SOURCE_BALANCE" };
  }
  if (typeof rawCellValue === "object" && "formula" in (rawCellValue as object)) {
    const formulaCell = rawCellValue as { formula: string; result?: unknown };
    if ("result" in formulaCell && formulaCell.result !== undefined && formulaCell.result !== null) {
      const n = parseAmount(formulaCell.result);
      if (n !== null) return { parsed: n, raw: String(formulaCell.result), reason: null };
      return { parsed: null, raw: String(formulaCell.result), reason: "OTHER_UNREADABLE_BALANCE" };
    }
    // A formula exists but produced no cached result at all — e.g. a
    // self-referencing formula Excel could never actually evaluate.
    return { parsed: null, raw: formulaCell.formula, reason: "BROKEN_SOURCE_FORMULA" };
  }
  const n = parseAmount(rawCellValue);
  if (n !== null) return { parsed: n, raw: String(rawCellValue), reason: null };
  return { parsed: null, raw: String(rawCellValue), reason: "OTHER_UNREADABLE_BALANCE" };
}

// COMMISSION (column R) values found: null (97%), a full-width space "　"
// (whitespace-only, functionally blank), "YES"/"Y" (true), "N" (false), and
// a bare rate like 0.12 (4 rows — a real commission rate was entered instead
// of a yes/no flag). Phase 1A only tracks a boolean + date (see
// PolicyRecord.commissionReceived's schema comment) — a populated rate is
// treated as "yes, commission was received" without importing the rate
// itself, which is exactly what the import preview's warning surfaces.
export function normalizeCommissionReceived(value: unknown): { received: boolean; wasRateValue: boolean } {
  if (typeof value === "number") return { received: value > 0, wasRateValue: true };
  const str = String(value ?? "").trim();
  if (!str) return { received: false, wasRateValue: false };
  const upper = str.toUpperCase();
  if (upper === "YES" || upper === "Y") return { received: true, wasRateValue: false };
  if (upper === "N" || upper === "NO") return { received: false, wasRateValue: false };
  return { received: false, wasRateValue: false };
}

// Company-suffix synonyms seen across real customer records vs the
// historical workbook's client names (e.g. "...KENYA LTD" in the workbook
// vs "...Kenya Limited" as the actual Customer record) — a plain
// trim+uppercase pass alone does not bridge these, so the "possible match"
// tier normalizes known abbreviations before comparing.
const SUFFIX_SYNONYMS: [RegExp, string][] = [
  [/\bLIMITED\b/g, "LTD"],
  [/\bCOMPANY\b/g, "CO"],
  [/\bINTERNATIONAL\b/g, "INTL"],
  [/\bCORPORATION\b/g, "CORP"],
  [/\bGROUP\b/g, "GRP"],
];

export function normalizeCustomerNameStrict(name: unknown): string {
  return String(name ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

// A looser normalization used only for the "possible match" tier — never
// for "matched" (exact), which always uses normalizeCustomerNameStrict.
export function normalizeCustomerNameLoose(name: unknown): string {
  let s = normalizeCustomerNameStrict(name).replace(/[.,()]/g, "");
  for (const [pattern, replacement] of SUFFIX_SYNONYMS) s = s.replace(pattern, replacement);
  return s.replace(/\s+/g, " ").trim();
}
