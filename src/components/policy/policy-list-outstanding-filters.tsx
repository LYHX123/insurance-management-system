"use client";

import { Input } from "@/components/ui/input";
import { useLocale } from "@/i18n/locale-provider";

// Shared by Motor and Non-Motor list tables (and future Bond / Work Permit
// lists) so the expiry-date-equals filter and the two outstanding-balance
// checkboxes stay behaviorally and visually identical across categories
// instead of drifting per-category.
export function PolicyExpiryDateFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useLocale();
  return (
    <Input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-auto"
      aria-label={t.policy.expiryDate}
    />
  );
}

export function PolicyOutstandingBalanceCheckboxes({
  outstandingClientOnly,
  onOutstandingClientOnlyChange,
  outstandingInsurerOnly,
  onOutstandingInsurerOnlyChange,
}: {
  outstandingClientOnly: boolean;
  onOutstandingClientOnlyChange: (value: boolean) => void;
  outstandingInsurerOnly: boolean;
  onOutstandingInsurerOnlyChange: (value: boolean) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-1.5 text-sm text-zinc-600">
        <input
          type="checkbox"
          checked={outstandingClientOnly}
          onChange={(e) => onOutstandingClientOnlyChange(e.target.checked)}
          className="h-4 w-4 rounded border-zinc-300"
        />
        {t.policy.filterOutstandingClientBalance}
      </label>
      <label className="flex items-center gap-1.5 text-sm text-zinc-600">
        <input
          type="checkbox"
          checked={outstandingInsurerOnly}
          onChange={(e) => onOutstandingInsurerOnlyChange(e.target.checked)}
          className="h-4 w-4 rounded border-zinc-300"
        />
        {t.policy.filterOutstandingInsurerBalance}
      </label>
    </div>
  );
}

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
