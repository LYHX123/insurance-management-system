// Phase 12E — client-side label helpers for the Manual Ledger payment
// method. The canonical values + i18n keys live in
// src/lib/ledger/paymentMethods.ts (the single source of truth); this only
// resolves them against the active dictionary's `ledger` section.

import {
  MANUAL_LEDGER_PAYMENT_METHODS,
  MANUAL_LEDGER_PAYMENT_METHOD_LABEL_KEY,
  isManualLedgerPaymentMethod,
} from "@/lib/ledger/paymentMethods";

type LedgerDict = Record<string, string>;

export function manualLedgerPaymentMethodOptions(ledger: LedgerDict): Array<{ value: string; label: string }> {
  return MANUAL_LEDGER_PAYMENT_METHODS.map((value) => ({
    value,
    label: ledger[MANUAL_LEDGER_PAYMENT_METHOD_LABEL_KEY[value]],
  }));
}

// Standard token -> translated label; a legacy / non-standard stored value
// is shown verbatim.
export function displayPaymentMethod(value: string | null | undefined, ledger: LedgerDict): string {
  if (!value) return "";
  return isManualLedgerPaymentMethod(value) ? ledger[MANUAL_LEDGER_PAYMENT_METHOD_LABEL_KEY[value]] : value;
}
