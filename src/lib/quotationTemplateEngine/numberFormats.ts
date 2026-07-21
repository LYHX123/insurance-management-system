// Shared Excel number formats the engine enforces in code, independent of
// whatever numFmt a template cell happens to carry. The template's rate
// cells were audited and standardized to this same format (see the Phase
// "standardize quotation rate formatting" report), but every generated rate
// cell also gets this applied explicitly at write time — the template's
// saved format is never trusted alone, since a future template edit could
// silently reintroduce mixed 0%/0.00%/0.000%/General formatting the same
// way this inconsistency originally crept in.
export const EXCEL_RATE_NUM_FMT = "0.###%";
