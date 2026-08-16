"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { PolicyCategory } from "@/generated/prisma/enums";
import { canEdit, POLICY_CATEGORY_PERMISSION } from "@/lib/permissions";
import { toDecimal, toFiniteAmount } from "@/lib/money";
import { generatePolicyRecordNumber } from "@/lib/policy/recordNumber";
import { computeBusinessStatus } from "@/lib/policy/status";
import { recordPolicyActivity } from "@/lib/policy/activity";
import { claimIdempotencyKey, fulfillIdempotencyClaim } from "@/lib/idempotency/claim";
import { resolveSectionPolicyPlan, type SectionForPolicyPlan } from "@/lib/quotationRevisions/sectionPolicyMapping";

// Phase 1+2: "Generate Policy Records" — batch counterpart to
// createMotorRecordAction / createNonMotorRecordAction / createBondRecordAction.
// Deliberately does NOT call those exported Server Actions directly (each one
// opens and commits its own independent prisma.$transaction(), so calling
// them in a loop could never give the whole batch the single atomic,
// row-locked transaction this phase's spec requires for its idempotency
// guarantee). Instead this reuses the exact same shared building blocks
// those actions are themselves built from — generatePolicyRecordNumber,
// computeBusinessStatus, recordPolicyActivity, toDecimal — and mirrors their
// PolicyRecord/*Detail construction field-for-field (see each category
// branch below), so the actual business rules never diverge from the
// single-record flow; only the transaction boundary and the
// section-to-category dispatch are new.

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

// Self-contained per this project's existing convention (see e.g.
// invoice/eligibility.ts's own POLICY_CATEGORY_ROUTE) — used only for the
// revalidatePath calls below.
const POLICY_CATEGORY_ROUTE: Record<PolicyCategory, string> = {
  MOTOR: "/policy/motor",
  NON_MOTOR: "/policy/non-motor",
  BOND: "/policy/bond",
  WORK_PERMIT: "/policy/work-permit",
};

const SECTION_INCLUDE = {
  motorCompPrivateDetail: { select: { plateNo: true, vehicleValue: true } },
  motorCompCommercialDetail: { select: { plateNo: true, vehicleValue: true } },
  motorTpoPrivateDetail: { select: { plateNo: true } },
  motorTpoCommercialDetail: { select: { plateNo: true } },
  tenderSecurityDetail: { select: { bondValue: true } },
  performanceBondDetail: { select: { bondValue: true } },
  advancePaymentGuaranteeDetail: { select: { bondValue: true } },
  generatedPolicyRecords: { where: { deletedAt: null }, select: { id: true } },
} satisfies Prisma.QuotationInsuranceSectionInclude;

type SectionWithPlanData = Prisma.QuotationInsuranceSectionGetPayload<{ include: typeof SECTION_INCLUDE }>;

function toPlanInput(section: SectionWithPlanData): SectionForPolicyPlan {
  return {
    id: section.id,
    sectionKind: section.sectionKind,
    sectionTotal: section.sectionTotal,
    motorCompPrivateDetail: section.motorCompPrivateDetail,
    motorCompCommercialDetail: section.motorCompCommercialDetail,
    motorTpoPrivateDetail: section.motorTpoPrivateDetail,
    motorTpoCommercialDetail: section.motorTpoCommercialDetail,
    tenderSecurityDetail: section.tenderSecurityDetail,
    performanceBondDetail: section.performanceBondDetail,
    advancePaymentGuaranteeDetail: section.advancePaymentGuaranteeDetail,
  };
}

// Locks the source Quotation row for the duration of the transaction — same
// SELECT ... FOR UPDATE technique as revisionActions.ts's lockCase /
// invoice/actions.ts's lockPolicyRecordsForInvoice. Two concurrent
// "Generate Policy Records" submissions against the SAME quotation (double-
// click without a shared idempotencyKey, two browser tabs, a network retry)
// serialize here: the second call blocks until the first transaction
// commits, then its own fresh re-query of generatedPolicyRecords already
// reflects what the first call just created, so it naturally creates
// nothing further for any section the first call already covered.
async function lockQuotation(tx: Prisma.TransactionClient, quotationId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Quotation" WHERE id = ${quotationId} FOR UPDATE`;
}

// Section-level input (see this phase's spec: different insurance types on
// the same quotation legitimately run different cover periods — e.g. CAR
// 2026-08-20..2027-08-19 vs. a Performance Bond 2026-08-25..2027-02-24 —
// so effectiveDate/expiryDate can never be a single batch-wide value).
// insurerCost stays per-section too (unchanged from the previous phase —
// every category's PolicyRecord.insurerCost is a required, non-nullable
// Decimal with no reliable quotation source, so it is never fabricated and
// always collected from the user).
export type GeneratePolicyRecordsSectionInput = {
  sectionId: string;
  insurerCost: number | string;
  effectiveDate: string;
  expiryDate: string;
  // Phase 4 "Policy Number at generation time" — OPTIONAL (this phase's
  // spec, Part 3): the user often already has the real, insurer-issued
  // policy number by the time they batch-generate, but not always, so a
  // blank value must never block generation. Written into the SAME
  // category-specific detail field (MotorPolicyDetail.policyNumber /
  // NonMotorPolicyDetail.policyNumber / BondPolicyDetail.policyNumber) the
  // single-record create/edit actions already use — never a new/duplicate
  // column, never just a snapshot.
  policyNumber?: string;
};

export type GeneratePolicyRecordsInput = {
  quotationId: string;
  // Processing Date stays batch-level (this phase's spec, Part 1): every
  // PolicyRecord generated in one submission shares the same processingDate
  // — only effectiveDate/expiryDate/insurerCost moved to section-level.
  processingDate: string;
  sections: GeneratePolicyRecordsSectionInput[];
  // Production Readiness Audit V1 H6 pattern, reused as-is (see
  // addCustomerReceiptAction's own idempotencyKey doc comment): one
  // client-generated key per modal open/submission attempt, resubmitted
  // unchanged on any retry of that same attempt.
  idempotencyKey: string;
};

export type GeneratedPolicyRecordRow = {
  sectionId: string;
  id: string;
  recordNumber: string;
  category: PolicyCategory;
  policyNumber: string | null;
};

export type GeneratePolicyRecordsResult = ActionResult<{
  created: GeneratedPolicyRecordRow[];
  // Sections that already had a (non-deleted) generated PolicyRecord at the
  // time this call was authoritatively checked (under the row lock) — never
  // an error, since a section already generated by an earlier call/tab is
  // exactly the "don't create a duplicate" outcome this action exists to
  // guarantee, not a failure of this call.
  alreadyGenerated: string[];
}>;

export async function generatePolicyRecordsAction(input: GeneratePolicyRecordsInput): Promise<GeneratePolicyRecordsResult> {
  const session = await auth();
  if (!session?.user) return { success: false, error: "FORBIDDEN" };

  if (!input.idempotencyKey?.trim()) return { success: false, error: "IDEMPOTENCY_KEY_REQUIRED" };

  const uniqueSectionInputs = new Map<string, GeneratePolicyRecordsSectionInput>();
  for (const s of input.sections ?? []) uniqueSectionInputs.set(s.sectionId, s);
  const sectionIds = Array.from(uniqueSectionInputs.keys());
  if (sectionIds.length === 0) return { success: false, error: "NO_SECTIONS_SELECTED" };

  if (!input.processingDate) return { success: false, error: "PROCESSING_DATE_REQUIRED" };
  const processingDate = new Date(input.processingDate);
  if (Number.isNaN(processingDate.getTime())) return { success: false, error: "PROCESSING_DATE_REQUIRED" };

  const quotation = await prisma.quotation.findUnique({
    where: { id: input.quotationId },
    select: {
      id: true,
      quotationNumber: true,
      quotationCaseId: true,
      revisionStatus: true,
      revisionCode: true,
      quotationDate: true,
      customerId: true,
      projectId: true,
    },
  });
  if (!quotation) return { success: false, error: "QUOTATION_NOT_FOUND" };
  // Mirrors every existing single-record create action's own eligibility
  // check exactly (see createMotorRecordAction etc.) — never relaxed for
  // the batch flow.
  if (quotation.revisionStatus !== "ISSUED" && quotation.revisionStatus !== "ACCEPTED") {
    return { success: false, error: "QUOTATION_NOT_ELIGIBLE" };
  }

  const sections = await prisma.quotationInsuranceSection.findMany({
    where: { id: { in: sectionIds }, quotationId: input.quotationId },
    include: SECTION_INCLUDE,
  });
  if (sections.length !== sectionIds.length) return { success: false, error: "SECTION_NOT_FOUND" };

  // Resolve + validate every requested section BEFORE touching the
  // database — an unsupported sectionKind (Part 6 of the previous phase's
  // spec) must reject the whole submission with a clear error rather than
  // silently skipping it or guessing a mapping. The modal is expected to
  // never let a user check an unsupported section in the first place; this
  // is the authoritative re-validation for a stale/bypassed client.
  const categories = new Set<PolicyCategory>();
  for (const section of sections) {
    const plan = resolveSectionPolicyPlan(toPlanInput(section));
    if (!plan.supported) return { success: false, error: "UNSUPPORTED_SECTION" };
    categories.add(plan.category);
  }

  // Fail closed on permissions BEFORE creating anything: every distinct
  // Policy category among the requested sections must be individually
  // authorized (mirrors each single-record action's own
  // canEdit(session.user, "policy.<category>") check) — never a partial
  // batch where sections the user lacks rights for are silently dropped.
  for (const category of categories) {
    const permissionKey = POLICY_CATEGORY_PERMISSION[category];
    if (!permissionKey || !canEdit(session.user, permissionKey)) {
      return { success: false, error: "FORBIDDEN" };
    }
  }

  // Every section actually eligible to be created (i.e. not already
  // generated as of this pre-transaction read) must supply its OWN valid
  // effectiveDate/expiryDate/insurerCost — checked here for a fast, clear
  // error before opening the transaction, and re-checked implicitly inside
  // it. This phase's spec, Part "验证规则": a single invalid/missing section
  // fails the WHOLE submission — never a partial batch.
  type ParsedSectionInput = { insurerCost: number; effectiveDate: Date; expiryDate: Date; policyNumber: string | null };
  const parsedBySection = new Map<string, ParsedSectionInput>();
  for (const section of sections) {
    if (section.generatedPolicyRecords.length > 0) continue; // already generated — no input required
    const raw = uniqueSectionInputs.get(section.id)!;

    if (!raw.effectiveDate || !raw.expiryDate) return { success: false, error: "DATES_REQUIRED" };
    const effectiveDate = new Date(raw.effectiveDate);
    const expiryDate = new Date(raw.expiryDate);
    if (Number.isNaN(effectiveDate.getTime()) || Number.isNaN(expiryDate.getTime())) {
      return { success: false, error: "DATES_REQUIRED" };
    }
    if (expiryDate <= effectiveDate) return { success: false, error: "EXPIRY_BEFORE_EFFECTIVE" };

    const insurerCostAmount = toFiniteAmount(raw.insurerCost);
    if (insurerCostAmount === null || insurerCostAmount < 0) return { success: false, error: "INSURER_COST_INVALID" };

    // OPTIONAL (this phase's spec, Part 3) — trimmed, blank -> null, never
    // required. Never validated against a format: the real insurer-issued
    // policy number has no fixed shape in this system (see
    // MotorPolicyDetail.policyNumber's own schema comment — free text).
    const policyNumber = raw.policyNumber?.trim() || null;

    parsedBySection.set(section.id, { insurerCost: insurerCostAmount, effectiveDate, expiryDate, policyNumber });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, "quotation.generatePolicyRecords", input.idempotencyKey);
      if (claim.kind === "replay") {
        const ids = claim.resourceId ? claim.resourceId.split(",").filter(Boolean) : [];
        // Selects each category's OWN policyNumber field (see this phase's
        // spec, Part 5 — policyNumber lives on the category-specific detail
        // table, never a duplicate column on PolicyRecord itself) so a
        // replay reports the SAME value the original call actually wrote,
        // never re-deriving or re-applying whatever the retry happened to
        // submit (Part 9: "相同 idempotencyKey replay: 不得...修改已经生成的
        // Policy").
        const replayed = ids.length
          ? await tx.policyRecord.findMany({
              where: { id: { in: ids } },
              select: {
                id: true,
                recordNumber: true,
                category: true,
                sourceQuotationSectionId: true,
                motorDetail: { select: { policyNumber: true } },
                nonMotorDetail: { select: { policyNumber: true } },
                bondDetail: { select: { policyNumber: true } },
              },
            })
          : [];
        return {
          created: replayed
            .filter((r) => r.sourceQuotationSectionId)
            .map((r) => ({
              sectionId: r.sourceQuotationSectionId as string,
              id: r.id,
              recordNumber: r.recordNumber,
              category: r.category,
              policyNumber: r.motorDetail?.policyNumber ?? r.nonMotorDetail?.policyNumber ?? r.bondDetail?.policyNumber ?? null,
            })),
          alreadyGenerated: [] as string[],
        };
      }

      // Authoritative re-check under the row lock — see lockQuotation's doc
      // comment for the full concurrency story.
      await lockQuotation(tx, input.quotationId);
      const freshSections = await tx.quotationInsuranceSection.findMany({
        where: { id: { in: sectionIds }, quotationId: input.quotationId },
        include: SECTION_INCLUDE,
      });

      const alreadyGenerated = freshSections.filter((s) => s.generatedPolicyRecords.length > 0).map((s) => s.id);
      const toCreate = freshSections.filter((s) => s.generatedPolicyRecords.length === 0);

      const created: GeneratedPolicyRecordRow[] = [];
      for (const section of toCreate) {
        const plan = resolveSectionPolicyPlan(toPlanInput(section));
        if (!plan.supported) continue; // defensive only — already validated above

        const parsed = parsedBySection.get(section.id);
        if (!parsed) throw new Error("DATES_REQUIRED"); // defensive only — every non-generated section was parsed above
        const { insurerCost: insurerCostAmount, effectiveDate, expiryDate, policyNumber } = parsed;

        const recordNumber = await generatePolicyRecordNumber(tx, plan.category);
        // businessStatus depends on THIS section's own effective/expiry
        // window — never the batch's processingDate or another section's
        // dates (this phase's spec, Part "PolicyRecord 数据准确性").
        const businessStatus = computeBusinessStatus(effectiveDate, expiryDate, "DRAFT");

        const commonData = {
          recordNumber,
          processingDate,
          customerId: quotation.customerId,
          projectId: quotation.projectId || null,
          insurerName: null,
          effectiveDate,
          expiryDate,
          businessStatus,
          customerPremium: section.sectionTotal,
          insurerCost: toDecimal(insurerCostAmount),
          commissionReceived: false,
          commissionAmount: null,
          commissionReceivedDate: null,
          source: "MANUAL" as const,
          remarks: null,
          createdById: session.user.id,
          sourceQuotationId: quotation.id,
          sourceQuotationSectionId: section.id,
          sourceQuotationNumberSnapshot: quotation.quotationNumber,
          sourceQuotationRevisionSnapshot: quotation.revisionCode,
          sourceQuotationDateSnapshot: quotation.quotationDate,
        };

        let createdRecord: { id: string };
        if (plan.category === "MOTOR") {
          createdRecord = await tx.policyRecord.create({
            data: {
              ...commonData,
              category: "MOTOR",
              motorDetail: {
                create: {
                  insuranceType: plan.insuranceType,
                  registrationNumber: plan.registrationNumber,
                  taxClass: plan.taxClass,
                  vehicleValue: plan.vehicleValue,
                  policyNumber,
                },
              },
            },
            select: { id: true },
          });
        } else if (plan.category === "NON_MOTOR") {
          createdRecord = await tx.policyRecord.create({
            data: {
              ...commonData,
              category: "NON_MOTOR",
              nonMotorDetail: { create: { insuranceType: plan.insuranceType, policyNumber } },
            },
            select: { id: true },
          });
        } else {
          createdRecord = await tx.policyRecord.create({
            data: {
              ...commonData,
              category: "BOND",
              bondDetail: { create: { bondType: plan.bondType, bondAmount: plan.bondAmount, customBondType: null, policyNumber } },
            },
            select: { id: true },
          });
        }

        await recordPolicyActivity(tx, {
          policyRecordId: createdRecord.id,
          actionType: "POLICY_CREATED",
          summary: `${plan.category} policy ${recordNumber} generated from quotation ${quotation.quotationNumber} (section: ${section.insuranceTypeNameSnapshot})`,
          performedById: session.user.id,
        });

        if (quotation.quotationCaseId) {
          await tx.quotationCaseActivity.create({
            data: {
              quotationCaseId: quotation.quotationCaseId,
              actionType: "POLICY_CREATED",
              summary: `Policy ${recordNumber} created`,
              performedById: session.user.id,
            },
          });
        }

        created.push({ sectionId: section.id, id: createdRecord.id, recordNumber, category: plan.category, policyNumber });
      }

      await fulfillIdempotencyClaim(tx, input.idempotencyKey, created.map((c) => c.id).join(","));

      return { created, alreadyGenerated };
    });

    revalidatePath(`/quotation/${quotation.id}`);
    if (quotation.quotationCaseId) revalidatePath(`/quotation/case/${quotation.quotationCaseId}`);
    for (const category of categories) {
      revalidatePath(POLICY_CATEGORY_ROUTE[category]);
    }

    return { success: true, created: result.created, alreadyGenerated: result.alreadyGenerated };
  } catch (err) {
    if (err instanceof Error && (err.message === "INSURER_COST_INVALID" || err.message === "DATES_REQUIRED")) {
      return { success: false, error: err.message };
    }
    console.error("Failed to generate Policy Records:", err);
    return { success: false, error: "GENERATE_FAILED" };
  }
}
