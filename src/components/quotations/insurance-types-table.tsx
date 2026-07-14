"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil, Trash2, Plus, Ban, CheckCircle2 } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { TableWrap, Table, TableEmpty } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InsuranceTypeFormModal } from "@/components/quotations/insurance-type-form-modal";
import {
  deleteInsuranceTypeAction,
  toggleInsuranceTypeActiveAction,
} from "@/app/(app)/quotation/insurance-type-actions";
import type { InsuranceTypeRow } from "@/components/quotations/types";

type ModalState =
  | { type: "create" }
  | { type: "edit"; insuranceType: InsuranceTypeRow }
  | { type: "delete"; insuranceType: InsuranceTypeRow }
  | null;

export function InsuranceTypesTable({ insuranceTypes }: { insuranceTypes: InsuranceTypeRow[] }) {
  const { t } = useLocale();
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSuccess = (successMessage: string) => {
    setModal(null);
    setMessage(successMessage);
    router.refresh();
  };

  const handleToggleActive = async (row: InsuranceTypeRow) => {
    setIsSubmitting(true);
    const result = await toggleInsuranceTypeActiveAction(row.id, !row.active);
    setIsSubmitting(false);
    if (result.success) {
      setMessage(t.quotations.statusChangeSuccess);
      router.refresh();
    }
  };

  const handleDelete = async () => {
    if (modal?.type !== "delete") return;
    setIsSubmitting(true);
    const result = await deleteInsuranceTypeAction(modal.insuranceType.id);
    setIsSubmitting(false);
    if (result.success) {
      handleSuccess(result.deactivatedInstead ? t.quotations.deactivatedInstead : t.quotations.deleteSuccess);
    }
  };

  return (
    <div className="flex flex-col gap-section">
      <div>
        <Link
          href="/quotation"
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:underline"
        >
          <ArrowLeft size={14} />
          {t.quotations.backToList}
        </Link>
        <PageHeader
          title={t.quotations.insuranceTypesTitle}
          actions={
            <Button onClick={() => setModal({ type: "create" })}>
              <Plus size={16} />
              {t.quotations.addInsuranceType}
            </Button>
          }
        />
      </div>

      {message && (
        <div className="flex items-center justify-between rounded-control border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {message}
          <button type="button" onClick={() => setMessage(null)}>
            ×
          </button>
        </div>
      )}

      <TableWrap scroll>
        <Table className="min-w-[900px]">
          <thead>
            <tr>
              <th>{t.quotations.insuranceType}</th>
              <th>{t.quotations.code}</th>
              <th>{t.quotations.defaultPHCFRate}</th>
              <th>{t.quotations.defaultITLRate}</th>
              <th>{t.quotations.defaultStampDuty}</th>
              <th>{t.common.status}</th>
              <th className="text-right">{t.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {insuranceTypes.length === 0 && (
              <TableEmpty colSpan={7}>{t.quotations.noQuotations}</TableEmpty>
            )}
            {insuranceTypes.map((row) => (
              <tr key={row.id}>
                <td className="font-medium text-zinc-800">{row.name}</td>
                <td className="text-zinc-500">{row.code}</td>
                <td className="text-zinc-500">{row.applyPHCF ? `${row.defaultPHCFRate}%` : "—"}</td>
                <td className="text-zinc-500">{row.applyITL ? `${row.defaultITLRate}%` : "—"}</td>
                <td className="text-zinc-500">{row.applyStampDuty ? row.defaultStampDuty : "—"}</td>
                <td>
                  <StatusBadge
                    active={row.active}
                    activeLabel={t.quotations.active}
                    inactiveLabel={t.quotations.inactive}
                  />
                </td>
                <td>
                  <div className="flex items-center justify-end gap-1.5">
                    <IconButton title={t.common.edit} onClick={() => setModal({ type: "edit", insuranceType: row })}>
                      <Pencil size={16} />
                    </IconButton>
                    <IconButton
                      title={row.active ? t.quotations.inactive : t.quotations.active}
                      disabled={isSubmitting}
                      onClick={() => handleToggleActive(row)}
                    >
                      {row.active ? <Ban size={16} /> : <CheckCircle2 size={16} />}
                    </IconButton>
                    <IconButton
                      tone="danger"
                      title={t.common.delete}
                      onClick={() => setModal({ type: "delete", insuranceType: row })}
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      {(modal?.type === "create" || modal?.type === "edit") && (
        <InsuranceTypeFormModal
          insuranceType={modal.type === "edit" ? modal.insuranceType : null}
          onClose={() => setModal(null)}
          onSuccess={handleSuccess}
        />
      )}

      {modal?.type === "delete" && (
        <ConfirmDialog
          title={t.quotations.confirmDeleteInsuranceType}
          message={t.quotations.confirmDeleteInsuranceTypeMessage}
          isSubmitting={isSubmitting}
          onConfirm={handleDelete}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
