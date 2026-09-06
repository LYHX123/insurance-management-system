// Phase 13A — the single definition of each Policy list's row shape AND its
// client-side filter predicate, shared by:
//   * the list pages (src/app/(app)/policy/<cat>/page.tsx) — row mapping
//   * the list tables (src/components/policy/<cat>/<cat>-list-table.tsx) — filtering
//   * the Excel export routes (src/app/api/policy/export/[category]/route.ts) — both
//
// so an export always contains exactly the rows the list would show for the
// same filter state, never just the visible pagination page.
//
// Motor's Contact Person / Expiry range / Valuation Status filters are applied
// at the DATABASE level (see buildMotorListFilterWhere) and are therefore NOT
// re-checked here — the caller passes an already-narrowed record set.

import { computeBusinessStatus } from "@/lib/policy/status";
// Imported from the framework-free module, NOT the "use client" filter
// component — the export routes run this on the server.
import { matchesOutstandingBalanceFilters } from "@/lib/policy/outstandingBalanceFilter";
import type {
  MotorListRow,
  NonMotorListRow,
  BondListRow,
  WorkPermitListRow,
} from "@/components/policy/types";
import type { NonMotorCoverType, BondType, WorkPermitType, PolicyRenewalDecision } from "@/generated/prisma/enums";

type DecimalLike = { toNumber(): number };

// The record fields every category mapper needs (a structural subset of the
// Prisma `findMany` result — no coupling to the exact include shape).
type PolicyRecordCommon = {
  id: string;
  recordNumber: string;
  processingDate: Date;
  customerId: string;
  customer: { companyName: string };
  effectiveDate: Date;
  expiryDate: Date;
  businessStatus: MotorListRow["businessStatus"];
  customerPremium: DecimalLike;
  insurerCost: DecimalLike;
  insurerName: string | null;
  renewalIndex: number;
  renewalDecision: PolicyRenewalDecision | null;
};

export type PolicySums = { totalReceived: number; totalPaid: number };

function balances(record: PolicyRecordCommon, sums: PolicySums) {
  const clientPremium = record.customerPremium.toNumber();
  const insurerCost = record.insurerCost.toNumber();
  return {
    clientPremium,
    clientBalance: (clientPremium - sums.totalReceived).toFixed(2),
    insurerBalance: (insurerCost - sums.totalPaid).toFixed(2),
  };
}

// ---------------------------------------------------------------------------
// Row mappers — identical output to what each page.tsx produced inline.
// ---------------------------------------------------------------------------

export function toMotorListRow(
  record: PolicyRecordCommon & {
    customerContactPerson: string | null;
    motorDetail: { insuranceType: string; registrationNumber: string; valuationStatus: MotorListRow["valuationStatus"] } | null;
  },
  sums: PolicySums,
  now?: Date
): MotorListRow {
  const b = balances(record, sums);
  return {
    id: record.id,
    recordNumber: record.recordNumber,
    processingDate: record.processingDate.toISOString(),
    customerId: record.customerId,
    customerName: record.customer.companyName,
    insuranceType: record.motorDetail?.insuranceType ?? "—",
    registrationNumber: record.motorDetail?.registrationNumber ?? "—",
    insurerName: record.insurerName,
    expiryDate: record.expiryDate.toISOString(),
    clientPremium: b.clientPremium.toFixed(2),
    clientBalance: b.clientBalance,
    insurerBalance: b.insurerBalance,
    businessStatus: computeBusinessStatus(record.effectiveDate, record.expiryDate, record.businessStatus, now),
    renewalIndex: record.renewalIndex,
    renewalDecision: record.renewalDecision,
    contactPerson: record.customerContactPerson,
    valuationStatus: record.motorDetail?.valuationStatus ?? null,
  };
}

export function toNonMotorListRow(
  record: PolicyRecordCommon & { nonMotorDetail: { insuranceType: NonMotorCoverType } | null },
  sums: PolicySums,
  now?: Date
): NonMotorListRow {
  const b = balances(record, sums);
  return {
    id: record.id,
    recordNumber: record.recordNumber,
    processingDate: record.processingDate.toISOString(),
    customerId: record.customerId,
    customerName: record.customer.companyName,
    insuranceType: record.nonMotorDetail!.insuranceType,
    insurerName: record.insurerName,
    expiryDate: record.expiryDate.toISOString(),
    clientPremium: b.clientPremium.toFixed(2),
    clientBalance: b.clientBalance,
    insurerBalance: b.insurerBalance,
    businessStatus: computeBusinessStatus(record.effectiveDate, record.expiryDate, record.businessStatus, now),
    renewalIndex: record.renewalIndex,
    renewalDecision: record.renewalDecision,
  };
}

export function toBondListRow(
  record: PolicyRecordCommon & {
    bondDetail: { bondType: BondType; customBondType: string | null; policyNumber: string | null } | null;
  },
  sums: PolicySums,
  now?: Date
): BondListRow {
  const b = balances(record, sums);
  return {
    id: record.id,
    recordNumber: record.recordNumber,
    processingDate: record.processingDate.toISOString(),
    customerId: record.customerId,
    customerName: record.customer.companyName,
    bondType: record.bondDetail!.bondType,
    customBondType: record.bondDetail!.customBondType,
    policyNumber: record.bondDetail!.policyNumber,
    insurerName: record.insurerName,
    expiryDate: record.expiryDate.toISOString(),
    clientPremium: b.clientPremium.toFixed(2),
    clientBalance: b.clientBalance,
    insurerBalance: b.insurerBalance,
    businessStatus: computeBusinessStatus(record.effectiveDate, record.expiryDate, record.businessStatus, now),
    renewalIndex: record.renewalIndex,
    renewalDecision: record.renewalDecision,
  };
}

export function toWorkPermitListRow(
  record: PolicyRecordCommon & {
    workPermitDetail: { permitType: WorkPermitType; otherPermitType: string | null } | null;
  },
  sums: PolicySums,
  now?: Date
): WorkPermitListRow {
  const b = balances(record, sums);
  return {
    id: record.id,
    recordNumber: record.recordNumber,
    processingDate: record.processingDate.toISOString(),
    customerId: record.customerId,
    customerName: record.customer.companyName,
    permitType: record.workPermitDetail!.permitType,
    otherPermitType: record.workPermitDetail!.otherPermitType,
    expiryDate: record.expiryDate.toISOString(),
    clientPremium: b.clientPremium.toFixed(2),
    clientBalance: b.clientBalance,
    insurerBalance: b.insurerBalance,
    businessStatus: computeBusinessStatus(record.effectiveDate, record.expiryDate, record.businessStatus, now),
    renewalIndex: record.renewalIndex,
    renewalDecision: record.renewalDecision,
  };
}

// ---------------------------------------------------------------------------
// Client-side filter predicates — one shared definition per category.
// ---------------------------------------------------------------------------

export type PolicyListClientFilterState = {
  search?: string;
  /** customer NAME (not id) — pre-existing dropdown filter. "ALL" = no filter. */
  customer?: string;
  /** cover / bond / permit type value. "ALL" = no filter. */
  type?: string;
  /** insurer name. "ALL" = no filter. */
  insurer?: string;
  /** computed PolicyBusinessStatus. "ALL" = no filter. */
  status?: string;
  /** "YYYY-MM-DD" exact-match on expiry (Non-Motor / Bond / Work Permit only). */
  expiryDate?: string;
  outstandingClientOnly?: boolean;
  outstandingInsurerOnly?: boolean;
};

function commonMatch(
  row: {
    customerName: string;
    insurerName?: string | null;
    businessStatus: string;
    clientBalance: string;
    insurerBalance: string;
  },
  f: PolicyListClientFilterState
): boolean {
  const matchesCustomer = !f.customer || f.customer === "ALL" || row.customerName === f.customer;
  const matchesInsurer = !f.insurer || f.insurer === "ALL" || (row.insurerName ?? null) === f.insurer;
  const matchesStatus = !f.status || f.status === "ALL" || row.businessStatus === f.status;
  const matchesOutstanding = matchesOutstandingBalanceFilters({
    clientBalance: Number(row.clientBalance),
    insurerBalance: Number(row.insurerBalance),
    outstandingClientOnly: !!f.outstandingClientOnly,
    outstandingInsurerOnly: !!f.outstandingInsurerOnly,
  });
  return matchesCustomer && matchesInsurer && matchesStatus && matchesOutstanding;
}

export function matchesMotorListFilters(row: MotorListRow, f: PolicyListClientFilterState): boolean {
  const term = (f.search ?? "").trim().toLowerCase();
  const matchesTerm =
    !term ||
    row.recordNumber.toLowerCase().includes(term) ||
    row.customerName.toLowerCase().includes(term) ||
    row.registrationNumber.toLowerCase().includes(term) ||
    (row.insurerName?.toLowerCase().includes(term) ?? false);
  const matchesType = !f.type || f.type === "ALL" || row.insuranceType === f.type;
  return matchesTerm && matchesType && commonMatch(row, f);
}

export function matchesNonMotorListFilters(row: NonMotorListRow, f: PolicyListClientFilterState): boolean {
  const term = (f.search ?? "").trim().toLowerCase();
  const matchesTerm =
    !term ||
    row.recordNumber.toLowerCase().includes(term) ||
    row.customerName.toLowerCase().includes(term) ||
    (row.insurerName?.toLowerCase().includes(term) ?? false);
  const matchesType = !f.type || f.type === "ALL" || row.insuranceType === f.type;
  const matchesExpiryDate = !f.expiryDate || row.expiryDate.slice(0, 10) === f.expiryDate;
  return matchesTerm && matchesType && matchesExpiryDate && commonMatch(row, f);
}

export function matchesBondListFilters(row: BondListRow, f: PolicyListClientFilterState): boolean {
  const term = (f.search ?? "").trim().toLowerCase();
  const matchesTerm =
    !term ||
    row.recordNumber.toLowerCase().includes(term) ||
    row.customerName.toLowerCase().includes(term) ||
    (row.insurerName?.toLowerCase().includes(term) ?? false) ||
    (row.policyNumber?.toLowerCase().includes(term) ?? false) ||
    (row.customBondType?.toLowerCase().includes(term) ?? false);
  const matchesType = !f.type || f.type === "ALL" || row.bondType === f.type;
  const matchesExpiryDate = !f.expiryDate || row.expiryDate.slice(0, 10) === f.expiryDate;
  return matchesTerm && matchesType && matchesExpiryDate && commonMatch(row, f);
}

export function matchesWorkPermitListFilters(row: WorkPermitListRow, f: PolicyListClientFilterState): boolean {
  const term = (f.search ?? "").trim().toLowerCase();
  const matchesTerm =
    !term ||
    row.recordNumber.toLowerCase().includes(term) ||
    row.customerName.toLowerCase().includes(term);
  const matchesType = !f.type || f.type === "ALL" || row.permitType === f.type;
  const matchesExpiryDate = !f.expiryDate || row.expiryDate.slice(0, 10) === f.expiryDate;
  // Work Permit has no insurer filter dropdown — never apply one even if a
  // stray `insurer` value is passed.
  return matchesTerm && matchesType && matchesExpiryDate && commonMatch(row, { ...f, insurer: "ALL" });
}
