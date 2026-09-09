"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput } from "@/components/ui/money-input";
import { renewPolicyAction, type RenewPolicyInput } from "@/app/(app)/policy/renewal/actions";
import { RENEWAL_CATEGORY_ROUTE } from "@/lib/policy/renewal";
import { MOTOR_COVER_TYPES } from "@/lib/policy/motorCoverTypes";
import { MOTOR_TAX_CLASSES } from "@/lib/policy/motorTaxClasses";
import { NON_MOTOR_COVER_TYPES } from "@/lib/policy/nonMotorCoverTypes";
import { BOND_TYPES, bondTypeAllowsNoExpiry } from "@/lib/policy/bondTypes";
import { WORK_PERMIT_TYPES } from "@/lib/policy/workPermitTypes";
import type { PolicyCategory } from "@/generated/prisma/enums";

// The subset of the SOURCE policy the renewal form prefills from — the
// server component that renders this maps its Prisma row into this shape.
export type RenewSource = {
  id: string;
  recordNumber: string;
  category: PolicyCategory;
  customerName: string;
  insurerName: string | null;
  currency: string;
  customerPremium: string;
  insurerCost: string;
  remarks: string | null;
  contactPerson: string | null;
  motor?: {
    registrationNumber: string;
    insuranceType: string;
    taxClass: string | null;
    vehicleValue: string | null;
    vehicleMake: string | null;
    vehicleModel: string | null;
    policyNumber: string | null;
  };
  nonMotor?: { insuranceType: string; policyNumber: string | null };
  bond?: { bondType: string; bondAmount: string; customBondType: string | null; policyNumber: string | null };
  workPermit?: { permitType: string; agent: string; otherPermitType: string | null; permitNumber: string | null };
};

const today = () => new Date().toISOString().slice(0, 10);

const ERROR_KEY: Record<string, string> = {
  RECORD_NOT_FOUND: "recordNotFound",
  FORBIDDEN: "genericError",
  POLICY_ALREADY_RENEWED: "renewalAlreadyRenewedError",
  POLICY_NOT_RENEWABLE: "renewalNotRenewableError",
  DATES_REQUIRED: "datesRequired",
  EXPIRY_DATE_REQUIRED: "expiryDateRequired",
  EXPIRY_BEFORE_EFFECTIVE: "expiryBeforeEffective",
  CLIENT_PREMIUM_INVALID: "clientPremiumInvalid",
  INSURER_COST_INVALID: "insurerCostInvalid",
  REGISTRATION_NUMBER_REQUIRED: "registrationNumberRequired",
  INSURANCE_TYPE_REQUIRED: "insuranceTypeRequired",
  INVALID_TAX_CLASS: "taxClassRequired",
  INVALID_INSURANCE_TYPE: "insuranceTypeRequired",
  INVALID_BOND_TYPE: "genericError",
  BOND_AMOUNT_INVALID: "genericError",
  CUSTOM_BOND_TYPE_REQUIRED: "genericError",
  INVALID_PERMIT_TYPE: "genericError",
  AGENT_REQUIRED: "genericError",
  OTHER_PERMIT_TYPE_REQUIRED: "genericError",
  RENEW_FAILED: "createFailedError",
};

export function RenewPolicyForm({ source }: { source: RenewSource }) {
  const { t } = useLocale();
  const router = useRouter();

  const [effectiveDate, setEffectiveDate] = useState(today());
  const [expiryDate, setExpiryDate] = useState("");
  const [insurerName, setInsurerName] = useState(source.insurerName ?? "");
  const [currency, setCurrency] = useState(source.currency);
  const [customerPremium, setCustomerPremium] = useState(source.customerPremium);
  const [insurerCost, setInsurerCost] = useState(source.insurerCost);
  const [remarks, setRemarks] = useState(source.remarks ?? "");

  // Motor
  const [regNo, setRegNo] = useState(source.motor?.registrationNumber ?? "");
  const [motorType, setMotorType] = useState(source.motor?.insuranceType ?? "");
  const [taxClass, setTaxClass] = useState(source.motor?.taxClass ?? "");
  const [vehicleValue, setVehicleValue] = useState(source.motor?.vehicleValue ?? "");
  const [vehicleMake, setVehicleMake] = useState(source.motor?.vehicleMake ?? "");
  const [vehicleModel, setVehicleModel] = useState(source.motor?.vehicleModel ?? "");
  const [motorPolicyNumber, setMotorPolicyNumber] = useState(source.motor?.policyNumber ?? "");
  // Non-Motor
  const [nmType, setNmType] = useState(source.nonMotor?.insuranceType ?? "");
  const [nmPolicyNumber, setNmPolicyNumber] = useState(source.nonMotor?.policyNumber ?? "");
  // Bond
  const [bondType, setBondType] = useState(source.bond?.bondType ?? "");
  const [bondAmount, setBondAmount] = useState(source.bond?.bondAmount ?? "");
  const [customBondType, setCustomBondType] = useState(source.bond?.customBondType ?? "");
  const [bondPolicyNumber, setBondPolicyNumber] = useState(source.bond?.policyNumber ?? "");
  // Work Permit
  const [permitType, setPermitType] = useState(source.workPermit?.permitType ?? "");
  const [agent, setAgent] = useState(source.workPermit?.agent ?? "");
  const [otherPermitType, setOtherPermitType] = useState(source.workPermit?.otherPermitType ?? "");
  const [permitNumber, setPermitNumber] = useState(source.workPermit?.permitNumber ?? "");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const taxClassLabel: Record<string, string> = {
    PRIVATE: t.policy.taxClassPrivate,
    COMMERCIAL: t.policy.taxClassCommercial,
    PSV: t.policy.taxClassPsv,
    SPECIAL_USE: t.policy.taxClassSpecialUse,
  };
  const nmCoverLabel: Record<string, string> = {
    CONTRACTORS_ALL_RISKS: t.policy.coverContractorsAllRisks,
    WIBA: t.policy.coverWiba,
    EMPLOYERS_LIABILITY: t.policy.coverEmployersLiability,
    CONTRACTORS_PLANT_MACHINERY: t.policy.coverContractorsPlantMachinery,
    PUBLIC_LIABILITY: t.policy.coverPublicLiability,
    FIRE_ALLIED_PERILS: t.policy.coverFireAlliedPerils,
    BURGLARY: t.policy.coverBurglary,
    GOODS_IN_TRANSIT_SINGLE: t.policy.coverGoodsInTransitSingle,
    GOODS_IN_TRANSIT_ANNUAL: t.policy.coverGoodsInTransitAnnual,
    MARINE: t.policy.coverMarine,
    GROUP_PERSONAL_ACCIDENT: t.policy.coverGroupPersonalAccident,
    GROUP_MEDICAL: t.policy.coverGroupMedical,
  };
  const bondTypeLabel: Record<string, string> = {
    TENDER_BOND: t.policy.bondTenderBond,
    PERFORMANCE_BOND: t.policy.bondPerformanceBond,
    ADVANCE_PAYMENT_GUARANTEE: t.policy.bondAdvancePaymentGuarantee,
    CUSTOM_BOND: t.policy.bondCustomBond,
    SECURITY_BOND: t.policy.bondSecurityBond,
  };
  const permitTypeLabel: Record<string, string> = {
    CLASS_D: t.policy.permitClassD,
    CLASS_G: t.policy.permitClassG,
    SPECIAL_PASS: t.policy.permitSpecialPass,
    DEPENDANT_PASS: t.policy.permitDependantPass,
    OTHER: t.policy.permitOther,
  };
  const backHref = `${RENEWAL_CATEGORY_ROUTE[source.category]}/${source.id}`;

  // Phase 13C — renewing a BOND whose (possibly just-changed) type is Security
  // Bond may leave the expiry date blank, exactly like Create/Edit. Every
  // other category and Bond type still requires it.
  const isSecurityBondRenewal = source.category === "BOND" && bondTypeAllowsNoExpiry(bondType);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!effectiveDate) {
      setError(t.policy.datesRequired);
      return;
    }
    if (!isSecurityBondRenewal && !expiryDate) {
      setError(t.policy.expiryDateRequired);
      return;
    }
    if (expiryDate && new Date(expiryDate) < new Date(effectiveDate)) {
      setError(t.policy.expiryBeforeEffective);
      return;
    }
    setSubmitting(true);
    const input: RenewPolicyInput = {
      processingDate: today(),
      effectiveDate,
      expiryDate: expiryDate || null,
      insurerName: insurerName || null,
      currency,
      customerPremium,
      insurerCost,
      remarks: remarks || null,
    };
    if (source.category === "MOTOR") {
      input.motor = {
        registrationNumber: regNo,
        insuranceType: motorType,
        taxClass: taxClass || null,
        vehicleValue: vehicleValue || null,
        vehicleMake: vehicleMake || null,
        vehicleModel: vehicleModel || null,
        policyNumber: motorPolicyNumber || null,
      };
    } else if (source.category === "NON_MOTOR") {
      input.nonMotor = { insuranceType: nmType, policyNumber: nmPolicyNumber || null };
    } else if (source.category === "BOND") {
      input.bond = { bondType, bondAmount, customBondType: customBondType || null, policyNumber: bondPolicyNumber || null };
    } else {
      input.workPermit = { permitType, agent, otherPermitType: otherPermitType || null, permitNumber: permitNumber || null };
    }

    const res = await renewPolicyAction(source.id, input);
    setSubmitting(false);
    if (!res.success) {
      setError(t.policy[(ERROR_KEY[res.error] ?? "genericError") as keyof typeof t.policy] as string);
      return;
    }
    router.push(`${RENEWAL_CATEGORY_ROUTE[res.category]}/${res.id}`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-section">
      <PageHeader title={t.policy.renewPolicyTitle} description={t.policy.renewPolicyDescription.replace("{number}", source.recordNumber)} />

      <Card>
        <div className="form-grid">
          <FormField label={t.policy.customer}>
            <Input value={source.customerName} disabled readOnly />
          </FormField>
          <FormField label={t.policy.effectiveDate}>
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} required />
          </FormField>
          <FormField label={isSecurityBondRenewal ? t.policy.expiryDateOptional : t.policy.expiryDate}>
            <Input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              required={!isSecurityBondRenewal}
            />
          </FormField>
          <FormField label={t.policy.insurerOptional}>
            <Input value={insurerName} onChange={(e) => setInsurerName(e.target.value)} />
          </FormField>
          <FormField label={t.policy.clientPremium}>
            <MoneyInput value={customerPremium} onChange={setCustomerPremium} required />
          </FormField>
          <FormField label={t.policy.insurerCost}>
            <MoneyInput value={insurerCost} onChange={setInsurerCost} required />
          </FormField>
          <FormField label={t.policy.currencyRenew}>
            <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          </FormField>

          {source.category === "MOTOR" && (
            <>
              <FormField label={t.policy.registrationNumber}>
                <Input value={regNo} onChange={(e) => setRegNo(e.target.value.toUpperCase())} required />
              </FormField>
              <FormField label={t.policy.typeOfCover}>
                <Select value={motorType} onChange={(e) => setMotorType(e.target.value)} required>
                  <option value="">{t.policy.selectTypeOfCover}</option>
                  {MOTOR_COVER_TYPES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                  {motorType && !MOTOR_COVER_TYPES.includes(motorType as (typeof MOTOR_COVER_TYPES)[number]) && (
                    <option value={motorType}>{motorType}</option>
                  )}
                </Select>
              </FormField>
              <FormField label={t.policy.taxClass}>
                <Select value={taxClass} onChange={(e) => setTaxClass(e.target.value)}>
                  <option value="">{t.policy.selectTaxClass}</option>
                  {MOTOR_TAX_CLASSES.map((c) => (
                    <option key={c} value={c}>{taxClassLabel[c]}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t.policy.vehicleValueOptional}>
                <MoneyInput value={vehicleValue} onChange={setVehicleValue} />
              </FormField>
              <FormField label={t.policy.vehicleMake}>
                <Input value={vehicleMake} onChange={(e) => setVehicleMake(e.target.value)} />
              </FormField>
              <FormField label={t.policy.vehicleModel}>
                <Input value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} />
              </FormField>
              <FormField label={t.policy.policyNumberOptional}>
                <Input value={motorPolicyNumber} onChange={(e) => setMotorPolicyNumber(e.target.value)} />
              </FormField>
            </>
          )}

          {source.category === "NON_MOTOR" && (
            <>
              <FormField label={t.policy.typeOfCover}>
                <Select value={nmType} onChange={(e) => setNmType(e.target.value)} required>
                  <option value="">{t.policy.selectTypeOfCoverNonMotor}</option>
                  {NON_MOTOR_COVER_TYPES.map((c) => (
                    <option key={c} value={c}>{nmCoverLabel[c] ?? c}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t.policy.policyNumberOptional}>
                <Input value={nmPolicyNumber} onChange={(e) => setNmPolicyNumber(e.target.value)} />
              </FormField>
            </>
          )}

          {source.category === "BOND" && (
            <>
              <FormField label={t.policy.typeOfBond}>
                <Select value={bondType} onChange={(e) => setBondType(e.target.value)} required>
                  <option value="">{t.policy.selectBondTypeRenew}</option>
                  {BOND_TYPES.map((c) => (
                    <option key={c} value={c}>{bondTypeLabel[c] ?? c}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t.policy.bondAmount}>
                <MoneyInput value={bondAmount} onChange={setBondAmount} required />
              </FormField>
              {bondType === "CUSTOM_BOND" && (
                <FormField label={t.policy.typeOfCustomBond}>
                  <Input value={customBondType} onChange={(e) => setCustomBondType(e.target.value)} required />
                </FormField>
              )}
              <FormField label={t.policy.policyNumberOptional}>
                <Input value={bondPolicyNumber} onChange={(e) => setBondPolicyNumber(e.target.value)} />
              </FormField>
            </>
          )}

          {source.category === "WORK_PERMIT" && (
            <>
              <FormField label={t.policy.typeOfPermit}>
                <Select value={permitType} onChange={(e) => setPermitType(e.target.value)} required>
                  <option value="">{t.policy.selectPermitTypeRenew}</option>
                  {WORK_PERMIT_TYPES.map((c) => (
                    <option key={c} value={c}>{permitTypeLabel[c] ?? c}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t.policy.agent}>
                <Input value={agent} onChange={(e) => setAgent(e.target.value)} required />
              </FormField>
              {permitType === "OTHER" && (
                <FormField label={t.policy.otherPermitType}>
                  <Input value={otherPermitType} onChange={(e) => setOtherPermitType(e.target.value)} required />
                </FormField>
              )}
              <FormField label={t.policy.policyNumberOptional}>
                <Input value={permitNumber} onChange={(e) => setPermitNumber(e.target.value)} />
              </FormField>
            </>
          )}
        </div>

        <div className="mt-4">
          <FormField label={t.policy.remarks}>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} />
          </FormField>
        </div>

        {error && (
          <p role="alert" className="form-error mt-3">
            {error}
          </p>
        )}
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.push(backHref)} disabled={submitting}>
          {t.common.cancel}
        </Button>
        <Button type="submit" disabled={submitting}>
          {t.policy.renewPolicy}
        </Button>
      </div>
    </form>
  );
}
