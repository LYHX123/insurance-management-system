// Redraws a continuous medium/black outer border around the printed
// quotation table after removeUnusedSections.ts has finished deleting and
// inserting rows. The template's own per-section borders mostly survive row
// splicing, but dynamic-row insertion (worksheet.spliceRows with blank row
// objects — see fillDynamicRows.ts) adds rows with no border at all, and
// deleting the last section can leave whatever row now happens to be last
// without a bottom edge. This pass only ever ADDS the four outer edges; it
// never touches a cell's other border sides, so existing internal thin
// borders are left exactly as the template/section-fill logic set them.
import type ExcelJS from "exceljs";
import { TEMPLATE_CONFIG } from "./config";

// argb black — visually identical to the template's own border color
// ({ indexed: 64 }, the standard palette's "Automatic" black), but ExcelJS's
// Color type only declares `argb`, not `indexed`.
const OUTER_EDGE: Partial<ExcelJS.Border> = { style: "medium", color: { argb: "FF000000" } };

export function applyOuterBorder(worksheet: ExcelJS.Worksheet): void {
  const firstRow = TEMPLATE_CONFIG.contentAreaFirstRow;
  const firstCol = TEMPLATE_CONFIG.contentAreaFirstCol;
  const lastCol = TEMPLATE_CONFIG.contentAreaLastCol;
  const lastRow = worksheet.lastRow?.number ?? worksheet.rowCount;
  if (lastRow < firstRow) return;

  for (let r = firstRow; r <= lastRow; r++) {
    const row = worksheet.getRow(r);
    for (let c = firstCol; c <= lastCol; c++) {
      const cell = row.getCell(c);
      const border: Partial<ExcelJS.Borders> = { ...cell.border };
      if (c === firstCol) border.left = OUTER_EDGE;
      if (c === lastCol) border.right = OUTER_EDGE;
      if (r === firstRow) border.top = OUTER_EDGE;
      if (r === lastRow) border.bottom = OUTER_EDGE;
      cell.border = border;
    }
    row.commit();
  }
}
