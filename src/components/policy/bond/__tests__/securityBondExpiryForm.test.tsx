import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LocaleProvider } from "@/i18n/locale-provider";
import { CreateBondRecordForm } from "@/components/policy/bond/create-bond-record-form";
import type { CustomerOption } from "@/components/policy/types";

// Phase 13C — the Create Bond form makes the Expiry Date field visually and
// functionally optional ONLY while Security Bond is selected, and re-arms the
// requirement the instant the user switches to any other Bond type (spec
// §5/§6/§7). A date the user already typed is never auto-cleared.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/(app)/policy/bond/actions", () => ({ createBondRecordAction: vi.fn() }));

const ACME: CustomerOption = {
  id: "cust-acme",
  companyName: "Acme Ltd",
  customerNumber: "CUST-0002",
  shortName: "ACME",
  projects: [],
};

beforeEach(() => vi.clearAllMocks());

function renderForm() {
  return render(
    <LocaleProvider initialLocale="en">
      <CreateBondRecordForm customers={[ACME]} />
    </LocaleProvider>
  );
}

// The Expiry Date field's <label> text toggles; grab the <input> next to
// whichever label is currently shown.
function expiryInput(): HTMLInputElement {
  const label =
    screen.queryByText("Expiry Date (optional)") ?? screen.getByText("Expiry Date");
  const input = label.parentElement?.querySelector("input");
  if (!input) throw new Error("expiry input not found");
  return input as HTMLInputElement;
}

function selectBondType(value: string) {
  const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
  const bondSelect = selects.find((s) => s.querySelector('option[value="SECURITY_BOND"]'));
  if (!bondSelect) throw new Error("Type of Bond select not found");
  fireEvent.change(bondSelect, { target: { value } });
}

describe("Create Bond form — conditional Expiry Date requirement", () => {
  it("expiry is required and labelled plainly for a normal Bond type", () => {
    renderForm();
    selectBondType("TENDER_BOND");
    expect(screen.getByText("Expiry Date")).toBeInTheDocument();
    expect(screen.queryByText("Expiry Date (optional)")).not.toBeInTheDocument();
    expect(expiryInput().required).toBe(true);
  });

  it("selecting Security Bond makes expiry optional (label + no required attribute)", () => {
    renderForm();
    selectBondType("SECURITY_BOND");
    expect(screen.getByText("Expiry Date (optional)")).toBeInTheDocument();
    expect(expiryInput().required).toBe(false);
  });

  it("switching Security Bond -> normal Bond re-arms the requirement immediately", () => {
    renderForm();
    selectBondType("SECURITY_BOND");
    expect(expiryInput().required).toBe(false);
    selectBondType("PERFORMANCE_BOND");
    expect(screen.getByText("Expiry Date")).toBeInTheDocument();
    expect(expiryInput().required).toBe(true);
  });

  it("does not auto-clear a date the user already entered when switching to Security Bond", () => {
    renderForm();
    selectBondType("TENDER_BOND");
    fireEvent.change(expiryInput(), { target: { value: "2027-09-04" } });
    expect(expiryInput().value).toBe("2027-09-04");
    selectBondType("SECURITY_BOND");
    expect(expiryInput().value).toBe("2027-09-04");
  });

  it("keeps Security Bond in the Type of Bond option list", () => {
    renderForm();
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    const bondSelect = selects.find((s) => s.querySelector('option[value="SECURITY_BOND"]'));
    expect(bondSelect?.querySelector('option[value="SECURITY_BOND"]')?.textContent).toBe("Security Bond");
  });
});
