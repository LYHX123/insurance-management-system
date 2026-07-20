import { loadTemplateWorkbook, getTemplateWorksheet } from "./loadTemplate";
import { mapQuotationData, type QuotationForExport } from "./mapQuotationData";
import { removeUnusedSections, resolveFinalCell } from "./removeUnusedSections";
import { fillDynamicRows } from "./fillDynamicRows";
import { replaceVariables } from "./replaceVariables";
import { validateBeforeGeneration, validateAfterGeneration, validateGrandTotal } from "./validation";
import { getSectionConfig } from "./sectionRegistry";
import { TEMPLATE_CONFIG } from "./config";
import { boldFont, setBoldCellValue } from "./boldFont";
import { restoreTemplateDrawings } from "./restoreTemplateDrawings";
import { applyOuterBorder } from "./applyOuterBorder";
import type { GeneratedWorkbookResult, TemplateSectionKind } from "./types";

export async function generateQuotationExcel(quotation: QuotationForExport): Promise<GeneratedWorkbookResult> {
  const warnings: string[] = [];

  const mapped = mapQuotationData(quotation);
  const selectedKinds = mapped.sections.map((s) => s.kind);

  validateBeforeGeneration(mapped, selectedKinds);

  const workbook = await loadTemplateWorkbook();
  const worksheet = getTemplateWorksheet(workbook);

  const dynamicRowCounts: Partial<Record<TemplateSectionKind, number>> = {};
  for (const section of mapped.sections) {
    if (section.dynamicRows) dynamicRowCounts[section.kind] = section.dynamicRows.length;
  }

  const { layouts } = removeUnusedSections(worksheet, new Set(selectedKinds), dynamicRowCounts);

  for (const section of mapped.sections) {
    const config = getSectionConfig(section.kind);
    const layout = layouts.get(section.kind);
    if (!layout) continue;
    if (config.dynamicRow) fillDynamicRows(worksheet, config, layout, section);
    replaceVariables(worksheet, config, layout, section, warnings);

    // Static label text (not a {{placeholder}}) that must render bold
    // regardless — replaceVariables.ts only auto-bolds cells it actually
    // writes a value into. cell.style is replaced with a shallow copy of
    // itself first — see boldFont.ts's doc comment: ExcelJS gives cells
    // that share formatting the SAME style object reference, so mutating
    // cell.font in place would silently bold every other cell sharing it.
    for (const cellAddr of config.boldLabelCells ?? []) {
      const cell = worksheet.getCell(resolveFinalCell(config, layout, cellAddr));
      cell.style = { ...cell.style };
      cell.font = boldFont(cell.font);
    }
  }

  // Employer's Liability's B74 (=D62) / D76 (=D74) are native Excel formulas
  // reading WIBA's own cells — overwritten with static values because
  // WIBA's payroll rows are a dynamic region that (almost always) shifts
  // row 62 away from where the formula's original text points.
  const elSection = mapped.sections.find((s) => s.kind === "EMPLOYERS_LIABILITY");
  const wibaSection = mapped.sections.find((s) => s.kind === "WIBA");
  const elLayout = layouts.get("EMPLOYERS_LIABILITY");
  if (elSection && wibaSection && elLayout) {
    const elConfig = getSectionConfig("EMPLOYERS_LIABILITY");
    const b74 = worksheet.getCell(resolveFinalCell(elConfig, elLayout, "B74"));
    const d76 = worksheet.getCell(resolveFinalCell(elConfig, elLayout, "D76"));
    setBoldCellValue(b74, Number(wibaSection.values.wiba_gross_premium) || 0);
    setBoldCellValue(d76, Number(elSection.values.el_gross_premium) || 0);
  }

  // Common/header + footer variables (outside every section's row range).
  const customerNameCell = worksheet.getCell(TEMPLATE_CONFIG.commonVariables[0].cell);
  setBoldCellValue(customerNameCell, String(mapped.common.CUSTOMER_NAME ?? ""));

  // The template duplicates {{quotation_total_premium}} across two
  // adjacent footer rows (D475 AND D476, both labeled "TOTAL PREMIUM
  // (KES)" — a nominal two-row merge whose covered cell still carries its
  // own literal placeholder text rather than being a true empty merge
  // slave). Filling only the documented anchor cell (grandTotalCell)
  // leaves the duplicate unresolved, so every cell holding this exact
  // placeholder is filled instead of a single hardcoded address.
  const grandTotalPlaceholder = `{{${TEMPLATE_CONFIG.grandTotalVariable}}}`;
  for (let r = 1; r <= worksheet.rowCount; r++) {
    worksheet.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value === "string" && cell.value.trim() === grandTotalPlaceholder) {
        setBoldCellValue(cell, mapped.grandTotal);
      }
    });
  }

  const postValidation = validateAfterGeneration(worksheet);
  warnings.push(...postValidation.warnings);

  // Cross-check: the sum of every printed section's own total premium must
  // equal the stored quotation grand total exactly — catches a wrong or
  // missing section mapping even though the footer cell was written
  // directly from the same server-calculated number.
  const sumOfSectionTotals = mapped.sections.reduce((acc, section) => {
    const config = getSectionConfig(section.kind);
    return acc + (Number(section.values[config.summaryTotalVariable]) || 0);
  }, 0);
  validateGrandTotal(sumOfSectionTotals, mapped.grandTotal);

  applyOuterBorder(worksheet);

  // ExcelJS's own .d.ts shadows the global `Buffer` type with a minimal
  // `extends ArrayBuffer` shim, which is incompatible with @types/node's
  // real Buffer — Buffer.from() normalizes writeBuffer()'s actual runtime
  // Buffer instance back into that real type for restoreTemplateDrawings().
  const rawBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const buffer = await restoreTemplateDrawings(rawBuffer);
  const filename = `${quotation.quotationNumber}.xlsx`;

  return { buffer, filename, warnings };
}
