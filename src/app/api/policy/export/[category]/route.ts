import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { getLocale } from "@/i18n/get-locale";
import { dictionaries } from "@/i18n/config";
import { buildMotorListFilterWhere } from "@/lib/policy/motorListFilters";
import { isComprehensiveMotorCover } from "@/lib/policy/motorValuation";
import {
  toMotorListRow,
  toNonMotorListRow,
  toBondListRow,
  toWorkPermitListRow,
  matchesMotorListFilters,
  matchesNonMotorListFilters,
  matchesBondListFilters,
  matchesWorkPermitListFilters,
  type PolicyListClientFilterState,
} from "@/lib/policy/policyListView";
import {
  policyBusinessStatusLabel,
  motorValuationBadgeLabel,
  nonMotorCoverTypeLabel,
  bondTypeLabel,
  workPermitTypeLabel,
  policyRenewalPeriodLabel,
} from "@/lib/policy/policyDisplayLabels";
import { buildExportWorkbookBuffer, buildExportFilename, xlsxResponse, type ExportColumn } from "@/lib/excel/exportSheet";
import { POLICY_CATEGORY_PERMISSION } from "@/lib/permissions";
import type { PolicyCategory } from "@/generated/prisma/enums";

// Phase 13A — authenticated, server-side Excel export of a Policy list. The
// exported records EXACTLY respect the current filter state (the same helpers
// the list page/table use — buildMotorListFilterWhere + the shared client
// predicates in policyListView.ts), queried without pagination, so the file
// contains every matching record, never just the visible page.
//
// Financial columns (client premium, insurer cost, any balance / receipt /
// payment / commission) are DELIBERATELY excluded — the outstanding-balance
// filter may still narrow the rows, but the amounts never appear. The file is
// a clean operational schedule safe to share with a customer's contact.

type CategorySlug = "motor" | "non-motor" | "bond" | "work-permit";

const CATEGORY: Record<CategorySlug, { db: PolicyCategory }> = {
  motor: { db: "MOTOR" },
  "non-motor": { db: "NON_MOTOR" },
  bond: { db: "BOND" },
  "work-permit": { db: "WORK_PERMIT" },
};

function readClientFilters(params: URLSearchParams): PolicyListClientFilterState {
  return {
    search: params.get("search") ?? "",
    customer: params.get("customer") ?? "ALL",
    type: params.get("type") ?? "ALL",
    insurer: params.get("insurer") ?? "ALL",
    status: params.get("status") ?? "ALL",
    expiryDate: params.get("expiryDate") ?? "",
    outstandingClientOnly: params.get("outstandingClientOnly") === "1",
    outstandingInsurerOnly: params.get("outstandingInsurerOnly") === "1",
  };
}

function anyFilterActive(params: URLSearchParams): boolean {
  const keys = [
    "search",
    "customer",
    "type",
    "insurer",
    "status",
    "expiryDate",
    "expiryFrom",
    "expiryTo",
    "contact",
    "valuationStatus",
    "customerId",
    "outstandingClientOnly",
    "outstandingInsurerOnly",
  ];
  return keys.some((k) => {
    const v = params.get(k);
    return v !== null && v !== "" && v !== "ALL";
  });
}

async function loadSums(db: PolicyCategory) {
  const [receiptSums, paymentSums] = await Promise.all([
    prisma.policyCustomerReceipt.groupBy({
      by: ["policyRecordId"],
      where: { deletedAt: null, policyRecord: { category: db } },
      _sum: { amount: true },
    }),
    prisma.policyProviderPayment.groupBy({
      by: ["policyRecordId"],
      where: { deletedAt: null, policyRecord: { category: db } },
      _sum: { amount: true },
    }),
  ]);
  const received = new Map(receiptSums.map((r) => [r.policyRecordId, r._sum.amount?.toNumber() ?? 0]));
  const paid = new Map(paymentSums.map((p) => [p.policyRecordId, p._sum.amount?.toNumber() ?? 0]));
  return (id: string) => ({ totalReceived: received.get(id) ?? 0, totalPaid: paid.get(id) ?? 0 });
}

const commonInclude = {
  customer: { select: { companyName: true } },
};

// Phase 13C — an open-ended Security Bond has no expiry date; its export cell
// is left blank (never "Invalid Date" / a 1970 date / "null").
function dateOnly(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const config = CATEGORY[category as CategorySlug];
  if (!config) return NextResponse.json({ error: "UNKNOWN_CATEGORY" }, { status: 404 });

  const session = await auth();
  if (!session?.user || !hasPermission(session.user, POLICY_CATEGORY_PERMISSION[config.db])) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const clientFilters = readClientFilters(sp);
  const customerId = sp.get("customerId") || undefined;
  const locale = await getLocale();
  const t = dictionaries[locale];
  const isFiltered = anyFilterActive(sp);
  const sumsFor = await loadSums(config.db);

  const baseWhere = {
    category: config.db,
    deletedAt: null,
    ...(customerId ? { customerId } : {}),
  };

  let columns: ExportColumn[];
  let rows: Array<Record<string, string>>;
  let sheetBase: string;

  if (category === "motor") {
    const records = await prisma.policyRecord.findMany({
      where: {
        ...baseWhere,
        ...buildMotorListFilterWhere({
          contact: sp.get("contact"),
          expiryFrom: sp.get("expiryFrom"),
          expiryTo: sp.get("expiryTo"),
          valuationStatus: sp.get("valuationStatus"),
        }),
      },
      include: {
        ...commonInclude,
        motorDetail: { select: { insuranceType: true, registrationNumber: true, valuationStatus: true } },
      },
      orderBy: { processingDate: "desc" },
    });
    const filtered = records
      .map((r) => toMotorListRow(r, sumsFor(r.id)))
      .filter((row) => matchesMotorListFilters(row, clientFilters));

    sheetBase = t.policy.tabMotor;
    columns = [
      { header: t.policy.recordNumber, key: "recordNumber", width: 16 },
      { header: t.policy.processingDate, key: "processingDate", width: 14 },
      { header: t.policy.customer, key: "customer", width: 32 },
      { header: t.policy.contactPerson, key: "contactPerson", width: 20 },
      { header: t.policy.typeOfCover, key: "typeOfCover", width: 18 },
      { header: t.policy.registrationNumber, key: "registrationNumber", width: 16 },
      { header: t.policy.insurer, key: "insurer", width: 22 },
      { header: t.policy.valuationColumn, key: "valuation", width: 16 },
      { header: t.policy.expiryDate, key: "expiryDate", width: 14 },
      { header: t.common.status, key: "status", width: 12 },
      { header: t.policy.renewalStatusColumn, key: "renewal", width: 14 },
    ];
    rows = filtered.map((row) => ({
      recordNumber: row.recordNumber,
      processingDate: dateOnly(row.processingDate),
      customer: row.customerName,
      contactPerson: row.contactPerson ?? "",
      typeOfCover: row.insuranceType,
      registrationNumber: row.registrationNumber,
      insurer: row.insurerName ?? "",
      valuation:
        row.valuationStatus && isComprehensiveMotorCover(row.insuranceType)
          ? motorValuationBadgeLabel(t, row.valuationStatus)
          : "",
      expiryDate: dateOnly(row.expiryDate),
      status: policyBusinessStatusLabel(t, row.businessStatus),
      renewal: policyRenewalPeriodLabel(t, row.renewalIndex, row.renewalDecision),
    }));
  } else if (category === "non-motor") {
    const records = await prisma.policyRecord.findMany({
      where: baseWhere,
      include: { ...commonInclude, nonMotorDetail: { select: { insuranceType: true } } },
      orderBy: { processingDate: "desc" },
    });
    const filtered = records
      .filter((r) => r.nonMotorDetail)
      .map((r) => toNonMotorListRow(r, sumsFor(r.id)))
      .filter((row) => matchesNonMotorListFilters(row, clientFilters));

    sheetBase = t.policy.tabNonMotor;
    columns = [
      { header: t.policy.recordNumber, key: "recordNumber", width: 16 },
      { header: t.policy.processingDate, key: "processingDate", width: 14 },
      { header: t.policy.customer, key: "customer", width: 32 },
      { header: t.policy.typeOfCover, key: "typeOfCover", width: 28 },
      { header: t.policy.insurer, key: "insurer", width: 22 },
      { header: t.policy.expiryDate, key: "expiryDate", width: 14 },
      { header: t.common.status, key: "status", width: 12 },
      { header: t.policy.renewalStatusColumn, key: "renewal", width: 14 },
    ];
    rows = filtered.map((row) => ({
      recordNumber: row.recordNumber,
      processingDate: dateOnly(row.processingDate),
      customer: row.customerName,
      typeOfCover: nonMotorCoverTypeLabel(t, row.insuranceType),
      insurer: row.insurerName ?? "",
      expiryDate: dateOnly(row.expiryDate),
      status: policyBusinessStatusLabel(t, row.businessStatus),
      renewal: policyRenewalPeriodLabel(t, row.renewalIndex, row.renewalDecision),
    }));
  } else if (category === "bond") {
    const records = await prisma.policyRecord.findMany({
      where: baseWhere,
      include: {
        ...commonInclude,
        bondDetail: { select: { bondType: true, customBondType: true, policyNumber: true } },
      },
      orderBy: { processingDate: "desc" },
    });
    const filtered = records
      .filter((r) => r.bondDetail)
      .map((r) => toBondListRow(r, sumsFor(r.id)))
      .filter((row) => matchesBondListFilters(row, clientFilters));

    sheetBase = t.policy.tabBond;
    columns = [
      { header: t.policy.recordNumber, key: "recordNumber", width: 16 },
      { header: t.policy.processingDate, key: "processingDate", width: 14 },
      { header: t.policy.customer, key: "customer", width: 32 },
      { header: t.policy.typeOfBond, key: "typeOfBond", width: 24 },
      { header: t.policy.insurer, key: "insurer", width: 22 },
      { header: t.policy.expiryDate, key: "expiryDate", width: 14 },
      { header: t.common.status, key: "status", width: 12 },
      { header: t.policy.renewalStatusColumn, key: "renewal", width: 14 },
    ];
    rows = filtered.map((row) => ({
      recordNumber: row.recordNumber,
      processingDate: dateOnly(row.processingDate),
      customer: row.customerName,
      typeOfBond: bondTypeLabel(t, row.bondType, row.customBondType),
      insurer: row.insurerName ?? "",
      expiryDate: dateOnly(row.expiryDate),
      status: policyBusinessStatusLabel(t, row.businessStatus),
      renewal: policyRenewalPeriodLabel(t, row.renewalIndex, row.renewalDecision),
    }));
  } else {
    // work-permit
    const records = await prisma.policyRecord.findMany({
      where: baseWhere,
      include: {
        ...commonInclude,
        workPermitDetail: { select: { permitType: true, otherPermitType: true } },
      },
      orderBy: { processingDate: "desc" },
    });
    const filtered = records
      .filter((r) => r.workPermitDetail)
      .map((r) => toWorkPermitListRow(r, sumsFor(r.id)))
      .filter((row) => matchesWorkPermitListFilters(row, clientFilters));

    sheetBase = t.policy.tabWorkPermit;
    columns = [
      { header: t.policy.recordNumber, key: "recordNumber", width: 16 },
      { header: t.policy.processingDate, key: "processingDate", width: 14 },
      { header: t.policy.customer, key: "customer", width: 32 },
      { header: t.policy.typeOfPermit, key: "typeOfPermit", width: 22 },
      { header: t.policy.expiryDate, key: "expiryDate", width: 14 },
      { header: t.common.status, key: "status", width: 12 },
      { header: t.policy.renewalStatusColumn, key: "renewal", width: 14 },
    ];
    rows = filtered.map((row) => ({
      recordNumber: row.recordNumber,
      processingDate: dateOnly(row.processingDate),
      customer: row.customerName,
      typeOfPermit: workPermitTypeLabel(t, row.permitType, row.otherPermitType),
      expiryDate: dateOnly(row.expiryDate),
      status: policyBusinessStatusLabel(t, row.businessStatus),
      renewal: policyRenewalPeriodLabel(t, row.renewalIndex, row.renewalDecision),
    }));
  }

  const buffer = await buildExportWorkbookBuffer({ sheetName: sheetBase, columns, rows });
  // ASCII filename base regardless of UI language, so Content-Disposition
  // stays simple.
  const fileBase = {
    motor: "Motor-Policies",
    "non-motor": "Non-Motor-Policies",
    bond: "Bond-Policies",
    "work-permit": "Work-Permit-Policies",
  }[category as CategorySlug];
  return xlsxResponse(buffer, buildExportFilename(fileBase, isFiltered));
}
