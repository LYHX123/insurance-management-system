import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { LocaleProvider } from "@/i18n/locale-provider";
import { NonMotorClaimFormModal } from "@/components/claims/non-motor-claim-form-modal";
import type { ClaimCustomerOption, ActiveUserOption, ClaimPolicyOption } from "@/components/claims/types";

// Claim creation Customer picker unification (Motor + Non-Motor) — replaces
// the plain <Select> Customer field with the shared SearchableSelect (same
// component/convention as CreateQuotationCaseForm), while every existing
// Customer-dependent wiring (Project options, Contact prefill, Linked
// Policy options/reset) must keep behaving exactly as before.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const createNonMotorClaimActionMock = vi.fn();
const getNonMotorClaimPolicyOptionsActionMock = vi.fn();
vi.mock("@/app/(app)/task/non-motor-claim/actions", () => ({
  createNonMotorClaimAction: (...args: unknown[]) => createNonMotorClaimActionMock(...args),
  getNonMotorClaimPolicyOptionsAction: (...args: unknown[]) => getNonMotorClaimPolicyOptionsActionMock(...args),
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
  recordNumber: "PN202608-0001",
  numberPlate: null,
  insuranceTypeLabel: "WIBA",
  insurerName: "Jubilee",
  effectiveDate: "2026-01-01T00:00:00.000Z",
  expiryDate: "2026-12-31T00:00:00.000Z",
  businessStatus: "ACTIVE",
};
const POLICY_B: ClaimPolicyOption = {
  id: "policy-b1",
  recordNumber: "PN202608-0002",
  numberPlate: null,
  insuranceTypeLabel: "Fire",
  insurerName: "APA",
  effectiveDate: "2026-01-01T00:00:00.000Z",
  expiryDate: "2026-12-31T00:00:00.000Z",
  businessStatus: "ACTIVE",
};

const ACTIVE_USERS: ActiveUserOption[] = [{ id: "user-1", name: "Current User", role: "Agent" }];

function renderModal() {
  return render(
    <LocaleProvider initialLocale="en">
      <NonMotorClaimFormModal
        categorySlug="non-motor-claim"
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
  createNonMotorClaimActionMock.mockResolvedValue({ success: true, id: "claim-1" });
  getNonMotorClaimPolicyOptionsActionMock.mockImplementation(async (customerId: string) => {
    if (customerId === "cust-a") return [POLICY_A];
    if (customerId === "cust-b") return [POLICY_B];
    return [];
  });
});

describe("NonMotorClaimFormModal — Customer SearchableSelect", () => {
  it("Case 3: filters by Company Name substring", () => {
    renderModal();
    const input = screen.getByPlaceholderText("Select Customer");
    fireEvent.change(input, { target: { value: "jiang" } });
    expect(screen.getByText("China Jiangxi International Kenya Limited (CUST-0001)")).toBeInTheDocument();
    expect(screen.queryByText("Acme Ltd (CUST-0002)")).not.toBeInTheDocument();
  });

  it("Case 4: filters by Short Name", () => {
    renderModal();
    const input = screen.getByPlaceholderText("Select Customer");
    fireEvent.change(input, { target: { value: "CJIK" } });
    expect(screen.getByText("China Jiangxi International Kenya Limited (CUST-0001)")).toBeInTheDocument();
    expect(screen.queryByText("Acme Ltd (CUST-0002)")).not.toBeInTheDocument();
  });

  it("Case 5: search is case-insensitive", () => {
    renderModal();
    const input = screen.getByPlaceholderText("Select Customer");
    fireEvent.change(input, { target: { value: "cj" } });
    expect(screen.getByText("China Jiangxi International Kenya Limited (CUST-0001)")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "CJ" } });
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
    await waitFor(() => expect(getNonMotorClaimPolicyOptionsActionMock).toHaveBeenCalledWith("cust-a"));

    const linkedPolicySelect = selectByOptionText("No Linked Policy");
    await waitFor(() => expect(within(linkedPolicySelect).getByText(/PN202608-0001/)).toBeInTheDocument());

    fireEvent.change(linkedPolicySelect, { target: { value: "policy-a1" } });
    expect(linkedPolicySelect.value).toBe("policy-a1");

    pickCustomer("acme", "Acme Ltd (CUST-0002)");
    await waitFor(() => expect(getNonMotorClaimPolicyOptionsActionMock).toHaveBeenCalledWith("cust-b"));

    expect(linkedPolicySelect.value).toBe("");
    await waitFor(() => expect(within(linkedPolicySelect).getByText(/PN202608-0002/)).toBeInTheDocument());
    expect(within(linkedPolicySelect).queryByText(/PN202608-0001/)).not.toBeInTheDocument();

    const projectSelect = selectByOptionText("No Project");
    expect(within(projectSelect).getByText("Project B1")).toBeInTheDocument();
    expect(within(projectSelect).queryByText("Project A1")).not.toBeInTheDocument();
  });

  it("Case 10: original Save flow is unaffected — customerId flows through to the create action", async () => {
    renderModal();
    pickCustomer("jiang", "China Jiangxi International Kenya Limited (CUST-0001)");

    fireEvent.change(screen.getByPlaceholderText("Select Insurer"), { target: { value: "Jubilee" } });

    const insuranceTypeSelect = selectByOptionText("Select Insurance Type");
    fireEvent.change(insuranceTypeSelect, { target: { value: "WIBA" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(createNonMotorClaimActionMock).toHaveBeenCalledTimes(1));
    const payload = createNonMotorClaimActionMock.mock.calls[0][0];
    expect(payload.customerId).toBe("cust-a");
    expect(payload.contactName).toBe("A Main Contact");
    expect(payload.contactPhone).toBe("0700111111");
    expect(payload.insuranceType).toBe("WIBA");
  });
});
