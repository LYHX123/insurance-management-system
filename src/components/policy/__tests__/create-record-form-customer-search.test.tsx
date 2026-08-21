import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LocaleProvider } from "@/i18n/locale-provider";
import { CreateMotorRecordForm } from "@/components/policy/motor/create-motor-record-form";
import { CreateNonMotorRecordForm } from "@/components/policy/non-motor/create-non-motor-record-form";
import { CreateBondRecordForm } from "@/components/policy/bond/create-bond-record-form";
import { CreateWorkPermitRecordForm } from "@/components/policy/work-permit/create-work-permit-record-form";
import type { CustomerOption } from "@/components/policy/types";

// Part A: Policy manual-create Customer field unified onto the shared
// SearchableSelect (same component/convention as the Claim forms' own
// Customer picker) across all four Policy categories — Motor, Non-Motor,
// Bond, Work Permit.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/(app)/policy/motor/actions", () => ({ createMotorRecordAction: vi.fn() }));
vi.mock("@/app/(app)/policy/non-motor/actions", () => ({ createNonMotorRecordAction: vi.fn() }));
vi.mock("@/app/(app)/policy/bond/actions", () => ({ createBondRecordAction: vi.fn() }));
vi.mock("@/app/(app)/policy/work-permit/actions", () => ({ createWorkPermitRecordAction: vi.fn() }));

// Matches this phase's spec example exactly (Part A.1).
const CJIK: CustomerOption = {
  id: "cust-cjik",
  companyName: "China Jiangxi International Kenya Limited",
  customerNumber: "CUST-0003",
  shortName: "CJIK",
  projects: [{ id: "proj-cjik-1", projectName: "CJIK Project 1" }],
};
const ACME: CustomerOption = {
  id: "cust-acme",
  companyName: "Acme Ltd",
  customerNumber: "CUST-0002",
  shortName: "ACME",
  projects: [{ id: "proj-acme-1", projectName: "Acme Project 1" }],
};
const CUSTOMERS = [CJIK, ACME];

beforeEach(() => {
  vi.clearAllMocks();
});

function renderForm(Form: (props: { customers: CustomerOption[] }) => React.ReactElement) {
  return render(
    <LocaleProvider initialLocale="en">
      <Form customers={CUSTOMERS} />
    </LocaleProvider>
  );
}

// Table-driven over all four Policy categories (Part A: "必须审计并覆盖... 不要只修
// Motor") — each is a distinct create form component, not a shared one, so
// each must be independently verified to have actually been switched over.
const FORMS: Array<{ name: string; Form: (props: { customers: CustomerOption[] }) => React.ReactElement }> = [
  { name: "Motor", Form: CreateMotorRecordForm },
  { name: "Non-Motor", Form: CreateNonMotorRecordForm },
  { name: "Bond", Form: CreateBondRecordForm },
  { name: "Work Permit", Form: CreateWorkPermitRecordForm },
];

describe.each(FORMS)("$name Policy create form — Customer SearchableSelect", ({ Form }) => {
  it("Case 4: renders a searchable Customer field (text input, not a plain <select>)", () => {
    renderForm(Form);
    const input = screen.getByPlaceholderText("Select Customer");
    expect(input.tagName).toBe("INPUT");
  });

  it("Case 1: filters by Company Name substring, case-insensitive", () => {
    renderForm(Form);
    const input = screen.getByPlaceholderText("Select Customer");
    fireEvent.change(input, { target: { value: "jiangxi" } });
    expect(screen.getByText("China Jiangxi International Kenya Limited (CUST-0003)")).toBeInTheDocument();
    expect(screen.queryByText("Acme Ltd (CUST-0002)")).not.toBeInTheDocument();
  });

  it("Case 2: filters by Short Name", () => {
    renderForm(Form);
    const input = screen.getByPlaceholderText("Select Customer");
    fireEvent.change(input, { target: { value: "CJIK" } });
    expect(screen.getByText("China Jiangxi International Kenya Limited (CUST-0003)")).toBeInTheDocument();
    expect(screen.queryByText("Acme Ltd (CUST-0002)")).not.toBeInTheDocument();
  });

  it("Case 3: filters by Customer Number, full or partial", () => {
    renderForm(Form);
    const input = screen.getByPlaceholderText("Select Customer");
    fireEvent.change(input, { target: { value: "0003" } });
    expect(screen.getByText("China Jiangxi International Kenya Limited (CUST-0003)")).toBeInTheDocument();
    expect(screen.queryByText("Acme Ltd (CUST-0002)")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "CUST-0003" } });
    expect(screen.getByText("China Jiangxi International Kenya Limited (CUST-0003)")).toBeInTheDocument();
  });

  it("shows the localized no-results label when nothing matches", () => {
    renderForm(Form);
    const input = screen.getByPlaceholderText("Select Customer");
    fireEvent.change(input, { target: { value: "no such customer" } });
    expect(screen.getByText("No customers found")).toBeInTheDocument();
  });

  it("Case 5: switching Customer clears the previously selected Customer's Project — no stale Project carries over", () => {
    renderForm(Form);
    const input = screen.getByPlaceholderText("Select Customer");

    fireEvent.change(input, { target: { value: "jiangxi" } });
    fireEvent.mouseDown(screen.getByText("China Jiangxi International Kenya Limited (CUST-0003)"));
    expect(screen.getByDisplayValue("China Jiangxi International Kenya Limited (CUST-0003)")).toBeInTheDocument();

    const projectSelects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    const projectSelect = projectSelects.find((s) => s.querySelector('option[value="proj-cjik-1"]'))!;
    fireEvent.change(projectSelect, { target: { value: "proj-cjik-1" } });
    expect(projectSelect.value).toBe("proj-cjik-1");

    // Switch Customer — Project selection must reset to "No project", and
    // the previous Customer's Project options must no longer be present.
    fireEvent.change(input, { target: { value: "acme" } });
    fireEvent.mouseDown(screen.getByText("Acme Ltd (CUST-0002)"));

    expect(projectSelect.value).toBe("");
    expect(projectSelect.querySelector('option[value="proj-cjik-1"]')).toBeNull();
    expect(projectSelect.querySelector('option[value="proj-acme-1"]')).not.toBeNull();
  });
});
