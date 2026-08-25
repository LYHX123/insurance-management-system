import { readFileSync } from "fs";
import { join } from "path";
import ExcelJS from "exceljs";

// Phase 9 — WIBA / CPM Schedule Import test fixtures. Loads a COPY of the
// real, approved template files (fixtures/*.xlsx — themselves untouched
// copies of templates/import/*.xlsx, never the originals) and fills in
// specific data cells for each test scenario, so the parser is exercised
// against the actual real-template structure (bilingual richText headers,
// pre-filled No/SRN column, real formula cells in G/H or F, the real
// merged footer cell) rather than a hand-rolled approximation — per this
// phase's spec: "Parser tests should use copies/fixtures derived from
// these real templates wherever practical."

const FIXTURES_DIR = join(__dirname, "fixtures");

export async function loadWibaFixtureWorkbook(): Promise<ExcelJS.Workbook> {
  const buffer = readFileSync(join(FIXTURES_DIR, "WIBA-IMPORT-TEMPLATE.xlsx"));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return workbook;
}

export async function loadCpmFixtureWorkbook(): Promise<ExcelJS.Workbook> {
  const buffer = readFileSync(join(FIXTURES_DIR, "CPM-IMPORT-TEMPLATE.xlsx"));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return workbook;
}

export type WibaFixtureRow = {
  occupation?: string | null;
  basicSalary?: number | string | null;
  allowance?: number | string | null;
  otherEarnings?: number | string | null;
  employeeCount?: number | string | null;
};

// Fills rows starting at row 2 (the real template's data start row) on the
// real "WIBA LIST" worksheet. The template's own pre-built rows only go up
// to row 14 (13 data rows) with a TOTAL footer at row 15 — for scenarios
// needing MORE rows than that (e.g. the 50+ row regression test), use
// buildSyntheticWibaWorkbook below instead, which is not derived from the
// real file (documented at that function's own definition).
export async function buildWibaFixtureBuffer(rows: WibaFixtureRow[]): Promise<Buffer> {
  const workbook = await loadWibaFixtureWorkbook();
  const worksheet = workbook.getWorksheet("WIBA LIST")!;
  rows.forEach((row, index) => {
    const r = index + 2;
    worksheet.getCell(`B${r}`).value = row.occupation ?? null;
    worksheet.getCell(`C${r}`).value = row.basicSalary ?? null;
    worksheet.getCell(`D${r}`).value = row.allowance ?? null;
    worksheet.getCell(`E${r}`).value = row.otherEarnings ?? null;
    worksheet.getCell(`F${r}`).value = row.employeeCount ?? null;
  });
  // Blank out any remaining pre-built rows beyond what this test supplied,
  // so they correctly parse as skippable blank rows rather than leftover
  // template artifacts.
  for (let r = rows.length + 2; r <= 14; r++) {
    worksheet.getCell(`B${r}`).value = null;
    worksheet.getCell(`C${r}`).value = null;
    worksheet.getCell(`D${r}`).value = null;
    worksheet.getCell(`E${r}`).value = null;
    worksheet.getCell(`F${r}`).value = null;
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export type CpmFixtureRow = {
  equipmentName?: string | null;
  chassisOrPlate?: string | null;
  quantity?: number | string | null;
  unitValue?: number | string | null;
};

// Same technique as buildWibaFixtureBuffer, for the real CPM template's
// "EQUIPMENT,TOOLS, MACHINE" worksheet (data rows 2-13, "Total Sum" footer
// at row 14 with A14:C14 merged).
export async function buildCpmFixtureBuffer(rows: CpmFixtureRow[]): Promise<Buffer> {
  const workbook = await loadCpmFixtureWorkbook();
  const worksheet = workbook.getWorksheet("EQUIPMENT,TOOLS, MACHINE")!;
  rows.forEach((row, index) => {
    const r = index + 2;
    worksheet.getCell(`B${r}`).value = row.equipmentName ?? null;
    worksheet.getCell(`C${r}`).value = row.chassisOrPlate ?? null;
    worksheet.getCell(`D${r}`).value = row.quantity ?? null;
    worksheet.getCell(`E${r}`).value = row.unitValue ?? null;
  });
  for (let r = rows.length + 2; r <= 13; r++) {
    worksheet.getCell(`B${r}`).value = null;
    worksheet.getCell(`C${r}`).value = null;
    worksheet.getCell(`D${r}`).value = null;
    worksheet.getCell(`E${r}`).value = null;
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// Not derived from the real template file — used only for the "many more
// rows than the template's own pre-built range" regression test, to prove
// the parser scans to the sheet's actual last row rather than a hardcoded
// limit (this phase's spec, Part VII: "不要写死 Excel 行数"). Structurally
// equivalent to the real template (same header row 1 text, same footer
// marker), just built fresh so an arbitrary row count is trivial to
// generate.
export async function buildSyntheticWibaWorkbook(rowCount: number): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("WIBA LIST");
  worksheet.getRow(1).values = ["No", "Occupation", "Basic Salary / month", "Allowance / month", "Over time/Bonus / month", "Number of Employees", "Estimated Total Monthly Salary", "Estimated Annual Salary"];
  for (let i = 0; i < rowCount; i++) {
    const r = i + 2;
    worksheet.getRow(r).values = [i + 1, `Occupation ${i + 1}`, 10000, 1000, 500, 2];
  }
  worksheet.getRow(rowCount + 2).getCell(5).value = "TOTAL";
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function buildSyntheticCpmWorkbook(rowCount: number): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("EQUIPMENT,TOOLS, MACHINE");
  worksheet.getRow(1).values = ["SRN", "EQUIPMENT NAME", "CHASSIS NUMBER / NUMBER PLATE (OPTIONAL)", "QUANTITY", "SINGLE UNIT VALUE/KES", "TOTAL VALUE/KES"];
  for (let i = 0; i < rowCount; i++) {
    const r = i + 2;
    worksheet.getRow(r).values = [i + 1, `Equipment ${i + 1}`, null, 3, 1000];
  }
  worksheet.getRow(rowCount + 2).getCell(1).value = "Total Sum";
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
