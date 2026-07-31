// Phase 8.1 Part 2 — Customer Detail's "Related Records" tab. Server-only
// query layer: every module below is independently gated by the SAME
// permission key its own standalone list page already requires (see
// src/lib/permissions.ts) and, for Motor/Non-Motor Claims, the SAME
// participant-scoping already enforced by getMotorClaims/getNonMotorClaims
// in src/lib/claims/queries.ts — a user who cannot see a module's own list
// page must not see it here either, and the "module hidden" decision is
// made here (server-side), never left to the client component to fake by
// hiding a card (Part 14, requirement 4/5).
//
// Each module returns { visible, total, rows } — `visible` false means "do
// not render this card at all" (no permission), `rows` is capped at 5
// (Part 2: "最近若干条记录，建议最多5条"), `total` is a real DB count so the
// card can show "12 total" even though only 5 are listed.
import { prisma } from "@/lib/prisma";
import { hasPermission, POLICY_CATEGORY_PERMISSION, type AuthzUser } from "@/lib/permissions";
import type { PolicyCategory } from "@/generated/prisma/enums";

const RECENT_LIMIT = 5;

export type CustomerRelatedQuotationRow = {
  caseId: string;
  // Null when the case has no revision yet ("Preparing Documents") — the
  // UI links to the case page itself in that situation, since there is no
  // revision detail page to link to (Part 3: the link target must be a
  // real, resolvable page).
  currentRevisionId: string | null;
  quotationNumber: string;
  projectName: string | null;
  insuranceTypeNames: string[];
  revisionCode: string | null;
  grandTotal: string | null;
  currency: string | null;
  caseStatus: string;
  updatedAt: string;
};

export type CustomerRelatedPolicyRow = {
  id: string;
  recordNumber: string;
  category: PolicyCategory;
  typeOfCover: string;
  insurerOrAgent: string | null;
  effectiveDate: string;
  expiryDate: string;
  clientPremium: string;
  businessStatus: string;
};

export type CustomerRelatedInvoiceRow = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalPremium: string;
  status: string;
  policySummary: string;
};

export type CustomerRelatedClaimRow = {
  id: string;
  claimNumber: string;
  claimType: string;
  reportedAt: string;
  linkedPolicyRecordNumber: string | null;
  progress: string;
  status: string;
};

export type CustomerRelatedGroup<Row> = { visible: boolean; total: number; rows: Row[] };

export type CustomerRelatedRecordsData = {
  quotations: CustomerRelatedGroup<CustomerRelatedQuotationRow>;
  // categoryTotals only ever lists categories the user is permitted to see
  // AND that have at least one record for this customer — drives the "View
  // All {Category} Policies" links (Part 4), since there is no single
  // unified Policy list page to link to.
  policies: CustomerRelatedGroup<CustomerRelatedPolicyRow> & { categoryTotals: { category: PolicyCategory; total: number }[] };
  invoices: CustomerRelatedGroup<CustomerRelatedInvoiceRow>;
  motorClaims: CustomerRelatedGroup<CustomerRelatedClaimRow>;
  nonMotorClaims: CustomerRelatedGroup<CustomerRelatedClaimRow>;
};

const HIDDEN = { visible: false, total: 0, rows: [] };

async function loadQuotations(customerId: string, user: AuthzUser): Promise<CustomerRelatedRecordsData["quotations"]> {
  if (!hasPermission(user, "quotation")) return HIDDEN;

  const where = { customerId };
  const [total, cases] = await Promise.all([
    prisma.quotationCase.count({ where }),
    prisma.quotationCase.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: RECENT_LIMIT,
      select: {
        id: true,
        quotationNumber: true,
        status: true,
        updatedAt: true,
        currentRevisionId: true,
        project: { select: { projectName: true } },
      },
    }),
  ]);

  const revisionIds = cases.map((c) => c.currentRevisionId).filter((id): id is string => !!id);
  const revisions = revisionIds.length
    ? await prisma.quotation.findMany({
        where: { id: { in: revisionIds } },
        select: {
          id: true,
          revisionCode: true,
          grandTotal: true,
          currency: true,
          sections: { select: { insuranceTypeNameSnapshot: true } },
        },
      })
    : [];
  const revisionById = new Map(revisions.map((r) => [r.id, r]));

  const rows: CustomerRelatedQuotationRow[] = cases.map((c) => {
    const rev = c.currentRevisionId ? revisionById.get(c.currentRevisionId) : undefined;
    return {
      caseId: c.id,
      currentRevisionId: c.currentRevisionId,
      quotationNumber: c.quotationNumber,
      projectName: c.project?.projectName ?? null,
      insuranceTypeNames: rev ? rev.sections.map((s) => s.insuranceTypeNameSnapshot) : [],
      revisionCode: rev?.revisionCode ?? null,
      grandTotal: rev ? rev.grandTotal.toString() : null,
      currency: rev?.currency ?? null,
      caseStatus: c.status,
      updatedAt: c.updatedAt.toISOString(),
    };
  });

  return { visible: true, total, rows };
}

const POLICY_DETAIL_SELECT = {
  motorDetail: { select: { insuranceType: true } },
  nonMotorDetail: { select: { insuranceType: true } },
  bondDetail: { select: { bondType: true, customBondType: true } },
  workPermitDetail: { select: { permitType: true, otherPermitType: true, agent: true } },
} as const;

function typeOfCoverFor(record: {
  category: PolicyCategory;
  motorDetail: { insuranceType: string } | null;
  nonMotorDetail: { insuranceType: string } | null;
  bondDetail: { bondType: string; customBondType: string | null } | null;
  workPermitDetail: { permitType: string; otherPermitType: string | null; agent: string } | null;
}): { typeOfCover: string; insurerOrAgent: string | null } {
  switch (record.category) {
    case "MOTOR":
      return { typeOfCover: record.motorDetail?.insuranceType ?? "—", insurerOrAgent: null };
    case "NON_MOTOR":
      return { typeOfCover: record.nonMotorDetail?.insuranceType ?? "—", insurerOrAgent: null };
    case "BOND":
      return {
        typeOfCover: record.bondDetail?.bondType === "CUSTOM_BOND" ? record.bondDetail.customBondType ?? "—" : record.bondDetail?.bondType ?? "—",
        insurerOrAgent: null,
      };
    case "WORK_PERMIT":
      return {
        typeOfCover: record.workPermitDetail?.permitType === "OTHER" ? record.workPermitDetail.otherPermitType ?? "—" : record.workPermitDetail?.permitType ?? "—",
        insurerOrAgent: record.workPermitDetail?.agent ?? null,
      };
    default:
      return { typeOfCover: "—", insurerOrAgent: null };
  }
}

async function loadPolicies(customerId: string, user: AuthzUser): Promise<CustomerRelatedRecordsData["policies"]> {
  const visibleCategories = (Object.keys(POLICY_CATEGORY_PERMISSION) as PolicyCategory[]).filter((cat) =>
    hasPermission(user, POLICY_CATEGORY_PERMISSION[cat])
  );
  if (visibleCategories.length === 0) return { ...HIDDEN, categoryTotals: [] };

  const perCategory = await Promise.all(
    visibleCategories.map(async (category) => {
      const where = { customerId, category, deletedAt: null } as const;
      const [total, records] = await Promise.all([
        prisma.policyRecord.count({ where }),
        prisma.policyRecord.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          take: RECENT_LIMIT,
          select: {
            id: true,
            recordNumber: true,
            category: true,
            insurerName: true,
            effectiveDate: true,
            expiryDate: true,
            customerPremium: true,
            businessStatus: true,
            updatedAt: true,
            ...POLICY_DETAIL_SELECT,
          },
        }),
      ]);
      return { category, total, records };
    })
  );

  const total = perCategory.reduce((sum, c) => sum + c.total, 0);
  const categoryTotals = perCategory.filter((c) => c.total > 0).map((c) => ({ category: c.category, total: c.total }));
  const merged = perCategory
    .flatMap((c) => c.records)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, RECENT_LIMIT);

  const rows: CustomerRelatedPolicyRow[] = merged.map((r) => {
    const { typeOfCover, insurerOrAgent } = typeOfCoverFor(r);
    return {
      id: r.id,
      recordNumber: r.recordNumber,
      category: r.category,
      typeOfCover,
      insurerOrAgent: insurerOrAgent ?? r.insurerName,
      effectiveDate: r.effectiveDate.toISOString(),
      expiryDate: r.expiryDate.toISOString(),
      clientPremium: r.customerPremium.toString(),
      businessStatus: r.businessStatus,
    };
  });

  return { visible: true, total, rows, categoryTotals };
}

async function loadInvoices(customerId: string, user: AuthzUser): Promise<CustomerRelatedRecordsData["invoices"]> {
  if (!hasPermission(user, "invoice")) return HIDDEN;

  const where = { customerId };
  const [total, invoices] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      orderBy: { invoiceDate: "desc" },
      take: RECENT_LIMIT,
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        totalPremium: true,
        status: true,
        items: { select: { policyClassSnapshot: true, policyNumberSnapshot: true } },
      },
    }),
  ]);

  const rows: CustomerRelatedInvoiceRow[] = invoices.map((inv) => {
    const first = inv.items[0];
    const extra = inv.items.length - 1;
    const policySummary = first ? `${first.policyClassSnapshot} — ${first.policyNumberSnapshot}${extra > 0 ? ` (+${extra})` : ""}` : "—";
    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate.toISOString(),
      totalPremium: inv.totalPremium.toString(),
      status: inv.status,
      policySummary,
    };
  });

  return { visible: true, total, rows };
}

async function loadMotorClaims(customerId: string, userId: string, user: AuthzUser): Promise<CustomerRelatedRecordsData["motorClaims"]> {
  if (!hasPermission(user, "claim.motor")) return HIDDEN;

  // Same participant-scoping as getMotorClaims (src/lib/claims/queries.ts)
  // — a user (including an admin) only ever sees Claims they participate
  // in; this must never be relaxed just because this is a summary view.
  const where = { customerId, deletedAt: null, participants: { some: { userId } } } as const;
  const [total, claims] = await Promise.all([
    prisma.motorClaim.count({ where }),
    prisma.motorClaim.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: RECENT_LIMIT,
      select: {
        id: true,
        claimNumber: true,
        claimNature: true,
        reportedAt: true,
        progress: true,
        status: true,
        policyRecord: { select: { recordNumber: true } },
      },
    }),
  ]);

  const rows: CustomerRelatedClaimRow[] = claims.map((c) => ({
    id: c.id,
    claimNumber: c.claimNumber,
    claimType: c.claimNature,
    reportedAt: c.reportedAt.toISOString(),
    linkedPolicyRecordNumber: c.policyRecord?.recordNumber ?? null,
    progress: c.progress,
    status: c.status,
  }));

  return { visible: true, total, rows };
}

async function loadNonMotorClaims(customerId: string, userId: string, user: AuthzUser): Promise<CustomerRelatedRecordsData["nonMotorClaims"]> {
  if (!hasPermission(user, "claim.non_motor")) return HIDDEN;

  const where = { customerId, deletedAt: null, participants: { some: { userId } } } as const;
  const [total, claims] = await Promise.all([
    prisma.nonMotorClaim.count({ where }),
    prisma.nonMotorClaim.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: RECENT_LIMIT,
      select: {
        id: true,
        claimNumber: true,
        insuranceType: true,
        reportedAt: true,
        progress: true,
        status: true,
        policyRecord: { select: { recordNumber: true } },
      },
    }),
  ]);

  const rows: CustomerRelatedClaimRow[] = claims.map((c) => ({
    id: c.id,
    claimNumber: c.claimNumber,
    claimType: c.insuranceType,
    reportedAt: c.reportedAt.toISOString(),
    linkedPolicyRecordNumber: c.policyRecord?.recordNumber ?? null,
    progress: c.progress,
    status: c.status,
  }));

  return { visible: true, total, rows };
}

// `userId` is the acting session user — required (not read from `user`)
// because participant-scoping keys off the User row id, matching
// getMotorClaims/getNonMotorClaims's own signature.
export async function getCustomerRelatedRecords(
  customerId: string,
  userId: string,
  user: AuthzUser
): Promise<CustomerRelatedRecordsData> {
  const [quotations, policies, invoices, motorClaims, nonMotorClaims] = await Promise.all([
    loadQuotations(customerId, user),
    loadPolicies(customerId, user),
    loadInvoices(customerId, user),
    loadMotorClaims(customerId, userId, user),
    loadNonMotorClaims(customerId, userId, user),
  ]);

  return { quotations, policies, invoices, motorClaims, nonMotorClaims };
}
