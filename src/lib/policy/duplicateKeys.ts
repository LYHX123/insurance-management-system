// Duplicate-detection keys per the Phase 1A spec — combinations found to
// actually recur in the historical workbook (18 registration+start-date
// groups in the real data). None of these reject automatically; they only
// flag a row so the import preview can ask the user to confirm.
export type DuplicateKeyInput = {
  registrationNumber?: string | null;
  effectiveDate?: Date | null;
  expiryDate?: Date | null;
  customerKey?: string | null; // matchedCustomerId, or the raw normalized name if unmatched
  insuranceType?: string | null;
  policyNumber?: string | null;
};

function iso(d?: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function buildDuplicateKeys(input: DuplicateKeyInput): string[] {
  const keys: string[] = [];
  const reg = input.registrationNumber?.trim().toUpperCase();
  const eff = iso(input.effectiveDate);
  const exp = iso(input.expiryDate);

  if (reg && eff) keys.push(`REG_EFF:${reg}:${eff}`);
  if (reg && exp) keys.push(`REG_EXP:${reg}:${exp}`);
  if (input.customerKey && reg && input.insuranceType && eff) {
    keys.push(`CUST_REG_TYPE_EFF:${input.customerKey}:${reg}:${input.insuranceType.trim().toUpperCase()}:${eff}`);
  }
  if (input.policyNumber?.trim()) keys.push(`POLICY_NO:${input.policyNumber.trim().toUpperCase()}`);

  return keys;
}
