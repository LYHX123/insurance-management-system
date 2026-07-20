import { readFile } from "fs/promises";
import path from "path";
import ExcelJS from "exceljs";
import { TEMPLATE_CONFIG } from "./config";

// The template file is read from disk fresh on every call — each generation
// gets its own in-memory Workbook instance since removeUnusedSections.ts
// mutates it directly (row deletion/insertion is not something we want to
// risk sharing across concurrent requests).
export async function loadTemplateWorkbook(): Promise<ExcelJS.Workbook> {
  const absolutePath = path.join(/* turbopackIgnore: true */ process.cwd(), TEMPLATE_CONFIG.templateRelativePath);

  let buffer: Buffer;
  try {
    buffer = await readFile(absolutePath);
  } catch (err) {
    throw new Error(
      `Quotation Excel template not found at "${TEMPLATE_CONFIG.templateRelativePath}". ` +
        `(${err instanceof Error ? err.message : String(err)})`
    );
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const worksheet = workbook.getWorksheet(TEMPLATE_CONFIG.sheetName);
  if (!worksheet) {
    throw new Error(
      `Quotation Excel template is missing the expected sheet "${TEMPLATE_CONFIG.sheetName}". ` +
        `Found sheets: ${workbook.worksheets.map((w) => w.name).join(", ")}`
    );
  }

  return workbook;
}

export function getTemplateWorksheet(workbook: ExcelJS.Workbook): ExcelJS.Worksheet {
  const worksheet = workbook.getWorksheet(TEMPLATE_CONFIG.sheetName);
  if (!worksheet) {
    throw new Error(`Sheet "${TEMPLATE_CONFIG.sheetName}" not found in loaded workbook.`);
  }
  return worksheet;
}
