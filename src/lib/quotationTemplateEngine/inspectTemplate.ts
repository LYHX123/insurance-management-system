import type ExcelJS from "exceljs";

export type PlaceholderOccurrence = { address: string; row: number; column: string; placeholder: string };

const PLACEHOLDER_REGEX = /\{\{[^}]*\}\}/g;

export function cellText(cell: ExcelJS.Cell): string | null {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && "richText" in (v as object)) {
    return (v as { richText: { text: string }[] }).richText.map((rt) => rt.text).join("");
  }
  if (typeof v === "object" && "formula" in (v as object)) {
    return `FORMULA:${(v as { formula: string }).formula}`;
  }
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export function isFormulaCell(cell: ExcelJS.Cell): boolean {
  const v = cell.value;
  return !!v && typeof v === "object" && "formula" in (v as object);
}

/** Anchor cell addresses -> the set of every cell address covered by that merge (including the anchor). */
export function buildMergeMap(worksheet: ExcelJS.Worksheet): Map<string, Set<string>> {
  const merges: string[] = (worksheet.model as unknown as { merges?: string[] }).merges ?? [];
  const colToNum = (s: string) => s.split("").reduce((a, c) => a * 26 + (c.charCodeAt(0) - 64), 0);
  const map = new Map<string, Set<string>>();
  for (const range of merges) {
    const [start, end] = range.split(":");
    const m1 = start.match(/^([A-Z]+)(\d+)$/);
    const m2 = end.match(/^([A-Z]+)(\d+)$/);
    if (!m1 || !m2) continue;
    const c1 = colToNum(m1[1]);
    const r1 = parseInt(m1[2], 10);
    const c2 = colToNum(m2[1]);
    const r2 = parseInt(m2[2], 10);
    const cells = new Set<string>();
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        cells.add(`${String.fromCharCode(64 + c)}${r}`);
      }
    }
    map.set(start, cells);
  }
  return map;
}

/** Every {{...}} occurrence in the worksheet, skipping non-anchor cells within a merge (which mirror the anchor's value). */
export function scanPlaceholders(worksheet: ExcelJS.Worksheet): PlaceholderOccurrence[] {
  const mergeMap = buildMergeMap(worksheet);
  const slaveCells = new Set<string>();
  for (const [anchor, cells] of mergeMap) {
    for (const addr of cells) if (addr !== anchor) slaveCells.add(addr);
  }

  const found: PlaceholderOccurrence[] = [];
  for (let r = 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    for (let c = 1; c <= (worksheet.columnCount || 5); c++) {
      const cell = row.getCell(c);
      if (slaveCells.has(cell.address)) continue;
      const text = cellText(cell);
      if (!text) continue;
      const matches = text.match(PLACEHOLDER_REGEX);
      if (matches) {
        for (const m of matches) {
          found.push({ address: cell.address, row: r, column: cell.address.replace(/\d+$/, ""), placeholder: m.slice(2, -2) });
        }
      }
    }
  }
  return found;
}

export function scanFormulaCells(worksheet: ExcelJS.Worksheet): string[] {
  const addresses: string[] = [];
  for (let r = 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (isFormulaCell(cell)) addresses.push(cell.address);
    });
  }
  return addresses;
}
