"use client";

// Dropbox Integration Phase 7, Part 2 — the "Linked Policy" selector shared
// by Motor/Non-Motor Claim create and edit modals. Deliberately defaults to
// "No Linked Policy" (empty value) regardless of how many candidates exist —
// never auto-selects, even when there's exactly one (Part 2: "never silently
// auto-select when multiple candidates exist").
import { useLocale } from "@/i18n/locale-provider";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import type { ClaimPolicyOption } from "@/components/claims/types";

function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" }).format(new Date(iso));
}

export function ClaimPolicyLinkField({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  options: ClaimPolicyOption[];
  disabled?: boolean;
}) {
  const { t, locale } = useLocale();

  return (
    <FormField label={t.claims.selectLinkedPolicy}>
      <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">{t.claims.noLinkedPolicy}</option>
        {options.map((p) => {
          const descriptor = [p.numberPlate, p.insuranceTypeLabel].filter(Boolean).join(" · ");
          return (
            <option key={p.id} value={p.id}>
              {p.recordNumber}
              {descriptor ? ` — ${descriptor}` : ""}
              {p.insurerName ? ` · ${p.insurerName}` : ""} · {formatDate(p.effectiveDate, locale)}–{formatDate(p.expiryDate, locale)} · {p.businessStatus}
            </option>
          );
        })}
      </Select>
      <p className="mt-1 text-xs text-secondary">{t.claims.linkedPolicyHelp}</p>
    </FormField>
  );
}
