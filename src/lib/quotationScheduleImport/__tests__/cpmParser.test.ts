import { describe, it, expect } from "vitest";
import { parseCpmSchedule } from "../cpmParser";
import { buildCpmFixtureBuffer, buildSyntheticCpmWorkbook, loadCpmFixtureWorkbook, buildSyntheticWibaWorkbook } from "./fixtureHelpers";

// Phase 9 — CPM Schedule Import parser tests. Every scenario below (except
// the explicitly-noted "50+ rows" one) parses a COPY of the real, approved
// CPM-IMPORT-TEMPLATE.xlsx with specific data cells filled in — see
// fixtureHelpers.ts.

describe("parseCpmSchedule", () => {
  it("Case 1: a single valid equipment row parses correctly", async () => {
    const buffer = await buildCpmFixtureBuffer([{ equipmentName: "Excavator", chassisOrPlate: "KDX 123X", quantity: 2, unitValue: 500000 }]);
    const result = await parseCpmSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].status).toBe("valid");
    expect(result.rows[0].totalValue).toBe("1000000");
    expect(result.hasErrors).toBe(false);
  });

  it("Case 2: multiple valid equipment rows all parse with correct totals", async () => {
    const buffer = await buildCpmFixtureBuffer([
      { equipmentName: "Excavator", quantity: 2, unitValue: 500000 },
      { equipmentName: "Bulldozer", quantity: 1, unitValue: 800000 },
      { equipmentName: "Generator", quantity: 5, unitValue: 40000 },
    ]);
    const result = await parseCpmSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(3);
    expect(result.rows.every((r) => r.status === "valid")).toBe(true);
    expect(result.totals.totalQuantity).toBe(2 + 1 + 5);
    expect(result.totals.totalSumInsured).toBe(1000000 + 800000 + 200000);
  });

  it("Case 3: blank Chassis/Number Plate is allowed — valid row, chassisOrPlate is an empty string", async () => {
    const buffer = await buildCpmFixtureBuffer([{ equipmentName: "Generator", chassisOrPlate: null, quantity: 3, unitValue: 40000 }]);
    const result = await parseCpmSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("valid");
    expect(result.rows[0].chassisOrPlate).toBe("");
  });

  it("Case 4: chassis text is preserved exactly as entered, never numeric-converted", async () => {
    const buffer = await buildCpmFixtureBuffer([{ equipmentName: "Truck", chassisOrPlate: "KDA 001A / CH-9987XZ", quantity: 1, unitValue: 100000 }]);
    const result = await parseCpmSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].chassisOrPlate).toBe("KDA 001A / CH-9987XZ");
  });

  it("Case 5: a row with no Equipment Name is an error", async () => {
    const buffer = await buildCpmFixtureBuffer([{ equipmentName: null, quantity: 2, unitValue: 500000 }]);
    const result = await parseCpmSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("error");
    expect(result.rows[0].errorCode).toBe("EQUIPMENT_NAME_REQUIRED");
    expect(result.hasErrors).toBe(true);
  });

  it("Case 6: Quantity <= 0 (or blank) is rejected", async () => {
    const buffer = await buildCpmFixtureBuffer([
      { equipmentName: "Excavator", quantity: 0, unitValue: 500000 },
      { equipmentName: "Bulldozer", quantity: null, unitValue: 500000 },
    ]);
    const result = await parseCpmSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].errorCode).toBe("QUANTITY_INVALID");
    expect(result.rows[1].errorCode).toBe("QUANTITY_INVALID");
  });

  it("Case 7: an invalid (negative) Unit Value is an error", async () => {
    const buffer = await buildCpmFixtureBuffer([{ equipmentName: "Excavator", quantity: 1, unitValue: -500 }]);
    const result = await parseCpmSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("error");
    expect(result.rows[0].errorCode).toBe("UNIT_VALUE_INVALID");
  });

  it("Case 8: the workbook's own Total Value (column F) formula result is never trusted — recalculated correctly even when tampered", async () => {
    const workbook = await loadCpmFixtureWorkbook();
    const worksheet = workbook.getWorksheet("EQUIPMENT,TOOLS, MACHINE")!;
    worksheet.getCell("B2").value = "Excavator";
    worksheet.getCell("D2").value = 2;
    worksheet.getCell("E2").value = 500000;
    worksheet.getCell("F2").value = 1; // deliberately wrong
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await parseCpmSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].totalValue).toBe("1000000"); // 2 * 500000, not the tampered F2=1
  });

  it("Case 9: the 'Total Sum' footer row (merged A14:C14) is never imported as a data row", async () => {
    const buffer = await buildCpmFixtureBuffer([{ equipmentName: "Excavator", quantity: 2, unitValue: 500000 }]);
    const result = await parseCpmSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows.some((r) => r.equipmentName.toLowerCase().includes("total"))).toBe(false);
  });

  it("Case 10: blank rows between data rows are skipped, not imported and not errors", async () => {
    const buffer = await buildCpmFixtureBuffer([
      { equipmentName: "Excavator", quantity: 2, unitValue: 500000 },
      {},
      { equipmentName: "Bulldozer", quantity: 1, unitValue: 800000 },
    ]);
    const result = await parseCpmSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
    expect(result.blankRowsSkipped).toBeGreaterThanOrEqual(1);
    expect(result.rows.map((r) => r.equipmentName)).toEqual(["Excavator", "Bulldozer"]);
  });

  it("Case 11: 50+ equipment rows are all scanned — the parser never hardcodes a row limit", async () => {
    const buffer = await buildSyntheticCpmWorkbook(55);
    const result = await parseCpmSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(55);
    expect(result.rows.every((r) => r.status === "valid")).toBe(true);
    expect(result.totals.totalQuantity).toBe(55 * 3);
  });

  it("an equipment name containing the word 'total' is NOT misclassified as the footer", async () => {
    const buffer = await buildCpmFixtureBuffer([{ equipmentName: "Total Station (Survey Equipment)", quantity: 1, unitValue: 250000 }]);
    const result = await parseCpmSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].equipmentName).toBe("Total Station (Survey Equipment)");
  });

  it("rejects a workbook with no matching CPM worksheet as INVALID_TEMPLATE", async () => {
    const buffer = await buildSyntheticWibaWorkbook(3);
    const result = await parseCpmSchedule(buffer);
    expect(result).toEqual({ ok: false, error: "INVALID_TEMPLATE" });
  });
});
