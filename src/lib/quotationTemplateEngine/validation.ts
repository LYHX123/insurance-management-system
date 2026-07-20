import type ExcelJS from "exceljs";
import { getSectionConfig, hasSectionConfig } from "./sectionRegistry";
import { findUnresolvedPlaceholders } from "./replaceVariables";
import type { MappedQuotation } from "./mapQuotationData";
import type { TemplateSectionKind } from "./types";

export class TemplateGenerationError extends Error {
  constructor(message: string, public readonly details: string[] = []) {
    super(message);
    this.name = "TemplateGenerationError";
  }
}

// Placeholders known (and documented in config.ts) to be left unfilled by
// design in Phase 3A — see the CPM dynamic-row malformed-variable finding.
const DOCUMENTED_UNRESOLVED_PLACEHOLDERS = new Set(["cpm_quantity", "cpm_unit_value"]);

/** Pre-generation: every selected section kind must have a registry entry, and every required placeholder must have a mapped value. Throws on failure. */
export function validateBeforeGeneration(mapped: MappedQuotation, selectedKinds: TemplateSectionKind[]): void {
  const problems: string[] = [];

  for (const kind of selectedKinds) {
    if (!hasSectionConfig(kind)) {
      problems.push(`Selected section "${kind}" has no template registry entry — cannot be exported.`);
    }
  }

  for (const section of mapped.sections) {
    const config = getSectionConfig(section.kind);
    for (const variable of config.staticVariables) {
      if (!variable.required) continue;
      const value = section.values[variable.name];
      if (value === undefined || value === null || value === "") {
        problems.push(
          `Section ${section.kind}: required field {{${variable.name}}} is missing or blank in the source quotation data.`
        );
      }
    }
    if (config.dynamicRow && (mapped.sections.find((s) => s.kind === section.kind)?.dynamicRows?.length ?? 0) === 0) {
      problems.push(`Section ${section.kind}: dynamic row region has no data rows.`);
    }
  }

  if (problems.length > 0) {
    throw new TemplateGenerationError("Quotation is missing data required to generate the Excel workbook.", problems);
  }
}

/** Post-generation: no unresolved {{...}} remain except the documented, explicitly-allowed ones. */
export function validateAfterGeneration(worksheet: ExcelJS.Worksheet): { warnings: string[] } {
  const unresolved = findUnresolvedPlaceholders(worksheet);
  const blocking = unresolved.filter((u) => !DOCUMENTED_UNRESOLVED_PLACEHOLDERS.has(u.placeholder.slice(2, -2)));
  const documented = unresolved.filter((u) => DOCUMENTED_UNRESOLVED_PLACEHOLDERS.has(u.placeholder.slice(2, -2)));

  if (blocking.length > 0) {
    throw new TemplateGenerationError(
      "Generated workbook still contains unresolved placeholders.",
      blocking.map((b) => `${b.address}: ${b.placeholder}`)
    );
  }

  return {
    warnings: documented.map((d) => `${d.address}: ${d.placeholder} intentionally left unresolved (documented in config.ts).`),
  };
}

/** The printed grand total must equal the server-calculated quotation total exactly. */
export function validateGrandTotal(workbookValue: number, expected: number): void {
  const diff = Math.abs(workbookValue - expected);
  if (diff > 0.01) {
    throw new TemplateGenerationError(
      `Generated workbook grand total (${workbookValue.toFixed(2)}) does not match the stored quotation total (${expected.toFixed(2)}).`
    );
  }
}
