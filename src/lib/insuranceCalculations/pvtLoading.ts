// Shared PVT Loading calculation, used identically by CAR, Standalone CPM,
// Fire & Perils, GIT Single and GIT Annual — the only insurance types with
// a PVT Loading "Amount x Rate = Premium" block. Motor's {{motor_pvt}} is a
// separate, unrelated concept (an inclusion/coverage description, not a
// loading calculation) and must never be routed through this helper.
//
// PVT Loading Amount is the calculation base, PVT Loading Rate is the
// percentage (same "0.15 means 0.15%" convention as every other rate in
// this project), and only PVT Loading Premium — never the amount — is
// added into a section's gross premium.
import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";

export type PvtLoadingInput = {
  enabled: boolean;
  amount?: DecimalInput;
  rate?: DecimalInput;
};

export type PvtLoadingResult = {
  amount: Prisma.Decimal;
  rate: Prisma.Decimal;
  premium: Prisma.Decimal;
};

export function calculatePvtLoading(input: PvtLoadingInput): PvtLoadingResult {
  if (!input.enabled) {
    return { amount: toDecimal(0), rate: toDecimal(0), premium: toDecimal(0) };
  }
  const amount = roundMoney(toDecimal(input.amount));
  const rate = toDecimal(input.rate);
  const premium = roundMoney(percentOf(amount, rate));
  return { amount, rate, premium };
}
