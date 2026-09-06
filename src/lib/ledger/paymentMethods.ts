// Phase 12E — the single source of truth for the Manual Ledger "Payment
// Method" field. Mirrors the shape of src/lib/policy/motorTaxClasses.ts.
//
// The database column (LedgerManualEntry.paymentMethod) stays a plain
// nullable String: pre-12E rows may hold ANY free-text value and must keep
// rendering and staying editable unchanged. From 12E on, the create/edit
// forms and the server actions only ever write one of the four canonical
// values below — never an arbitrary string, never a silent conversion of a
// legacy value.

export const MANUAL_LEDGER_PAYMENT_METHODS = ["MPESA", "BANK_TRANSFER", "CHEQUE", "CASH"] as const;

export type ManualLedgerPaymentMethod = (typeof MANUAL_LEDGER_PAYMENT_METHODS)[number];

// i18n key (under dictionary.ledger) for each canonical value's display
// label. The label itself lives in en.ts / zh.ts, never here.
export const MANUAL_LEDGER_PAYMENT_METHOD_LABEL_KEY: Record<ManualLedgerPaymentMethod, string> = {
  MPESA: "paymentMethodMpesa",
  BANK_TRANSFER: "paymentMethodBankTransfer",
  CHEQUE: "paymentMethodCheque",
  CASH: "paymentMethodCash",
};

// The exact Excel cell value exported for each canonical method — the
// human-readable business value, not the stored token (see the export
// route). A legacy value is exported verbatim instead.
export const MANUAL_LEDGER_PAYMENT_METHOD_EXPORT_LABEL: Record<ManualLedgerPaymentMethod, string> = {
  MPESA: "MPESA",
  BANK_TRANSFER: "BANK TRANSFER",
  CHEQUE: "CHEQUE",
  CASH: "CASH",
};

export function isManualLedgerPaymentMethod(value: string | null | undefined): value is ManualLedgerPaymentMethod {
  return typeof value === "string" && (MANUAL_LEDGER_PAYMENT_METHODS as readonly string[]).includes(value);
}

// Normalises a submitted payment-method value for a NEW or CHANGED entry.
// Returns the canonical token when valid, `null` for an intentionally blank
// choice, or `undefined` when the value is neither blank nor one of the four
// standard tokens (the caller rejects it — server-side validation never
// trusts the client dropdown alone).
export function normalizeSubmittedPaymentMethod(value: string | null | undefined): ManualLedgerPaymentMethod | null | undefined {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  return isManualLedgerPaymentMethod(trimmed) ? trimmed : undefined;
}
