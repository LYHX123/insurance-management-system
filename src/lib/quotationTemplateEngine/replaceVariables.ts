// Fills every static (non-dynamic-row) placeholder for one section, scoped
// strictly to that section's own final row range. This is deliberately NOT
// a sheet-wide find/replace: several placeholder names are reused across
// different sections (all 4 Motor sections share {{motor_*}}; Performance
// Bond and APG — which CAN both be selected at once — share
// {{guarantee_*}}), so writing by (section, cell) pair is the only safe
// approach. See config.ts's header comment for the full list of reused
// names this guards against.
//
// Every written value must render bold while any static text sharing the
// same cell (e.g. "CONTRACT PERIOD: {{car_construction_period_months}}
// months", where only the number should go bold) stays at normal weight.
// A whole-cell placeholder just gets its font bolded in place
// (setBoldCellValue). A placeholder embedded inside a larger literal
// string can't be handled that way — bolding cell.font would also bold
// the surrounding static text — so embedded substitutions are tracked as
// a list of plain/bold text segments per cell (supporting more than one
// placeholder sharing a cell, e.g. Motor's Period From/To) and only
// converted into a real Excel rich-text value once, after every variable
// for this section has been processed.

import type ExcelJS from "exceljs";
import type { MappedSection, PlaceholderValues } from "./mapQuotationData";
import type { SectionConfig, SectionLayout, StaticVariable } from "./types";
import { resolveFinalCell } from "./removeUnusedSections";
import { boldFont, setBoldCellValue } from "./boldFont";
import { EXCEL_RATE_NUM_FMT } from "./numberFormats";

const PLACEHOLDER_REGEX = /\{\{[^}]*\}\}/g;

type TextSegment = { text: string; bold: boolean };

function formatForText(value: PlaceholderValues[string], kind: StaticVariable["kind"]): string {
  if (value === null || value === undefined) return "";
  if (kind === "rate") return typeof value === "number" ? String(value) : String(value);
  return String(value);
}

function isPurePlaceholderCell(text: string, placeholderName: string): boolean {
  return text.trim() === `{{${placeholderName}}}`;
}

function cellPlainText(cell: ExcelJS.Cell): string | null {
  // cell.text throws for merge-slave cells in some ExcelJS versions
  // (MergeValue.toString on a null value), so richText/plain-string
  // content is read directly off cell.value instead of relying on it.
  const v = cell.value;
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "richText" in v) {
    return (v as { richText: { text: string }[] }).richText.map((run) => run.text).join("");
  }
  return null;
}

/**
 * Finds `token` in the first plain (non-bold) segment that contains it and
 * splits that segment into plain/bold/plain, mutating segments in place.
 * No-op if the token isn't found (e.g. a malformed template placeholder).
 *
 * When the variable declares a unitPrefix/unitSuffix (see StaticVariable's
 * doc comment) and that exact literal text is immediately adjacent to the
 * token, it is absorbed into the bold run instead of staying static — e.g.
 * "CONTRACT PERIOD: {{x}} months" with unitSuffix " months" bolds "24
 * months" as one unit, leaving only the label "CONTRACT PERIOD: " normal.
 */
function substituteInSegments(
  segments: TextSegment[],
  token: string,
  replacement: string,
  unitPrefix?: string,
  unitSuffix?: string
): void {
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.bold) continue; // never re-scan an already-resolved value
    const idx = segment.text.indexOf(token);
    if (idx === -1) continue;
    let before = segment.text.slice(0, idx);
    let after = segment.text.slice(idx + token.length);
    let boldText = replacement;
    if (unitPrefix && before.endsWith(unitPrefix)) {
      before = before.slice(0, before.length - unitPrefix.length);
      boldText = unitPrefix + boldText;
    }
    if (unitSuffix && after.startsWith(unitSuffix)) {
      after = after.slice(unitSuffix.length);
      boldText = boldText + unitSuffix;
    }
    const replacementSegments: TextSegment[] = [];
    if (before) replacementSegments.push({ text: before, bold: false });
    replacementSegments.push({ text: boldText, bold: true });
    if (after) replacementSegments.push({ text: after, bold: false });
    segments.splice(i, 1, ...replacementSegments);
    return;
  }
}

export function replaceVariables(
  worksheet: ExcelJS.Worksheet,
  section: SectionConfig,
  layout: SectionLayout,
  mapped: MappedSection,
  warnings: string[]
): void {
  const embeddedSegments = new Map<string, TextSegment[]>();

  for (const variable of section.staticVariables) {
    const finalAddress = resolveFinalCell(section, layout, variable.cell);
    const cell = worksheet.getCell(finalAddress);
    const value = mapped.values[variable.name];

    if (value === undefined) {
      if (variable.required) {
        warnings.push(
          `Section ${section.kind}: required placeholder {{${variable.name}}} (${finalAddress}) has no mapped value.`
        );
      }
      continue;
    }

    const inProgress = embeddedSegments.get(finalAddress);
    const currentText = inProgress ? inProgress.map((s) => s.text).join("") : cellPlainText(cell) ?? "";

    if (!inProgress && isPurePlaceholderCell(currentText, variable.name)) {
      // The whole cell is exactly this one placeholder — write a real
      // typed, bold value so Excel treats it as a genuine number, not a
      // string sharing weight with nothing else.
      if (value === null) {
        cell.value = null;
        continue;
      }
      switch (variable.kind) {
        case "money":
        case "integer":
          setBoldCellValue(cell, typeof value === "number" ? value : Number(value) || 0);
          break;
        case "rate":
          // App convention: 0.25 means 0.25%. The template cell is
          // %-formatted, which needs the raw fraction to display correctly.
          // numFmt is always forced here rather than trusting whatever the
          // template cell already has — see numberFormats.ts.
          cell.numFmt = EXCEL_RATE_NUM_FMT;
          setBoldCellValue(cell, (typeof value === "number" ? value : Number(value) || 0) / 100);
          break;
        case "text":
        case "date":
          setBoldCellValue(cell, String(value));
          break;
      }
    } else {
      // Placeholder is embedded inside a larger literal-text sentence
      // (e.g. "Period: {{motor_period_from}} - {{motor_period_to}}") —
      // record this substitution as a bold segment; the static text
      // around it must stay normal weight, so nothing is written to the
      // cell yet.
      const segments = inProgress ?? [{ text: currentText, bold: false }];
      const replacement = formatForText(value, variable.kind);
      substituteInSegments(segments, `{{${variable.name}}}`, replacement, variable.unitPrefix, variable.unitSuffix);
      embeddedSegments.set(finalAddress, segments);
    }
  }

  for (const [address, segments] of embeddedSegments) {
    const cell = worksheet.getCell(address);
    const baseFont = { ...cell.font };
    cell.value = {
      richText: segments
        .filter((s) => s.text !== "")
        .map((s) => ({ font: s.bold ? boldFont(baseFont) : baseFont, text: s.text })),
    };
  }
}

/** After all sections are processed, scan the whole sheet for any {{...}} left unresolved. */
export function findUnresolvedPlaceholders(worksheet: ExcelJS.Worksheet): { address: string; placeholder: string }[] {
  const found: { address: string; placeholder: string }[] = [];
  for (let r = 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    row.eachCell({ includeEmpty: false }, (cell) => {
      const text = cellPlainText(cell);
      if (!text) return;
      const matches = text.match(PLACEHOLDER_REGEX);
      if (matches) for (const m of matches) found.push({ address: cell.address, placeholder: m });
    });
  }
  return found;
}
