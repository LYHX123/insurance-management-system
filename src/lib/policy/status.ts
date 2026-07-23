import type { PolicyBusinessStatus, PolicyPaymentStatus } from "@/generated/prisma/enums";

// Cancellation is always explicit, never inferred from dates — the Phase 1A
// historical-import inspection found "Cancel" only ever appears as a
// REMARKS entry (never a dedicated status column), so importRowToRecord
// checks for that same signal; live records are cancelled via the
// businessStatus field directly.
export function computeBusinessStatus(
  effectiveDate: Date,
  expiryDate: Date,
  currentStatus: PolicyBusinessStatus,
  now: Date = new Date()
): PolicyBusinessStatus {
  if (currentStatus === "CANCELLED" || currentStatus === "RENEWED") return currentStatus;
  if (now > expiryDate) return "EXPIRED";
  if (now >= effectiveDate) return "ACTIVE";
  return "DRAFT";
}

// Shared by both the customer-receipt side and the insurer-payment side —
// same four-state rule, just applied to whichever (premium, totalPaid) pair
// the caller passes in.
export function computePaymentStatus(premium: number, totalPaid: number): PolicyPaymentStatus {
  if (totalPaid <= 0) return "UNPAID";
  if (totalPaid < premium) return "PARTIALLY_PAID";
  if (totalPaid === premium) return "FULLY_PAID";
  return "OVERPAID";
}
