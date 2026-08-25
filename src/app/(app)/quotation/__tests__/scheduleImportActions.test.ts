import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildWibaFixtureBuffer, buildCpmFixtureBuffer } from "@/lib/quotationScheduleImport/__tests__/fixtureHelpers";

// Phase 9 — WIBA / CPM Schedule Import, Case 12: parseWibaScheduleAction/
// parseCpmScheduleAction (Preview) must NEVER touch the database. Proven
// here by mocking @/lib/prisma with a Proxy that throws on ANY property
// access — if the parse path ever imported/called prisma for anything, this
// test fails immediately, rather than merely asserting a mock wasn't
// called (which a refactor could silently stop covering).

const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => auth(...args) }));

vi.mock("@/lib/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return { ...actual, canEdit: () => true };
});

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(`Unexpected database access via prisma.${String(prop)} during a stateless schedule parse/preview`);
      },
    }
  ),
}));

function fileFormData(buffer: Buffer, name: string): FormData {
  const formData = new FormData();
  formData.set("file", new File([buffer], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseWibaScheduleAction", () => {
  it("Case 12: a valid WIBA schedule parses successfully without ever touching prisma", async () => {
    auth.mockResolvedValue({ user: { id: "u1", role: "Staff", status: "ACTIVE", permissions: ["quotation"] } });
    const { parseWibaScheduleAction } = await import("../actions");
    const buffer = await buildWibaFixtureBuffer([{ occupation: "Mason", basicSalary: 14000, allowance: 3500, otherEarnings: 10000, employeeCount: 50 }]);

    const result = await parseWibaScheduleAction(fileFormData(buffer, "wiba.xlsx"));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(1);
  });

  it("an unauthenticated/unauthorized request is rejected before parsing", async () => {
    auth.mockResolvedValue(null);
    const { parseWibaScheduleAction } = await import("../actions");
    const buffer = await buildWibaFixtureBuffer([{ occupation: "Mason", basicSalary: 14000, employeeCount: 1 }]);

    const result = await parseWibaScheduleAction(fileFormData(buffer, "wiba.xlsx"));
    expect(result).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("a non-.xlsx file is rejected as INVALID_FILE_TYPE", async () => {
    auth.mockResolvedValue({ user: { id: "u1", role: "Staff", status: "ACTIVE", permissions: ["quotation"] } });
    const { parseWibaScheduleAction } = await import("../actions");

    const result = await parseWibaScheduleAction(fileFormData(Buffer.from("not excel"), "wiba.csv"));
    expect(result).toEqual({ ok: false, error: "INVALID_FILE_TYPE" });
  });

  it("no file at all is rejected as INVALID_FILE_TYPE", async () => {
    auth.mockResolvedValue({ user: { id: "u1", role: "Staff", status: "ACTIVE", permissions: ["quotation"] } });
    const { parseWibaScheduleAction } = await import("../actions");

    const result = await parseWibaScheduleAction(new FormData());
    expect(result).toEqual({ ok: false, error: "INVALID_FILE_TYPE" });
  });

  it("a genuinely invalid template (wrong workbook shape) is rejected as INVALID_TEMPLATE", async () => {
    auth.mockResolvedValue({ user: { id: "u1", role: "Staff", status: "ACTIVE", permissions: ["quotation"] } });
    const { parseWibaScheduleAction } = await import("../actions");
    // A CPM-shaped workbook fed to the WIBA parser.
    const buffer = await buildCpmFixtureBuffer([{ equipmentName: "Excavator", quantity: 1, unitValue: 100 }]);

    const result = await parseWibaScheduleAction(fileFormData(buffer, "wrong.xlsx"));
    expect(result).toEqual({ ok: false, error: "INVALID_TEMPLATE" });
  });
});

describe("parseCpmScheduleAction", () => {
  it("Case 12: a valid CPM schedule parses successfully without ever touching prisma", async () => {
    auth.mockResolvedValue({ user: { id: "u1", role: "Staff", status: "ACTIVE", permissions: ["quotation"] } });
    const { parseCpmScheduleAction } = await import("../actions");
    const buffer = await buildCpmFixtureBuffer([{ equipmentName: "Excavator", quantity: 2, unitValue: 500000 }]);

    const result = await parseCpmScheduleAction(fileFormData(buffer, "cpm.xlsx"));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(1);
  });

  it("an unauthenticated/unauthorized request is rejected before parsing", async () => {
    auth.mockResolvedValue(null);
    const { parseCpmScheduleAction } = await import("../actions");
    const buffer = await buildCpmFixtureBuffer([{ equipmentName: "Excavator", quantity: 1, unitValue: 100 }]);

    const result = await parseCpmScheduleAction(fileFormData(buffer, "cpm.xlsx"));
    expect(result).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("a non-.xlsx file is rejected as INVALID_FILE_TYPE", async () => {
    auth.mockResolvedValue({ user: { id: "u1", role: "Staff", status: "ACTIVE", permissions: ["quotation"] } });
    const { parseCpmScheduleAction } = await import("../actions");

    const result = await parseCpmScheduleAction(fileFormData(Buffer.from("not excel"), "cpm.xls"));
    expect(result).toEqual({ ok: false, error: "INVALID_FILE_TYPE" });
  });
});
