import { prisma } from "@/lib/prisma";
import type { PolicyCategory } from "@/generated/prisma/enums";

// Self-contained per this project's existing convention (see e.g.
// quotation-detail.tsx's own POLICY_CATEGORY_ROUTE) — used to build "Open
// Source" links from a normalized System Record back to its origin Policy.
export const POLICY_CATEGORY_ROUTE: Record<PolicyCategory, string> = {
  MOTOR: "/policy/motor",
  NON_MOTOR: "/policy/non-motor",
  BOND: "/policy/bond",
  WORK_PERMIT: "/policy/work-permit",
};

export type SystemLedgerSourceType = "CUSTOMER_PREMIUM_RECEIPT" | "PROVIDER_PAYMENT" | "COMMISSION_INCOME";
export type LedgerDirection = "INCOME" | "EXPENSE";

// A read-only normalized projection over the existing financial
// source-of-truth records — deliberately NOT a persisted table (see
// LedgerManualEntry's schema comment for why). Every field here is derived
// live from PolicyCustomerReceipt / PolicyProviderPayment /
// PolicyRecord.commission* at read time; nothing here is ever written back.
export type SystemLedgerRecord = {
  // Stable composite identity per this phase's spec — e.g.
  // "CUSTOMER_PREMIUM_RECEIPT:<receiptId>" — never a join-derived id that
  // could collide or duplicate.
  id: string;
  sourceType: SystemLedgerSourceType;
  sourceId: string;
  transactionDate: string;
  direction: LedgerDirection;
  customerId: string;
  customerName: string;
  policyRecordId: string;
  policyRecordNumber: string;
  policyCategory: PolicyCategory;
  // Null when genuinely unavailable (e.g. Motor/Non-Motor/Bond with no
  // insurer recorded, or Work Permit — which has no insurer concept at all,
  // see WorkPermitPolicyDetail's schema comment) — never guessed.
  counterparty: string | null;
  description: string | null;
  paymentMethod: string | null;
  referenceNumber: string | null;
  amount: string;
  sourceRoute: string;
  createdByName: string;
  createdAt: string;
};

const USER_SELECT = { id: true, fullName: true, username: true } as const;

// Fetches and normalizes every qualifying source transaction across all
// four Policy categories in one pass — mirrors this app's existing
// "fetch everything server-side, filter/paginate client-side" list-page
// convention (see e.g. MotorListTable), so System Records behaves exactly
// like every other list in this app rather than inventing a new pattern.
export async function getSystemLedgerRecords(): Promise<SystemLedgerRecord[]> {
  const [receipts, payments, commissionRecords] = await Promise.all([
    prisma.policyCustomerReceipt.findMany({
      where: { deletedAt: null },
      include: {
        policyRecord: {
          select: {
            recordNumber: true,
            category: true,
            customerId: true,
            customer: { select: { companyName: true } },
          },
        },
      },
      orderBy: { receiptDate: "desc" },
    }),
    prisma.policyProviderPayment.findMany({
      where: { deletedAt: null },
      include: {
        policyRecord: {
          select: {
            recordNumber: true,
            category: true,
            customerId: true,
            insurerName: true,
            customer: { select: { companyName: true } },
            workPermitDetail: { select: { agent: true } },
          },
        },
      },
      orderBy: { paymentDate: "desc" },
    }),
    // "commissionReceived = true" alone is not enough — see this phase's
    // spec ("Do not include ... Commission marked received without a valid
    // amount/date"). All three conditions are required together.
    prisma.policyRecord.findMany({
      where: {
        deletedAt: null,
        commissionReceived: true,
        commissionAmount: { not: null },
        commissionReceivedDate: { not: null },
      },
      select: {
        id: true,
        recordNumber: true,
        category: true,
        customerId: true,
        insurerName: true,
        commissionAmount: true,
        commissionReceivedDate: true,
        createdById: true,
        updatedById: true,
        customer: { select: { companyName: true } },
      },
      orderBy: { commissionReceivedDate: "desc" },
    }),
  ]);

  const userIds = new Set<string>();
  for (const r of receipts) userIds.add(r.createdById);
  for (const p of payments) userIds.add(p.createdById);
  for (const c of commissionRecords) userIds.add(c.updatedById ?? c.createdById);

  const users = userIds.size
    ? await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: USER_SELECT })
    : [];
  const userNameById = new Map(users.map((u) => [u.id, u.fullName || u.username]));

  const receiptRows: SystemLedgerRecord[] = receipts.map((r) => ({
    id: `CUSTOMER_PREMIUM_RECEIPT:${r.id}`,
    sourceType: "CUSTOMER_PREMIUM_RECEIPT",
    sourceId: r.id,
    transactionDate: r.receiptDate.toISOString(),
    direction: "INCOME",
    customerId: r.policyRecord.customerId,
    customerName: r.policyRecord.customer.companyName,
    policyRecordId: r.policyRecordId,
    policyRecordNumber: r.policyRecord.recordNumber,
    policyCategory: r.policyRecord.category,
    counterparty: r.policyRecord.customer.companyName,
    description: r.notes,
    paymentMethod: r.paymentMethod,
    referenceNumber: r.referenceNumber,
    amount: r.amount.toString(),
    sourceRoute: `${POLICY_CATEGORY_ROUTE[r.policyRecord.category]}/${r.policyRecordId}?tab=financial`,
    createdByName: userNameById.get(r.createdById) ?? "—",
    createdAt: r.createdAt.toISOString(),
  }));

  const paymentRows: SystemLedgerRecord[] = payments.map((p) => ({
    id: `PROVIDER_PAYMENT:${p.id}`,
    sourceType: "PROVIDER_PAYMENT",
    sourceId: p.id,
    transactionDate: p.paymentDate.toISOString(),
    direction: "EXPENSE",
    customerId: p.policyRecord.customerId,
    customerName: p.policyRecord.customer.companyName,
    policyRecordId: p.policyRecordId,
    policyRecordNumber: p.policyRecord.recordNumber,
    policyCategory: p.policyRecord.category,
    counterparty:
      p.policyRecord.category === "WORK_PERMIT" ? p.policyRecord.workPermitDetail?.agent ?? null : p.policyRecord.insurerName,
    description: p.notes,
    paymentMethod: p.paymentMethod,
    referenceNumber: p.referenceNumber,
    amount: p.amount.toString(),
    sourceRoute: `${POLICY_CATEGORY_ROUTE[p.policyRecord.category]}/${p.policyRecordId}?tab=financial`,
    createdByName: userNameById.get(p.createdById) ?? "—",
    createdAt: p.createdAt.toISOString(),
  }));

  const commissionRows: SystemLedgerRecord[] = commissionRecords.map((c) => ({
    id: `COMMISSION_INCOME:${c.id}`,
    sourceType: "COMMISSION_INCOME",
    sourceId: c.id,
    transactionDate: c.commissionReceivedDate!.toISOString(),
    direction: "INCOME",
    customerId: c.customerId,
    customerName: c.customer.companyName,
    policyRecordId: c.id,
    policyRecordNumber: c.recordNumber,
    policyCategory: c.category,
    counterparty: c.insurerName,
    description: null,
    paymentMethod: null,
    referenceNumber: null,
    amount: c.commissionAmount!.toString(),
    sourceRoute: `${POLICY_CATEGORY_ROUTE[c.category]}/${c.id}?tab=financial`,
    // Commission has no dedicated transaction row of its own to attribute —
    // best-effort attribution to whoever last touched the PolicyRecord
    // (updateCommissionAction always sets updatedById — see that action),
    // falling back to the record's original creator.
    createdByName: userNameById.get(c.updatedById ?? c.createdById) ?? "—",
    createdAt: c.commissionReceivedDate!.toISOString(),
  }));

  return [...receiptRows, ...paymentRows, ...commissionRows].sort((a, b) => (a.transactionDate < b.transactionDate ? 1 : -1));
}
