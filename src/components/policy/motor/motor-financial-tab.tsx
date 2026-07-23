"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TableWrap, Table, TableEmpty } from "@/components/ui/table";
import { formatMoney } from "@/components/ui/money-input";
import { AddReceiptModal } from "@/components/policy/motor/add-receipt-modal";
import { AddPaymentModal } from "@/components/policy/motor/add-payment-modal";
import { HistoricalImportWarningCard } from "@/components/policy/motor/historical-import-warning-card";
import { EditCommissionModal } from "@/components/policy/motor/edit-commission-modal";
import type { MotorDetail, PolicyPaymentStatus } from "@/components/policy/types";

const PAYMENT_STATUS_TONE: Record<PolicyPaymentStatus, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  UNPAID: "danger",
  PARTIALLY_PAID: "warning",
  FULLY_PAID: "success",
  OVERPAID: "brand",
};

export function MotorFinancialTab({ detail }: { detail: MotorDetail }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" });

  const [showAddReceipt, setShowAddReceipt] = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [showEditCommission, setShowEditCommission] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const paymentStatusLabel: Record<PolicyPaymentStatus, string> = {
    UNPAID: t.policy.paymentUnpaid,
    PARTIALLY_PAID: t.policy.paymentPartiallyPaid,
    FULLY_PAID: t.policy.paymentFullyPaid,
    OVERPAID: t.policy.paymentOverpaid,
  };

  return (
    <div className="flex flex-col gap-4">
      <HistoricalImportWarningCard detail={detail} onResolved={() => router.refresh()} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="section-title mb-4">{t.policy.customerCardTitle}</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-secondary">{t.policy.clientPremium}</dt><dd className="font-medium text-zinc-800">{formatMoney(detail.customerPremium)}</dd></div>
            <div><dt className="text-secondary">{t.policy.totalReceived}</dt><dd className="font-medium text-zinc-800">{formatMoney(detail.totalReceived)}</dd></div>
            <div><dt className="text-secondary">{t.policy.clientBalance}</dt><dd className="font-medium text-zinc-800">{formatMoney(detail.clientBalance)}</dd></div>
            <div>
              <dt className="text-secondary">{t.policy.customerPaymentStatus}</dt>
              <dd><Badge tone={PAYMENT_STATUS_TONE[detail.customerPaymentStatus]}>{paymentStatusLabel[detail.customerPaymentStatus]}</Badge></dd>
            </div>
          </dl>
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" onClick={() => setShowAddReceipt(true)}>
              <Plus size={16} />
              {t.policy.addReceipt}
            </Button>
          </div>
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-medium text-zinc-700">{t.policy.receiptHistory}</h3>
            <TableWrap scroll>
              <Table>
                <thead>
                  <tr>
                    <th>{t.policy.receiptDate}</th>
                    <th>{t.policy.amount}</th>
                    <th>{t.policy.paymentMethod}</th>
                    <th>{t.policy.referenceNumber}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.customerReceipts.length === 0 && <TableEmpty colSpan={4}>{t.policy.noReceiptsYet}</TableEmpty>}
                  {detail.customerReceipts.map((r) => (
                    <tr key={r.id}>
                      <td className="text-zinc-500">{dateFormatter.format(new Date(r.date))}</td>
                      <td className="font-medium text-zinc-800">{formatMoney(r.amount)}</td>
                      <td className="text-zinc-500">{r.paymentMethod || "—"}</td>
                      <td className="text-zinc-500">{r.referenceNumber || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </div>
        </Card>

        <Card>
          <h2 className="section-title mb-4">{t.policy.insurerCardTitle}</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-secondary">{t.policy.insurerCost}</dt><dd className="font-medium text-zinc-800">{formatMoney(detail.insurerCost)}</dd></div>
            <div><dt className="text-secondary">{t.policy.totalPaid}</dt><dd className="font-medium text-zinc-800">{formatMoney(detail.totalPaid)}</dd></div>
            <div><dt className="text-secondary">{t.policy.insurerBalance}</dt><dd className="font-medium text-zinc-800">{formatMoney(detail.insurerBalance)}</dd></div>
            <div>
              <dt className="text-secondary">{t.policy.insurerPaymentStatus}</dt>
              <dd><Badge tone={PAYMENT_STATUS_TONE[detail.insurerPaymentStatus]}>{paymentStatusLabel[detail.insurerPaymentStatus]}</Badge></dd>
            </div>
          </dl>
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" onClick={() => setShowAddPayment(true)}>
              <Plus size={16} />
              {t.policy.addPayment}
            </Button>
          </div>
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-medium text-zinc-700">{t.policy.paymentHistory}</h3>
            <TableWrap scroll>
              <Table>
                <thead>
                  <tr>
                    <th>{t.policy.paymentDate}</th>
                    <th>{t.policy.amount}</th>
                    <th>{t.policy.paymentMethod}</th>
                    <th>{t.policy.referenceNumber}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.providerPayments.length === 0 && <TableEmpty colSpan={4}>{t.policy.noPaymentsYet}</TableEmpty>}
                  {detail.providerPayments.map((p) => (
                    <tr key={p.id}>
                      <td className="text-zinc-500">{dateFormatter.format(new Date(p.date))}</td>
                      <td className="font-medium text-zinc-800">{formatMoney(p.amount)}</td>
                      <td className="text-zinc-500">{p.paymentMethod || "—"}</td>
                      <td className="text-zinc-500">{p.referenceNumber || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </div>
        </Card>
      </div>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="section-title">{t.policy.commissionCardTitle}</h2>
          <Button variant="secondary" onClick={() => setShowEditCommission(true)}>
            {t.policy.editCommission}
          </Button>
        </div>
        {message && (
          <div className="mb-4 rounded-control border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>
        )}
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-secondary">{t.policy.commissionReceived}</dt>
            <dd className="font-medium text-zinc-800">{detail.commissionReceived ? t.common.yes : t.common.no}</dd>
          </div>
          <div>
            <dt className="text-secondary">{t.policy.commissionAmount}</dt>
            <dd className="font-medium text-zinc-800">
              {detail.commissionAmount !== null ? formatMoney(detail.commissionAmount) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-secondary">{t.policy.commissionReceivedDate}</dt>
            <dd className="font-medium text-zinc-800">
              {detail.commissionReceivedDate ? dateFormatter.format(new Date(detail.commissionReceivedDate)) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-secondary">{t.policy.systemCalculatedMargin}</dt>
            <dd className="font-medium text-zinc-800">{formatMoney(detail.systemCalculatedMargin)}</dd>
          </div>
          {detail.historicalNetProfit !== null && (
            <div>
              <dt className="text-secondary">{t.policy.historicalNetProfit}</dt>
              <dd className="font-medium text-zinc-800">{formatMoney(detail.historicalNetProfit)}</dd>
            </div>
          )}
        </dl>
      </Card>

      {showAddReceipt && (
        <AddReceiptModal
          policyRecordId={detail.id}
          onClose={() => setShowAddReceipt(false)}
          onSuccess={() => {
            setShowAddReceipt(false);
            router.refresh();
          }}
        />
      )}
      {showAddPayment && (
        <AddPaymentModal
          policyRecordId={detail.id}
          onClose={() => setShowAddPayment(false)}
          onSuccess={() => {
            setShowAddPayment(false);
            router.refresh();
          }}
        />
      )}
      {showEditCommission && (
        <EditCommissionModal
          detail={detail}
          onClose={() => setShowEditCommission(false)}
          onSuccess={() => {
            setShowEditCommission(false);
            setMessage(t.policy.commissionUpdateSuccess);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
