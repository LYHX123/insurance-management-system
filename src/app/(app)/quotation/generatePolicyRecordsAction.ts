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
import {
  resolveSectionPolicyPlan,
  resolveCustomsBondItemPolicyPlan,
  type SectionForPolicyPlan,
} from "@/lib/quotationRevisions/sectionPolicyMapping";

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

// Phase 6 "Customs Bond per-item generation" — each item's own
// generatedPolicyRecords (mirrors the section-level generatedPolicyRecords
// selection below, one level deeper) so item-level already-generated checks
// never need a second query. Named/reused (not inlined into SECTION_INCLUDE)
// so CustomsBondItemWithPlanData below is derived from the exact same select
// shape rather than risking drift between two hand-written copies.
const CUSTOMS_BOND_ITEM_SELECT = {
  id: true,
  bondType: true,
  bondValue: true,
  premium: true,
  generatedPolicyRecords: { where: { deletedAt: null }, select: { id: true } },
} satisfies Prisma.CustomsBondItemRowSelect;

const SECTION_INCLUDE = {
  motorCompPrivateDetail: { select: { plateNo: true, vehicleValue: true } },
  motorCompCommercialDetail: { select: { plateNo: true, vehicleValue: true } },
  motorTpoPrivateDetail: { select: { plateNo: true } },
  motorTpoCommercialDetail: { select: { plateNo: true } },
  tenderSecurityDetail: { select: { bondValue: true } },
  performanceBondDetail: { select: { bondValue: true } },
  advancePaymentGuaranteeDetail: { select: { bondValue: true } },
  customsBondDetail: { select: { id: true, itemRows: { select: CUSTOMS_BOND_ITEM_SELECT } } },
  generatedPolicyRecords: { where: { deletedAt: null }, select: { id: true } },
} satisfies Prisma.QuotationInsuranceSectionInclude;

type SectionWithPlanData = Prisma.QuotationInsuranceSectionGetPayload<{ include: typeof SECTION_INCLUDE }>;
type CustomsBondItemWithPlanData = Prisma.CustomsBondItemRowGetPayload<{ select: typeof CUSTOMS_BOND_ITEM_SELECT }>;

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

// Phase 6 "Customs Bond per-item generation" — PolicyGenerationUnit is the
// one abstraction this phase adds on top of the existing section-level
// architecture (see this phase's spec, Part 4): every requested row from the
// modal resolves to either a whole QuotationInsuranceSection (unchanged
// Phase 1-5 meaning) or one specific CustomsBondItemRow within a CUSTOMS_BOND
// section. Both branches share the exact same idempotency/row-lock/
// transaction/dates-and-cost-collection machinery below — only the plan
// resolution (resolveSectionPolicyPlan vs. resolveCustomsBondItemPolicyPlan)
// and the PolicyRecord/*Detail shape actually created differ.
type PolicyGenerationUnit =
  | { key: string; kind: "SECTION"; section: SectionWithPlanData }
  | { key: string; kind: "CUSTOM_BOND_ITEM"; section: SectionWithPlanData; item: CustomsBondItemWithPlanData };

type ResolveUnitError = "SECTION_NOT_FOUND" | "CUSTOM_BOND_ITEM_NOT_FOUND";

// Never trusts input.sections[].customBondItemId beyond "which row to look
// up" — the section/item objects returned here always come from a fresh
// `sectionById` lookup (a real prisma read, done by the caller immediately
// before/inside the transaction), never from client-submitted field values.
function resolveUnit(
  key: string,
  raw: GeneratePolicyRecordsSectionInput,
  sectionById: Map<string, SectionWithPlanData>
): PolicyGenerationUnit | ResolveUnitError {
  const section = sectionById.get(raw.sectionId);
  if (!section) return "SECTION_NOT_FOUND";

  if (raw.customBondItemId) {
    if (section.sectionKind !== "CUSTOMS_BOND") return "CUSTOM_BOND_ITEM_NOT_FOUND";
    const item = section.customsBondDetail?.itemRows.find((r) => r.id === raw.customBondItemId);
    if (!item) return "CUSTOM_BOND_ITEM_NOT_FOUND";
    return { key, kind: "CUSTOM_BOND_ITEM", section, item };
  }

  return { key, kind: "SECTION", section };
}

function unitAlreadyGenerated(unit: PolicyGenerationUnit): boolean {
  return unit.kind === "SECTION" ? unit.section.generatedPolicyRecords.length > 0 : unit.item.generatedPolicyRecords.length > 0;
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
  // Phase 6 "Customs Bond per-item generation" — OPTIONAL. When absent,
  // this entry requests section-level generation for `sectionId` (unchanged
  // Phase 1-5 behavior). When present, `sectionId` must be the CUSTOMS_BOND
  // section that owns this CustomsBondItemRow, and this entry requests
  // generation for that ONE item row, never the section as a whole — a
  // CUSTOMS_BOND section with 3 items submits 3 separate entries, each
  // sharing the same sectionId but a different customBondItemId. This is a
  // client-submitted id used only to look the row up; the actual
  // bondType/bondValue/premium are always re-read fresh from the database
  // inside the transaction below (Part 11 of this phase's spec — the client
  // is never trusted for those values).
  customBondItemId?: string;
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
  // Phase 6 — null for every section-level record (unchanged); the source
  // CustomsBondItemRow id for a per-item Customs Bond record.
  customBondItemId: string | null;
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
  // Phase 6 — same "not an error" meaning as alreadyGenerated above, but at
  // CustomsBondItemRow granularity (a CUSTOMS_BOND section with one item
  // already generated and two still pending must report that ONE item here,
  // never the whole section via alreadyGenerated).
  alreadyGeneratedCustomBondItems: string[];
}>;

export async function generatePolicyRecordsAction(input: GeneratePolicyRecordsInput): Promise<GeneratePolicyRecordsResult> {
  const session = await auth();
  if (!session?.user) return { success: false, error: "FORBIDDEN" };

  if (!input.idempotencyKey?.trim()) return { success: false, error: "IDEMPOTENCY_KEY_REQUIRED" };

  // Phase 6: dedup by generation UNIT, not by sectionId alone — a CUSTOMS_BOND
  // section legitimately submits several entries sharing one sectionId (one
  // per selected item row), so keying by customBondItemId when present is
  // required to avoid collapsing distinct items into a single map entry.
  const uniqueUnitInputs = new Map<string, GeneratePolicyRecordsSectionInput>();
  for (const s of input.sections ?? []) {
    const key = s.customBondItemId ? `item:${s.customBondItemId}` : `section:${s.sectionId}`;
    uniqueUnitInputs.set(key, s);
  }
  if (uniqueUnitInputs.size === 0) return { success: false, error: "NO_SECTIONS_SELECTED" };
  const sectionIds = Array.from(new Set(Array.from(uniqueUnitInputs.values()).map((u) => u.sectionId)));

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
  const sectionById = new Map(sections.map((s) => [s.id, s]));

  // Resolve + validate every requested UNIT (section or Customs Bond item)
  // BEFORE touching the database — an unsupported sectionKind, or a
  // customBondItemId that doesn't belong to a CUSTOMS_BOND section (Part 6
  // of this phase's spec) must reject the whole submission with a clear
  // error rather than silently skipping it or guessing a mapping. The modal
  // is expected to never let a user check an unsupported row in the first
  // place; this is the authoritative re-validation for a stale/bypassed
  // client. Only genuine SECTION units are run through
  // resolveSectionPolicyPlan — a CUSTOMS_BOND section requested purely for
  // its item rows is never itself section-plan-resolved (it would always
  // report unsupported), and a stray section-level request against a
  // CUSTOMS_BOND section (no customBondItemId) still correctly falls
  // through to resolveSectionPolicyPlan and is rejected as UNSUPPORTED_SECTION,
  // unchanged from Phase 1-5.
  const categories = new Set<PolicyCategory>();
  const resolvedUnits: PolicyGenerationUnit[] = [];
  for (const [key, raw] of uniqueUnitInputs) {
    const resolved = resolveUnit(key, raw, sectionById);
    if (typeof resolved === "string") return { success: false, error: resolved };

    if (resolved.kind === "CUSTOM_BOND_ITEM") {
      categories.add("BOND");
    } else {
      const plan = resolveSectionPolicyPlan(toPlanInput(resolved.section));
      if (!plan.supported) return { success: false, error: "UNSUPPORTED_SECTION" };
      categories.add(plan.category);
    }
    resolvedUnits.push(resolved);
  }

  // Fail closed on permissions BEFORE creating anything: every distinct
  // Policy category among the requested units must be individually
  // authorized (mirrors each single-record action's own
  // canEdit(session.user, "policy.<category>") check) — never a partial
  // batch where units the user lacks rights for are silently dropped.
  for (const category of categories) {
    const permissionKey = POLICY_CATEGORY_PERMISSION[category];
    if (!permissionKey || !canEdit(session.user, permissionKey)) {
      return { success: false, error: "FORBIDDEN" };
    }
  }

  // Every unit actually eligible to be created (i.e. not already generated
  // as of this pre-transaction read) must supply its OWN valid
  // effectiveDate/expiryDate/insurerCost — checked here for a fast, clear
  // error before opening the transaction, and re-checked implicitly inside
  // it. This phase's spec, Part "验证规则": a single invalid/missing
  // section/item fails the WHOLE submission — never a partial batch.
  type ParsedUnitInput = { insurerCost: number; effectiveDate: Date; expiryDate: Date; policyNumber: string | null };
  const parsedByUnitKey = new Map<string, ParsedUnitInput>();
  for (const unit of resolvedUnits) {
    if (unitAlreadyGenerated(unit)) continue; // already generated — no input required
    const raw = uniqueUnitInputs.get(unit.key)!;

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

    parsedByUnitKey.set(unit.key, { insurerCost: insurerCostAmount, effectiveDate, expiryDate, policyNumber });
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
                sourceCustomsBondItemId: true,
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
              customBondItemId: r.sourceCustomsBondItemId ?? null,
              id: r.id,
              recordNumber: r.recordNumber,
              category: r.category,
              policyNumber: r.motorDetail?.policyNumber ?? r.nonMotorDetail?.policyNumber ?? r.bondDetail?.policyNumber ?? null,
            })),
          alreadyGenerated: [] as string[],
          alreadyGeneratedCustomBondItems: [] as string[],
        };
      }

      // Authoritative re-check under the row lock — see lockQuotation's doc
      // comment for the full concurrency story. Re-reads the sections (and,
      // for Customs Bond, their item rows) fresh inside the lock, then
      // re-resolves every requested unit against THAT fresh data — never the
      // pre-transaction snapshot — so a concurrent generation of the same
      // item/section that committed first is always correctly seen as
      // already-generated here.
      await lockQuotation(tx, input.quotationId);
      const freshSections = await tx.quotationInsuranceSection.findMany({
        where: { id: { in: sectionIds }, quotationId: input.quotationId },
        include: SECTION_INCLUDE,
      });
      const freshSectionById = new Map(freshSections.map((s) => [s.id, s]));

      const freshUnits: PolicyGenerationUnit[] = [];
      for (const [key, raw] of uniqueUnitInputs) {
        const resolved = resolveUnit(key, raw, freshSectionById);
        if (typeof resolved === "string") continue; // defensive only — already validated above
        freshUnits.push(resolved);
      }

      const alreadyGenerated = freshUnits
        .filter((u): u is Extract<PolicyGenerationUnit, { kind: "SECTION" }> => u.kind === "SECTION" && unitAlreadyGenerated(u))
        .map((u) => u.section.id);
      const alreadyGeneratedCustomBondItems = freshUnits
        .filter((u): u is Extract<PolicyGenerationUnit, { kind: "CUSTOM_BOND_ITEM" }> => u.kind === "CUSTOM_BOND_ITEM" && unitAlreadyGenerated(u))
        .map((u) => u.item.id);
      const toCreate = freshUnits.filter((u) => !unitAlreadyGenerated(u));

      const created: GeneratedPolicyRecordRow[] = [];
      for (const unit of toCreate) {
        const parsed = parsedByUnitKey.get(unit.key);
        if (!parsed) throw new Error("DATES_REQUIRED"); // defensive only — every non-generated unit was parsed above
        const { insurerCost: insurerCostAmount, effectiveDate, expiryDate, policyNumber } = parsed;
        // businessStatus depends on THIS unit's own effective/expiry window
        // — never the batch's processingDate or another unit's dates (this
        // phase's spec, Part "PolicyRecord 数据准确性").
        const businessStatus = computeBusinessStatus(effectiveDate, expiryDate, "DRAFT");

        if (unit.kind === "CUSTOM_BOND_ITEM") {
          // bondType/bondAmount/customerPremium all come from `unit.item`,
          // which was just re-read fresh from the database under the row
          // lock above — never from the client-submitted payload (Part 11
          // of this phase's spec).
          const plan = resolveCustomsBondItemPolicyPlan(unit.item);
          const recordNumber = await generatePolicyRecordNumber(tx, "BOND");

          const createdRecord = await tx.policyRecord.create({
            data: {
              recordNumber,
              processingDate,
              customerId: quotation.customerId,
              projectId: quotation.projectId || null,
              insurerName: null,
              effectiveDate,
              expiryDate,
              businessStatus,
              // This item's OWN premium — never the CUSTOMS_BOND section's
              // sectionTotal, which may be the sum of several items (Part 6
              // of this phase's spec).
              customerPremium: plan.customerPremium,
              insurerCost: toDecimal(insurerCostAmount),
              commissionReceived: false,
              commissionAmount: null,
              commissionReceivedDate: null,
              source: "MANUAL",
              remarks: null,
              createdById: session.user.id,
              sourceQuotationId: quotation.id,
              sourceQuotationSectionId: unit.section.id,
              sourceCustomsBondItemId: unit.item.id,
              sourceQuotationNumberSnapshot: quotation.quotationNumber,
              sourceQuotationRevisionSnapshot: quotation.revisionCode,
              sourceQuotationDateSnapshot: quotation.quotationDate,
              category: "BOND",
              bondDetail: {
                create: {
                  bondType: plan.bondType,
                  bondAmount: plan.bondAmount,
                  customBondType: plan.customBondType,
                  policyNumber,
                },
              },
            },
            select: { id: true },
          });

          await recordPolicyActivity(tx, {
            policyRecordId: createdRecord.id,
            actionType: "POLICY_CREATED",
            summary: `BOND policy ${recordNumber} generated from quotation ${quotation.quotationNumber} (section: ${unit.section.insuranceTypeNameSnapshot}, Customs Bond item: ${plan.customBondType})`,
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

          created.push({
            sectionId: unit.section.id,
            customBondItemId: unit.item.id,
            id: createdRecord.id,
            recordNumber,
            category: "BOND",
            policyNumber,
          });
          continue;
        }

        const section = unit.section;
        const plan = resolveSectionPolicyPlan(toPlanInput(section));
        if (!plan.supported) continue; // defensive only — already validated above

        const recordNumber = await generatePolicyRecordNumber(tx, plan.category);

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

        created.push({ sectionId: section.id, customBondItemId: null, id: createdRecord.id, recordNumber, category: plan.category, policyNumber });
      }

      await fulfillIdempotencyClaim(tx, input.idempotencyKey, created.map((c) => c.id).join(","));

      return { created, alreadyGenerated, alreadyGeneratedCustomBondItems };
    });

    revalidatePath(`/quotation/${quotation.id}`);
    if (quotation.quotationCaseId) revalidatePath(`/quotation/case/${quotation.quotationCaseId}`);
    for (const category of categories) {
      revalidatePath(POLICY_CATEGORY_ROUTE[category]);
    }

    return {
      success: true,
      created: result.created,
      alreadyGenerated: result.alreadyGenerated,
      alreadyGeneratedCustomBondItems: result.alreadyGeneratedCustomBondItems,
    };
  } catch (err) {
    if (err instanceof Error && (err.message === "INSURER_COST_INVALID" || err.message === "DATES_REQUIRED")) {
      return { success: false, error: err.message };
    }
    console.error("Failed to generate Policy Records:", err);
    return { success: false, error: "GENERATE_FAILED" };
  }
}
