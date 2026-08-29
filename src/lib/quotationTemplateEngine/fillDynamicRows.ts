// Writes the actual dynamic-row values (WIBA payroll, CPM equipment, Marine
// shipments, Customs Bond items) into the row range removeUnusedSections.ts
// already resized to match. Every data row's formatting is copied fresh
// from the template row (font/border/fill/alignment/numFmt/row height) so
// it never depends on whether the template's reserved blank rows happened
// to already carry matching styles.

import type ExcelJS from "exceljs";
import type { MappedSection, PlaceholderValues } from "./mapQuotationData";
import type { SectionConfig, SectionLayout } from "./types";
import { resolveFinalRow } from "./removeUnusedSections";
import { setBoldCellValue } from "./boldFont";
import { formatRatePercent } from "./formatRate";

function copyRowFormatting(worksheet: ExcelJS.Worksheet, sourceRowNumber: number, targetRowNumber: number) {
  if (sourceRowNumber === targetRowNumber) return;
  const sourceRow = worksheet.getRow(sourceRowNumber);
  const targetRow = worksheet.getRow(targetRowNumber);
  targetRow.height = sourceRow.height;
  for (let c = 1; c <= 5; c++) {
    const sourceCell = sourceRow.getCell(c);
    const targetCell = targetRow.getCell(c);
    // ExcelJS gives cells that had identical original formatting a SHARED
    // style object reference — mutating targetCell's style properties
    // without decoupling first would silently reformat every other cell
    // that happens to share targetCell's original (pre-copy) style. See
    // boldFont.ts's setBoldCellValue doc comment for the confirmed repro.
    targetCell.style = { ...targetCell.style };
    targetCell.font = { ...sourceCell.font };
    targetCell.border = { ...sourceCell.border };
    targetCell.fill = sourceCell.fill;
    targetCell.alignment = { ...sourceCell.alignment };
    targetCell.numFmt = sourceCell.numFmt;
  }
}

function writeCellValue(cell: ExcelJS.Cell, value: PlaceholderValues[string]) {
  if (value === null || value === undefined || value === "") {
    cell.value = null;
    return;
  }
  setBoldCellValue(cell, value as string | number | boolean);
}

export function fillDynamicRows(
  worksheet: ExcelJS.Worksheet,
  section: SectionConfig,
  layout: SectionLayout,
  mapped: MappedSection
): void {
  if (!section.dynamicRow) return;
  const rows = mapped.dynamicRows ?? [];
  const rowsPerEntry = section.dynamicRow.rowsPerEntry ?? 1;
  const templateRowFinal = resolveFinalRow(section, layout, section.dynamicRow.templateRow);

  // The template's own block (dataStart .. dataStart + rowsPerEntry - 1) is
  // both the formatting SOURCE for every block instance and, for i === 0,
  // its own target — copyRowFormatting's same-row guard makes that a no-op,
  // so the first entry always uses the template's rows exactly as-is.
  const dataStart = layout.dynamicDataStartRow ?? templateRowFinal;
  for (let i = 0; i < rows.length; i++) {
    const blockStart = dataStart + i * rowsPerEntry;
    const touchedRows = new Set<number>();

    for (let offset = 0; offset < rowsPerEntry; offset++) {
      copyRowFormatting(worksheet, dataStart + offset, blockStart + offset);
      touchedRows.add(blockStart + offset);
    }

    for (const label of section.dynamicRow.blockLabels ?? []) {
      worksheet.getRow(blockStart + label.rowOffset).getCell(label.column).value = label.text;
      touchedRows.add(blockStart + label.rowOffset);
    }

    for (const col of section.dynamicRow.columns) {
      const targetRow = worksheet.getRow(blockStart + (col.rowOffset ?? 0));
      const cell = targetRow.getCell(col.column);
      const raw = rows[i][col.name];
      if (col.kind === "rate" && raw !== null && raw !== undefined && raw !== "") {
        // App convention: the mapped value is in percentage points (0.35 =
        // 0.35%). Written as a pre-formatted string ("0.35%") for the same
        // reason as replaceVariables.ts's static "rate" case — Excel's
        // "0.###%" format renders a whole number as "1." (Phase 10 issue 3)
        // and also leaks float artifacts (0.0034999999%). setBoldCellValue
        // has already decoupled this cell's style, so forcing numFmt to text
        // and preserving the numeric right-alignment is safe here.
        setBoldCellValue(cell, formatRatePercent(Number(raw)));
        cell.numFmt = "@";
        if (!cell.alignment || !cell.alignment.horizontal) {
          cell.alignment = { ...cell.alignment, horizontal: "right" };
        }
      } else {
        writeCellValue(cell, raw);
      }
      touchedRows.add(blockStart + (col.rowOffset ?? 0));
    }

    for (const rowNumber of touchedRows) worksheet.getRow(rowNumber).commit();
  }
}
