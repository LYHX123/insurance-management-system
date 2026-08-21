import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LocaleProvider } from "@/i18n/locale-provider";
import { NonMotorClaimEditModal } from "@/components/claims/non-motor-claim-edit-modal";
import type { ClaimCustomerOption, ClaimPolicyOption, NonMotorClaimDetail } from "@/components/claims/types";

// WIBA Injured Name (Edit Claim) — see NonMotorClaim.injuredName's schema
// comment. Mirrors non-motor-claim-form-modal.test.tsx's mocking
// conventions.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const updateNonMotorClaimActionMock = vi.fn();
const getNonMotorClaimPolicyOptionsActionMock = vi.fn();
vi.mock("@/app/(app)/task/non-motor-claim/actions", () => ({
  updateNonMotorClaimAction: (...args: unknown[]) => updateNonMotorClaimActionMock(...args),
  getNonMotorClaimPolicyOptionsAction: (...args: unknown[]) => getNonMotorClaimPolicyOptionsActionMock(...args),
}));

const CUSTOMER_A: ClaimCustomerOption = {
  id: "cust-a",
  companyName: "China Jiangxi International Kenya Limited",
  customerNumber: "CUST-0001",
  shortName: "CJIK",
  mainContactPerson: "A Main Contact",
  mainPhoneNumber: "0700111111",
  projects: [],
};
const CUSTOMERS = [CUSTOMER_A];
const POLICY_OPTIONS: ClaimPolicyOption[] = [];

function baseClaim(overrides: Partial<NonMotorClaimDetail> = {}): NonMotorClaimDetail {
  return {
    id: "claim-1",
    claimNumber: "NC202608-0001",
    reportedAt: "2026-08-01T09:00:00.000Z",
    customerId: "cust-a",
    customerName: "China Jiangxi International Kenya Limited",
    projectId: null,
    projectName: null,
    contactName: "Jane Doe",
    contactPhone: "0700000000",
    insurer: "Jubilee",
    insuranceType: "WIBA",
    injuredName: null,
    progress: "DOCUMENT_PREPARATION",
    status: "OPEN",
    createdById: "user-1",
    createdByName: "Current User",
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
    closedByName: null,
    closedAt: null,
    participantNames: ["Current User"],
    policyRecordId: null,
    linkedPolicy: null,
    participants: [],
    timeline: [],
    documents: [],
    ...overrides,
  };
}

function renderEditModal(claim: NonMotorClaimDetail) {
  return render(
    <LocaleProvider initialLocale="en">
      <NonMotorClaimEditModal
        claim={claim}
        customers={CUSTOMERS}
        insurers={["Jubilee", "APA"]}
        policyOptions={POLICY_OPTIONS}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    </LocaleProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  updateNonMotorClaimActionMock.mockResolvedValue({ success: true });
  getNonMotorClaimPolicyOptionsActionMock.mockResolvedValue([]);
});

describe("NonMotorClaimEditModal — WIBA Injured Name", () => {
  it("Case 5: a WIBA claim's existing Injured Name is echoed back into the field", () => {
    renderEditModal(baseClaim({ injuredName: "John Kamau" }));
    expect(screen.getByPlaceholderText("Enter injured name")).toHaveValue("John Kamau");
  });

  it("Case 5: editing and saving a new Injured Name flows through to the update action", async () => {
    renderEditModal(baseClaim({ injuredName: "John Kamau" }));
    fireEvent.change(screen.getByPlaceholderText("Enter injured name"), { target: { value: "Jane Wanjiru" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateNonMotorClaimActionMock).toHaveBeenCalledTimes(1));
    expect(updateNonMotorClaimActionMock).toHaveBeenCalledWith("claim-1", expect.objectContaining({ injuredName: "Jane Wanjiru" }));
  });

  it("Case 6: a historical WIBA claim with injuredName = null opens without crashing, showing a blank field", () => {
    expect(() => renderEditModal(baseClaim({ injuredName: null }))).not.toThrow();
    expect(screen.getByPlaceholderText("Enter injured name")).toHaveValue("");
  });

  it("Case 6: saving a historical null-Injured-Name WIBA claim without filling it in shows the required error and does not submit", async () => {
    renderEditModal(baseClaim({ injuredName: null }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Injured Name is required for WIBA claims.")).toBeInTheDocument();
    expect(updateNonMotorClaimActionMock).not.toHaveBeenCalled();
  });

  it("Injured Name is hidden for a non-WIBA claim", () => {
    renderEditModal(baseClaim({ insuranceType: "PUBLIC_LIABILITY", injuredName: null }));
    expect(screen.queryByPlaceholderText("Enter injured name")).not.toBeInTheDocument();
  });

  it("switching a WIBA claim to another insurance type saves injuredName = null instead of the old value", async () => {
    renderEditModal(baseClaim({ injuredName: "John Kamau" }));
    const insuranceTypeSelect = screen.getByDisplayValue("WIBA");
    fireEvent.change(insuranceTypeSelect, { target: { value: "PUBLIC_LIABILITY" } });
    expect(screen.queryByPlaceholderText("Enter injured name")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateNonMotorClaimActionMock).toHaveBeenCalledTimes(1));
    expect(updateNonMotorClaimActionMock).toHaveBeenCalledWith("claim-1", expect.objectContaining({ injuredName: null }));
  });
});
