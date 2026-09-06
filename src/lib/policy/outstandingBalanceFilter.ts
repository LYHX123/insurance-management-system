// The pure "outstanding balance" predicate shared by the Policy list tables
// (client) and the Phase 13A Policy Excel export routes (server). It lived in
// policy-list-outstanding-filters.tsx originally, but that file carries
// "use client" for its React filter controls, so importing this function
// into a server route turned it into a client reference that throws
// ("Attempted to call ... from the server"). Kept here as a plain,
// framework-free module so both sides can call it.
//
// Client Balance = customerPremium - total customer receipts.
// Insurer Balance = insurerCost - total insurer payments.
// PolicyRecord.insurerCost is a non-nullable Decimal (defaults to 0 on
// create), so there is no null-insurerCost case to special-case here — a
// record with no insurer cost simply yields balance <= 0 (never "owed") once
// payments are netted against it, same as the existing detail-tab balance
// math (see MotorDetail/NonMotorDetail insurerBalance).
export function matchesOutstandingBalanceFilters({
  clientBalance,
  insurerBalance,
  outstandingClientOnly,
  outstandingInsurerOnly,
}: {
  clientBalance: number;
  insurerBalance: number;
  outstandingClientOnly: boolean;
  outstandingInsurerOnly: boolean;
}): boolean {
  return (!outstandingClientOnly || clientBalance > 0) && (!outstandingInsurerOnly || insurerBalance > 0);
}
