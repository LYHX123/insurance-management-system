// Removes every non-selected section entirely and resizes each selected
// dynamic section's reserved row capacity to match its actual data-row
// count, in a single bottom-to-top pass over ORIGINAL template row
// numbers. Bottom-to-top is what makes this safe: at the moment any one
// operation is applied, everything above it (lower row numbers) has not
// been touched yet, so that operation's row number is still valid — see
// the Phase 3A report for why this matters (WIBA's own "Total" row, and
// Employer's Liability's live formula reference into WIBA, both move
// whenever WIBA's payroll row count differs from the template's reserved
// 17, which is the common case).
//
// Returns a per-section SectionLayout carrying just enough (rowOffset +
// dynamicDelta) for replaceVariables.ts/fillDynamicRows.ts to translate any
// original template row number into its final row number — see
// resolveFinalRow/resolveFinalCell below.

import type ExcelJS from "exceljs";
import { SECTIONS_BY_ROW_ORDER } from "./sectionRegistry";
import type { SectionConfig, SectionLayout, TemplateSectionKind } from "./types";

type RowOperation = { row: number; deleteCount: number; insertCount: number };

// Capacity/counts below are in ENTRIES (one logical data row, e.g. one
// Marine shipment), not physical Excel rows — dynamicRowCounts (passed in
// from generateQuotationExcel.ts) already counts entries this same way
// (mapped.sections[].dynamicRows.length). Multiply by rowsPerEntry to get
// physical row counts for the actual splice operations.
function dynamicCapacity(section: SectionConfig): number {
  if (!section.dynamicRow) return 0;
  const rowsPerEntry = section.dynamicRow.rowsPerEntry ?? 1;
  return (section.dynamicRow.lastBlankRow - section.dynamicRow.templateRow + 1) / rowsPerEntry;
}

export type RemoveUnusedSectionsResult = {
  layouts: Map<TemplateSectionKind, SectionLayout>;
  /** Net row-count change across the ENTIRE sheet — apply this to any fixed row that sits after every section (e.g. the footer/grand-total row). */
  footerRowOffset: number;
};

type CapturedMerge = { col: string; startRow: number; endRow: number };

// ExcelJS's spliceRows does NOT keep worksheet.model.merges in sync with
// row shifts caused by splices elsewhere in the sheet — a merge sitting
// below a deleted/inserted range keeps its OLD absolute row numbers
// instead of shifting with the content around it. Every one of this
// template's 20 sections has its own single-column "excess/remarks"
// merge in column E (confirmed by dumping every merge in the file — 20
// per-section merges + the B2:E2 header + the 2-row footer merges
// A475:A476/B475:B476/D475:D476 (shifted +3 by the Marine template rebuild
// — see config.ts's MARINE_COVER note), 24 total, nothing else). Left
// alone, any section that shifts position (i.e. anything after the
// first deleted/resized section) ends up with its merge still pointing
// at the section's ORIGINAL rows — silently wrong for every multi-
// section quotation, and an outright "Cannot merge already merged
// cells" crash once two stale merges happen to collide. The fix:
// capture every section's (and the footer's) original merge before any
// mutation, unmerge everything up front, do all the splicing, then
// recreate each surviving merge at its analytically-resolved final
// position.
function captureMerges(worksheet: ExcelJS.Worksheet): {
  bySection: Map<TemplateSectionKind, CapturedMerge>;
  footer: CapturedMerge[];
} {
  const merges: string[] = (worksheet.model as unknown as { merges?: string[] }).merges ?? [];
  const bySection = new Map<TemplateSectionKind, CapturedMerge>();
  const footer: CapturedMerge[] = [];
  for (const range of merges) {
    const [start, end] = range.split(":");
    const sm = start.match(/^([A-Z]+)(\d+)$/);
    const em = end.match(/^([A-Z]+)(\d+)$/);
    if (!sm || !em) continue;
    const col = sm[1];
    const startRow = parseInt(sm[2], 10);
    const endRow = parseInt(em[2], 10);
    if (startRow < SECTIONS_BY_ROW_ORDER[0].startRow) continue; // header (B2:E2) — never moves, leave untouched
    const owner = SECTIONS_BY_ROW_ORDER.find((s) => startRow >= s.startRow && startRow <= s.endRow);
    if (owner) bySection.set(owner.kind, { col, startRow, endRow });
    else footer.push({ col, startRow, endRow }); // sits after every section, e.g. the grand-total footer
  }
  return { bySection, footer };
}

export function removeUnusedSections(
  worksheet: ExcelJS.Worksheet,
  selectedKinds: ReadonlySet<TemplateSectionKind>,
  dynamicRowCounts: Partial<Record<TemplateSectionKind, number>>
): RemoveUnusedSectionsResult {
  const { bySection: capturedMerges, footer: footerMerges } = captureMerges(worksheet);

  const operations: RowOperation[] = [];

  for (const section of SECTIONS_BY_ROW_ORDER) {
    if (!selectedKinds.has(section.kind)) {
      operations.push({ row: section.startRow, deleteCount: section.endRow - section.startRow + 1, insertCount: 0 });
      continue;
    }
    if (section.dynamicRow) {
      const rowsPerEntry = section.dynamicRow.rowsPerEntry ?? 1;
      const capacity = dynamicCapacity(section); // entries
      const actual = Math.max(1, dynamicRowCounts[section.kind] ?? 1); // entries
      const deltaRows = (actual - capacity) * rowsPerEntry;
      if (deltaRows < 0) {
        operations.push({ row: section.dynamicRow.templateRow + actual * rowsPerEntry, deleteCount: -deltaRows, insertCount: 0 });
      } else if (deltaRows > 0) {
        operations.push({ row: section.dynamicRow.templateRow + capacity * rowsPerEntry, deleteCount: 0, insertCount: deltaRows });
      }
    }
  }

  // Precompute final layout analytically (see types.ts SectionLayout doc)
  // before touching the worksheet at all.
  const layoutByKind = new Map<TemplateSectionKind, SectionLayout>();
  {
    const opsAscending = [...operations].sort((a, b) => a.row - b.row);
    let cumulativeOffset = 0;
    let opIndex = 0;
    for (const section of SECTIONS_BY_ROW_ORDER) {
      while (opIndex < opsAscending.length && opsAscending[opIndex].row < section.startRow) {
        cumulativeOffset += opsAscending[opIndex].insertCount - opsAscending[opIndex].deleteCount;
        opIndex++;
      }
      if (!selectedKinds.has(section.kind)) continue;

      const rowsPerEntry = section.dynamicRow?.rowsPerEntry ?? 1;
      const capacity = dynamicCapacity(section); // entries
      const actual = section.dynamicRow ? Math.max(1, dynamicRowCounts[section.kind] ?? 1) : 0; // entries
      // dynamicDelta stays in ROW units (SectionLayout's documented contract
      // — resolveFinalRow adds it directly to original row numbers).
      const dynamicDelta = section.dynamicRow ? (actual - capacity) * rowsPerEntry : 0;

      const layout: SectionLayout = {
        kind: section.kind,
        rowOffset: cumulativeOffset,
        dynamicDelta,
        startRow: section.startRow + cumulativeOffset,
        endRow: section.endRow + cumulativeOffset + dynamicDelta,
      };
      if (section.dynamicRow) {
        layout.dynamicTemplateRow = section.dynamicRow.templateRow + cumulativeOffset;
        layout.dynamicDataStartRow = layout.dynamicTemplateRow;
        layout.dynamicDataEndRow = layout.dynamicTemplateRow + actual * rowsPerEntry - 1;
        if (section.dynamicRow.totalRow) {
          layout.dynamicTotalRow = section.dynamicRow.totalRow + cumulativeOffset + dynamicDelta;
        }
      }
      layoutByKind.set(section.kind, layout);
    }
  }

  const footerRowOffset = operations.reduce((acc, op) => acc + (op.insertCount - op.deleteCount), 0);

  // Unmerge every section's and the footer's merge up front — see
  // captureMerges' doc comment for why this must happen before any
  // splicing rather than only for ranges being deleted.
  for (const merge of capturedMerges.values()) {
    safeUnmerge(worksheet, `${merge.col}${merge.startRow}:${merge.col}${merge.endRow}`);
  }
  for (const merge of footerMerges) {
    safeUnmerge(worksheet, `${merge.col}${merge.startRow}:${merge.col}${merge.endRow}`);
  }

  // Apply the mutations, strictly bottom-to-top (highest original row first).
  const opsDescending = [...operations].sort((a, b) => b.row - a.row);
  for (const op of opsDescending) {
    if (op.deleteCount > 0) {
      safeSpliceDelete(worksheet, op.row, op.deleteCount);
    } else if (op.insertCount > 0) {
      safeSpliceInsert(worksheet, op.row, op.insertCount);
    }
  }

  // Recreate every surviving section's merge at its resolved final position.
  for (const section of SECTIONS_BY_ROW_ORDER) {
    if (!selectedKinds.has(section.kind)) continue;
    const merge = capturedMerges.get(section.kind);
    const layout = layoutByKind.get(section.kind);
    if (!merge || !layout) continue;
    const finalStart = resolveFinalRow(section, layout, merge.startRow);
    const finalEnd = resolveFinalRow(section, layout, merge.endRow);
    if (finalEnd > finalStart) {
      worksheet.mergeCells(`${merge.col}${finalStart}:${merge.col}${finalEnd}`);
    }
  }

  // Recreate the footer's merges, shifted by the net row-count change.
  for (const merge of footerMerges) {
    const finalStart = merge.startRow + footerRowOffset;
    const finalEnd = merge.endRow + footerRowOffset;
    if (finalEnd > finalStart) {
      worksheet.mergeCells(`${merge.col}${finalStart}:${merge.col}${finalEnd}`);
    }
  }

  // Shrink the print area to the new last row.
  const lastRow = worksheet.lastRow?.number ?? worksheet.rowCount;
  if (worksheet.pageSetup?.printArea) {
    worksheet.pageSetup.printArea = `A1:E${lastRow}`;
  }

  return { layouts: layoutByKind, footerRowOffset };
}

// ExcelJS's worksheet.spliceRows() silently corrupts the sheet when a
// single call deletes a large run of rows whose end sits close to the
// sheet's true last row (empirically: a delete count roughly more than
// half the remaining tail length triggers it) — the reported row count
// only drops by a few rows and the "deleted" content reappears intact a
// few rows below where it should have been removed, while unrelated
// content after it (e.g. the footer) is shifted up as if the full count
// really was deleted. Confirmed via isolated reproduction against this
// template: spliceRows(453, 19) (deleting Customs Bond, the last
// section, right before the two-row footer) only reduced rowCount by 2
// instead of 19 and left Customs Bond's own rows behind. Splitting any
// single delete/insert into small chunks avoids the bug entirely and
// produces the exact same end state as a correct single call would.
const SAFE_SPLICE_CHUNK = 5;

function safeSpliceDelete(worksheet: ExcelJS.Worksheet, row: number, count: number) {
  let remaining = count;
  while (remaining > 0) {
    const n = Math.min(SAFE_SPLICE_CHUNK, remaining);
    worksheet.spliceRows(row, n);
    remaining -= n;
  }
}

function safeSpliceInsert(worksheet: ExcelJS.Worksheet, row: number, count: number) {
  let remaining = count;
  while (remaining > 0) {
    const n = Math.min(SAFE_SPLICE_CHUNK, remaining);
    const blankRows: unknown[][] = Array.from({ length: n }, () => []);
    worksheet.spliceRows(row, 0, ...blankRows);
    remaining -= n;
  }
}

function safeUnmerge(worksheet: ExcelJS.Worksheet, range: string) {
  try {
    worksheet.unMergeCells(range);
  } catch {
    // already unmerged — fine.
  }
}

/** Translate an original template row number into its final (post-mutation) row number for the given section. */
export function resolveFinalRow(section: SectionConfig, layout: SectionLayout, originalRow: number): number {
  const crossesDynamicRegion = section.dynamicRow && originalRow > section.dynamicRow.lastBlankRow;
  return originalRow + layout.rowOffset + (crossesDynamicRegion ? layout.dynamicDelta : 0);
}

/** Translate an original template cell address (e.g. "D36") into its final address for the given section. */
export function resolveFinalCell(section: SectionConfig, layout: SectionLayout, originalCell: string): string {
  const match = originalCell.match(/^([A-Z]+)(\d+)$/);
  if (!match) throw new Error(`Invalid cell address "${originalCell}"`);
  const [, col, rowStr] = match;
  const finalRow = resolveFinalRow(section, layout, parseInt(rowStr, 10));
  return `${col}${finalRow}`;
}
