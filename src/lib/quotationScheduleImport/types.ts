// Phase 9 — WIBA / CPM Schedule Import for Quotation. Shared types for the
// parser modules and the Preview UI. This module never touches Prisma or
// the database — parsing/validation is entirely stateless (see
// wibaParser.ts / cpmParser.ts's own doc comments for why: nothing here
// writes anything; the caller decides what to do with the result).

export type ScheduleRowStatus = "valid" | "error";

// One code per row-level validation failure — the UI (not this module)
// turns a code into a localized "Row N — ..." message, matching the
// existing convention in src/app/(app)/quotation/actions.ts (WIBA_ROW_*/
// CPM_ROW_* error codes translated client-side).
export type WibaRowErrorCode =
  | "OCCUPATION_REQUIRED"
  | "OCCUPATION_TOO_LONG"
  | "BASIC_SALARY_INVALID"
  | "ALLOWANCE_INVALID"
  | "OTHER_EARNINGS_INVALID"
  | "EMPLOYEE_COUNT_INVALID";

export type CpmRowErrorCode = "EQUIPMENT_NAME_REQUIRED" | "EQUIPMENT_NAME_TOO_LONG" | "QUANTITY_INVALID" | "UNIT_VALUE_INVALID";

export type WibaScheduleRow = {
  rowNumber: number; // 1-based Excel row number (for "Row N — ..." messages)
  occupation: string;
  // Kept as strings throughout (never JS float arithmetic on the final
  // persisted value — this module only produces the row-level preview
  // numbers; the actual Decimal recalculation on save happens through the
  // existing prepareWiba()/resolveWibaRowAnnualWages() path once these
  // rows land in WibaDraft, per this phase's approved architecture).
  basicSalary: string;
  allowance: string;
  otherEarnings: string;
  employeeCount: string;
  // System-recalculated — never the workbook's own formula result (Excel
  // columns G/H are read only to confirm the template shape, then
  // discarded; see wibaParser.ts).
  monthlyEarnings: string;
  annualEarnings: string;
  status: ScheduleRowStatus;
  errorCode: WibaRowErrorCode | null;
};

export type CpmScheduleRow = {
  rowNumber: number;
  equipmentName: string;
  chassisOrPlate: string; // "" when blank — optional field, never validated as numeric
  quantity: string;
  unitValue: string;
  // System-recalculated (quantity x unitValue) — never Excel column F's own
  // formula result; see cpmParser.ts.
  totalValue: string;
  status: ScheduleRowStatus;
  errorCode: CpmRowErrorCode | null;
};

export type WibaScheduleTotals = {
  totalEmployees: number;
  totalMonthlyEarnings: number;
  totalAnnualEarnings: number;
};

export type CpmScheduleTotals = {
  totalQuantity: number;
  totalSumInsured: number;
};

export type TemplateParseError = "INVALID_TEMPLATE" | "NO_DATA_ROWS" | "FILE_TOO_LARGE" | "INVALID_FILE_TYPE" | "PARSE_FAILED";

export type WibaScheduleParseResult =
  | { ok: true; rows: WibaScheduleRow[]; totals: WibaScheduleTotals; blankRowsSkipped: number; hasErrors: boolean }
  | { ok: false; error: TemplateParseError };

export type CpmScheduleParseResult =
  | { ok: true; rows: CpmScheduleRow[]; totals: CpmScheduleTotals; blankRowsSkipped: number; hasErrors: boolean }
  | { ok: false; error: TemplateParseError };

// Deliberately small — these are structured schedules (tens to low hundreds
// of rows), not scanned documents; see this phase's report for why this
// isn't wired to an env var like the document-upload constants elsewhere in
// this codebase.
export const MAX_SCHEDULE_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export const OCCUPATION_MAX_LENGTH = 200;
export const EQUIPMENT_NAME_MAX_LENGTH = 200;
