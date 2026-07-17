-- CreateEnum
CREATE TYPE "QuotationSectionKind" AS ENUM ('GENERIC', 'CAR_PACKAGE', 'WIBA', 'EMPLOYERS_LIABILITY', 'CPM_STANDALONE');

-- AlterTable
ALTER TABLE "QuotationInsuranceSection" ADD COLUMN     "sectionKind" "QuotationSectionKind" NOT NULL DEFAULT 'GENERIC';

-- CreateTable
CREATE TABLE "CarSectionDetail" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "projectName" TEXT,
    "contractValue" DECIMAL(18,2) NOT NULL,
    "carRate" DECIMAL(10,4) NOT NULL,
    "contractPeriodFrom" TIMESTAMP(3) NOT NULL,
    "contractPeriodTo" TIMESTAMP(3) NOT NULL,
    "cpmValue" DECIMAL(18,2),
    "cpmRate" DECIMAL(10,4),
    "tplAnyOneClaim" DECIMAL(18,2),
    "tplAnyOneEvent" DECIMAL(18,2),
    "tplAnyOnePeriod" DECIMAL(18,2),
    "tplRate" DECIMAL(10,4),
    "tplComplimentary" BOOLEAN NOT NULL DEFAULT false,
    "pvtLoadingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pvtLoadingRate" DECIMAL(10,4),
    "pvtLoadingAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "carBasicPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "carCpmPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "carMainGrossPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "carMainPhcf" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "carMainItl" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "carMainStampDuty" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "carMainTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "tplGrossPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "tplPhcf" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "tplItl" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "tplStampDuty" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "tplTotalPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarSectionDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WibaSectionDetail" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "wibaRate" DECIMAL(10,4) NOT NULL,
    "totalEmployeeCount" INTEGER NOT NULL DEFAULT 0,
    "totalAnnualWages" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "grossPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "phcfAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "itlAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "stampDutyAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WibaSectionDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WibaPayrollRow" (
    "id" TEXT NOT NULL,
    "wibaDetailId" TEXT NOT NULL,
    "occupation" TEXT NOT NULL,
    "employeeCount" INTEGER NOT NULL,
    "annualWages" DECIMAL(18,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WibaPayrollRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElSectionDetail" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "linkedWibaGrossPremium" DECIMAL(16,2) NOT NULL,
    "grossPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "phcfAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "itlAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "stampDutyAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ElSectionDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CpmSectionDetail" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "cpmRate" DECIMAL(10,4) NOT NULL,
    "pvtLoadingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pvtLoadingRate" DECIMAL(10,4),
    "pvtLoadingAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalSumInsured" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "basicPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "grossPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "phcfAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "itlAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "stampDutyAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CpmSectionDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CpmEquipmentRow" (
    "id" TEXT NOT NULL,
    "cpmDetailId" TEXT NOT NULL,
    "equipmentName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitValue" DECIMAL(18,2) NOT NULL,
    "totalValue" DECIMAL(18,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CpmEquipmentRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CarSectionDetail_sectionId_key" ON "CarSectionDetail"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "WibaSectionDetail_sectionId_key" ON "WibaSectionDetail"("sectionId");

-- CreateIndex
CREATE INDEX "WibaPayrollRow_wibaDetailId_idx" ON "WibaPayrollRow"("wibaDetailId");

-- CreateIndex
CREATE UNIQUE INDEX "ElSectionDetail_sectionId_key" ON "ElSectionDetail"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "CpmSectionDetail_sectionId_key" ON "CpmSectionDetail"("sectionId");

-- CreateIndex
CREATE INDEX "CpmEquipmentRow_cpmDetailId_idx" ON "CpmEquipmentRow"("cpmDetailId");

-- AddForeignKey
ALTER TABLE "CarSectionDetail" ADD CONSTRAINT "CarSectionDetail_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuotationInsuranceSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WibaSectionDetail" ADD CONSTRAINT "WibaSectionDetail_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuotationInsuranceSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WibaPayrollRow" ADD CONSTRAINT "WibaPayrollRow_wibaDetailId_fkey" FOREIGN KEY ("wibaDetailId") REFERENCES "WibaSectionDetail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElSectionDetail" ADD CONSTRAINT "ElSectionDetail_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuotationInsuranceSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CpmSectionDetail" ADD CONSTRAINT "CpmSectionDetail_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuotationInsuranceSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CpmEquipmentRow" ADD CONSTRAINT "CpmEquipmentRow_cpmDetailId_fkey" FOREIGN KEY ("cpmDetailId") REFERENCES "CpmSectionDetail"("id") ON DELETE CASCADE ON UPDATE CASCADE;
