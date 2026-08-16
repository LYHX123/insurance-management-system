import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LocaleProvider } from "@/i18n/locale-provider";
import { CreateInvoiceForm } from "@/components/invoice/create-invoice-form";
import type { EligiblePolicyRow } from "@/lib/invoice/eligibility";

// Phase 5 "Combined Invoice grouping" — from any Policy Detail's Create
// Invoice button, policies sharing the launching Policy's quotationCaseId
// must default-select together (Part 6), other quotation-case groups and
// historical (no-quotation) policies must render but stay unselected (Part
// 3), an already-invoiced Policy must be shown disabled with its Invoice
// reference rather than silently hidden (Part 7), and the authoritative
// validation must always stay in createInvoiceAction — this component only
// ever proposes a selection.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const createInvoiceActionMock = vi.fn();
vi.mock("@/app/(app)/invoice/actions", () => ({
  createInvoiceAction: (...args: unknown[]) => createInvoiceActionMock(...args),
}));

function makeRow(overrides: Partial<EligiblePolicyRow>): EligiblePolicyRow {
  return {
    id: "pol-x",
    recordNumber: "PN-0001",
    category: "NON_MOTOR",
    customerId: "cust-1",
    customerName: "Acme Ltd",
    processingDate: "2026-08-16T00:00:00.000Z",
    policyClass: "CAR",
    policyNumber: "CAR/2026/001",
    effectiveDate: "2026-09-01T00:00:00.000Z",
    expiryDate: "2027-08-31T00:00:00.000Z",
    clientPremium: "500000",
    quotationCaseId: null,
    quotationNumber: null,
    isEligible: true,
    activeInvoiceRef: null,
    ...overrides,
  };
}

function renderForm(policies: EligiblePolicyRow[], defaultSelectedPolicyId: string) {
  return render(
    <LocaleProvider initialLocale="en">
      <CreateInvoiceForm
        blocked={null}
        customerId="cust-1"
        customerName="Acme Ltd"
        customerPin="P000111222A"
        policies={policies}
        defaultSelectedPolicyId={defaultSelectedPolicyId}
        sourcePolicy={{ id: defaultSelectedPolicyId, category: "NON_MOTOR" }}
        sourcePolicyReturnTo={null}
      />
    </LocaleProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  createInvoiceActionMock.mockResolvedValue({ success: true, id: "inv-1", invoiceNumber: "INV202608-0001" });
});

describe("CreateInvoiceForm — Phase 5 quotation-case grouping", () => {
  it("Case 1/14: a single, ungrouped Policy submits exactly itself", async () => {
    const car = makeRow({ id: "pol-car", recordNumber: "PN-CAR", policyClass: "CAR", clientPremium: "500000" });
    renderForm([car], "pol-car");

    expect((screen.getByLabelText("PN-CAR") as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Generate Invoice" }));
    await waitFor(() => expect(createInvoiceActionMock).toHaveBeenCalledTimes(1));

    const payload = createInvoiceActionMock.mock.calls[0][0];
    expect(payload.policyRecordIds).toEqual(["pol-car"]);
  });

  it("Case 2: CAR + WIBA + EL in the same Quotation Case are ALL default-selected, grouped under one header, with the correct total", () => {
    const car = makeRow({ id: "pol-car", recordNumber: "PN-CAR", clientPremium: "500000", quotationCaseId: "case-1", quotationNumber: "QT202608-006" });
    const wiba = makeRow({ id: "pol-wiba", recordNumber: "PN-WIBA", clientPremium: "80000", quotationCaseId: "case-1", quotationNumber: "QT202608-006" });
    const el = makeRow({ id: "pol-el", recordNumber: "PN-EL", clientPremium: "60000", quotationCaseId: "case-1", quotationNumber: "QT202608-006" });
    renderForm([car, wiba, el], "pol-car");

    expect((screen.getByLabelText("PN-CAR") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("PN-WIBA") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("PN-EL") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Quotation QT202608-006")).toBeInTheDocument();
    // Appears twice: the group subtotal and the overall grand total — both
    // 640,000.00 since every eligible row in the only group is selected.
    expect(screen.getAllByText("640,000.00")).toHaveLength(2);
  });

  it("Case 3: unchecking CAR leaves only WIBA + EL in the submitted payload", async () => {
    const car = makeRow({ id: "pol-car", recordNumber: "PN-CAR", clientPremium: "500000", quotationCaseId: "case-1", quotationNumber: "QT202608-006" });
    const wiba = makeRow({ id: "pol-wiba", recordNumber: "PN-WIBA", clientPremium: "80000", quotationCaseId: "case-1", quotationNumber: "QT202608-006" });
    const el = makeRow({ id: "pol-el", recordNumber: "PN-EL", clientPremium: "60000", quotationCaseId: "case-1", quotationNumber: "QT202608-006" });
    renderForm([car, wiba, el], "pol-car");

    fireEvent.click(screen.getByLabelText("PN-CAR"));

    fireEvent.click(screen.getByRole("button", { name: "Generate Invoice" }));
    await waitFor(() => expect(createInvoiceActionMock).toHaveBeenCalledTimes(1));

    const payload = createInvoiceActionMock.mock.calls[0][0];
    expect(payload.policyRecordIds.sort()).toEqual(["pol-el", "pol-wiba"]);
  });

  it("Case 4: a Policy from a DIFFERENT Quotation Case renders in its own group but stays unselected by default", () => {
    const car = makeRow({ id: "pol-car", recordNumber: "PN-CAR", quotationCaseId: "case-1", quotationNumber: "QT202608-006" });
    const wiba = makeRow({ id: "pol-wiba", recordNumber: "PN-WIBA", quotationCaseId: "case-1", quotationNumber: "QT202608-006" });
    const fire = makeRow({ id: "pol-fire", recordNumber: "PN-FIRE", policyClass: "Fire & Perils", quotationCaseId: "case-2", quotationNumber: "QT202608-009" });
    renderForm([car, wiba, fire], "pol-car");

    expect((screen.getByLabelText("PN-CAR") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("PN-WIBA") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("PN-FIRE") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("Quotation QT202608-006")).toBeInTheDocument();
    expect(screen.getByText("Quotation QT202608-009")).toBeInTheDocument();
  });

  it("Case 5: the user can manually check a Policy from a different Quotation Case and it joins the submission", async () => {
    const car = makeRow({ id: "pol-car", recordNumber: "PN-CAR", clientPremium: "500000", quotationCaseId: "case-1", quotationNumber: "QT202608-006" });
    const wiba = makeRow({ id: "pol-wiba", recordNumber: "PN-WIBA", clientPremium: "80000", quotationCaseId: "case-1", quotationNumber: "QT202608-006" });
    const fire = makeRow({ id: "pol-fire", recordNumber: "PN-FIRE", clientPremium: "60000", quotationCaseId: "case-2", quotationNumber: "QT202608-009" });
    renderForm([car, wiba, fire], "pol-car");

    fireEvent.click(screen.getByLabelText("PN-FIRE"));

    fireEvent.click(screen.getByRole("button", { name: "Generate Invoice" }));
    await waitFor(() => expect(createInvoiceActionMock).toHaveBeenCalledTimes(1));

    const payload = createInvoiceActionMock.mock.calls[0][0];
    expect(payload.policyRecordIds.sort()).toEqual(["pol-car", "pol-fire", "pol-wiba"]);
  });

  it("Case 6: a Policy already on an active ISSUED Invoice is shown disabled with its Invoice number, and is never default-selected", () => {
    const car = makeRow({ id: "pol-car", recordNumber: "PN-CAR", quotationCaseId: "case-1", quotationNumber: "QT202608-006" });
    const wiba = makeRow({
      id: "pol-wiba",
      recordNumber: "PN-WIBA",
      quotationCaseId: "case-1",
      quotationNumber: "QT202608-006",
      isEligible: false,
      activeInvoiceRef: { id: "inv-1", invoiceNumber: "INV202608-0001" },
    });
    renderForm([car, wiba], "pol-car");

    expect((screen.getByLabelText("PN-CAR") as HTMLInputElement).checked).toBe(true);
    const wibaCheckbox = screen.getByLabelText("PN-WIBA") as HTMLInputElement;
    expect(wibaCheckbox.checked).toBe(false);
    expect(wibaCheckbox).toBeDisabled();
    expect(screen.getByText("Already invoiced")).toBeInTheDocument();
    expect(screen.getByText("INV202608-0001")).toBeInTheDocument();

    // Clicking a disabled row must never select it.
    fireEvent.click(wibaCheckbox);
    expect(wibaCheckbox.checked).toBe(false);
  });

  it("Case 8: a historical Policy (no quotationCaseId) renders under Other Eligible Policies and is not default-selected unless it is the source", () => {
    const historical = makeRow({ id: "pol-hist", recordNumber: "PN-HIST", quotationCaseId: null, quotationNumber: null });
    const car = makeRow({ id: "pol-car", recordNumber: "PN-CAR", quotationCaseId: "case-1", quotationNumber: "QT202608-006" });
    renderForm([car, historical], "pol-car");

    expect(screen.getByText("Other Eligible Policies")).toBeInTheDocument();
    expect((screen.getByLabelText("PN-HIST") as HTMLInputElement).checked).toBe(false);
  });

  it("a historical Policy launched directly (fromPolicyId) is itself default-selected even with no quotationCaseId", () => {
    const historical = makeRow({ id: "pol-hist", recordNumber: "PN-HIST", quotationCaseId: null, quotationNumber: null });
    renderForm([historical], "pol-hist");

    expect((screen.getByLabelText("PN-HIST") as HTMLInputElement).checked).toBe(true);
  });
});
