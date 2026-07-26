import ExcelJS from "exceljs";
import { parseRange, shiftRangeRows, cellAddress, type RangeRef } from "./cellRange";

// ExcelJS's spliceRows has a documented tendency to corrupt large single
// splices near the end of a sheet (the same issue this codebase already
// worked around in the Quotation template engine — see
// src/lib/quotationTemplateEngine/removeUnusedSections.ts) — chunking every
// insert/delete into batches of at most 5 rows avoids it. Invoice's row
// counts are far smaller than Quotation's, but the insertion point (right
// before the TOTAL row, near the sheet's tail) is exactly the situation
// that triggers it, so the same defensive chunking is used here.
const SPLICE_CHUNK_SIZE = 5;

function deleteRowsChunked(worksheet: ExcelJS.Worksheet, start: number, count: number): void {
  let remaining = count;
  while (remaining > 0) {
    const chunk = Math.min(SPLICE_CHUNK_SIZE, remaining);
    worksheet.spliceRows(start, chunk);
    remaining -= chunk;
  }
}

function insertBlankRowsChunked(worksheet: ExcelJS.Worksheet, start: number, count: number): void {
  let inserted = 0;
  while (inserted < count) {
    const chunk = Math.min(SPLICE_CHUNK_SIZE, count - inserted);
    const blankRows = Array.from({ length: chunk }, () => [] as unknown[]);
    worksheet.spliceRows(start + inserted, 0, ...blankRows);
    inserted += chunk;
  }
}

// Copies font/border/fill/alignment/numFmt + row height from sourceRow into
// targetRow for columns 1..columnCount — used to give newly-inserted rows
// the item template row's exact formatting (spliced-in blank rows carry no
// style of their own). Explicitly rebinds each target cell's `.style` to a
// fresh object first — ExcelJS cells loaded from a workbook can share the
// same underlying style object reference across multiple cells, so mutating
// one in place can silently restyle unrelated cells that happen to share
// it (the same gotcha documented in
// src/lib/quotationTemplateEngine/boldFont.ts).
export function copyRowStyle(worksheet: ExcelJS.Worksheet, sourceRowNumber: number, targetRowNumber: number, columnCount: number): void {
  if (sourceRowNumber === targetRowNumber) return;
  const sourceRow = worksheet.getRow(sourceRowNumber);
  const targetRow = worksheet.getRow(targetRowNumber);
  targetRow.height = sourceRow.height;
  for (let c = 1; c <= columnCount; c++) {
    const sourceCell = sourceRow.getCell(c);
    const targetCell = targetRow.getCell(c);
    targetCell.style = { ...targetCell.style };
    targetCell.font = { ...sourceCell.font };
    targetCell.border = { ...sourceCell.border };
    targetCell.fill = sourceCell.fill;
    targetCell.alignment = { ...sourceCell.alignment };
    targetCell.numFmt = sourceCell.numFmt;
  }
}

export type MergeShiftPlan = {
  itemRow: number;
  totalRow: number;
  itemCount: number;
  delta: number;
  columnCount: number;
};

// Re-applies the worksheet's original merged ranges after a row
// insertion/deletion, since ExcelJS does not shift `worksheet.model.merges`
// row numbers on `spliceRows` (a confirmed limitation already documented and
// worked around in the Quotation template engine). Every merge is
// classified once against the plan:
//   - entirely above the item row: unaffected, restored exactly as-is.
//   - starting exactly at the item row (e.g. a merged placeholder cell
//     within the template row itself): duplicated across every actual item
//     row, at the same columns.
//   - starting at or after the original total row: shifted by `delta` (the
//     TOTAL row and everything below it, e.g. the bank-details block, move
//     together as one block).
//   - anything strictly between the item row and the total row that isn't
//     the item row itself (not present in the shipped template, but handled
//     defensively): shifted by `delta` like the trailing block.
export function reapplyMerges(worksheet: ExcelJS.Worksheet, originalMerges: string[], plan: MergeShiftPlan): void {
  for (const range of originalMerges) {
    const parsed = parseRange(range);
    if (parsed.startRow < plan.itemRow) {
      mergeRange(worksheet, parsed);
    } else if (parsed.startRow === plan.itemRow) {
      for (let i = 0; i < plan.itemCount; i++) {
        mergeRange(worksheet, shiftRangeRows(parsed, i));
      }
    } else {
      mergeRange(worksheet, shiftRangeRows(parsed, plan.delta));
    }
  }
}

function mergeRange(worksheet: ExcelJS.Worksheet, range: RangeRef): void {
  if (range.startRow === range.endRow && range.startCol === range.endCol) return; // not actually a merge
  worksheet.mergeCells(`${cellAddress({ row: range.startRow, col: range.startCol })}:${cellAddress({ row: range.endRow, col: range.endCol })}`);
}

// Resizes the sheet's item-row capacity (rows [itemRow, totalRow)) to
// exactly `itemCount` rows, moving the TOTAL row and everything below it
// down/up accordingly, and gives every newly-created row the item template
// row's formatting. Returns the new (possibly unchanged) total row number.
export function adjustItemRowCapacity(
  worksheet: ExcelJS.Worksheet,
  itemRow: number,
  totalRow: number,
  itemCount: number,
  columnCount: number
): { totalRow: number } {
  const capacity = totalRow - itemRow;
  const delta = itemCount - capacity;
  if (delta === 0) return { totalRow };

  const originalMerges = [...worksheet.model.merges] as string[];
  for (const range of originalMerges) worksheet.unMergeCells(range);

  if (delta < 0) {
    deleteRowsChunked(worksheet, itemRow + itemCount, -delta);
  } else {
    insertBlankRowsChunked(worksheet, totalRow, delta);
    for (let i = 0; i < delta; i++) {
      copyRowStyle(worksheet, itemRow, totalRow + i, columnCount);
    }
  }

  reapplyMerges(worksheet, originalMerges, { itemRow, totalRow, itemCount, delta, columnCount });

  return { totalRow: totalRow + delta };
}
