import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { estimateTextHeight, autoFitMergedTextHeights, readCellText } from "../autoFitRowHeights";

// Phase 10 — reusable Excel row-height auto-fit for long wrapped clause /
// excess / remark / warranty / conditions text in merged cells.

const SHORT = "Excess - 25,000/= each and every claim";
const MEDIUM =
  "CLAUSE\nA) Cover on claims made basis\nB) Retroactive date - inception date\n" +
  "C) WIBA policy in place at same time\nD) Excluding political violence and terrorism\n" +
  "E) Jurisdiction clause-Kenya\n\nEXCESS\nExcess - 25,000/= each and every claim";
const VERY_LONG = Array.from({ length: 18 }, (_, i) =>
  `${i + 1}) This is a deliberately long clause line that will certainly wrap across more than one visual row inside the excess column because it contains far more characters than fit`
).join("\n");
const EXPLICIT_NEWLINES = "Line one\nLine two\nLine three\nLine four\nLine five";

describe("estimateTextHeight", () => {
  const width = 52.5; // template column E

  it("1. short clause: needs little height, never below existing", () => {
    const r = estimateTextHeight({ text: SHORT, effectiveColumnWidth: width, rowSpan: 13, existingHeight: 200 });
    expect(r.estimatedLines).toBeLessThanOrEqual(2);
    expect(r.targetHeight).toBe(200); // existing already covers it
  });

  it("2. medium multi-line clause: counts every explicit line at least once", () => {
    const r = estimateTextHeight({ text: MEDIUM, effectiveColumnWidth: width, rowSpan: 13, existingHeight: 50 });
    // 9 explicit lines (incl. the blank) -> at least 9 rows of text
    expect(r.estimatedLines).toBeGreaterThanOrEqual(9);
    expect(r.requiredHeight).toBeGreaterThan(50);
    expect(r.targetHeight).toBe(r.requiredHeight);
  });

  it("3. very long multi-line clause: wraps individual lines, far exceeds a small block", () => {
    const r = estimateTextHeight({ text: VERY_LONG, effectiveColumnWidth: width, rowSpan: 13, existingHeight: 200 });
    // 18 long lines, each wrapping to >=2 visual rows
    expect(r.estimatedLines).toBeGreaterThanOrEqual(36);
    expect(r.targetHeight).toBeGreaterThan(200);
    expect(r.targetHeight).toBe(r.requiredHeight);
  });

  it("4. explicit newline content: exactly one row per line when each line is short", () => {
    const r = estimateTextHeight({ text: EXPLICIT_NEWLINES, effectiveColumnWidth: width, rowSpan: 5, existingHeight: 10 });
    expect(r.estimatedLines).toBe(5);
  });

  it("narrower column => more wrapping => taller estimate", () => {
    const wide = estimateTextHeight({ text: MEDIUM, effectiveColumnWidth: 80, rowSpan: 13, existingHeight: 0 });
    const narrow = estimateTextHeight({ text: MEDIUM, effectiveColumnWidth: 20, rowSpan: 13, existingHeight: 0 });
    expect(narrow.estimatedLines).toBeGreaterThan(wide.estimatedLines);
  });

  it("never shrinks below existingHeight", () => {
    const r = estimateTextHeight({ text: SHORT, effectiveColumnWidth: width, rowSpan: 20, existingHeight: 999 });
    expect(r.targetHeight).toBe(999);
  });

  // Phase 10 issue 2 — calibrated against LibreOffice's own optimal row
  // height for the real template clause blocks (column E width 52.5):
  //   EL clause     (9 lines / 232 ch)   -> 114 pt
  //   Perf. Bond    (10 lines / 516 ch)  -> 164 pt
  //   Marine clause (27 lines / 1128 ch) -> 400 pt
  // The estimate must sit above optimal (no clipping) but not wildly so —
  // the previous version produced ~614pt for Marine (over-tall, issue 2).
  const REAL = {
    marine:
      "CLAUSE\nInstitute classification cluase\nInstitute replacement clause\n" +
      "Institute radioactive contamination exclusion exclusion\n" +
      "Institute standard conditions for cargo contracts\nExcluding unexplained losses\n" +
      "Excluding caking and rainwater damage\nExcluding contamination other than by sea water\n" +
      "Excluding spontaneous combustion, sweating, heating, spillage and hook dmage\n" +
      "Excluding inherent vice and moisture damage unless caused by insured peril\n" +
      "Excluding mechanical and electrical derangement\nExcluding scratching,denting\n" +
      "Political risks exclusion clause\n" +
      "Excluding mechanical failure of refrigirators other than from a result of insured peril\n" +
      "General average and salvage charges clause\nPacking Warranty\nMinimum premium: ksh. 5,000\n" +
      "Loss due to delays (deterioration of stock) other than from as a result of insured perils is excluded\n" +
      "Five Powers War Exclusion\nSeepage and Pollution Exclusion\n" +
      "Specified territory Exclusion – Russia, Ukraine and Belarus Waters\n" +
      "Excluding Hull War, Piracy, Terrorism and Related Perils\n" +
      "Excluding water damage other than by sea water\nSanction Clause\n\nEXCESS\n" +
      "10% of consignment value minimum Kshs 50,000/-",
  };

  it("Marine clause: estimate is above LibreOffice-optimal (400pt) but not over-tall", () => {
    const r = estimateTextHeight({ text: REAL.marine, effectiveColumnWidth: width, rowSpan: 22, existingHeight: 0 });
    expect(r.requiredHeight).toBeGreaterThan(400); // no clipping
    expect(r.requiredHeight).toBeLessThan(520); // not the old ~614pt bloat
  });
});

describe("autoFitMergedTextHeights", () => {
  function sheetWith(text: string, rows = 6, perRowHeight = 15) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("S");
    ws.getColumn(5).width = 52.5;
    for (let r = 1; r <= rows; r++) ws.getRow(r).height = perRowHeight;
    ws.getCell("E1").value = text;
    ws.getCell("E1").alignment = { wrapText: true, vertical: "top" };
    ws.mergeCells(`E1:E${rows}`);
    return ws;
  }

  it("5. merged-cell clause block: grows a too-small block, spreads across its rows, keeps the row count", () => {
    const ws = sheetWith(VERY_LONG, 6, 15);
    const before = Array.from({ length: 6 }, (_, i) => ws.getRow(i + 1).height ?? 0);
    const beforeTotal = before.reduce((a, b) => a + b, 0);

    const grown = autoFitMergedTextHeights(ws);

    expect(grown).toContain("E1:E6");
    const after = Array.from({ length: 6 }, (_, i) => ws.getRow(i + 1).height ?? 0);
    const afterTotal = after.reduce((a, b) => a + b, 0);
    expect(afterTotal).toBeGreaterThan(beforeTotal);
    // spread evenly — every row grew by the same amount
    for (let i = 0; i < 6; i++) expect(after[i]).toBeGreaterThan(before[i]);
    expect(new Set(after.map((h) => h.toFixed(4))).size).toBe(1);
    // still a 6-row merge — nothing inserted/removed
    expect((ws.model as { merges?: string[] }).merges).toContain("E1:E6");
  });

  it("leaves a block that already fits completely untouched (short clause stays compact)", () => {
    const ws = sheetWith(SHORT, 13, 15); // 13 * 15 = 195pt for one short line
    const before = ws.getRow(1).height;
    const grown = autoFitMergedTextHeights(ws);
    expect(grown).toHaveLength(0);
    expect(ws.getRow(1).height).toBe(before);
  });

  it("ignores multi-column merges (only single-column clause blocks)", () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("S");
    for (let r = 1; r <= 4; r++) ws.getRow(r).height = 15;
    ws.getCell("A1").value = VERY_LONG;
    ws.mergeCells("A1:C4");
    const grown = autoFitMergedTextHeights(ws);
    expect(grown).toHaveLength(0);
  });

  it("readCellText flattens rich text", () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("S");
    ws.getCell("E1").value = { richText: [{ text: "CLAUSE\n" }, { text: "A) one" }] };
    expect(readCellText(ws.getCell("E1"))).toBe("CLAUSE\nA) one");
  });
});

// Phase 11 — only the blank (flexible) rows of a merge grow; rows carrying
// A-D business content keep their height.
describe("autoFitMergedTextHeights — protected vs flexible rows", () => {
  // A 12-row column-E merge shaped like a real section:
  //   r1  title (A content)      — protected
  //   r2  blank                  — FLEXIBLE
  //   r3  "Sum Insured" (A+B)    — protected
  //   r4  "Rate" (A+C)           — protected
  //   r5  blank                  — FLEXIBLE
  //   r6  blank                  — FLEXIBLE
  //   r7  blank                  — FLEXIBLE
  //   r8  "Gross premium" (B+D)  — protected
  //   r9  "PHCF" (B+D)           — protected
  //   r10 "ITL" (B+D)            — protected
  //   r11 blank                  — FLEXIBLE
  //   r12 "Total Premium" (B+D)  — protected
  function sectionSheet(clause: string, rowHeight = 15.45) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("S");
    ws.getColumn(5).width = 52.5;
    for (let r = 1; r <= 12; r++) ws.getRow(r).height = rowHeight;
    ws.getCell("A1").value = "SECTION TITLE";
    ws.getCell("A3").value = "Sum Insured";
    ws.getCell("B3").value = 1_000_000;
    ws.getCell("A4").value = "Rate";
    ws.getCell("C4").value = "0.25%";
    ws.getCell("B8").value = "Gross premium";
    ws.getCell("D8").value = 2500;
    ws.getCell("B9").value = "PHCF";
    ws.getCell("D9").value = 6.25;
    ws.getCell("B10").value = "ITL";
    ws.getCell("D10").value = 5;
    ws.getCell("B12").value = "Total Premium";
    ws.getCell("D12").value = 2511.25;
    ws.getCell("E1").value = clause;
    ws.getCell("E1").alignment = { wrapText: true, vertical: "top" };
    ws.mergeCells("E1:E12");
    return ws;
  }
  const PROTECTED = [1, 3, 4, 8, 9, 10, 12];
  const FLEXIBLE = [2, 5, 6, 7, 11];

  function heights(ws: ExcelJS.Worksheet) {
    return Array.from({ length: 12 }, (_, i) => ws.getRow(i + 1).height ?? 0);
  }

  it("short clause: no row grows at all", () => {
    const ws = sectionSheet(SHORT);
    const before = heights(ws);
    const grown = autoFitMergedTextHeights(ws);
    expect(grown).toHaveLength(0);
    expect(heights(ws)).toEqual(before);
  });

  // ~16 short lines — overflows the 12-row (185pt) section by a modest amount.
  const MEDIUM_LONG = Array.from({ length: 16 }, (_, i) => `${i + 1}) A clause line of moderate length here`).join("\n");

  it("medium clause: only the flexible rows grow — every protected row is untouched", () => {
    const ws = sectionSheet(MEDIUM_LONG);
    const before = heights(ws);
    const grown = autoFitMergedTextHeights(ws);
    expect(grown).toHaveLength(1);
    const after = heights(ws);
    for (const r of PROTECTED) expect(after[r - 1], `protected r${r}`).toBe(before[r - 1]);
    // at least one flexible row grew
    expect(FLEXIBLE.some((r) => after[r - 1] > before[r - 1])).toBe(true);
    // the flexible rows grew by (almost) the same amount — even spread
    const flexAfter = FLEXIBLE.map((r) => after[r - 1]);
    expect(Math.max(...flexAfter) - Math.min(...flexAfter)).toBeLessThan(0.75);
    // and only modestly — nowhere near the extreme heights Phase 10 produced
    expect(Math.max(...flexAfter)).toBeLessThan(40);
  });

  it("very long clause: flexible rows grow enough that the whole merge holds the text; protected rows still untouched", () => {
    const ws = sectionSheet(VERY_LONG);
    const before = heights(ws);
    autoFitMergedTextHeights(ws);
    const after = heights(ws);

    for (const r of PROTECTED) expect(after[r - 1], `protected r${r}`).toBe(before[r - 1]);
    for (const r of FLEXIBLE) expect(after[r - 1], `flexible r${r}`).toBeGreaterThan(before[r - 1]);

    const total = after.reduce((a, b) => a + b, 0);
    const explicitLines = VERY_LONG.split("\n").length;
    expect(total).toBeGreaterThanOrEqual(explicitLines * 13);
  });

  it("never shrinks: a merge whose rows are already tall enough is left alone", () => {
    const ws = sectionSheet(MEDIUM, 40); // 12 * 40 = 480pt, far more than MEDIUM needs
    const before = heights(ws);
    const grown = autoFitMergedTextHeights(ws);
    expect(grown).toHaveLength(0);
    expect(heights(ws)).toEqual(before);
  });

  it("a section with ZERO flexible rows never clips (falls back to growing every row)", () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("S");
    ws.getColumn(5).width = 52.5;
    for (let r = 1; r <= 6; r++) {
      ws.getRow(r).height = 15.45;
      ws.getCell(`A${r}`).value = `line ${r}`; // every row has A content -> all protected
    }
    ws.getCell("E1").value = VERY_LONG;
    ws.getCell("E1").alignment = { wrapText: true, vertical: "top" };
    ws.mergeCells("E1:E6");
    const before = Array.from({ length: 6 }, (_, i) => ws.getRow(i + 1).height ?? 0);
    autoFitMergedTextHeights(ws);
    const after = Array.from({ length: 6 }, (_, i) => ws.getRow(i + 1).height ?? 0);
    const total = after.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(before.reduce((a, b) => a + b, 0));
    expect(total).toBeGreaterThanOrEqual(VERY_LONG.split("\n").length * 13);
  });
});
