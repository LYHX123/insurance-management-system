"use client";

import { Input } from "@/components/ui/input";
import { useLocale } from "@/i18n/locale-provider";

// Shared by Motor and Non-Motor list tables (and Bond / Work Permit lists)
// so the expiry-date filter and the two outstanding-balance checkboxes stay
// behaviorally and visually identical across categories instead of drifting
// per-category.
//
// Phase 12A: upgraded in place to also support a From/To date RANGE. When
// only `value`/`onChange` are passed (Non-Motor, Bond, Work Permit — and any
// future single-date caller) it renders exactly the one date input it always
// did, unchanged. When the range props (`fromValue`/`toValue` +
// `onFromChange`/`onToChange`) are passed (Motor) it renders two labelled
// date inputs — either, both, or neither may be set. The two modes are
// mutually exclusive; a caller uses one or the other.
export function PolicyExpiryDateFilter({
  value,
  onChange,
  fromValue,
  toValue,
  onFromChange,
  onToChange,
}: {
  value?: string;
  onChange?: (value: string) => void;
  fromValue?: string;
  toValue?: string;
  onFromChange?: (value: string) => void;
  onToChange?: (value: string) => void;
}) {
  const { t } = useLocale();

  if (onFromChange || onToChange) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-sm text-zinc-600">
          <span>{t.policy.expiryFrom}</span>
          <Input
            type="date"
            value={fromValue ?? ""}
            onChange={(e) => onFromChange?.(e.target.value)}
            className="w-auto"
            aria-label={t.policy.expiryFrom}
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-zinc-600">
          <span>{t.policy.expiryTo}</span>
          <Input
            type="date"
            value={toValue ?? ""}
            onChange={(e) => onToChange?.(e.target.value)}
            className="w-auto"
            aria-label={t.policy.expiryTo}
          />
        </label>
      </div>
    );
  }

  return (
    <Input
      type="date"
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
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
