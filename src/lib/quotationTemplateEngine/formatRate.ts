// Phase 10 issue 3 — quotation Excel rate/percentage formatting.
//
// Rates in this system follow the "percentage points" convention: the
// number 0.25 means 0.25%, 1 means 1%, 30 means 30%. They used to be
// written as Excel numbers (value / 100) with the custom number format
// "0.###%". That format renders a whole-number percentage as "1." in
// Microsoft Excel — a dangling trailing decimal point — so a 1% rate
// displayed as "1.%" / "2.%". (LibreOffice strips it; Excel does not.)
//
// The fix: build the display string ourselves and write it as text, so the
// output is identical in every viewer. This module is the single reusable
// formatter every rate cell (static + dynamic-row) goes through.

/**
 * Trims a number to a clean decimal string:
 *   1      -> "1"          (never "1." )
 *   2      -> "2"
 *   1.5    -> "1.5"
 *   0.075  -> "0.075"
 *   0.15   -> "0.15"
 *   0.25   -> "0.25"
 *   0.2    -> "0.2"
 *   0.15000000000000002 -> "0.15"   (no floating-point artifacts)
 *
 * Values are rounded to 6 decimal places first (well beyond any real rate
 * precision), then trailing zeros and any trailing "." are removed.
 */
export function trimNumberString(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1e6) / 1e6;
  if (Object.is(rounded, -0) || rounded === 0) return "0";
  let s = rounded.toFixed(6);
  if (s.includes(".")) {
    s = s.replace(/0+$/, "").replace(/\.$/, "");
  }
  return s;
}

/**
 * Formats a rate given in percentage points as a display string with a
 * trailing "%":
 *   formatRatePercent(1)      -> "1%"
 *   formatRatePercent(2)      -> "2%"
 *   formatRatePercent(1.5)    -> "1.5%"
 *   formatRatePercent(0.075)  -> "0.075%"
 *   formatRatePercent(0.25)   -> "0.25%"
 *   formatRatePercent(0.2)    -> "0.2%"
 * Blank / null / non-finite input -> "" (nothing written).
 */
export function formatRatePercent(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "";
  return `${trimNumberString(n)}%`;
}
