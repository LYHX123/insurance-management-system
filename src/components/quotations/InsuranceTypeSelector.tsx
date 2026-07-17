"use client";

import { useState } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export type Phase1Selection = {
  carPackage: boolean;
  wiba: boolean;
  employersLiability: boolean;
  cpmStandalone: boolean;
  publicLiability: boolean;
  fireAndPerils: boolean;
  burglary: boolean;
  gitSingle: boolean;
  gitAnnual: boolean;
  marineCover: boolean;
  motorCompPrivate: boolean;
  motorCompCommercial: boolean;
  motorTpoPrivate: boolean;
  motorTpoCommercial: boolean;
  gpa: boolean;
  medical: boolean;
  tenderSecurity: boolean;
  performanceBond: boolean;
  apg: boolean;
  customsBond: boolean;
};

// Only one of these four may be selected at a time in Phase 2B (single
// Motor section per quotation — see the confirm-to-switch flow below).
const MOTOR_KEYS = ["motorCompPrivate", "motorCompCommercial", "motorTpoPrivate", "motorTpoCommercial"] as const;
type MotorKey = (typeof MOTOR_KEYS)[number];

function CheckboxCard({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-control border p-3 transition-colors ${
        disabled
          ? "cursor-not-allowed border-zinc-100 bg-zinc-50 text-zinc-400"
          : checked
            ? "cursor-pointer border-emerald-300 bg-emerald-50"
            : "cursor-pointer border-zinc-200 hover:border-emerald-200"
      }`}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600 disabled:opacity-50"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block font-medium text-zinc-800">{label}</span>
        {hint && <span className="block text-sm text-secondary">{hint}</span>}
      </span>
    </label>
  );
}

export function InsuranceTypeSelector({
  selection,
  onChange,
}: {
  selection: Phase1Selection;
  onChange: (next: Phase1Selection) => void;
}) {
  const { t } = useLocale();
  const [pendingMotorSwitch, setPendingMotorSwitch] = useState<{ from: MotorKey; to: MotorKey } | null>(null);

  const motorLabel: Record<MotorKey, string> = {
    motorCompPrivate: t.quotations.motorCompPrivateType,
    motorCompCommercial: t.quotations.motorCompCommercialType,
    motorTpoPrivate: t.quotations.motorTpoPrivateType,
    motorTpoCommercial: t.quotations.motorTpoCommercialType,
  };

  const handleMotorChange = (key: MotorKey, checked: boolean) => {
    if (!checked) {
      onChange({ ...selection, [key]: false });
      return;
    }
    const currentlySelected = MOTOR_KEYS.find((k) => k !== key && selection[k]);
    if (!currentlySelected) {
      onChange({ ...selection, [key]: true });
      return;
    }
    // Another Motor type is already selected — never silently keep two;
    // require explicit confirmation before switching.
    setPendingMotorSwitch({ from: currentlySelected, to: key });
  };

  const confirmMotorSwitch = () => {
    if (!pendingMotorSwitch) return;
    onChange({ ...selection, [pendingMotorSwitch.from]: false, [pendingMotorSwitch.to]: true });
    setPendingMotorSwitch(null);
  };

  return (
    <Card>
      <h2 className="section-title mb-4">{t.quotations.selectInsuranceTypes}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CheckboxCard
          label={t.quotations.carPackage}
          checked={selection.carPackage}
          onChange={(checked) => onChange({ ...selection, carPackage: checked })}
        />
        <CheckboxCard
          label={t.quotations.wibaType}
          checked={selection.wiba}
          onChange={(checked) =>
            onChange({
              ...selection,
              wiba: checked,
              // EL cannot exist without WIBA in the same quotation.
              employersLiability: checked ? selection.employersLiability : false,
            })
          }
        />
        <CheckboxCard
          label={t.quotations.elType}
          hint={!selection.wiba ? t.quotations.elRequiresWibaHint : undefined}
          checked={selection.employersLiability}
          disabled={!selection.wiba}
          onChange={(checked) => onChange({ ...selection, employersLiability: checked })}
        />
        <CheckboxCard
          label={t.quotations.cpmStandaloneType}
          checked={selection.cpmStandalone}
          onChange={(checked) => onChange({ ...selection, cpmStandalone: checked })}
        />
        <CheckboxCard
          label={t.quotations.publicLiabilityType}
          checked={selection.publicLiability}
          onChange={(checked) => onChange({ ...selection, publicLiability: checked })}
        />
        <CheckboxCard
          label={t.quotations.fireAndPerilsType}
          checked={selection.fireAndPerils}
          onChange={(checked) => onChange({ ...selection, fireAndPerils: checked })}
        />
        <CheckboxCard
          label={t.quotations.burglaryType}
          checked={selection.burglary}
          onChange={(checked) => onChange({ ...selection, burglary: checked })}
        />
        <CheckboxCard
          label={t.quotations.gitSingleType}
          checked={selection.gitSingle}
          onChange={(checked) => onChange({ ...selection, gitSingle: checked })}
        />
        <CheckboxCard
          label={t.quotations.gitAnnualType}
          checked={selection.gitAnnual}
          onChange={(checked) => onChange({ ...selection, gitAnnual: checked })}
        />
        <CheckboxCard
          label={t.quotations.marineCoverType}
          checked={selection.marineCover}
          onChange={(checked) => onChange({ ...selection, marineCover: checked })}
        />
        <CheckboxCard
          label={t.quotations.motorCompPrivateType}
          hint={t.quotations.motorOnlyOneHint}
          checked={selection.motorCompPrivate}
          onChange={(checked) => handleMotorChange("motorCompPrivate", checked)}
        />
        <CheckboxCard
          label={t.quotations.motorCompCommercialType}
          hint={t.quotations.motorOnlyOneHint}
          checked={selection.motorCompCommercial}
          onChange={(checked) => handleMotorChange("motorCompCommercial", checked)}
        />
        <CheckboxCard
          label={t.quotations.motorTpoPrivateType}
          hint={t.quotations.motorOnlyOneHint}
          checked={selection.motorTpoPrivate}
          onChange={(checked) => handleMotorChange("motorTpoPrivate", checked)}
        />
        <CheckboxCard
          label={t.quotations.motorTpoCommercialType}
          hint={t.quotations.motorOnlyOneHint}
          checked={selection.motorTpoCommercial}
          onChange={(checked) => handleMotorChange("motorTpoCommercial", checked)}
        />
        <CheckboxCard
          label={t.quotations.gpaType}
          checked={selection.gpa}
          onChange={(checked) => onChange({ ...selection, gpa: checked })}
        />
        <CheckboxCard
          label={t.quotations.medicalType}
          checked={selection.medical}
          onChange={(checked) => onChange({ ...selection, medical: checked })}
        />
        <CheckboxCard
          label={t.quotations.tenderSecurityType}
          checked={selection.tenderSecurity}
          onChange={(checked) => onChange({ ...selection, tenderSecurity: checked })}
        />
        <CheckboxCard
          label={t.quotations.performanceBondType}
          checked={selection.performanceBond}
          onChange={(checked) => onChange({ ...selection, performanceBond: checked })}
        />
        <CheckboxCard
          label={t.quotations.apgType}
          checked={selection.apg}
          onChange={(checked) => onChange({ ...selection, apg: checked })}
        />
        <CheckboxCard
          label={t.quotations.customsBondType}
          checked={selection.customsBond}
          onChange={(checked) => onChange({ ...selection, customsBond: checked })}
        />
      </div>

      {pendingMotorSwitch && (
        <ConfirmDialog
          title={t.quotations.confirmMotorSwitchTitle}
          message={t.quotations.confirmMotorSwitchMessage
            .replace("{from}", motorLabel[pendingMotorSwitch.from])
            .replace("{to}", motorLabel[pendingMotorSwitch.to])}
          isSubmitting={false}
          onConfirm={confirmMotorSwitch}
          onClose={() => setPendingMotorSwitch(null)}
        />
      )}
    </Card>
  );
}
