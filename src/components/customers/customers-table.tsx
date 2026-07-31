"use client";

import { useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, Pencil, FolderPlus, Upload, Trash2, Plus, Ban, CheckCircle2 } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Select } from "@/components/ui/select";
import { SearchBar } from "@/components/ui/search-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import { TableWrap, Table, TableEmpty } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EditCustomerModal } from "@/components/customers/edit-customer-modal";
import { ProjectFormModal } from "@/components/customers/project-form-modal";
import { UploadDocumentModal } from "@/components/customers/upload-document-modal";
import { deleteCustomerAction, toggleCustomerStatusAction } from "@/app/(app)/customer/actions";
import { useUrlListState } from "@/lib/navigation/useUrlListState";
import { buildReturnTo } from "@/lib/navigation/returnTo";
import type { CustomerListRow } from "@/components/customers/types";

const CUSTOMER_LIST_DEFAULTS = { search: "", status: "ALL" };

type ModalState =
  | { type: "edit"; customer: CustomerListRow }
  | { type: "add-project"; customer: CustomerListRow }
  | { type: "upload"; customer: CustomerListRow }
  | { type: "delete"; customer: CustomerListRow }
  | null;

export function CustomersTable({ customers }: { customers: CustomerListRow[] }) {
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [listState, setListState] = useUrlListState(CUSTOMER_LIST_DEFAULTS);
  const { search, status: statusFilter } = listState;
  const [modal, setModal] = useState<ModalState>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Captures this list's current filters/search so detail/create pages can
  // offer a safe way back that restores them (Phase 8 Part 3).
  const returnTo = buildReturnTo(pathname, searchParams.toString());

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return customers.filter((c) => {
      const matchesTerm =
        !term ||
        c.companyName.toLowerCase().includes(term) ||
        c.pinNumber.toLowerCase().includes(term) ||
        c.customerNumber.toLowerCase().includes(term);
      const matchesStatus = statusFilter === "ALL" || c.status === statusFilter;
      return matchesTerm && matchesStatus;
    });
  }, [customers, search, statusFilter]);

  const handleSuccess = (successMessage: string) => {
    setModal(null);
    setMessage(successMessage);
    router.refresh();
  };

  const handleToggleStatus = async (customer: CustomerListRow) => {
    setIsSubmitting(true);
    const result = await toggleCustomerStatusAction(
      customer.id,
      customer.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"
    );
    setIsSubmitting(false);
    if (result.success) {
      setMessage(t.customers.statusChangeSuccess);
      router.refresh();
    }
  };

  const handleDelete = async () => {
    if (modal?.type !== "delete") return;
    setIsSubmitting(true);
    const result = await deleteCustomerAction(modal.customer.id);
    setIsSubmitting(false);
    if (result.success) {
      handleSuccess(result.deactivatedInstead ? t.customers.deactivatedInstead : t.customers.deleteSuccess);
    }
  };

  return (
    <div className="flex flex-col gap-section">
      <PageHeader
        title={t.customers.title}
        actions={
          <Link href={`/customer/new?returnTo=${encodeURIComponent(returnTo)}`}>
            <Button>
              <Plus size={16} />
              {t.customers.addCustomer}
            </Button>
          </Link>
        }
      />

      {message && (
        <div className="flex items-center justify-between rounded-control border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {message}
          <button type="button" onClick={() => setMessage(null)}>
            ×
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={(value) => setListState({ search: value })}
          placeholder={t.customers.searchPlaceholder}
          className="w-full max-w-sm"
        />
        <Select
          value={statusFilter}
          onChange={(e) => setListState({ status: e.target.value }, { immediate: true })}
          className="w-auto max-w-[200px]"
        >
          <option value="ALL">{t.customers.allStatuses}</option>
          <option value="ACTIVE">{t.customers.active}</option>
          <option value="INACTIVE">{t.customers.inactive}</option>
        </Select>
      </div>

      <TableWrap scroll>
        <Table className="min-w-[980px]">
          <thead>
            <tr>
              <th>{t.customers.customerNumber}</th>
              <th>{t.customers.companyName}</th>
              <th>{t.customers.pinNumber}</th>
              <th>{t.customers.mainContactPerson}</th>
              <th>{t.customers.mainPhoneNumber}</th>
              <th>{t.customers.numberOfProjects}</th>
              <th>{t.customers.numberOfDocuments}</th>
              <th>{t.common.status}</th>
              <th className="text-right">{t.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <TableEmpty colSpan={9}>{t.customers.noCustomers}</TableEmpty>
            )}
            {filtered.map((customer) => (
              <tr key={customer.id}>
                <td className="font-medium text-zinc-800">{customer.customerNumber}</td>
                <td>
                  <Link href={`/customer/${customer.id}?returnTo=${encodeURIComponent(returnTo)}`} className="text-emerald-700 hover:underline">
                    {customer.companyName}
                  </Link>
                </td>
                <td>{customer.pinNumber}</td>
                <td>{customer.mainContactPerson || "—"}</td>
                <td className="text-zinc-500">{customer.mainPhoneNumber || "—"}</td>
                <td>{customer.projectCount}</td>
                <td>{customer.documentCount}</td>
                <td>
                  <StatusBadge
                    active={customer.status === "ACTIVE"}
                    activeLabel={t.customers.active}
                    inactiveLabel={t.customers.inactive}
                  />
                </td>
                <td>
                  <div className="flex items-center justify-end gap-1.5">
                    <Link href={`/customer/${customer.id}?returnTo=${encodeURIComponent(returnTo)}`}>
                      <IconButton title={t.customers.view}>
                        <Eye size={16} />
                      </IconButton>
                    </Link>
                    <IconButton title={t.common.edit} onClick={() => setModal({ type: "edit", customer })}>
                      <Pencil size={16} />
                    </IconButton>
                    <IconButton
                      title={t.customers.addProject}
                      onClick={() => setModal({ type: "add-project", customer })}
                    >
                      <FolderPlus size={16} />
                    </IconButton>
                    <IconButton
                      title={t.customers.uploadDocument}
                      onClick={() => setModal({ type: "upload", customer })}
                    >
                      <Upload size={16} />
                    </IconButton>
                    <IconButton
                      title={customer.status === "ACTIVE" ? t.customers.deactivate : t.customers.activate}
                      disabled={isSubmitting}
                      onClick={() => handleToggleStatus(customer)}
                    >
                      {customer.status === "ACTIVE" ? <Ban size={16} /> : <CheckCircle2 size={16} />}
                    </IconButton>
                    <IconButton
                      tone="danger"
                      title={t.common.delete}
                      onClick={() => setModal({ type: "delete", customer })}
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

      {modal?.type === "edit" && (
        <EditCustomerModal
          customer={modal.customer}
          onClose={() => setModal(null)}
          onSuccess={handleSuccess}
        />
      )}

      {modal?.type === "add-project" && (
        <ProjectFormModal
          customerId={modal.customer.id}
          project={null}
          onClose={() => setModal(null)}
          onSuccess={handleSuccess}
        />
      )}

      {modal?.type === "upload" && (
        <UploadDocumentModal
          customerId={modal.customer.id}
          projects={modal.customer.projects}
          onClose={() => setModal(null)}
          onSuccess={handleSuccess}
        />
      )}

      {modal?.type === "delete" && (
        <ConfirmDialog
          title={t.customers.confirmDeleteCustomer}
          message={t.customers.confirmDeleteCustomerMessage}
          isSubmitting={isSubmitting}
          onConfirm={handleDelete}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
