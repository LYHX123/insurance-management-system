import { describe, it, expect } from "vitest";
import {
  MANUAL_LEDGER_PAYMENT_METHODS,
  MANUAL_LEDGER_PAYMENT_METHOD_LABEL_KEY,
  MANUAL_LEDGER_PAYMENT_METHOD_EXPORT_LABEL,
  isManualLedgerPaymentMethod,
  normalizeSubmittedPaymentMethod,
} from "@/lib/ledger/paymentMethods";
import en from "@/i18n/dictionaries/en";
import zh from "@/i18n/dictionaries/zh";

// Phase 12E — the four standard payment methods are the single source of
// truth (X.31, X.36, X.40).

describe("MANUAL_LEDGER_PAYMENT_METHODS", () => {
  it("X.31: is exactly the four standard business choices", () => {
    expect([...MANUAL_LEDGER_PAYMENT_METHODS]).toEqual(["MPESA", "BANK_TRANSFER", "CHEQUE", "CASH"]);
  });

  it("X.36: the type guard only accepts the four canonical tokens", () => {
    expect(isManualLedgerPaymentMethod("MPESA")).toBe(true);
    expect(isManualLedgerPaymentMethod("BANK_TRANSFER")).toBe(true);
    for (const bad of ["", "bank transfer", "M-Pesa", "mpesa", "PayPal", null, undefined]) {
      expect(isManualLedgerPaymentMethod(bad as string)).toBe(false);
    }
  });

  it("X.36: normalize accepts the 4 tokens, treats blank as null, rejects anything else", () => {
    expect(normalizeSubmittedPaymentMethod(" MPESA ")).toBe("MPESA");
    expect(normalizeSubmittedPaymentMethod("CASH")).toBe("CASH");
    expect(normalizeSubmittedPaymentMethod("")).toBeNull();
    expect(normalizeSubmittedPaymentMethod("   ")).toBeNull();
    expect(normalizeSubmittedPaymentMethod(null)).toBeNull();
    expect(normalizeSubmittedPaymentMethod("M-Pesa (old)")).toBeUndefined();
    expect(normalizeSubmittedPaymentMethod("BANK TRANSFER")).toBeUndefined();
  });

  it("X.40: every canonical value has an EN and ZH label", () => {
    for (const method of MANUAL_LEDGER_PAYMENT_METHODS) {
      const key = MANUAL_LEDGER_PAYMENT_METHOD_LABEL_KEY[method] as keyof typeof en.ledger;
      expect(typeof en.ledger[key]).toBe("string");
      expect(typeof zh.ledger[key]).toBe("string");
      expect(en.ledger[key]).not.toEqual("");
      expect(zh.ledger[key]).not.toEqual("");
    }
    expect(en.ledger.paymentMethodBankTransfer).toBe("Bank Transfer");
    expect(zh.ledger.paymentMethodBankTransfer).toBe("银行转账");
    expect(zh.ledger.paymentMethodCheque).toBe("支票");
    expect(zh.ledger.paymentMethodCash).toBe("现金");
  });

  it("X.41: export labels are the readable business values", () => {
    expect(MANUAL_LEDGER_PAYMENT_METHOD_EXPORT_LABEL).toEqual({
      MPESA: "MPESA",
      BANK_TRANSFER: "BANK TRANSFER",
      CHEQUE: "CHEQUE",
      CASH: "CASH",
    });
  });
});
