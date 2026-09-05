import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { LocaleProvider } from "@/i18n/locale-provider";
import { MotorListTable } from "@/components/policy/motor/motor-list-table";
import type { MotorListRow } from "@/components/policy/types";

// Phase 12C — the Motor list Valuation column: a badge for a Comprehensive
// row with a tracked status, "—" for everything else.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/policy/motor",
  useSearchParams: () => new URLSearchParams(),
}));

function row(overrides: Partial<MotorListRow>): MotorListRow {
  return {
    id: `id-${Math.random()}`,
    recordNumber: "PM202609-0001",
    processingDate: "2026-09-05T00:00:00.000Z",
    customerId: "c1",
    customerName: "ABC Construction Ltd",
    insuranceType: "COMPREHENSIVE",
    registrationNumber: "KAA 111A",
    insurerName: "AAR",
    expiryDate: "2026-10-04T00:00:00.000Z",
    clientPremium: "5000.00",
    clientBalance: "0.00",
    insurerBalance: "0.00",
    businessStatus: "ACTIVE",
    contactPerson: null,
    valuationStatus: null,
    ...overrides,
  };
}

function renderList(records: MotorListRow[], locale: "en" | "zh" = "en") {
  return render(
    <LocaleProvider initialLocale={locale}>
      <MotorListTable records={records} canEdit={false} />
    </LocaleProvider>
  );
}

function cellFor(recordNumber: string, colIndex: number): HTMLElement {
  const link = screen.getByText(recordNumber);
  const tr = link.closest("tr") as HTMLTableRowElement;
  return within(tr).getAllByRole("cell")[colIndex] as HTMLElement;
}

// Column order: 0 Record | 1 Processing | 2 Customer | 3 Contact | 4 Type |
// 5 Valuation | 6 Reg | ...
const VALUATION_COL = 5;

describe("MotorListTable — Valuation column (EN)", () => {
  it("C8: NOT_ARRANGED renders the 'Not Arranged' badge", () => {
    renderList([row({ recordNumber: "PM-NA", valuationStatus: "NOT_ARRANGED" })]);
    expect(within(cellFor("PM-NA", VALUATION_COL)).getByText("Not Arranged")).toBeInTheDocument();
  });

  it("C9: IN_PROGRESS renders the 'In Progress' badge", () => {
    renderList([row({ recordNumber: "PM-IP", valuationStatus: "IN_PROGRESS" })]);
    expect(within(cellFor("PM-IP", VALUATION_COL)).getByText("In Progress")).toBeInTheDocument();
  });

  it("C10: COMPLETED renders the 'Completed' badge", () => {
    renderList([row({ recordNumber: "PM-DONE", valuationStatus: "COMPLETED" })]);
    expect(within(cellFor("PM-DONE", VALUATION_COL)).getByText("Completed")).toBeInTheDocument();
  });

  it("C11: a non-Comprehensive row shows — even if a status somehow leaked in", () => {
    renderList([row({ recordNumber: "PM-TP", insuranceType: "THIRD PARTY", valuationStatus: "NOT_ARRANGED" })]);
    expect(cellFor("PM-TP", VALUATION_COL).textContent).toBe("—");
  });

  it("a Comprehensive row with null status shows —", () => {
    renderList([row({ recordNumber: "PM-NULL", valuationStatus: null })]);
    expect(cellFor("PM-NULL", VALUATION_COL).textContent).toBe("—");
  });

  it("the Valuation header + filter are present", () => {
    renderList([row({})]);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toContain("Valuation");
    expect(screen.getByLabelText("Valuation Status")).toBeInTheDocument();
  });
});

describe("MotorListTable — Valuation column (中文)", () => {
  it("C24: Chinese badge + header labels render", () => {
    renderList([row({ recordNumber: "PM-ZH", valuationStatus: "IN_PROGRESS" })], "zh");
    expect(within(cellFor("PM-ZH", VALUATION_COL)).getByText("评估中")).toBeInTheDocument();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toContain("车辆评估");
  });
});
