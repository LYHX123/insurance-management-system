import { loadInvoiceTemplateWorkbook } from "./loadTemplate";
import { detectTemplateStructure, InvoiceTemplateValidationError } from "./detect";
import { adjustItemRowCapacity } from "./rowSplicing";
import { restoreTemplateDrawings } from "./restoreTemplateDrawings";
import {
  SUPPORTED_HEADER_PLACEHOLDERS,
  ALL_SUPPORTED_PLACEHOLDERS,
  TOTAL_PLACEHOLDER,
  MIN_ITEM_ROWS,
  placeholderToken,
} from "./config";

export type InvoiceExcelItem = {
  policyClass: string;
  policyNumber: string;
  premium: number;
};

export type GenerateInvoiceExcelInput = {
  customerName: string;
  customerPin: string;
  invoiceDate: Date;
  items: InvoiceExcelItem[];
  totalPremium: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatInvoiceDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function formatMoneyText(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Resolves a cell's row number, captured before any row splicing, to its
// final post-splice position — mirrors the merge-shifting logic in
// rowSplicing.ts's reapplyMerges (rows above the item row never move; rows
// at/after the original total row move by delta). Applied to the header
// placeholder cells, which the real template keeps entirely above the item
// row (row 3 vs. item row 5) and therefore never actually need shifting,
// but this keeps the engine correct even if a future template edit moved
// them below the item block.
function resolveShiftedRow(originalRow: number, itemRow: number, originalTotalRow: number, delta: number): number {
  if (originalRow < itemRow) return originalRow;
  if (originalRow >= originalTotalRow) return originalRow + delta;
  return originalRow;
}

// Generates a complete Invoice workbook buffer from the repository template
// (see loadInvoiceTemplateWorkbook) — pure with respect to the filesystem
// beyond reading that one template file; never writes anywhere. Throws
// InvoiceTemplateValidationError if the template's placeholders can't be
// located (see detectTemplateStructure), or a plain Error for any other
// generation failure (e.g. zero items).
export async function generateInvoiceExcelBuffer(input: GenerateInvoiceExcelInput): Promise<Buffer> {
  if (input.items.length === 0) {
    throw new Error("At least one item is required to generate an Invoice workbook");
  }

  const { workbook, worksheet } = await loadInvoiceTemplateWorkbook();
  const structure = detectTemplateStructure(worksheet);

  const columnCount = Math.max(
    worksheet.columnCount,
    structure.itemColumns.itemNo,
    structure.itemColumns.policyClass,
    structure.itemColumns.policyNumber,
    structure.itemColumns.premium,
    structure.totalCell.col
  );

  // At least MIN_ITEM_ROWS formatted rows always show, independent of how
  // many Policies are actually selected (see MIN_ITEM_ROWS's doc comment) —
  // never just input.items.length.
  const displayRowCount = Math.max(MIN_ITEM_ROWS, input.items.length);

  const originalTotalRow = structure.totalRow;
  const { totalRow } = adjustItemRowCapacity(worksheet, structure.itemRow, structure.totalRow, displayRowCount, columnCount);
  const delta = totalRow - originalTotalRow;

  // --- Fill item rows (0..N-1 real, N..displayRowCount-1 blank) ---
  for (let i = 0; i < displayRowCount; i++) {
    const rowNum = structure.itemRow + i;
    const row = worksheet.getRow(rowNum);
    const item = i < input.items.length ? input.items[i] : null;

    row.getCell(structure.itemColumns.itemNo).value = item ? i + 1 : null;
    row.getCell(structure.itemColumns.policyClass).value = item ? item.policyClass : null;

    const numberCell = row.getCell(structure.itemColumns.policyNumber);
    numberCell.value = item ? item.policyNumber : null;
    // Normalizes away a stray numeric format (the shipped template has a
    // leftover "0%" format on this column) — a policy/permit number is
    // always text, never a number, regardless of what format the template
    // cell happened to carry. Left untouched (whatever the template/copied
    // row style already is) for blank rows, since no value is being written.
    if (item) numberCell.numFmt = "General";

    // Blank rows get no value at all (not 0) — an empty numeric cell reads
    // as genuinely blank in Excel, never a displayed "0.00".
    row.getCell(structure.itemColumns.premium).value = item ? round2(item.premium) : null;
  }

  // --- Total ---
  const totalCellObj = worksheet.getRow(totalRow).getCell(structure.totalCell.col);
  if (structure.totalCell.wholeCell) {
    totalCellObj.value = round2(input.totalPremium);
  } else if (typeof totalCellObj.value === "string") {
    totalCellObj.value = totalCellObj.value.split(placeholderToken(TOTAL_PLACEHOLDER)).join(formatMoneyText(input.totalPremium));
  }

  // --- Header placeholders (embedded in surrounding text) ---
  const headerValues: Record<(typeof SUPPORTED_HEADER_PLACEHOLDERS)[number], string> = {
    CUSTOMER_NAME: input.customerName,
    CUSTOMER_PIN: input.customerPin,
    INVOICE_DATE: formatInvoiceDate(input.invoiceDate),
  };
  for (const token of SUPPORTED_HEADER_PLACEHOLDERS) {
    for (const match of structure.headerCells[token]) {
      const finalRow = resolveShiftedRow(match.row, structure.itemRow, originalTotalRow, delta);
      const cell = worksheet.getRow(finalRow).getCell(match.col);
      if (typeof cell.value === "string") {
        cell.value = cell.value.split(placeholderToken(token)).join(headerValues[token]);
      }
    }
  }

  // --- Safety net: no supported placeholder token may remain anywhere ---
  const leftover: string[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value !== "string") return;
      for (const token of ALL_SUPPORTED_PLACEHOLDERS) {
        if (cell.value.includes(placeholderToken(token))) leftover.push(`${placeholderToken(token)} at ${cell.address}`);
      }
    });
  });
  if (leftover.length > 0) {
    throw new InvoiceTemplateValidationError([`Unresolved placeholders remained after generation: ${leftover.join(", ")}`]);
  }

  const rawBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
  // ExcelJS's writer drops the company-name/address text-box shape from
  // xl/drawings/drawing1.xml on round-trip (see restoreTemplateDrawings's
  // doc comment) — restored from the original template's own bytes here,
  // never re-created/guessed.
  return restoreTemplateDrawings(rawBuffer);
}
