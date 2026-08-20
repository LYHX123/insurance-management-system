import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { LocaleProvider } from "@/i18n/locale-provider";
import { MotorClaimFormModal } from "@/components/claims/motor-claim-form-modal";
import type { ClaimCustomerOption, ActiveUserOption, ClaimPolicyOption } from "@/components/claims/types";

// Claim creation Customer picker unification (Motor + Non-Motor) — replaces
// the plain <Select> Customer field with the shared SearchableSelect (same
// component/convention as CreateQuotationCaseForm), while every existing
// Customer-dependent wiring (Project options, Contact prefill, Linked
// Policy options/reset) must keep behaving exactly as before.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const createMotorClaimActionMock = vi.fn();
const getMotorClaimPolicyOptionsActionMock = vi.fn();
vi.mock("@/app/(app)/task/motor-claim/actions", () => ({
  createMotorClaimAction: (...args: unknown[]) => createMotorClaimActionMock(...args),
  getMotorClaimPolicyOptionsAction: (...args: unknown[]) => getMotorClaimPolicyOptionsActionMock(...args),
}));

const CUSTOMER_A: ClaimCustomerOption = {
  id: "cust-a",
  companyName: "China Jiangxi International Kenya Limited",
  customerNumber: "CUST-0001",
  shortName: "CJIK",
  mainContactPerson: "A Main Contact",
  mainPhoneNumber: "0700111111",
  projects: [{ id: "proj-a1", projectName: "Project A1", contactPerson: "Alice", phoneNumber: "0700111222" }],
};
const CUSTOMER_B: ClaimCustomerOption = {
  id: "cust-b",
  companyName: "Acme Ltd",
  customerNumber: "CUST-0002",
  shortName: "ACME",
  mainContactPerson: "B Main Contact",
  mainPhoneNumber: "0700222222",
  projects: [{ id: "proj-b1", projectName: "Project B1", contactPerson: "Bob", phoneNumber: "0700222333" }],
};
const CUSTOMERS = [CUSTOMER_A, CUSTOMER_B];

const POLICY_A: ClaimPolicyOption = {
  id: "policy-a1",
  recordNumber: "PM202608-0001",
  numberPlate: "KAA 001A",
  insuranceTypeLabel: "Comprehensive",
  insurerName: "Jubilee",
  effectiveDate: "2026-01-01T00:00:00.000Z",
  expiryDate: "2026-12-31T00:00:00.000Z",
  businessStatus: "ACTIVE",
};
const POLICY_B: ClaimPolicyOption = {
  id: "policy-b1",
  recordNumber: "PM202608-0002",
  numberPlate: "KBB 002B",
  insuranceTypeLabel: "TPO",
  insurerName: "APA",
  effectiveDate: "2026-01-01T00:00:00.000Z",
  expiryDate: "2026-12-31T00:00:00.000Z",
  businessStatus: "ACTIVE",
};

const ACTIVE_USERS: ActiveUserOption[] = [{ id: "user-1", name: "Current User", role: "Agent" }];

function renderModal() {
  return render(
    <LocaleProvider initialLocale="en">
      <MotorClaimFormModal
        categorySlug="motor-claim"
        customers={CUSTOMERS}
        insurers={["Jubilee", "APA"]}
        currentUserId="user-1"
        activeUsers={ACTIVE_USERS}
        onClose={vi.fn()}
      />
    </LocaleProvider>
  );
}

function selectByOptionText(text: string): HTMLSelectElement {
  const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
  const found = selects.find((s) => within(s).queryByText(text));
  if (!found) throw new Error(`No <select> found containing option "${text}"`);
  return found;
}

function pickCustomer(query: string, optionText: string) {
  const input = screen.getByPlaceholderText("Select Customer");
  fireEvent.change(input, { target: { value: query } });
  fireEvent.mouseDown(screen.getByText(optionText));
}

beforeEach(() => {
  vi.clearAllMocks();
  createMotorClaimActionMock.mockResolvedValue({ success: true, id: "claim-1" });
  getMotorClaimPolicyOptionsActionMock.mockImplementation(async (customerId: string) => {
    if (customerId === "cust-a") return [POLICY_A];
    if (customerId === "cust-b") return [POLICY_B];
    return [];
  });
});

describe("MotorClaimFormModal — Customer SearchableSelect", () => {
  it("Case 1: filters by Company Name substring", () => {
    renderModal();
    const input = screen.getByPlaceholderText("Select Customer");
    fireEvent.change(input, { target: { value: "jiang" } });
    expect(screen.getByText("China Jiangxi International Kenya Limited (CUST-0001)")).toBeInTheDocument();
    expect(screen.queryByText("Acme Ltd (CUST-0002)")).not.toBeInTheDocument();
  });

  it("Case 2: filters by Short Name", () => {
    renderModal();
    const input = screen.getByPlaceholderText("Select Customer");
    fireEvent.change(input, { target: { value: "CJIK" } });
    expect(screen.getByText("China Jiangxi International Kenya Limited (CUST-0001)")).toBeInTheDocument();
    expect(screen.queryByText("Acme Ltd (CUST-0002)")).not.toBeInTheDocument();
  });

  it("Case 5: search is case-insensitive", () => {
    renderModal();
    const input = screen.getByPlaceholderText("Select Customer");
    fireEvent.change(input, { target: { value: "china" } });
    expect(screen.getByText("China Jiangxi International Kenya Limited (CUST-0001)")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "CHINA" } });
    expect(screen.getByText("China Jiangxi International Kenya Limited (CUST-0001)")).toBeInTheDocument();
  });

  it("Case 9: shows 'No customers found' when nothing matches", () => {
    renderModal();
    const input = screen.getByPlaceholderText("Select Customer");
    fireEvent.change(input, { target: { value: "nonexistent customer xyz" } });
    expect(screen.getByText("No customers found")).toBeInTheDocument();
  });

  it("Case 6/7: selecting a Customer sets the displayed value and scopes Project to that Customer only", () => {
    renderModal();
    pickCustomer("jiang", "China Jiangxi International Kenya Limited (CUST-0001)");

    expect(screen.getByDisplayValue("China Jiangxi International Kenya Limited (CUST-0001)")).toBeInTheDocument();

    const projectSelect = selectByOptionText("No Project");
    expect(within(projectSelect).getByText("Project A1")).toBeInTheDocument();
    expect(within(projectSelect).queryByText("Project B1")).not.toBeInTheDocument();
  });

  it("Case 8: switching Customer never leaves the previous Customer's Linked Policy behind", async () => {
    renderModal();
    pickCustomer("jiang", "China Jiangxi International Kenya Limited (CUST-0001)");
    await waitFor(() => expect(getMotorClaimPolicyOptionsActionMock).toHaveBeenCalledWith("cust-a"));

    const linkedPolicySelect = selectByOptionText("No Linked Policy");
    await waitFor(() => expect(within(linkedPolicySelect).getByText(/PM202608-0001/)).toBeInTheDocument());

    fireEvent.change(linkedPolicySelect, { target: { value: "policy-a1" } });
    expect(linkedPolicySelect.value).toBe("policy-a1");

    pickCustomer("acme", "Acme Ltd (CUST-0002)");
    await waitFor(() => expect(getMotorClaimPolicyOptionsActionMock).toHaveBeenCalledWith("cust-b"));

    // Policy selection reset immediately on Customer change — never carries A's id.
    expect(linkedPolicySelect.value).toBe("");
    await waitFor(() => expect(within(linkedPolicySelect).getByText(/PM202608-0002/)).toBeInTheDocument());
    expect(within(linkedPolicySelect).queryByText(/PM202608-0001/)).not.toBeInTheDocument();

    const projectSelect = selectByOptionText("No Project");
    expect(within(projectSelect).getByText("Project B1")).toBeInTheDocument();
    expect(within(projectSelect).queryByText("Project A1")).not.toBeInTheDocument();
  });

  it("Case 10: original Save flow is unaffected — customerId flows through to the create action", async () => {
    renderModal();
    pickCustomer("jiang", "China Jiangxi International Kenya Limited (CUST-0001)");

    fireEvent.change(screen.getByPlaceholderText("Select Insurer"), { target: { value: "Jubilee" } });

    const numberPlateInput = document.querySelector("input[maxlength='50']") as HTMLInputElement;
    fireEvent.change(numberPlateInput, { target: { value: "KAA 999Z" } });

    const claimNatureSelect = selectByOptionText("Select Claim Nature");
    fireEvent.change(claimNatureSelect, { target: { value: "OWN_DAMAGE" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(createMotorClaimActionMock).toHaveBeenCalledTimes(1));
    const payload = createMotorClaimActionMock.mock.calls[0][0];
    expect(payload.customerId).toBe("cust-a");
    expect(payload.contactName).toBe("A Main Contact");
    expect(payload.contactPhone).toBe("0700111111");
    expect(payload.numberPlate).toBe("KAA 999Z");
    expect(payload.claimNature).toBe("OWN_DAMAGE");
  });
});
