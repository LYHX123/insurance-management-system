"use client";

import { forwardRef, useState } from "react";
import { Input } from "@/components/ui/input";

// Single source of truth for money formatting/parsing across the quotation
// module (Contract Value, CPM Value, TPL limits, Annual Wages, Equipment
// Unit/Total Value, Premium, PHCF, ITL, Stamp Duty, Section Total, summaries,
// ...) so every field gets thousand separators the same way instead of each
// component rolling its own.

// Draft/form state always stores the raw, comma-free numeric string (or "")
// — this strips out any commas a user might paste in, so callers never need
// to parse commas out again before handing the value to Prisma.Decimal.
export function stripCommas(value: string): string {
  return value.replace(/,/g, "");
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Adds thousand separators to a raw numeric string without altering its
// precision — used while composing the live (unfocused) display value of a
// MoneyInput. Never pads decimals, so a whole number typed so far stays a
// whole number until the user actually types a decimal point.
function formatRawWithCommas(raw: string): string {
  if (!raw) return raw;
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [intPart, ...rest] = unsigned.split(".");
  const grouped = groupThousands(intPart || "");
  const decPart = rest.length > 0 ? `.${rest.join("")}` : "";
  return `${negative ? "-" : ""}${grouped}${decPart}`;
}

// For read-only calculated monetary displays (section totals, premium/PHCF/
// ITL/stamp duty breakdowns, quotation & financial summaries). Always renders
// exactly two decimal places with thousand separators, e.g. 1004540 ->
// "1,004,540.00".
export function formatMoney(value: number | string | null | undefined): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Only digits, an optional single leading '-', and an optional single '.'.
const PARTIAL_NUMBER = /^-?\d*\.?\d*$/;

export type MoneyInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> & {
  value: string;
  onChange: (rawValue: string) => void;
};

// Text input for editable money fields. The value passed in/out is always
// the raw, comma-free numeric string — this component only ever adds commas
// for display. While focused it shows exactly what the user is typing (so
// natural editing/cursor behavior is never fought); on blur it reformats
// with thousand separators. Pasted text is stripped of commas immediately,
// whether focused or not.
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onChange, onFocus, onBlur, ...props }, ref) => {
    const [focused, setFocused] = useState(false);

    return (
      <Input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={focused ? value : formatRawWithCommas(value)}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        onChange={(e) => {
          const raw = stripCommas(e.target.value);
          if (raw === "" || PARTIAL_NUMBER.test(raw)) {
            onChange(raw);
          }
        }}
        {...props}
      />
    );
  }
);
MoneyInput.displayName = "MoneyInput";
