import type { Prisma } from "@/generated/prisma/client";
import { isMotorValuationStatus } from "@/lib/policy/motorValuation";

// Phase 12A/12C — pure builder for the database-level Motor list filters
// (Contact Person + Expiry date range + Valuation Status). Kept as a
// standalone pure function (no prisma/auth import) so it is unit-testable in
// isolation and so the list page's own `where` stays a plain merge of small
// fragments.
//
// Contact Person: PolicyRecord.customerContactPerson is a free-text
// customer-side contact name. The filter is a case-insensitive substring
// match (Postgres ILIKE, via Prisma `contains` + `mode: "insensitive"`), so
// "john" matches "John", "John Kamau" and "Mr John".
//
// Date handling: PolicyRecord.expiryDate is written from a "YYYY-MM-DD" form
// value via `new Date(str)` (see createMotorRecordAction / historical
// import), i.e. as UTC midnight of that calendar day. These bounds therefore
// compare in UTC too, and the "To" bound is the LAST millisecond of the
// selected day (…T23:59:59.999Z) so a policy expiring anywhere on the "To"
// date is included, never excluded by a midnight comparison.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type MotorListFilterParams = {
  /** Raw `?contact=` value — a free-text fragment, or "" for no filter. */
  contact?: string | null;
  /** Raw `?expiryFrom=` value: "" | "YYYY-MM-DD". */
  expiryFrom?: string | null;
  /** Raw `?expiryTo=` value: "" | "YYYY-MM-DD". */
  expiryTo?: string | null;
  /** Raw `?valuationStatus=` value: "" | "ALL" | a MotorValuationStatus. */
  valuationStatus?: string | null;
};

export function buildMotorListFilterWhere(params: MotorListFilterParams): Prisma.PolicyRecordWhereInput {
  const where: Prisma.PolicyRecordWhereInput = {};

  const contact = params.contact?.trim();
  if (contact) {
    where.customerContactPerson = { contains: contact, mode: "insensitive" };
  }

  // Phase 12C — filters to Motor detail rows with exactly this valuation
  // status. Only Comprehensive policies ever carry one, so this implicitly
  // restricts to Comprehensive (a non-Comprehensive row has null and can
  // never match). Never touches PolicyBusinessStatus.
  const valuationStatus = params.valuationStatus?.trim();
  if (valuationStatus && isMotorValuationStatus(valuationStatus)) {
    where.motorDetail = { valuationStatus };
  }

  const expiryFrom = params.expiryFrom?.trim();
  const expiryTo = params.expiryTo?.trim();
  const expiryDate: Prisma.DateTimeFilter = {};
  if (expiryFrom && DATE_RE.test(expiryFrom)) {
    expiryDate.gte = new Date(`${expiryFrom}T00:00:00.000Z`);
  }
  if (expiryTo && DATE_RE.test(expiryTo)) {
    expiryDate.lte = new Date(`${expiryTo}T23:59:59.999Z`);
  }
  if (expiryDate.gte !== undefined || expiryDate.lte !== undefined) {
    where.expiryDate = expiryDate;
  }

  return where;
}
