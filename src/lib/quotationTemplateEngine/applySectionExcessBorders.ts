// Closes two border gaps confirmed by direct inspection of generated
// workbooks (never hardcoded to one example file — driven entirely by each
// section's own final SectionLayout, so it applies uniformly to every
// section regardless of how many rows removeUnusedSections.ts spliced):
//
// 1. The internal divider between column D (last data column) and column E
//    (the section-wide "excess/clauses" merge) is missing on the template's
//    own spacer rows immediately inside a section's row range (confirmed at
//    the row right after a section's title and the row right after its
//    Total Premium row) — visible as a break in the right-hand vertical
//    border near the EXCESS/REMARK column.
// 2. Column E's own bottom border (at the section's last row) is never set
//    by the template at all — captureMerges/mergeCells in
//    removeUnusedSections.ts only recreates the MERGE STATE, never a
//    border — so two adjacent sections' Clause/Excess areas visually run
//    together with no separating line.
//
// Deliberately does NOT set a top border on the merge's own first row (a
// second production report caught the fallout of an earlier version that
// did): every section's own leading spacer row (immediately before its
// Clause/Excess merge begins) already carries a lone top border baked into
// the template itself, with no bottom — confirmed by inspecting the raw
// template. Setting ANOTHER top border on the merge's first row directly
// below it visually sandwiches that already-bordered spacer row between two
// lines, producing an empty boxed-off row right before the Clause text
// starts. The template's own design relies on the PRECEDING block's bottom
// edge (the previous section's own Total Premium row, or the sheet's fixed
// header) to serve as each section's visual top boundary — never an
// independent top line on the section's own first row. Also relevant:
// ExcelJS propagates a border write on any one cell in a merged range to
// every cell in that range (confirmed empirically — unlike font, which is
// independent per cell), so writing "bottom" once at the merge's last row
// is sufficient to close its visual box; there is no cell-by-cell equivalent
// to worry about for interior rows.
//
// This only ever ADDS the two specific edges documented above (same
// "gap-filling, never override other sides" convention as
// applyOuterBorder.ts) — never touches column A-C, and never touches any
// border side already set by the template or by fillDynamicRows.ts.
import type ExcelJS from "exceljs";
import type { SectionLayout, TemplateSectionKind } from "./types";

const DIVIDER_EDGE: Partial<ExcelJS.Border> = { style: "medium", color: { argb: "FF000000" } };
const LAST_CONTENT_COLUMN = 4; // D
const EXCESS_COLUMN = 5; // E

export function applySectionExcessBorders(
  worksheet: ExcelJS.Worksheet,
  layouts: Map<TemplateSectionKind, SectionLayout>
): void {
  for (const layout of layouts.values()) {
    for (let r = layout.startRow; r <= layout.endRow; r++) {
      const dCell = worksheet.getRow(r).getCell(LAST_CONTENT_COLUMN);
      dCell.border = { ...dCell.border, right: DIVIDER_EDGE };

      const eCell = worksheet.getRow(r).getCell(EXCESS_COLUMN);
      eCell.border = { ...eCell.border, left: DIVIDER_EDGE };

      worksheet.getRow(r).commit();
    }

    // The merge's own last row (never the same as endRow above when a
    // trailing spacer separates it from the next section) is what needs its
    // bottom edge closed — see SectionLayout's doc comment.
    const excessEndRow = layout.excessColumnEndRow ?? layout.endRow;
    const bottomCell = worksheet.getRow(excessEndRow).getCell(EXCESS_COLUMN);
    bottomCell.border = { ...bottomCell.border, bottom: DIVIDER_EDGE };
    worksheet.getRow(excessEndRow).commit();
  }
}
