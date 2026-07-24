import { prisma } from "@/lib/prisma";
import { computeBusinessStatus } from "@/lib/policy/status";
import type { QuotationDetail } from "@/components/quotations/types";

const DETAIL_INCLUDE = {
  customer: { select: { companyName: true } },
  project: { select: { projectName: true } },
  sections: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      items: { orderBy: { sortOrder: "asc" as const } },
      carDetail: true,
      wibaDetail: { include: { payrollRows: { orderBy: { sortOrder: "asc" as const } } } },
      cpmDetail: { include: { equipmentRows: { orderBy: { sortOrder: "asc" as const } } } },
      publicLiabilityDetail: true,
      fireDetail: true,
      burglaryDetail: true,
      gitSingleDetail: true,
      gitAnnualDetail: true,
      marineDetail: { include: { shipmentRows: { orderBy: { sortOrder: "asc" as const } } } },
      motorCompPrivateDetail: true,
      motorCompCommercialDetail: true,
      motorTpoPrivateDetail: true,
      motorTpoCommercialDetail: true,
      gpaDetail: true,
      medicalDetail: { include: { categoryRows: { orderBy: { sortOrder: "asc" as const } } } },
      tenderSecurityDetail: true,
      performanceBondDetail: true,
      advancePaymentGuaranteeDetail: true,
      customsBondDetail: { include: { itemRows: { orderBy: { sortOrder: "asc" as const } } } },
    },
  },
} as const;

/**
 * Loads one Quotation (revision) and maps it into the exact shape
 * QuotationDetailView expects — shared by /quotation/[id] (view a specific
 * revision directly) and the QuotationCase detail page's "Quotation
 * Details" tab, so both stay in sync with zero duplicated field mapping.
 */
export async function getQuotationDetailData(id: string): Promise<QuotationDetail | null> {
  const quotation = await prisma.quotation.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  if (!quotation) return null;

  const creator = await prisma.user.findUnique({
    where: { id: quotation.createdBy },
    select: { fullName: true, username: true },
  });

  // Phase 2A: policies created from this revision (see "Create Policy").
  // Never filtered by category — Motor is the only one that exists yet, but
  // this list must keep working unchanged once Non-Motor/Bond/Work Permit
  // start creating policies the same way.
  const relatedPolicyRecords = await prisma.policyRecord.findMany({
    where: { sourceQuotationId: id, deletedAt: null },
    include: { customer: { select: { companyName: true } } },
    orderBy: { createdAt: "desc" },
  });
  const now = new Date();
  const relatedPolicies = relatedPolicyRecords.map((p) => ({
    id: p.id,
    recordNumber: p.recordNumber,
    category: p.category,
    businessStatus: computeBusinessStatus(p.effectiveDate, p.expiryDate, p.businessStatus, now),
    effectiveDate: p.effectiveDate.toISOString(),
    expiryDate: p.expiryDate.toISOString(),
    customerName: p.customer.companyName,
  }));

  return {
    id: quotation.id,
    quotationNumber: quotation.quotationNumber,
    customerId: quotation.customerId,
    customerName: quotation.customer.companyName,
    projectId: quotation.projectId,
    projectName: quotation.project?.projectName ?? null,
    quotationDate: quotation.quotationDate.toISOString(),
    validUntil: quotation.validUntil ? quotation.validUntil.toISOString() : null,
    currency: quotation.currency,
    status: quotation.status,
    internalNotes: quotation.internalNotes,
    subtotalPremium: quotation.subtotalPremium.toString(),
    totalPHCF: quotation.totalPHCF.toString(),
    totalITL: quotation.totalITL.toString(),
    totalStampDuty: quotation.totalStampDuty.toString(),
    grandTotal: quotation.grandTotal.toString(),
    createdByName: creator ? creator.fullName || creator.username : "—",
    createdAt: quotation.createdAt.toISOString(),
    updatedAt: quotation.updatedAt.toISOString(),
    quotationCaseId: quotation.quotationCaseId,
    revisionCode: quotation.revisionCode,
    revisionNumber: quotation.revisionNumber,
    revisionStatus: quotation.revisionStatus,
    revisionReason: quotation.revisionReason,
    isCurrentRevision: quotation.isCurrentRevision,
    relatedPolicies,
    sections: quotation.sections.map((s) => ({
      id: s.id,
      insuranceTypeId: s.insuranceTypeId,
      insuranceTypeNameSnapshot: s.insuranceTypeNameSnapshot,
      sectionKind: s.sectionKind,
      description: s.description,
      phcfRate: s.phcfRate.toString(),
      itlRate: s.itlRate.toString(),
      stampDuty: s.stampDuty.toString(),
      applyPHCF: s.applyPHCF,
      applyITL: s.applyITL,
      applyStampDuty: s.applyStampDuty,
      basePremium: s.basePremium.toString(),
      phcfAmount: s.phcfAmount.toString(),
      itlAmount: s.itlAmount.toString(),
      sectionTotal: s.sectionTotal.toString(),
      clausesSnapshot: s.clausesSnapshot,
      exclusionsSnapshot: s.exclusionsSnapshot,
      conditionsSnapshot: s.conditionsSnapshot,
      sortOrder: s.sortOrder,
      items: s.items.map((i) => ({
        id: i.id,
        insuredContent: i.insuredContent,
        sumInsured: i.sumInsured ? i.sumInsured.toString() : null,
        rate: i.rate ? i.rate.toString() : null,
        calculationMethod: i.calculationMethod,
        premium: i.premium.toString(),
        notes: i.notes,
        sortOrder: i.sortOrder,
      })),
      carDetail: s.carDetail
        ? {
            projectName: s.carDetail.projectName,
            contractValue: s.carDetail.contractValue.toString(),
            carRate: s.carDetail.carRate.toString(),
            contractPeriodFrom: s.carDetail.contractPeriodFrom
              ? s.carDetail.contractPeriodFrom.toISOString().slice(0, 10)
              : null,
            contractPeriodTo: s.carDetail.contractPeriodTo
              ? s.carDetail.contractPeriodTo.toISOString().slice(0, 10)
              : null,
            constructionPeriodMonths: s.carDetail.constructionPeriodMonths,
            maintenancePeriodMonths: s.carDetail.maintenancePeriodMonths,
            cpmValue: s.carDetail.cpmValue?.toString() ?? null,
            cpmRate: s.carDetail.cpmRate?.toString() ?? null,
            tplAnyOneClaim: s.carDetail.tplAnyOneClaim?.toString() ?? null,
            tplAnyOneEvent: s.carDetail.tplAnyOneEvent?.toString() ?? null,
            tplAnyOnePeriod: s.carDetail.tplAnyOnePeriod?.toString() ?? null,
            tplRate: s.carDetail.tplRate?.toString() ?? null,
            tplComplimentary: s.carDetail.tplComplimentary,
            pvtLoadingEnabled: s.carDetail.pvtLoadingEnabled,
            pvtLoadingRate: s.carDetail.pvtLoadingRate?.toString() ?? null,
            pvtLoadingAmount: s.carDetail.pvtLoadingAmount.toString(),
            pvtLoadingPremium: s.carDetail.pvtLoadingPremium.toString(),
          }
        : null,
      wibaDetail: s.wibaDetail
        ? {
            wibaRate: s.wibaDetail.wibaRate.toString(),
            payrollRows: s.wibaDetail.payrollRows.map((r) => ({
              occupation: r.occupation,
              employeeCount: r.employeeCount,
              annualWages: r.annualWages.toString(),
              basicMonthlySalary: r.basicMonthlySalary?.toString() ?? null,
              monthlyAllowance: r.monthlyAllowance?.toString() ?? null,
            })),
          }
        : null,
      cpmDetail: s.cpmDetail
        ? {
            cpmRate: s.cpmDetail.cpmRate.toString(),
            pvtLoadingEnabled: s.cpmDetail.pvtLoadingEnabled,
            pvtLoadingRate: s.cpmDetail.pvtLoadingRate?.toString() ?? null,
            pvtLoadingAmount: s.cpmDetail.pvtLoadingAmount.toString(),
            pvtLoadingPremium: s.cpmDetail.pvtLoadingPremium.toString(),
            equipmentRows: s.cpmDetail.equipmentRows.map((r) => ({
              equipmentName: r.equipmentName,
              quantity: r.quantity,
              unitValue: r.unitValue.toString(),
              totalValue: r.totalValue.toString(),
            })),
          }
        : null,
      publicLiabilityDetail: s.publicLiabilityDetail
        ? {
            anyOnePersonLimit: s.publicLiabilityDetail.anyOnePersonLimit?.toString() ?? null,
            anyOneOccurrenceLimit: s.publicLiabilityDetail.anyOneOccurrenceLimit?.toString() ?? null,
            anyOneYearLimit: s.publicLiabilityDetail.anyOneYearLimit.toString(),
            rate: s.publicLiabilityDetail.rate.toString(),
          }
        : null,
      fireDetail: s.fireDetail
        ? {
            propertyValue: s.fireDetail.propertyValue.toString(),
            rawMaterialValue: s.fireDetail.rawMaterialValue.toString(),
            goodsInStockValue: s.fireDetail.goodsInStockValue.toString(),
            rate: s.fireDetail.rate.toString(),
            earthquakeLoadingRate: s.fireDetail.earthquakeLoadingRate.toString(),
            floodLoadingRate: s.fireDetail.floodLoadingRate.toString(),
            earthquakeLoadingEnabled: s.fireDetail.earthquakeLoadingEnabled,
            floodLoadingEnabled: s.fireDetail.floodLoadingEnabled,
            pvtLoadingEnabled: s.fireDetail.pvtLoadingEnabled,
            pvtLoadingRate: s.fireDetail.pvtLoadingRate?.toString() ?? null,
            pvtLoadingAmount: s.fireDetail.pvtLoadingAmount.toString(),
            pvtLoadingPremium: s.fireDetail.pvtLoadingPremium.toString(),
          }
        : null,
      burglaryDetail: s.burglaryDetail
        ? {
            equipmentValue: s.burglaryDetail.equipmentValue.toString(),
            stockValue: s.burglaryDetail.stockValue.toString(),
            firstLossPercentage: s.burglaryDetail.firstLossPercentage.toString(),
            rate: s.burglaryDetail.rate.toString(),
          }
        : null,
      gitSingleDetail: s.gitSingleDetail
        ? {
            cargoDescription: s.gitSingleDetail.cargoDescription,
            route: s.gitSingleDetail.route,
            sumInsured: s.gitSingleDetail.sumInsured.toString(),
            rate: s.gitSingleDetail.rate.toString(),
            pvtLoadingEnabled: s.gitSingleDetail.pvtLoadingEnabled,
            pvtLoadingRate: s.gitSingleDetail.pvtLoadingRate?.toString() ?? null,
            pvtLoadingAmount: s.gitSingleDetail.pvtLoadingAmount.toString(),
            pvtLoadingPremium: s.gitSingleDetail.pvtLoadingPremium.toString(),
          }
        : null,
      gitAnnualDetail: s.gitAnnualDetail
        ? {
            cargoDescription: s.gitAnnualDetail.cargoDescription,
            singleLimit: s.gitAnnualDetail.singleLimit.toString(),
            yearLimit: s.gitAnnualDetail.yearLimit.toString(),
            singleLimitRate: s.gitAnnualDetail.singleLimitRate.toString(),
            yearLimitRate: s.gitAnnualDetail.yearLimitRate.toString(),
            pvtLoadingEnabled: s.gitAnnualDetail.pvtLoadingEnabled,
            pvtLoadingRate: s.gitAnnualDetail.pvtLoadingRate?.toString() ?? null,
            pvtLoadingAmount: s.gitAnnualDetail.pvtLoadingAmount.toString(),
            pvtLoadingPremium: s.gitAnnualDetail.pvtLoadingPremium.toString(),
          }
        : null,
      marineDetail: s.marineDetail
        ? {
            cargoDescription: s.marineDetail.cargoDescription,
            origin: s.marineDetail.origin,
            destination: s.marineDetail.destination,
            marineStampDutyRate: s.marineDetail.marineStampDutyRate.toString(),
            shipmentRows: s.marineDetail.shipmentRows.map((r) => ({
              referenceNo: r.referenceNo,
              sumInsured: r.sumInsured.toString(),
              rate: r.rate.toString(),
              linePremium: r.linePremium.toString(),
            })),
          }
        : null,
      motorCompPrivateDetail: s.motorCompPrivateDetail
        ? {
            plateNo: s.motorCompPrivateDetail.plateNo,
            vehicleValue: s.motorCompPrivateDetail.vehicleValue.toString(),
            periodFrom: s.motorCompPrivateDetail.periodFrom.toISOString().slice(0, 10),
            periodTo: s.motorCompPrivateDetail.periodTo.toISOString().slice(0, 10),
            excessProtector: s.motorCompPrivateDetail.excessProtector,
            pvt: s.motorCompPrivateDetail.pvt,
            rate: s.motorCompPrivateDetail.rate.toString(),
          }
        : null,
      motorCompCommercialDetail: s.motorCompCommercialDetail
        ? {
            plateNo: s.motorCompCommercialDetail.plateNo,
            vehicleValue: s.motorCompCommercialDetail.vehicleValue.toString(),
            periodFrom: s.motorCompCommercialDetail.periodFrom.toISOString().slice(0, 10),
            periodTo: s.motorCompCommercialDetail.periodTo.toISOString().slice(0, 10),
            excessProtector: s.motorCompCommercialDetail.excessProtector,
            pvt: s.motorCompCommercialDetail.pvt,
            rate: s.motorCompCommercialDetail.rate.toString(),
          }
        : null,
      motorTpoPrivateDetail: s.motorTpoPrivateDetail
        ? {
            plateNo: s.motorTpoPrivateDetail.plateNo,
            loadingCapacity: null,
            basePremium: s.motorTpoPrivateDetail.basePremium.toString(),
            periodFrom: s.motorTpoPrivateDetail.periodFrom.toISOString().slice(0, 10),
            periodTo: s.motorTpoPrivateDetail.periodTo.toISOString().slice(0, 10),
          }
        : null,
      motorTpoCommercialDetail: s.motorTpoCommercialDetail
        ? {
            plateNo: s.motorTpoCommercialDetail.plateNo,
            loadingCapacity: s.motorTpoCommercialDetail.loadingCapacity.toString(),
            basePremium: s.motorTpoCommercialDetail.basePremium.toString(),
            periodFrom: s.motorTpoCommercialDetail.periodFrom.toISOString().slice(0, 10),
            periodTo: s.motorTpoCommercialDetail.periodTo.toISOString().slice(0, 10),
          }
        : null,
      gpaDetail: s.gpaDetail
        ? {
            deathLimit: s.gpaDetail.deathLimit.toString(),
            ptdLimit: s.gpaDetail.ptdLimit.toString(),
            ttdLimit: s.gpaDetail.ttdLimit.toString(),
            medicalLimit: s.gpaDetail.medicalLimit.toString(),
            funeralLimit: s.gpaDetail.funeralLimit.toString(),
            deathRate: s.gpaDetail.deathRate.toString(),
            ptdRate: s.gpaDetail.ptdRate.toString(),
            ttdRate: s.gpaDetail.ttdRate.toString(),
            medicalRate: s.gpaDetail.medicalRate.toString(),
            funeralRate: s.gpaDetail.funeralRate.toString(),
            numberOfPeople: s.gpaDetail.numberOfPeople,
          }
        : null,
      medicalDetail: s.medicalDetail
        ? {
            inpatientLimit: s.medicalDetail.inpatientLimit.toString(),
            outpatientLimit: s.medicalDetail.outpatientLimit.toString(),
            categoryRows: s.medicalDetail.categoryRows.map((r) => ({
              category: r.category,
              employeeCount: r.employeeCount,
              inpatientRate: r.inpatientRate.toString(),
              outpatientRate: r.outpatientRate.toString(),
            })),
          }
        : null,
      tenderSecurityDetail: s.tenderSecurityDetail
        ? {
            projectName: s.tenderSecurityDetail.projectName,
            bondValue: s.tenderSecurityDetail.bondValue.toString(),
            rate: s.tenderSecurityDetail.rate.toString(),
          }
        : null,
      performanceBondDetail: s.performanceBondDetail
        ? {
            projectName: s.performanceBondDetail.projectName,
            bondValue: s.performanceBondDetail.bondValue.toString(),
            rate: s.performanceBondDetail.rate.toString(),
          }
        : null,
      advancePaymentGuaranteeDetail: s.advancePaymentGuaranteeDetail
        ? {
            projectName: s.advancePaymentGuaranteeDetail.projectName,
            bondValue: s.advancePaymentGuaranteeDetail.bondValue.toString(),
            rate: s.advancePaymentGuaranteeDetail.rate.toString(),
          }
        : null,
      customsBondDetail: s.customsBondDetail
        ? {
            itemRows: s.customsBondDetail.itemRows.map((r) => ({
              bondType: r.bondType,
              bondValue: r.bondValue.toString(),
              rate: r.rate.toString(),
              premium: r.premium.toString(),
            })),
          }
        : null,
    })),
  };
}
