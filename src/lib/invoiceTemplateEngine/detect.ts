import ExcelJS from "exceljs";
import {
  SUPPORTED_ITEM_PLACEHOLDERS,
  SUPPORTED_HEADER_PLACEHOLDERS,
  TOTAL_PLACEHOLDER,
  placeholderToken,
} from "./config";
import type { CellRef } from "./cellRange";

export class InvoiceTemplateValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invoice template is invalid: ${issues.join("; ")}`);
    this.name = "InvoiceTemplateValidationError";
  }
}

type TokenMatch = CellRef & { wholeCell: boolean };

export type InvoiceTemplateStructure = {
  itemRow: number;
  itemColumns: { itemNo: number; policyClass: number; policyNumber: number; premium: number };
  totalRow: number;
  totalCell: TokenMatch;
  headerCells: Record<(typeof SUPPORTED_HEADER_PLACEHOLDERS)[number], TokenMatch[]>;
};

// Detects the template's structure by SCANNING cell contents for the
// supported {{TOKEN}} placeholders, rather than trusting hardcoded cell
// addresses — per this phase's spec ("do not rely on ten fixed rows", "the
// row containing [the four item placeholders] is the repeatable item row"),
// since this template's exact layout is user-edited and not something this
// codebase should hardcode. This also means the engine keeps working if the
// user repositions rows/columns later, as long as the same tokens are used.
export function detectTemplateStructure(worksheet: ExcelJS.Worksheet): InvoiceTemplateStructure {
  const matches = new Map<string, TokenMatch[]>();
  for (const token of [...SUPPORTED_ITEM_PLACEHOLDERS, ...SUPPORTED_HEADER_PLACEHOLDERS, TOTAL_PLACEHOLDER]) {
    matches.set(token, []);
  }

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (typeof cell.value !== "string") return;
      const text = cell.value;
      for (const [token, list] of matches) {
        const needle = placeholderToken(token);
        if (text.includes(needle)) {
          list.push({ row: rowNumber, col: colNumber, wholeCell: text.trim() === needle });
        }
      }
    });
  });

  const issues: string[] = [];

  // --- Item template row: all four item placeholders, each exactly one
  // whole-cell match, all sharing the same row.
  const itemMatchesByToken: Record<string, TokenMatch[]> = {};
  for (const token of SUPPORTED_ITEM_PLACEHOLDERS) {
    const found = (matches.get(token) ?? []).filter((m) => m.wholeCell);
    itemMatchesByToken[token] = found;
    if (found.length === 0) issues.push(`Missing item placeholder ${placeholderToken(token)}`);
    else if (found.length > 1) issues.push(`Item placeholder ${placeholderToken(token)} appears in more than one cell`);
  }
  let itemRow: number | null = null;
  if (issues.length === 0) {
    const rows = new Set(SUPPORTED_ITEM_PLACEHOLDERS.map((t) => itemMatchesByToken[t][0].row));
    if (rows.size !== 1) {
      issues.push(
        `The four item placeholders (${SUPPORTED_ITEM_PLACEHOLDERS.map(placeholderToken).join(", ")}) must all be in the same row — found in rows ${[...rows].join(", ")}`
      );
    } else {
      itemRow = [...rows][0];
    }
  }

  // --- Total placeholder
  const totalMatches = matches.get(TOTAL_PLACEHOLDER) ?? [];
  if (totalMatches.length === 0) issues.push(`Missing total placeholder ${placeholderToken(TOTAL_PLACEHOLDER)}`);
  else if (totalMatches.length > 1) issues.push(`Total placeholder ${placeholderToken(TOTAL_PLACEHOLDER)} appears in more than one cell`);
  const totalCell = totalMatches.length === 1 ? totalMatches[0] : null;
  if (itemRow !== null && totalCell && totalCell.row <= itemRow) {
    issues.push(`Total placeholder ${placeholderToken(TOTAL_PLACEHOLDER)} must be in a row below the item row`);
  }

  // --- Header placeholders (embedded in surrounding text — CUSTOMER_NAME,
  // CUSTOMER_PIN, INVOICE_DATE) — at least one occurrence each.
  const headerCells = {} as Record<(typeof SUPPORTED_HEADER_PLACEHOLDERS)[number], TokenMatch[]>;
  for (const token of SUPPORTED_HEADER_PLACEHOLDERS) {
    const found = matches.get(token) ?? [];
    headerCells[token] = found;
    if (found.length === 0) issues.push(`Missing header placeholder ${placeholderToken(token)}`);
  }

  if (issues.length > 0 || itemRow === null || !totalCell) {
    throw new InvoiceTemplateValidationError(issues.length > 0 ? issues : ["Unable to determine template structure"]);
  }

  return {
    itemRow,
    itemColumns: {
      itemNo: itemMatchesByToken.ITEM_NO[0].col,
      policyClass: itemMatchesByToken.POLICY_CLASS[0].col,
      policyNumber: itemMatchesByToken.POLICY_NUMBER[0].col,
      premium: itemMatchesByToken.PREMIUM[0].col,
    },
    totalRow: totalCell.row,
    totalCell,
    headerCells,
  };
}
