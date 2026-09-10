import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LocaleProvider } from "@/i18n/locale-provider";
import { MotorOverviewTab } from "@/components/policy/motor/motor-overview-tab";
import { NonMotorOverviewTab } from "@/components/policy/non-motor/non-motor-overview-tab";
import { BondOverviewTab } from "@/components/policy/bond/bond-overview-tab";
import { WorkPermitOverviewTab } from "@/components/policy/work-permit/work-permit-overview-tab";
import type { MotorDetail, NonMotorDetail, BondDetail, WorkPermitDetail } from "@/components/policy/types";

// Phase 13D UI fix — the "Delete Policy" button must be visible AND actually
// open the confirmation modal, for every one of the four Policy categories.
// Real interaction tests through each category's own Overview tab.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/policy/x/pol-1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/(app)/policy/motor/actions", () => ({ updateMotorOverviewAction: vi.fn(), deleteMotorPolicyAction: vi.fn() }));
vi.mock("@/app/(app)/policy/non-motor/actions", () => ({ updateNonMotorOverviewAction: vi.fn(), deleteNonMotorPolicyAction: vi.fn() }));
vi.mock("@/app/(app)/policy/bond/actions", () => ({ updateBondOverviewAction: vi.fn(), deleteBondPolicyAction: vi.fn() }));
vi.mock("@/app/(app)/policy/work-permit/actions", () => ({ updateWorkPermitOverviewAction: vi.fn(), deleteWorkPermitPolicyAction: vi.fn() }));

const base = {
  processingDate: "2026-09-01T00:00:00.000Z",
  customerId: "cust-1",
  customerName: "Acme Ltd",
  projectId: null,
  projectName: null,
  policyNumber: "POL-1",
  insurerName: "AAR",
  effectiveDate: "2026-09-05T00:00:00.000Z",
  businessStatus: "ACTIVE" as const,
  source: "MANUAL" as const,
  remarks: null,
  customerPremium: "5000",
  insurerCost: "4000",
  totalReceived: "0",
  totalPaid: "0",
  clientBalance: "5000",
  insurerBalance: "4000",
  customerPaymentStatus: "UNPAID" as const,
  insurerPaymentStatus: "UNPAID" as const,
  commissionReceived: false,
  commissionAmount: null,
  commissionReceivedDate: null,
  systemCalculatedMargin: "1000",
  customerReceipts: [],
  providerPayments: [],
  documents: [],
  activities: [],
  sourceQuotation: null,
  sourceQuotationSnapshot: null,
  relatedInvoice: null,
};

const motor: MotorDetail = {
  ...base,
  id: "pol-motor",
  recordNumber: "PM202609-0001",
  insuranceType: "COMPREHENSIVE",
  registrationNumber: "KDA 123A",
  taxClass: "PRIVATE",
  vehicleValue: null,
  vehicleMake: null,
  vehicleModel: null,
  expiryDate: "2027-09-04T00:00:00.000Z",
  customerContactPerson: null,
  valuationStatus: null,
  assessedVehicleValue: null,
  insurerBalanceVerification: "VERIFIED",
  insurerBalanceWarningReason: null,
  insurerBalanceRaw: null,
  insurerBalanceResolutionNote: null,
  insurerBalanceResolvedAt: null,
  insurerBalanceResolvedByName: null,
  clientBalanceVerification: "VERIFIED",
  clientBalanceWarningReason: null,
  clientBalanceRaw: null,
  clientBalanceResolutionNote: null,
  clientBalanceResolvedAt: null,
  clientBalanceResolvedByName: null,
  historicalNetProfit: null,
  sourceSheet: null,
  originalRowNumber: null,
};

const nonMotor: NonMotorDetail = {
  ...base,
  id: "pol-nm",
  recordNumber: "PN202609-0001",
  insuranceType: "FIRE_ALLIED_PERILS",
  expiryDate: "2027-09-04T00:00:00.000Z",
};

const bondSecurityNoExpiry: BondDetail = {
  ...base,
  id: "pol-bond",
  recordNumber: "PB202609-0001",
  bondType: "SECURITY_BOND",
  customBondType: null,
  bondAmount: "100000",
  expiryDate: null, // Phase 13C — open-ended Security Bond
};

const workPermit: WorkPermitDetail = {
  ...base,
  id: "pol-wp",
  recordNumber: "PW202609-0001",
  permitType: "CLASS_D",
  otherPermitType: null,
  agent: "Agent A",
  permitNumber: "WP-1",
  expiryDate: "2027-09-04T00:00:00.000Z",
};

function wrap(node: React.ReactElement) {
  return render(<LocaleProvider initialLocale="en">{node}</LocaleProvider>);
}

beforeEach(() => vi.clearAllMocks());

const cases = [
  { name: "Motor", node: (p: { canEdit: boolean; canDelete: boolean }) => <MotorOverviewTab detail={motor} customers={[]} {...p} />, record: "PM202609-0001" },
  { name: "Non-Motor", node: (p: { canEdit: boolean; canDelete: boolean }) => <NonMotorOverviewTab detail={nonMotor} customers={[]} {...p} />, record: "PN202609-0001" },
  { name: "Bond (Security Bond, null expiry)", node: (p: { canEdit: boolean; canDelete: boolean }) => <BondOverviewTab detail={bondSecurityNoExpiry} customers={[]} {...p} />, record: "PB202609-0001" },
  { name: "Work Permit", node: (p: { canEdit: boolean; canDelete: boolean }) => <WorkPermitOverviewTab detail={workPermit} customers={[]} {...p} />, record: "PW202609-0001" },
];

describe.each(cases)("Delete Policy button — $name", ({ node, record }) => {
  it("is hidden for an Edit-only user (no Delete permission)", () => {
    wrap(node({ canEdit: true, canDelete: false }));
    expect(screen.queryByRole("button", { name: "Delete Policy" })).toBeNull();
  });

  it("is visible for a Delete user, and clicking it opens the confirmation modal (no Invalid Date / crash)", () => {
    wrap(node({ canEdit: true, canDelete: true }));
    const launcher = screen.getByRole("button", { name: "Delete Policy" });
    fireEvent.click(launcher);

    expect(screen.getByText("Permanently Delete Policy?")).toBeTruthy();
    // record number shown in the modal detail list
    expect(screen.getAllByText(record).length).toBeGreaterThan(0);
    // confirm disabled until typed
    const confirm = screen.getByRole("button", { name: "Delete Permanently" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(record), { target: { value: record } });
    expect(confirm.disabled).toBe(false);
    // no stray "Invalid Date" / NaN leaked into the dialog
    expect(document.body.textContent).not.toMatch(/Invalid Date|NaN|1970/);
  });
});
