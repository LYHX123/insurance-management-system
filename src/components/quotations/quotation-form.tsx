"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createQuotationAction, updateQuotationAction } from "@/app/(app)/quotation/actions";
import type { CustomerOption, InsuranceTypeOption, CalculationMethod } from "@/components/quotations/types";

type ItemDraft = {
  key: string;
  insuredContent: string;
  sumInsured: string;
  rate: string;
  calculationMethod: CalculationMethod;
  premium: string;
  notes: string;
};

type SectionDraft = {
  key: string;
  insuranceTypeId: string;
  insuranceTypeNameSnapshot: string;
  description: string;
  phcfRate: string;
  itlRate: string;
  stampDuty: string;
  applyPHCF: boolean;
  applyITL: boolean;
  applyStampDuty: boolean;
  clausesSnapshot: string;
  exclusionsSnapshot: string;
  conditionsSnapshot: string;
  items: ItemDraft[];
};

export type QuotationFormData = {
  id: string;
  quotationNumber: string;
  customerId: string;
  projectId: string | null;
  quotationDate: string;
  validUntil: string;
  currency: string;
  internalNotes: string;
  sections: (Omit<SectionDraft, "key" | "items"> & {
    id: string;
    items: (Omit<ItemDraft, "key"> & { id: string })[];
  })[];
};

const ERROR_KEY: Record<string, string> = {
  CUSTOMER_REQUIRED: "customerRequired",
  CUSTOMER_NOT_FOUND: "genericError",
  PROJECT_NOT_BELONG_TO_CUSTOMER: "projectNotBelongToCustomer",
  AT_LEAST_ONE_SECTION: "atLeastOneSection",
  AT_LEAST_ONE_ITEM: "atLeastOneItem",
  INSURANCE_TYPE_NOT_FOUND: "genericError",
  ITEM_CONTENT_REQUIRED: "requiredField",
  ITEM_SUM_INSURED_REQUIRED: "requiredField",
  ITEM_RATE_REQUIRED: "requiredField",
  ITEM_PREMIUM_REQUIRED: "requiredField",
  CREATE_FAILED: "genericError",
  UPDATE_FAILED: "genericError",
  FORBIDDEN: "genericError",
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function computeItemPremium(item: ItemDraft): number {
  if (item.calculationMethod === "PERCENTAGE") {
    return round2(((Number(item.sumInsured) || 0) * (Number(item.rate) || 0)) / 100);
  }
  return Number(item.premium) || 0;
}

function computeSectionTotals(section: SectionDraft) {
  const basePremium = round2(section.items.reduce((acc, item) => acc + computeItemPremium(item), 0));
  const phcfAmount = section.applyPHCF ? round2((basePremium * (Number(section.phcfRate) || 0)) / 100) : 0;
  const itlAmount = section.applyITL ? round2((basePremium * (Number(section.itlRate) || 0)) / 100) : 0;
  const stampDutyAmount = section.applyStampDuty ? round2(Number(section.stampDuty) || 0) : 0;
  const sectionTotal = round2(basePremium + phcfAmount + itlAmount + stampDutyAmount);
  return { basePremium, phcfAmount, itlAmount, stampDutyAmount, sectionTotal };
}

function emptyItem(): ItemDraft {
  return {
    key: crypto.randomUUID(),
    insuredContent: "",
    sumInsured: "",
    rate: "",
    calculationMethod: "PERCENTAGE",
    premium: "",
    notes: "",
  };
}

function sectionFromInsuranceType(insuranceType: InsuranceTypeOption): SectionDraft {
  return {
    key: crypto.randomUUID(),
    insuranceTypeId: insuranceType.id,
    insuranceTypeNameSnapshot: insuranceType.name,
    description: "",
    phcfRate: insuranceType.defaultPHCFRate,
    itlRate: insuranceType.defaultITLRate,
    stampDuty: insuranceType.defaultStampDuty,
    applyPHCF: insuranceType.applyPHCF,
    applyITL: insuranceType.applyITL,
    applyStampDuty: insuranceType.applyStampDuty,
    clausesSnapshot: insuranceType.defaultClauses ?? "",
    exclusionsSnapshot: insuranceType.defaultExclusions ?? "",
    conditionsSnapshot: insuranceType.defaultConditions ?? "",
    items: [],
  };
}

export function QuotationForm({
  customers,
  insuranceTypes,
  quotation,
}: {
  customers: CustomerOption[];
  insuranceTypes: InsuranceTypeOption[];
  quotation: QuotationFormData | null;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const isEdit = !!quotation;

  const [customerId, setCustomerId] = useState(quotation?.customerId ?? "");
  const [projectId, setProjectId] = useState(quotation?.projectId ?? "");
  const [quotationDate, setQuotationDate] = useState(
    quotation?.quotationDate ?? new Date().toISOString().slice(0, 10)
  );
  const [validUntil, setValidUntil] = useState(quotation?.validUntil ?? "");
  const [currency, setCurrency] = useState(quotation?.currency ?? "KES");
  const [internalNotes, setInternalNotes] = useState(quotation?.internalNotes ?? "");
  const [sections, setSections] = useState<SectionDraft[]>(
    quotation?.sections.map((s) => ({ ...s, key: s.id, items: s.items.map((i) => ({ ...i, key: i.id })) })) ?? []
  );
  const [selectedInsuranceTypeId, setSelectedInsuranceTypeId] = useState(insuranceTypes[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<
    { type: "section"; key: string } | { type: "item"; sectionKey: string; itemKey: string } | null
  >(null);

  const calculationMethodLabel: Record<CalculationMethod, string> = {
    PERCENTAGE: t.quotations.percentage,
    FIXED_PREMIUM: t.quotations.fixedPremium,
    MANUAL_PREMIUM: t.quotations.manualPremium,
  };

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const availableProjects = selectedCustomer?.projects ?? [];

  const sectionTotalsByKey = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeSectionTotals>>();
    sections.forEach((s) => map.set(s.key, computeSectionTotals(s)));
    return map;
  }, [sections]);

  const quotationTotals = useMemo(() => {
    const totalsList = sections.map((s) => sectionTotalsByKey.get(s.key)!);
    const subtotalPremium = round2(totalsList.reduce((acc, t2) => acc + t2.basePremium, 0));
    const totalPHCF = round2(totalsList.reduce((acc, t2) => acc + t2.phcfAmount, 0));
    const totalITL = round2(totalsList.reduce((acc, t2) => acc + t2.itlAmount, 0));
    const totalStampDuty = round2(totalsList.reduce((acc, t2) => acc + t2.stampDutyAmount, 0));
    const grandTotal = round2(subtotalPremium + totalPHCF + totalITL + totalStampDuty);
    return { subtotalPremium, totalPHCF, totalITL, totalStampDuty, grandTotal };
  }, [sections, sectionTotalsByKey]);

  const handleCustomerChange = (newCustomerId: string) => {
    setCustomerId(newCustomerId);
    const newCustomer = customers.find((c) => c.id === newCustomerId);
    if (!newCustomer?.projects.some((p) => p.id === projectId)) {
      setProjectId("");
    }
  };

  const handleAddSection = () => {
    const insuranceType = insuranceTypes.find((it) => it.id === selectedInsuranceTypeId);
    if (!insuranceType) return;
    setSections((prev) => [...prev, sectionFromInsuranceType(insuranceType)]);
  };

  const updateSection = (key: string, patch: Partial<SectionDraft>) => {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  };

  const updateItem = (sectionKey: string, itemKey: string, patch: Partial<ItemDraft>) => {
    setSections((prev) =>
      prev.map((s) =>
        s.key !== sectionKey
          ? s
          : { ...s, items: s.items.map((i) => (i.key === itemKey ? { ...i, ...patch } : i)) }
      )
    );
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    setSections((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!customerId) {
      setError(t.quotations.customerRequired);
      return;
    }
    if (sections.length === 0) {
      setError(t.quotations.atLeastOneSection);
      return;
    }
    if (sections.some((s) => s.items.length === 0)) {
      setError(t.quotations.atLeastOneItem);
      return;
    }

    const payload = {
      customerId,
      projectId: projectId || null,
      quotationDate,
      validUntil: validUntil || null,
      currency,
      internalNotes,
      sections: sections.map((s) => ({
        insuranceTypeId: s.insuranceTypeId,
        description: s.description,
        phcfRate: s.phcfRate,
        itlRate: s.itlRate,
        stampDuty: s.stampDuty,
        applyPHCF: s.applyPHCF,
        applyITL: s.applyITL,
        applyStampDuty: s.applyStampDuty,
        clausesSnapshot: s.clausesSnapshot,
        exclusionsSnapshot: s.exclusionsSnapshot,
        conditionsSnapshot: s.conditionsSnapshot,
        items: s.items.map((i) => ({
          insuredContent: i.insuredContent,
          sumInsured: i.sumInsured || null,
          rate: i.rate || null,
          calculationMethod: i.calculationMethod,
          premium: i.premium || null,
          notes: i.notes,
        })),
      })),
    };

    setIsSubmitting(true);

    if (isEdit) {
      const result = await updateQuotationAction(quotation.id, payload);
      setIsSubmitting(false);
      if (!result.success) {
        const key = ERROR_KEY[result.error] ?? "genericError";
        setError(t.quotations[key as keyof typeof t.quotations]);
        return;
      }
      router.push(`/quotation/${quotation.id}`);
      return;
    }

    const result = await createQuotationAction(payload);
    setIsSubmitting(false);
    if (!result.success) {
      const key = ERROR_KEY[result.error] ?? "genericError";
      setError(t.quotations[key as keyof typeof t.quotations]);
      return;
    }
    router.push(`/quotation/${result.id}`);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "section") {
      setSections((prev) => prev.filter((s) => s.key !== deleteTarget.key));
    } else {
      setSections((prev) =>
        prev.map((s) =>
          s.key !== deleteTarget.sectionKey
            ? s
            : { ...s, items: s.items.filter((i) => i.key !== deleteTarget.itemKey) }
        )
      );
    }
    setDeleteTarget(null);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-section">
      <PageHeader
        title={isEdit ? t.quotations.editQuotationTitle : t.quotations.createQuotationTitle}
        description={isEdit ? quotation.quotationNumber : undefined}
      />

      <Card>
        <h2 className="section-title mb-4">{t.quotations.quotationInformation}</h2>
        <div className="form-grid">
          <FormField label={t.quotations.customer}>
            <Select value={customerId} onChange={(e) => handleCustomerChange(e.target.value)} required>
              <option value="">{t.quotations.selectCustomer}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName} ({c.customerNumber})
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t.quotations.project}>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!customerId}>
              <option value="">{t.quotations.noProject}</option>
              {availableProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.projectName}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t.quotations.quotationDate}>
            <Input type="date" value={quotationDate} onChange={(e) => setQuotationDate(e.target.value)} required />
          </FormField>
          <FormField label={t.quotations.validUntil}>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </FormField>
          <FormField label={t.quotations.currency}>
            <Input value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </FormField>
        </div>
        <div className="mt-field">
          <FormField label={t.quotations.internalNotes}>
            <Textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} />
          </FormField>
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="section-title">{t.quotations.insuranceSections}</h2>
          <div className="flex items-center gap-2">
            <Select
              value={selectedInsuranceTypeId}
              onChange={(e) => setSelectedInsuranceTypeId(e.target.value)}
              className="w-auto min-w-[200px]"
            >
              {insuranceTypes.length === 0 && <option value="">—</option>}
              {insuranceTypes.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </Select>
            <Button type="button" variant="secondary" onClick={handleAddSection} disabled={!selectedInsuranceTypeId}>
              <Plus size={16} />
              {t.quotations.addInsuranceType}
            </Button>
          </div>
        </div>

        {sections.length === 0 && <p className="text-secondary">{t.quotations.noSectionsYet}</p>}

        <div className="flex flex-col gap-4">
          {sections.map((section, sectionIndex) => {
            const totals = sectionTotalsByKey.get(section.key)!;
            return (
              <div key={section.key} className="rounded-control border border-zinc-200 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="table-title">{section.insuranceTypeNameSnapshot}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="btn-icon"
                      disabled={sectionIndex === 0}
                      onClick={() => moveSection(sectionIndex, -1)}
                      title={t.quotations.moveUp}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      disabled={sectionIndex === sections.length - 1}
                      onClick={() => moveSection(sectionIndex, 1)}
                      title={t.quotations.moveDown}
                    >
                      <ArrowDown size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon text-red-500 hover:bg-red-50"
                      onClick={() => setDeleteTarget({ type: "section", key: section.key })}
                      title={t.quotations.deleteSection}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <FormField label={t.quotations.description}>
                  <Input
                    value={section.description}
                    onChange={(e) => updateSection(section.key, { description: e.target.value })}
                  />
                </FormField>

                <div className="form-grid mt-field">
                  <FormField label={t.quotations.phcfRate}>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={section.phcfRate}
                        onChange={(e) => updateSection(section.key, { phcfRate: e.target.value })}
                        disabled={!section.applyPHCF}
                      />
                      <label className="flex items-center gap-1 whitespace-nowrap text-sm text-zinc-600">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600"
                          checked={section.applyPHCF}
                          onChange={(e) => updateSection(section.key, { applyPHCF: e.target.checked })}
                        />
                        {t.quotations.applyPHCF}
                      </label>
                    </div>
                  </FormField>
                  <FormField label={t.quotations.itlRate}>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={section.itlRate}
                        onChange={(e) => updateSection(section.key, { itlRate: e.target.value })}
                        disabled={!section.applyITL}
                      />
                      <label className="flex items-center gap-1 whitespace-nowrap text-sm text-zinc-600">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600"
                          checked={section.applyITL}
                          onChange={(e) => updateSection(section.key, { applyITL: e.target.checked })}
                        />
                        {t.quotations.applyITL}
                      </label>
                    </div>
                  </FormField>
                  <FormField label={t.quotations.stampDuty}>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={section.stampDuty}
                        onChange={(e) => updateSection(section.key, { stampDuty: e.target.value })}
                        disabled={!section.applyStampDuty}
                      />
                      <label className="flex items-center gap-1 whitespace-nowrap text-sm text-zinc-600">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600"
                          checked={section.applyStampDuty}
                          onChange={(e) => updateSection(section.key, { applyStampDuty: e.target.checked })}
                        />
                        {t.quotations.applyStampDuty}
                      </label>
                    </div>
                  </FormField>
                </div>

                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="table-title">{t.quotations.coverageItems}</span>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        updateSection(section.key, { items: [...section.items, emptyItem()] })
                      }
                    >
                      <Plus size={16} />
                      {t.quotations.addCoverageItem}
                    </Button>
                  </div>

                  {section.items.length === 0 && (
                    <p className="text-secondary">{t.quotations.noItemsYet}</p>
                  )}

                  <div className="flex flex-col gap-3">
                    {section.items.map((item) => (
                      <div key={item.key} className="rounded-control border border-zinc-100 bg-zinc-50/60 p-3">
                        <div className="form-grid">
                          <FormField label={t.quotations.insuredContent}>
                            <Input
                              value={item.insuredContent}
                              onChange={(e) =>
                                updateItem(section.key, item.key, { insuredContent: e.target.value })
                              }
                              required
                            />
                          </FormField>
                          <FormField label={t.quotations.calculationMethod}>
                            <Select
                              value={item.calculationMethod}
                              onChange={(e) =>
                                updateItem(section.key, item.key, {
                                  calculationMethod: e.target.value as CalculationMethod,
                                })
                              }
                            >
                              {(["PERCENTAGE", "FIXED_PREMIUM", "MANUAL_PREMIUM"] as CalculationMethod[]).map(
                                (m) => (
                                  <option key={m} value={m}>
                                    {calculationMethodLabel[m]}
                                  </option>
                                )
                              )}
                            </Select>
                          </FormField>
                          <FormField label={t.quotations.sumInsured}>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={item.sumInsured}
                              onChange={(e) => updateItem(section.key, item.key, { sumInsured: e.target.value })}
                              disabled={item.calculationMethod === "FIXED_PREMIUM"}
                            />
                          </FormField>
                          <FormField label={t.quotations.rate}>
                            <Input
                              type="number"
                              step="0.0001"
                              min="0"
                              value={item.rate}
                              onChange={(e) => updateItem(section.key, item.key, { rate: e.target.value })}
                              disabled={item.calculationMethod === "FIXED_PREMIUM"}
                            />
                          </FormField>
                          <FormField label={t.quotations.premium}>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={
                                item.calculationMethod === "PERCENTAGE"
                                  ? computeItemPremium(item).toFixed(2)
                                  : item.premium
                              }
                              onChange={(e) => updateItem(section.key, item.key, { premium: e.target.value })}
                              disabled={item.calculationMethod === "PERCENTAGE"}
                            />
                          </FormField>
                          <FormField label={t.quotations.notes}>
                            <Input
                              value={item.notes}
                              onChange={(e) => updateItem(section.key, item.key, { notes: e.target.value })}
                            />
                          </FormField>
                        </div>
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            className="btn-icon text-red-500 hover:bg-red-50"
                            onClick={() =>
                              setDeleteTarget({ type: "item", sectionKey: section.key, itemKey: item.key })
                            }
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4">
                  <FormField label={t.quotations.clauses}>
                    <Textarea
                      value={section.clausesSnapshot}
                      onChange={(e) => updateSection(section.key, { clausesSnapshot: e.target.value })}
                    />
                  </FormField>
                </div>
                <div className="mt-field">
                  <FormField label={t.quotations.exclusions}>
                    <Textarea
                      value={section.exclusionsSnapshot}
                      onChange={(e) => updateSection(section.key, { exclusionsSnapshot: e.target.value })}
                    />
                  </FormField>
                </div>
                <div className="mt-field">
                  <FormField label={t.quotations.conditions}>
                    <Textarea
                      value={section.conditionsSnapshot}
                      onChange={(e) => updateSection(section.key, { conditionsSnapshot: e.target.value })}
                    />
                  </FormField>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 rounded-control bg-zinc-50 p-3 text-sm sm:grid-cols-4">
                  <div>
                    <div className="text-secondary">{t.quotations.premium}</div>
                    <div className="font-medium text-zinc-800">{totals.basePremium.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-secondary">{t.quotations.phcf}</div>
                    <div className="font-medium text-zinc-800">{totals.phcfAmount.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-secondary">{t.quotations.itl}</div>
                    <div className="font-medium text-zinc-800">{totals.itlAmount.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-secondary">{t.quotations.sectionTotal}</div>
                    <div className="font-semibold text-emerald-800">{totals.sectionTotal.toFixed(2)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <h2 className="section-title mb-4">{t.quotations.financialSummary}</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <div>
            <div className="text-secondary">{t.quotations.subtotalPremium}</div>
            <div className="text-body font-medium">{quotationTotals.subtotalPremium.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-secondary">{t.quotations.totalPHCF}</div>
            <div className="text-body font-medium">{quotationTotals.totalPHCF.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-secondary">{t.quotations.totalITL}</div>
            <div className="text-body font-medium">{quotationTotals.totalITL.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-secondary">{t.quotations.totalStampDuty}</div>
            <div className="text-body font-medium">{quotationTotals.totalStampDuty.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-secondary">{t.quotations.grandTotal}</div>
            <div className="text-lg font-semibold text-emerald-800">
              {currency} {quotationTotals.grandTotal.toFixed(2)}
            </div>
          </div>
        </div>
      </Card>

      {sections.length > 0 && (
        <Card>
          <h2 className="section-title mb-4">{t.quotations.termsAndConditions}</h2>
          <div className="flex flex-col gap-4">
            {sections.map((section) => (
              <div key={section.key}>
                <p className="table-title mb-1">{section.insuranceTypeNameSnapshot}</p>
                <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div>
                    <dt className="text-secondary">{t.quotations.clauses}</dt>
                    <dd className="text-body whitespace-pre-wrap">{section.clausesSnapshot || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-secondary">{t.quotations.exclusions}</dt>
                    <dd className="text-body whitespace-pre-wrap">{section.exclusionsSnapshot || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-secondary">{t.quotations.conditions}</dt>
                    <dd className="text-body whitespace-pre-wrap">{section.conditionsSnapshot || "—"}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </Card>
      )}

      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.push(isEdit ? `/quotation/${quotation.id}` : "/quotation")}
          disabled={isSubmitting}
        >
          {t.common.cancel}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {t.common.save}
        </Button>
      </div>

      {deleteTarget?.type === "section" && (
        <ConfirmDialog
          title={t.quotations.confirmDeleteSection}
          message={t.quotations.confirmDeleteSectionMessage}
          isSubmitting={false}
          onConfirm={confirmDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
      {deleteTarget?.type === "item" && (
        <ConfirmDialog
          title={t.quotations.confirmDeleteItem}
          message={t.quotations.confirmDeleteItemMessage}
          isSubmitting={false}
          onConfirm={confirmDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </form>
  );
}
