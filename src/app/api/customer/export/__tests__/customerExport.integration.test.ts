import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { config as loadDotenv } from "dotenv";

loadDotenv();

// Phase 13A — real-Postgres tests for the Customer list Excel export route.

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/i18n/get-locale", () => ({ getLocale: vi.fn(async () => "en") }));

let dbReachable = true;
let prisma: typeof import("@/lib/prisma").prisma;
let GET: typeof import("../route").GET;
let auth: ReturnType<typeof vi.fn>;

const TAG = `p13a-cust-${randomUUID().slice(0, 8)}`;

const EDIT_USER = { id: "u", role: "Staff", status: "ACTIVE", permissions: ["customer.edit"] };
const NO_CUSTOMER_USER = { id: "u", role: "Staff", status: "ACTIVE", permissions: ["policy.motor.view"] };

async function callExport(query: Record<string, string> = {}) {
  const sp = new URLSearchParams(query).toString();
  return GET(new NextRequest(`http://localhost:3001/api/customer/export${sp ? `?${sp}` : ""}`));
}
async function parseSheet(res: Response) {
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheet = wb.worksheets[0];
  const headers = (sheet.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? ""));
  const rows: string[][] = [];
  sheet.eachRow((row, n) => {
    if (n > 1) rows.push((row.values as unknown[]).slice(1).map((v) => String(v ?? "")));
  });
  return { headers, rows };
}

beforeAll(async () => {
  try {
    ({ prisma } = await import("@/lib/prisma"));
    ({ GET } = await import("../route"));
    ({ auth } = (await import("@/lib/auth")) as unknown as { auth: ReturnType<typeof vi.fn> });
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("customerExport.integration.test: no reachable database — skipping.", err);
    dbReachable = false;
    return;
  }
  auth.mockResolvedValue({ user: EDIT_USER });
  await prisma.customer.create({
    data: {
      customerNumber: `${TAG}-1`, companyName: `${TAG} Active Co`, pinNumber: `${TAG}-P1`,
      status: "ACTIVE", mainContactPerson: "Jane", mainPhoneNumber: "0712345678", registeredAddress: "Nairobi",
      projects: { create: [{ projectName: `${TAG} P1`, contactPerson: "x", phoneNumber: "0700000000" }, { projectName: `${TAG} P2`, contactPerson: "y", phoneNumber: "0700000001" }] },
    },
  });
  await prisma.customer.create({
    data: { customerNumber: `${TAG}-2`, companyName: `${TAG} Inactive Co`, pinNumber: `${TAG}-P2`, status: "INACTIVE" },
  });
});

afterAll(async () => {
  if (!dbReachable) return;
  await prisma.customerProject.deleteMany({ where: { customer: { customerNumber: { startsWith: TAG } } } });
  await prisma.customer.deleteMany({ where: { customerNumber: { startsWith: TAG } } });
});

describe("Customer export route (real DB)", () => {
  const mine = (rows: string[][]) => rows.filter((r) => r.some((c) => c.startsWith(TAG)));

  it("4: permission enforced server-side", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValueOnce({ user: NO_CUSTOMER_USER });
    expect((await callExport()).status).toBe(403);
    auth.mockResolvedValueOnce(null);
    expect((await callExport()).status).toBe(403);
  });

  it("1/3: respects the status filter; one row per customer (no contact fan-out)", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: EDIT_USER });
    const { rows } = await parseSheet(await callExport({ status: "INACTIVE" }));
    const ours = mine(rows);
    expect(ours.length).toBe(1);
    expect(ours[0].some((c) => c.includes("Inactive Co"))).toBe(true);
  });

  it("1: respects the search filter", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: EDIT_USER });
    const { rows } = await parseSheet(await callExport({ search: "active co" }));
    const ours = mine(rows);
    // "active co" substring-matches BOTH "Active Co" and "Inactive Co"
    expect(ours.length).toBe(2);
  });

  it("2/6: no filter -> exports all customers (both of ours present, project count did not multiply rows)", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: EDIT_USER });
    const { headers, rows } = await parseSheet(await callExport());
    const ours = mine(rows);
    expect(ours.length).toBe(2);
    expect(headers).toContain("Customer Number");
    expect(headers).toContain("Created Date");
    expect(headers).not.toContain("Actions");
    // the customer with 2 projects still contributes exactly 1 row
    expect(ours.filter((r) => r.some((c) => c.includes("Active Co"))).length).toBe(1);
  });

  it("filename signals whether a filter was applied", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: EDIT_USER });
    const plain = await callExport();
    expect(plain.headers.get("content-disposition")).toMatch(/Customers-\d{8}\.xlsx/);
    const filtered = await callExport({ status: "ACTIVE" });
    expect(filtered.headers.get("content-disposition")).toMatch(/Customers-Filtered-\d{8}\.xlsx/);
  });
});
