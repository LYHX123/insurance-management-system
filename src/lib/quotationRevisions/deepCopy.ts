// Deep-copies every insurance section (and every nested child row) from one
// existing Quotation (a revision) into a fresh
// Prisma.QuotationInsuranceSectionCreateWithoutQuotationInput[] payload,
// suitable for nested-create into a brand new Quotation row for the next
// revision.
//
// Deliberately independent from buildSectionCreates() in actions.ts: that
// function VALIDATES and RECALCULATES a section from raw form input (the
// correct behavior for Save), whereas a revision copy must preserve the
// source revision's exact persisted values byte-for-byte — no
// recalculation, no re-validation, no risk of drift between what the
// source revision showed and what the new draft starts from. Every
// *SectionDetail model's own id/sectionId/createdAt/updatedAt (and every
// child row's id/parentId) is stripped; everything else is copied as-is.
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

// Shared with the detail/edit pages' own Prisma include shape (kept as an
// independent copy here rather than importing from a page module, since
// page files are not meant to export shared server-only query fragments).
const SOURCE_INCLUDE = {
  sections: {
    orderBy: { sortOrder: "asc" },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      carDetail: true,
      wibaDetail: { include: { payrollRows: { orderBy: { sortOrder: "asc" } } } },
      elDetail: true,
      cpmDetail: { include: { equipmentRows: { orderBy: { sortOrder: "asc" } } } },
      publicLiabilityDetail: true,
      fireDetail: true,
      burglaryDetail: true,
      gitSingleDetail: true,
      gitAnnualDetail: true,
      marineDetail: { include: { shipmentRows: { orderBy: { sortOrder: "asc" } } } },
      motorCompPrivateDetail: true,
      motorCompCommercialDetail: true,
      motorTpoPrivateDetail: true,
      motorTpoCommercialDetail: true,
      gpaDetail: true,
      medicalDetail: { include: { categoryRows: { orderBy: { sortOrder: "asc" } } } },
      tenderSecurityDetail: true,
      performanceBondDetail: true,
      advancePaymentGuaranteeDetail: true,
      customsBondDetail: { include: { itemRows: { orderBy: { sortOrder: "asc" } } } },
    },
  },
} satisfies Prisma.QuotationInclude;

type SourceQuotation = Prisma.QuotationGetPayload<{ include: typeof SOURCE_INCLUDE }>;
type SourceSection = SourceQuotation["sections"][number];

function copyItems(section: SourceSection): Prisma.QuotationCoverageItemCreateWithoutSectionInput[] {
  return section.items.map((item) => ({
    insuredContent: item.insuredContent,
    sumInsured: item.sumInsured,
    rate: item.rate,
    calculationMethod: item.calculationMethod,
    premium: item.premium,
    notes: item.notes,
    sortOrder: item.sortOrder,
  }));
}

function copySectionDetail(section: SourceSection): Pick<
  Prisma.QuotationInsuranceSectionCreateWithoutQuotationInput,
  | "carDetail"
  | "wibaDetail"
  | "elDetail"
  | "cpmDetail"
  | "publicLiabilityDetail"
  | "fireDetail"
  | "burglaryDetail"
  | "gitSingleDetail"
  | "gitAnnualDetail"
  | "marineDetail"
  | "motorCompPrivateDetail"
  | "motorCompCommercialDetail"
  | "motorTpoPrivateDetail"
  | "motorTpoCommercialDetail"
  | "gpaDetail"
  | "medicalDetail"
  | "tenderSecurityDetail"
  | "performanceBondDetail"
  | "advancePaymentGuaranteeDetail"
  | "customsBondDetail"
> {
  const d = section;

  if (d.carDetail) {
    const c = d.carDetail;
    return {
      carDetail: {
        create: {
          projectName: c.projectName,
          contractValue: c.contractValue,
          carRate: c.carRate,
          contractPeriodFrom: c.contractPeriodFrom,
          contractPeriodTo: c.contractPeriodTo,
          constructionPeriodMonths: c.constructionPeriodMonths,
          maintenancePeriodMonths: c.maintenancePeriodMonths,
          cpmValue: c.cpmValue,
          cpmRate: c.cpmRate,
          tplAnyOneClaim: c.tplAnyOneClaim,
          tplAnyOneEvent: c.tplAnyOneEvent,
          tplAnyOnePeriod: c.tplAnyOnePeriod,
          tplRate: c.tplRate,
          tplComplimentary: c.tplComplimentary,
          pvtLoadingEnabled: c.pvtLoadingEnabled,
          pvtLoadingRate: c.pvtLoadingRate,
          pvtLoadingAmount: c.pvtLoadingAmount,
          pvtLoadingPremium: c.pvtLoadingPremium,
          carBasicPremium: c.carBasicPremium,
          carCpmPremium: c.carCpmPremium,
          carMainGrossPremium: c.carMainGrossPremium,
          carMainPhcf: c.carMainPhcf,
          carMainItl: c.carMainItl,
          carMainStampDuty: c.carMainStampDuty,
          carMainTotal: c.carMainTotal,
          tplGrossPremium: c.tplGrossPremium,
          tplPhcf: c.tplPhcf,
          tplItl: c.tplItl,
          tplStampDuty: c.tplStampDuty,
          tplTotalPremium: c.tplTotalPremium,
        },
      },
    };
  }

  if (d.wibaDetail) {
    const w = d.wibaDetail;
    return {
      wibaDetail: {
        create: {
          wibaRate: w.wibaRate,
          totalEmployeeCount: w.totalEmployeeCount,
          totalAnnualWages: w.totalAnnualWages,
          grossPremium: w.grossPremium,
          phcfAmount: w.phcfAmount,
          itlAmount: w.itlAmount,
          stampDutyAmount: w.stampDutyAmount,
          totalPremium: w.totalPremium,
          payrollRows: {
            create: w.payrollRows.map((r) => ({
              occupation: r.occupation,
              employeeCount: r.employeeCount,
              annualWages: r.annualWages,
              basicMonthlySalary: r.basicMonthlySalary,
              monthlyAllowance: r.monthlyAllowance,
              sortOrder: r.sortOrder,
            })),
          },
        },
      },
    };
  }

  if (d.elDetail) {
    const e = d.elDetail;
    return {
      elDetail: {
        create: {
          linkedWibaGrossPremium: e.linkedWibaGrossPremium,
          grossPremium: e.grossPremium,
          phcfAmount: e.phcfAmount,
          itlAmount: e.itlAmount,
          stampDutyAmount: e.stampDutyAmount,
          totalPremium: e.totalPremium,
        },
      },
    };
  }

  if (d.cpmDetail) {
    const c = d.cpmDetail;
    return {
      cpmDetail: {
        create: {
          cpmRate: c.cpmRate,
          pvtLoadingEnabled: c.pvtLoadingEnabled,
          pvtLoadingRate: c.pvtLoadingRate,
          pvtLoadingAmount: c.pvtLoadingAmount,
          pvtLoadingPremium: c.pvtLoadingPremium,
          totalSumInsured: c.totalSumInsured,
          basicPremium: c.basicPremium,
          grossPremium: c.grossPremium,
          phcfAmount: c.phcfAmount,
          itlAmount: c.itlAmount,
          stampDutyAmount: c.stampDutyAmount,
          totalPremium: c.totalPremium,
          equipmentRows: {
            create: c.equipmentRows.map((r) => ({
              equipmentName: r.equipmentName,
              quantity: r.quantity,
              unitValue: r.unitValue,
              totalValue: r.totalValue,
              sortOrder: r.sortOrder,
            })),
          },
        },
      },
    };
  }

  if (d.publicLiabilityDetail) {
    const p = d.publicLiabilityDetail;
    return {
      publicLiabilityDetail: {
        create: {
          anyOnePersonLimit: p.anyOnePersonLimit,
          anyOneOccurrenceLimit: p.anyOneOccurrenceLimit,
          anyOneYearLimit: p.anyOneYearLimit,
          rate: p.rate,
          grossPremium: p.grossPremium,
          phcfAmount: p.phcfAmount,
          itlAmount: p.itlAmount,
          stampDutyAmount: p.stampDutyAmount,
          totalPremium: p.totalPremium,
        },
      },
    };
  }

  if (d.fireDetail) {
    const f = d.fireDetail;
    return {
      fireDetail: {
        create: {
          propertyValue: f.propertyValue,
          rawMaterialValue: f.rawMaterialValue,
          goodsInStockValue: f.goodsInStockValue,
          rate: f.rate,
          earthquakeLoadingRate: f.earthquakeLoadingRate,
          floodLoadingRate: f.floodLoadingRate,
          earthquakeLoadingEnabled: f.earthquakeLoadingEnabled,
          floodLoadingEnabled: f.floodLoadingEnabled,
          pvtLoadingEnabled: f.pvtLoadingEnabled,
          pvtLoadingRate: f.pvtLoadingRate,
          pvtLoadingAmount: f.pvtLoadingAmount,
          pvtLoadingPremium: f.pvtLoadingPremium,
          totalSumInsured: f.totalSumInsured,
          basicPremium: f.basicPremium,
          earthquakeLoadingAmount: f.earthquakeLoadingAmount,
          floodLoadingAmount: f.floodLoadingAmount,
          grossPremium: f.grossPremium,
          phcfAmount: f.phcfAmount,
          itlAmount: f.itlAmount,
          stampDutyAmount: f.stampDutyAmount,
          totalPremium: f.totalPremium,
        },
      },
    };
  }

  if (d.burglaryDetail) {
    const b = d.burglaryDetail;
    return {
      burglaryDetail: {
        create: {
          equipmentValue: b.equipmentValue,
          stockValue: b.stockValue,
          firstLossPercentage: b.firstLossPercentage,
          rate: b.rate,
          totalValue: b.totalValue,
          firstLossSumInsured: b.firstLossSumInsured,
          grossPremium: b.grossPremium,
          phcfAmount: b.phcfAmount,
          itlAmount: b.itlAmount,
          stampDutyAmount: b.stampDutyAmount,
          totalPremium: b.totalPremium,
        },
      },
    };
  }

  if (d.gitSingleDetail) {
    const g = d.gitSingleDetail;
    return {
      gitSingleDetail: {
        create: {
          cargoDescription: g.cargoDescription,
          route: g.route,
          sumInsured: g.sumInsured,
          rate: g.rate,
          pvtLoadingEnabled: g.pvtLoadingEnabled,
          pvtLoadingRate: g.pvtLoadingRate,
          pvtLoadingAmount: g.pvtLoadingAmount,
          pvtLoadingPremium: g.pvtLoadingPremium,
          basicPremium: g.basicPremium,
          grossPremium: g.grossPremium,
          phcfAmount: g.phcfAmount,
          itlAmount: g.itlAmount,
          stampDutyAmount: g.stampDutyAmount,
          totalPremium: g.totalPremium,
        },
      },
    };
  }

  if (d.gitAnnualDetail) {
    const g = d.gitAnnualDetail;
    return {
      gitAnnualDetail: {
        create: {
          cargoDescription: g.cargoDescription,
          singleLimit: g.singleLimit,
          yearLimit: g.yearLimit,
          singleLimitRate: g.singleLimitRate,
          yearLimitRate: g.yearLimitRate,
          pvtLoadingEnabled: g.pvtLoadingEnabled,
          pvtLoadingRate: g.pvtLoadingRate,
          pvtLoadingAmount: g.pvtLoadingAmount,
          pvtLoadingPremium: g.pvtLoadingPremium,
          singlePremium: g.singlePremium,
          yearPremium: g.yearPremium,
          grossPremium: g.grossPremium,
          phcfAmount: g.phcfAmount,
          itlAmount: g.itlAmount,
          stampDutyAmount: g.stampDutyAmount,
          totalPremium: g.totalPremium,
        },
      },
    };
  }

  if (d.marineDetail) {
    const m = d.marineDetail;
    return {
      marineDetail: {
        create: {
          cargoDescription: m.cargoDescription,
          origin: m.origin,
          destination: m.destination,
          marineStampDutyRate: m.marineStampDutyRate,
          totalSumInsured: m.totalSumInsured,
          grossPremium: m.grossPremium,
          phcfAmount: m.phcfAmount,
          itlAmount: m.itlAmount,
          marineStampDutyAmount: m.marineStampDutyAmount,
          totalPremium: m.totalPremium,
          shipmentRows: {
            create: m.shipmentRows.map((r) => ({
              referenceNo: r.referenceNo,
              sumInsured: r.sumInsured,
              rate: r.rate,
              linePremium: r.linePremium,
              sortOrder: r.sortOrder,
            })),
          },
        },
      },
    };
  }

  if (d.motorCompPrivateDetail) {
    const m = d.motorCompPrivateDetail;
    return {
      motorCompPrivateDetail: {
        create: {
          plateNo: m.plateNo,
          vehicleValue: m.vehicleValue,
          periodFrom: m.periodFrom,
          periodTo: m.periodTo,
          excessProtector: m.excessProtector,
          pvt: m.pvt,
          rate: m.rate,
          grossPremium: m.grossPremium,
          phcfAmount: m.phcfAmount,
          itlAmount: m.itlAmount,
          stampDutyAmount: m.stampDutyAmount,
          totalPremium: m.totalPremium,
        },
      },
    };
  }

  if (d.motorCompCommercialDetail) {
    const m = d.motorCompCommercialDetail;
    return {
      motorCompCommercialDetail: {
        create: {
          plateNo: m.plateNo,
          vehicleValue: m.vehicleValue,
          periodFrom: m.periodFrom,
          periodTo: m.periodTo,
          excessProtector: m.excessProtector,
          pvt: m.pvt,
          rate: m.rate,
          grossPremium: m.grossPremium,
          phcfAmount: m.phcfAmount,
          itlAmount: m.itlAmount,
          stampDutyAmount: m.stampDutyAmount,
          totalPremium: m.totalPremium,
        },
      },
    };
  }

  if (d.motorTpoPrivateDetail) {
    const m = d.motorTpoPrivateDetail;
    return {
      motorTpoPrivateDetail: {
        create: {
          plateNo: m.plateNo,
          basePremium: m.basePremium,
          periodFrom: m.periodFrom,
          periodTo: m.periodTo,
          grossPremium: m.grossPremium,
          phcfAmount: m.phcfAmount,
          itlAmount: m.itlAmount,
          stampDutyAmount: m.stampDutyAmount,
          totalPremium: m.totalPremium,
        },
      },
    };
  }

  if (d.motorTpoCommercialDetail) {
    const m = d.motorTpoCommercialDetail;
    return {
      motorTpoCommercialDetail: {
        create: {
          plateNo: m.plateNo,
          loadingCapacity: m.loadingCapacity,
          basePremium: m.basePremium,
          periodFrom: m.periodFrom,
          periodTo: m.periodTo,
          grossPremium: m.grossPremium,
          phcfAmount: m.phcfAmount,
          itlAmount: m.itlAmount,
          stampDutyAmount: m.stampDutyAmount,
          totalPremium: m.totalPremium,
        },
      },
    };
  }

  if (d.gpaDetail) {
    const g = d.gpaDetail;
    return {
      gpaDetail: {
        create: {
          deathLimit: g.deathLimit,
          ptdLimit: g.ptdLimit,
          ttdLimit: g.ttdLimit,
          medicalLimit: g.medicalLimit,
          funeralLimit: g.funeralLimit,
          deathRate: g.deathRate,
          ptdRate: g.ptdRate,
          ttdRate: g.ttdRate,
          medicalRate: g.medicalRate,
          funeralRate: g.funeralRate,
          numberOfPeople: g.numberOfPeople,
          deathPremium: g.deathPremium,
          ptdPremium: g.ptdPremium,
          ttdPremium: g.ttdPremium,
          medicalPremium: g.medicalPremium,
          funeralPremium: g.funeralPremium,
          premiumPerPerson: g.premiumPerPerson,
          grossPremium: g.grossPremium,
          phcfAmount: g.phcfAmount,
          itlAmount: g.itlAmount,
          stampDutyAmount: g.stampDutyAmount,
          totalPremium: g.totalPremium,
        },
      },
    };
  }

  if (d.medicalDetail) {
    const m = d.medicalDetail;
    return {
      medicalDetail: {
        create: {
          inpatientLimit: m.inpatientLimit,
          outpatientLimit: m.outpatientLimit,
          employeeCount: m.employeeCount,
          inpatientPremium: m.inpatientPremium,
          outpatientPremium: m.outpatientPremium,
          subtotal: m.subtotal,
          grossPremium: m.grossPremium,
          phcfAmount: m.phcfAmount,
          itlAmount: m.itlAmount,
          stampDutyAmount: m.stampDutyAmount,
          totalPremium: m.totalPremium,
          categoryRows: {
            create: m.categoryRows.map((r) => ({
              category: r.category,
              employeeCount: r.employeeCount,
              inpatientRate: r.inpatientRate,
              outpatientRate: r.outpatientRate,
              inpatientAmount: r.inpatientAmount,
              outpatientAmount: r.outpatientAmount,
              sortOrder: r.sortOrder,
            })),
          },
        },
      },
    };
  }

  if (d.tenderSecurityDetail) {
    const t = d.tenderSecurityDetail;
    return {
      tenderSecurityDetail: {
        create: {
          projectName: t.projectName,
          bondValue: t.bondValue,
          rate: t.rate,
          grossPremium: t.grossPremium,
          phcfAmount: t.phcfAmount,
          itlAmount: t.itlAmount,
          stampDutyAmount: t.stampDutyAmount,
          totalPremium: t.totalPremium,
        },
      },
    };
  }

  if (d.performanceBondDetail) {
    const p = d.performanceBondDetail;
    return {
      performanceBondDetail: {
        create: {
          projectName: p.projectName,
          bondValue: p.bondValue,
          rate: p.rate,
          grossPremium: p.grossPremium,
          phcfAmount: p.phcfAmount,
          itlAmount: p.itlAmount,
          stampDutyAmount: p.stampDutyAmount,
          totalPremium: p.totalPremium,
        },
      },
    };
  }

  if (d.advancePaymentGuaranteeDetail) {
    const a = d.advancePaymentGuaranteeDetail;
    return {
      advancePaymentGuaranteeDetail: {
        create: {
          projectName: a.projectName,
          bondValue: a.bondValue,
          rate: a.rate,
          grossPremium: a.grossPremium,
          phcfAmount: a.phcfAmount,
          itlAmount: a.itlAmount,
          stampDutyAmount: a.stampDutyAmount,
          totalPremium: a.totalPremium,
        },
      },
    };
  }

  if (d.customsBondDetail) {
    const c = d.customsBondDetail;
    return {
      customsBondDetail: {
        create: {
          grossPremium: c.grossPremium,
          phcfAmount: c.phcfAmount,
          itlAmount: c.itlAmount,
          stampDutyAmount: c.stampDutyAmount,
          totalPremium: c.totalPremium,
          itemRows: {
            create: c.itemRows.map((r) => ({
              bondType: r.bondType,
              bondValue: r.bondValue,
              rate: r.rate,
              premium: r.premium,
              sortOrder: r.sortOrder,
            })),
          },
        },
      },
    };
  }

  // GENERIC sections carry no structured detail row — items alone.
  return {};
}

/**
 * Loads a source Quotation's full section tree and returns a ready-to-use
 * nested-create payload for a new revision, plus the source's own
 * quotationCaseId (so callers never have to re-derive it) and legacy
 * customer/project ids to copy onto the new Quotation row too. Throws if
 * the source quotation does not exist.
 */
export async function deepCopyQuotationSections(sourceQuotationId: string): Promise<{
  source: SourceQuotation;
  sectionCreates: Prisma.QuotationInsuranceSectionCreateWithoutQuotationInput[];
}> {
  const source = await prisma.quotation.findUniqueOrThrow({
    where: { id: sourceQuotationId },
    include: SOURCE_INCLUDE,
  });

  const sectionCreates: Prisma.QuotationInsuranceSectionCreateWithoutQuotationInput[] = source.sections.map(
    (section) => ({
      insuranceType: { connect: { id: section.insuranceTypeId } },
      sectionKind: section.sectionKind,
      insuranceTypeNameSnapshot: section.insuranceTypeNameSnapshot,
      description: section.description,
      phcfRate: section.phcfRate,
      itlRate: section.itlRate,
      stampDuty: section.stampDuty,
      applyPHCF: section.applyPHCF,
      applyITL: section.applyITL,
      applyStampDuty: section.applyStampDuty,
      clausesSnapshot: section.clausesSnapshot,
      exclusionsSnapshot: section.exclusionsSnapshot,
      conditionsSnapshot: section.conditionsSnapshot,
      basePremium: section.basePremium,
      phcfAmount: section.phcfAmount,
      itlAmount: section.itlAmount,
      sectionTotal: section.sectionTotal,
      sortOrder: section.sortOrder,
      items: { create: copyItems(section) },
      ...copySectionDetail(section),
    })
  );

  return { source, sectionCreates };
}
