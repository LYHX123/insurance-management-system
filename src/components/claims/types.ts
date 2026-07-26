import type { ClaimStatusValue, MotorClaimNatureValue, MotorClaimProgressValue, NonMotorClaimProgressValue } from "@/lib/claims/enums";
import type { NonMotorCoverType } from "@/lib/policy/nonMotorCoverTypes";

export type { ClaimStatusValue, MotorClaimNatureValue, MotorClaimProgressValue, NonMotorClaimProgressValue };

// contactPerson/phoneNumber are CustomerProject's own required fields (see
// that model's schema comment) — carried here so selecting a Project can
// prefill the Claim's Contact Name/Phone from the project's own contact,
// not just the Customer's (see the Project Contact Prefill Fix task).
export type ClaimProjectOption = { id: string; projectName: string; contactPerson: string; phoneNumber: string };

export type ActiveUserOption = { id: string; name: string; role: string };

// The customer picker's option shape plus the two contact fields needed for
// the "prefill Contact Name/Phone from the Customer record" behavior (see
// this phase's spec, Part D.14), plus that customer's own Projects for the
// customer-scoped Project selector (Part B.3) — a claim-specific type since
// no existing CustomerOption elsewhere in the app carries all of these
// together.
export type ClaimCustomerOption = {
  id: string;
  companyName: string;
  customerNumber: string;
  mainContactPerson: string | null;
  mainPhoneNumber: string | null;
  projects: ClaimProjectOption[];
};

export type ClaimParticipantRow = {
  userId: string;
  fullName: string;
  role: string | null;
  isActiveAccount: boolean;
};

export type ClaimTimelineRow = {
  id: string;
  content: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
  editedAt: string | null;
  // True only for the automatic "Claim created" entry — protected from
  // edit/delete (see this phase's spec, Part H.30).
  isInitial: boolean;
};

export type MotorClaimRow = {
  id: string;
  claimNumber: string;
  reportedAt: string;
  customerId: string;
  customerName: string;
  projectId: string | null;
  projectName: string | null;
  contactName: string;
  contactPhone: string;
  insurer: string;
  numberPlate: string;
  claimNature: MotorClaimNatureValue;
  progress: MotorClaimProgressValue;
  status: ClaimStatusValue;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  closedByName: string | null;
  closedAt: string | null;
  // For the left-panel-style "search by participant name" convenience (see
  // this phase's spec, Part J.38) — same pattern as TaskListItem.
  participantNames: string[];
};

export type MotorClaimDetail = MotorClaimRow & {
  participants: ClaimParticipantRow[];
  timeline: ClaimTimelineRow[];
};

export type NonMotorClaimRow = {
  id: string;
  claimNumber: string;
  reportedAt: string;
  customerId: string;
  customerName: string;
  projectId: string | null;
  projectName: string | null;
  contactName: string;
  contactPhone: string;
  insurer: string;
  insuranceType: NonMotorCoverType;
  progress: NonMotorClaimProgressValue;
  status: ClaimStatusValue;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  closedByName: string | null;
  closedAt: string | null;
  participantNames: string[];
};

export type NonMotorClaimDetail = NonMotorClaimRow & {
  participants: ClaimParticipantRow[];
  timeline: ClaimTimelineRow[];
};
