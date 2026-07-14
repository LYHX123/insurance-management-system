"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { useLocale } from "@/i18n/locale-provider";
import {
  createInsuranceTypeAction,
  updateInsuranceTypeAction,
} from "@/app/(app)/quotation/insurance-type-actions";
import type { InsuranceTypeRow } from "@/components/quotations/types";

const ERROR_KEY: Record<string, string> = {
  NAME_REQUIRED: "nameRequired",
  CODE_REQUIRED: "codeRequired",
  CODE_TAKEN: "codeTaken",
  INVALID_RATE: "invalidRate",
};

export function InsuranceTypeFormModal({
  insuranceType,
  onClose,
  onSuccess,
}: {
  insuranceType: InsuranceTypeRow | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const { t } = useLocale();
  const isEdit = !!insuranceType;

  const [name, setName] = useState(insuranceType?.name ?? "");
  const [code, setCode] = useState(insuranceType?.code ?? "");
  const [description, setDescription] = useState(insuranceType?.description ?? "");
  const [defaultPHCFRate, setDefaultPHCFRate] = useState(insuranceType?.defaultPHCFRate ?? "0.25");
  const [defaultITLRate, setDefaultITLRate] = useState(insuranceType?.defaultITLRate ?? "0.20");
  const [defaultStampDuty, setDefaultStampDuty] = useState(insuranceType?.defaultStampDuty ?? "40");
  const [applyPHCF, setApplyPHCF] = useState(insuranceType?.applyPHCF ?? true);
  const [applyITL, setApplyITL] = useState(insuranceType?.applyITL ?? true);
  const [applyStampDuty, setApplyStampDuty] = useState(insuranceType?.applyStampDuty ?? true);
  const [defaultClauses, setDefaultClauses] = useState(insuranceType?.defaultClauses ?? "");
  const [defaultExclusions, setDefaultExclusions] = useState(insuranceType?.defaultExclusions ?? "");
  const [defaultConditions, setDefaultConditions] = useState(insuranceType?.defaultConditions ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !code.trim()) {
      setError(t.quotations.requiredField);
      return;
    }

    const data = {
      name,
      code,
      description,
      defaultPHCFRate: Number(defaultPHCFRate),
      defaultITLRate: Number(defaultITLRate),
      defaultStampDuty: Number(defaultStampDuty),
      applyPHCF,
      applyITL,
      applyStampDuty,
      defaultClauses,
      defaultExclusions,
      defaultConditions,
    };

    setIsSubmitting(true);
    const result = isEdit
      ? await updateInsuranceTypeAction(insuranceType.id, data)
      : await createInsuranceTypeAction(data);
    setIsSubmitting(false);

    if (!result.success) {
      const key = ERROR_KEY[result.error] ?? "genericError";
      setError(t.quotations[key as keyof typeof t.quotations]);
      return;
    }

    onSuccess(isEdit ? t.common.save : t.quotations.createSuccess);
  };

  return (
    <Modal
      title={isEdit ? t.quotations.editInsuranceTypeTitle : t.quotations.createInsuranceTypeTitle}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="form-stack">
        <div className="form-grid">
          <FormField label={t.quotations.insuranceType}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </FormField>
          <FormField label={t.quotations.code}>
            <Input value={code} onChange={(e) => setCode(e.target.value)} required />
          </FormField>
        </div>

        <FormField label={t.quotations.description}>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>

        <div className="form-grid">
          <FormField label={t.quotations.defaultPHCFRate}>
            <Input
              type="number"
              step="0.0001"
              min="0"
              value={defaultPHCFRate}
              onChange={(e) => setDefaultPHCFRate(e.target.value)}
            />
          </FormField>
          <FormField label={t.quotations.defaultITLRate}>
            <Input
              type="number"
              step="0.0001"
              min="0"
              value={defaultITLRate}
              onChange={(e) => setDefaultITLRate(e.target.value)}
            />
          </FormField>
          <FormField label={t.quotations.defaultStampDuty}>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={defaultStampDuty}
              onChange={(e) => setDefaultStampDuty(e.target.value)}
            />
          </FormField>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600"
              checked={applyPHCF}
              onChange={(e) => setApplyPHCF(e.target.checked)}
            />
            {t.quotations.applyPHCF}
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600"
              checked={applyITL}
              onChange={(e) => setApplyITL(e.target.checked)}
            />
            {t.quotations.applyITL}
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600"
              checked={applyStampDuty}
              onChange={(e) => setApplyStampDuty(e.target.checked)}
            />
            {t.quotations.applyStampDuty}
          </label>
        </div>

        <FormField label={t.quotations.defaultClauses}>
          <Textarea value={defaultClauses} onChange={(e) => setDefaultClauses(e.target.value)} />
        </FormField>
        <FormField label={t.quotations.defaultExclusions}>
          <Textarea value={defaultExclusions} onChange={(e) => setDefaultExclusions(e.target.value)} />
        </FormField>
        <FormField label={t.quotations.defaultConditions}>
          <Textarea value={defaultConditions} onChange={(e) => setDefaultConditions(e.target.value)} />
        </FormField>

        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t.common.cancel}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {t.common.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
