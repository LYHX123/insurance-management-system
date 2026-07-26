// Small self-contained A1-notation helpers — no external dependency beyond
// plain string/number math, since ExcelJS itself doesn't expose a public
// range-string parser/builder.

export type CellRef = { row: number; col: number };
export type RangeRef = { startRow: number; startCol: number; endRow: number; endCol: number };

export function colLettersToNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function numberToColLetters(num: number): string {
  let n = num;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function parseCellAddress(address: string): CellRef {
  const match = /^([A-Z]+)(\d+)$/.exec(address);
  if (!match) throw new Error(`Unrecognized cell address: ${address}`);
  return { col: colLettersToNumber(match[1]), row: Number(match[2]) };
}

export function cellAddress(ref: CellRef): string {
  return `${numberToColLetters(ref.col)}${ref.row}`;
}

export function parseRange(range: string): RangeRef {
  const [start, end] = range.split(":");
  const s = parseCellAddress(start);
  const e = end ? parseCellAddress(end) : s;
  return { startRow: s.row, startCol: s.col, endRow: e.row, endCol: e.col };
}

export function shiftRangeRows(range: RangeRef, delta: number): RangeRef {
  return { ...range, startRow: range.startRow + delta, endRow: range.endRow + delta };
}
