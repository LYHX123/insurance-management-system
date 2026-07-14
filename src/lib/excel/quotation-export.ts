import ExcelJS from "exceljs";
import {
  applyBodyCellStyle,
  applyGrandTotalCellStyle,
  applyLabelStyle,
  applyMoneyCellStyle,
  applyPercentCellStyle,
  applySectionHeadingStyle,
  applyTableHeaderStyle,
  applyTitleStyle,
  applyTotalLabelStyle,
  autoFitColumns,
} from "./quotation-style";

// V1 preview engine: builds the workbook directly with ExcelJS so we can
// validate the quotation data structure end-to-end before switching to a
// template-based renderer. The public shape of this module — the
// `exportQuotationExcel(data)` function and its input type — is the
// integration point the API route depends on; a future template-based
// implementation only needs to replace what happens *inside* this file.

export type QuotationExportCoverageItem = {
  insuredContent: string;
  sumInsured: number | null;
  rate: number | null;
  premium: number;
};

export type QuotationExportSection = {
  insuranceTypeName: string;
  items: QuotationExportCoverageItem[];
  basePremium: number;
  applyPHCF: boolean;
  phcfRate: number;
  phcfAmount: number;
  applyITL: boolean;
  itlRate: number;
  itlAmount: number;
  applyStampDuty: boolean;
  stampDuty: number;
  sectionTotal: number;
  clauses: string | null;
  exclusions: string | null;
  conditions: string | null;
};

export type QuotationExportData = {
  quotationNumber: string;
  quotationDate: Date;
  validUntil: Date | null;
  customerName: string;
  projectName: string | null;
  preparedBy: string;
  currency: string;
  sections: QuotationExportSection[];
  subtotalPremium: number;
  totalPHCF: number;
  totalITL: number;
  totalStampDuty: number;
  grandTotal: number;
};

const ITEM_TABLE_COLUMNS = 4; // Description | Sum Insured | Rate | Premium
const LAST_COLUMN = ITEM_TABLE_COLUMNS;

function addLabelValueRow(worksheet: ExcelJS.Worksheet, label: string, value: string) {
  const row = worksheet.addRow([label, value]);
  applyLabelStyle(row.getCell(1));
  worksheet.mergeCells(row.number, 2, row.number, LAST_COLUMN);
  return row;
}

function addSectionHeading(worksheet: ExcelJS.Worksheet, text: string) {
  const row = worksheet.addRow([text]);
  applySectionHeadingStyle(row.getCell(1));
  worksheet.mergeCells(row.number, 1, row.number, LAST_COLUMN);
  return row;
}

function addItemTableHeader(worksheet: ExcelJS.Worksheet) {
  const row = worksheet.addRow(["Description", "Sum Insured", "Rate", "Premium"]);
  row.eachCell((cell) => applyTableHeaderStyle(cell));
  return row;
}

function addItemRow(worksheet: ExcelJS.Worksheet, item: QuotationExportCoverageItem) {
  const row = worksheet.addRow([
    item.insuredContent,
    item.sumInsured,
    item.rate,
    item.premium,
  ]);
  applyBodyCellStyle(row.getCell(1));
  applyMoneyCellStyle(row.getCell(2));
  if (item.rate === null) {
    applyMoneyCellStyle(row.getCell(3));
  } else {
    applyPercentCellStyle(row.getCell(3));
  }
  applyMoneyCellStyle(row.getCell(4));
  return row;
}

function addChargeRow(worksheet: ExcelJS.Worksheet, label: string, amount: number) {
  const row = worksheet.addRow([label, null, null, amount]);
  worksheet.mergeCells(row.number, 1, row.number, LAST_COLUMN - 1);
  applyTotalLabelStyle(row.getCell(1));
  applyMoneyCellStyle(row.getCell(LAST_COLUMN));
  return row;
}

function addTermsBlock(worksheet: ExcelJS.Worksheet, title: string, text: string | null) {
  if (!text || !text.trim()) return;

  const headingRow = worksheet.addRow([title]);
  applyLabelStyle(headingRow.getCell(1));
  worksheet.mergeCells(headingRow.number, 1, headingRow.number, LAST_COLUMN);

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  lines.forEach((line, index) => {
    const row = worksheet.addRow([`Clause ${index + 1}: ${line}`]);
    worksheet.mergeCells(row.number, 1, row.number, LAST_COLUMN);
    applyBodyCellStyle(row.getCell(1));
  });
}

export async function exportQuotationExcel(data: QuotationExportData): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Insurance Management System";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Quotation", {
    pageSetup: { paperSize: 9, orientation: "portrait" },
  });

  const titleRow = worksheet.addRow(["INSURANCE QUOTATION"]);
  titleRow.height = 32;
  applyTitleStyle(titleRow.getCell(1));
  worksheet.mergeCells(titleRow.number, 1, titleRow.number, LAST_COLUMN);

  worksheet.addRow([]);

  addLabelValueRow(worksheet, "Quotation No", data.quotationNumber);
  addLabelValueRow(worksheet, "Quotation Date", formatDate(data.quotationDate));
  addLabelValueRow(worksheet, "Valid Until", data.validUntil ? formatDate(data.validUntil) : "—");
  addLabelValueRow(worksheet, "Customer", data.customerName);
  addLabelValueRow(worksheet, "Project", data.projectName ?? "—");
  addLabelValueRow(worksheet, "Prepared By", data.preparedBy);

  worksheet.addRow([]);

  for (const section of data.sections) {
    addSectionHeading(worksheet, section.insuranceTypeName);
    addItemTableHeader(worksheet);
    section.items.forEach((item) => addItemRow(worksheet, item));

    worksheet.addRow([]);
    addChargeRow(worksheet, "Base Premium", section.basePremium);
    addChargeRow(
      worksheet,
      `PHCF (${formatPercentLabel(section.applyPHCF, section.phcfRate)})`,
      section.applyPHCF ? section.phcfAmount : 0
    );
    addChargeRow(
      worksheet,
      `ITL (${formatPercentLabel(section.applyITL, section.itlRate)})`,
      section.applyITL ? section.itlAmount : 0
    );
    addChargeRow(worksheet, "Stamp Duty", section.applyStampDuty ? section.stampDuty : 0);
    const sectionTotalRow = addChargeRow(worksheet, "Section Total", section.sectionTotal);
    applyTotalLabelStyle(sectionTotalRow.getCell(1));
    applyGrandTotalCellStyle(sectionTotalRow.getCell(LAST_COLUMN));

    worksheet.addRow([]);
    addTermsBlock(worksheet, "Terms & Conditions — Clauses", section.clauses);
    addTermsBlock(worksheet, "Terms & Conditions — Exclusions", section.exclusions);
    addTermsBlock(worksheet, "Terms & Conditions — Conditions", section.conditions);

    worksheet.addRow([]);
  }

  addSectionHeading(worksheet, "Grand Summary");
  addChargeRow(worksheet, "Subtotal Premium", data.subtotalPremium);
  addChargeRow(worksheet, "Total PHCF", data.totalPHCF);
  addChargeRow(worksheet, "Total ITL", data.totalITL);
  addChargeRow(worksheet, "Stamp Duty", data.totalStampDuty);
  const grandTotalRow = addChargeRow(worksheet, "Grand Total", data.grandTotal);
  applyTotalLabelStyle(grandTotalRow.getCell(1));
  applyGrandTotalCellStyle(grandTotalRow.getCell(LAST_COLUMN));

  autoFitColumns(worksheet);

  return workbook.xlsx.writeBuffer();
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatPercentLabel(applied: boolean, rate: number): string {
  return applied ? `${rate.toFixed(2)}%` : "not applied";
}
