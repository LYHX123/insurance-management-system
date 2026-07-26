import ExcelJS from "exceljs";
import path from "path";
import { readdir, readFile } from "fs/promises";
import { INVOICE_TEMPLATE_DIR, INVOICE_TEMPLATE_RELATIVE_PATH } from "./config";

export class InvoiceTemplateNotFoundError extends Error {
  constructor(public readonly xlsxFilesFound: string[]) {
    super(
      xlsxFilesFound.length === 0
        ? `No .xlsx template file found under ${INVOICE_TEMPLATE_DIR}`
        : `Expected exactly one .xlsx file under ${INVOICE_TEMPLATE_DIR}, found ${xlsxFilesFound.length}: ${xlsxFilesFound.join(", ")}`
    );
    this.name = "InvoiceTemplateNotFoundError";
  }
}

// Confirms exactly one .xlsx exists under templates/inovice/ before ever
// reading it — per this phase's spec ("If more than one .xlsx file exists,
// stop and report the filenames rather than guessing"). Never writes to
// this directory; the template is only ever read.
export async function loadInvoiceTemplateWorkbook(): Promise<{ workbook: ExcelJS.Workbook; worksheet: ExcelJS.Worksheet }> {
  const dirAbsolute = path.join(process.cwd(), INVOICE_TEMPLATE_DIR);
  const entries = await readdir(dirAbsolute);
  const xlsxFiles = entries.filter((f) => f.toLowerCase().endsWith(".xlsx"));
  if (xlsxFiles.length !== 1) {
    throw new InvoiceTemplateNotFoundError(xlsxFiles);
  }

  const absolutePath = path.join(process.cwd(), INVOICE_TEMPLATE_RELATIVE_PATH);
  const buffer = await readFile(absolutePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("Invoice template workbook has no worksheets");

  return { workbook, worksheet };
}
