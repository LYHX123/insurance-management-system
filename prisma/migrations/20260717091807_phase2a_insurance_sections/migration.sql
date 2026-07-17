-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "QuotationSectionKind" ADD VALUE 'PUBLIC_LIABILITY';
ALTER TYPE "QuotationSectionKind" ADD VALUE 'FIRE_AND_PERILS';
ALTER TYPE "QuotationSectionKind" ADD VALUE 'BURGLARY';
ALTER TYPE "QuotationSectionKind" ADD VALUE 'GIT_SINGLE';
ALTER TYPE "QuotationSectionKind" ADD VALUE 'GIT_ANNUAL';
ALTER TYPE "QuotationSectionKind" ADD VALUE 'MARINE_COVER';

-- CreateTable
CREATE TABLE "PublicLiabilitySectionDetail" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "anyOnePersonLimit" DECIMAL(18,2),
    "anyOneOccurrenceLimit" DECIMAL(18,2),
    "anyOneYearLimit" DECIMAL(18,2) NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "grossPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "phcfAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "itlAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "stampDutyAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicLiabilitySectionDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FireSectionDetail" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "propertyValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "rawMaterialValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "goodsInStockValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "rate" DECIMAL(10,4) NOT NULL,
    "earthquakeLoadingRate" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "floodLoadingRate" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "pvtLoadingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pvtLoadingRate" DECIMAL(10,4),
    "pvtLoadingAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalSumInsured" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "basicPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "earthquakeLoadingAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "floodLoadingAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "grossPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "phcfAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "itlAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "stampDutyAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FireSectionDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BurglarySectionDetail" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "equipmentValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "stockValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "firstLossPercentage" DECIMAL(10,4) NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "totalValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "firstLossSumInsured" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "grossPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "phcfAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "itlAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "stampDutyAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BurglarySectionDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitSingleSectionDetail" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "cargoDescription" TEXT NOT NULL,
    "route" TEXT,
    "sumInsured" DECIMAL(18,2) NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "pvtLoadingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pvtLoadingRate" DECIMAL(10,4),
    "pvtLoadingAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "basicPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "grossPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "phcfAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "itlAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "stampDutyAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitSingleSectionDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitAnnualSectionDetail" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "cargoDescription" TEXT NOT NULL,
    "singleLimit" DECIMAL(18,2) NOT NULL,
    "yearLimit" DECIMAL(18,2) NOT NULL,
    "singleLimitRate" DECIMAL(10,4) NOT NULL,
    "yearLimitRate" DECIMAL(10,4) NOT NULL,
    "pvtLoadingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pvtLoadingRate" DECIMAL(10,4),
    "pvtLoadingAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "singlePremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "yearPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "grossPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "phcfAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "itlAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "stampDutyAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitAnnualSectionDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarineSectionDetail" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "cargoDescription" TEXT,
    "origin" TEXT,
    "destination" TEXT,
    "marineStampDutyRate" DECIMAL(10,4) NOT NULL,
    "totalSumInsured" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "grossPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "phcfAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "itlAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "marineStampDutyAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarineSectionDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarineShipmentRow" (
    "id" TEXT NOT NULL,
    "marineDetailId" TEXT NOT NULL,
    "referenceNo" TEXT,
    "sumInsured" DECIMAL(18,2) NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "linePremium" DECIMAL(16,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MarineShipmentRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicLiabilitySectionDetail_sectionId_key" ON "PublicLiabilitySectionDetail"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "FireSectionDetail_sectionId_key" ON "FireSectionDetail"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "BurglarySectionDetail_sectionId_key" ON "BurglarySectionDetail"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "GitSingleSectionDetail_sectionId_key" ON "GitSingleSectionDetail"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "GitAnnualSectionDetail_sectionId_key" ON "GitAnnualSectionDetail"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "MarineSectionDetail_sectionId_key" ON "MarineSectionDetail"("sectionId");

-- CreateIndex
CREATE INDEX "MarineShipmentRow_marineDetailId_idx" ON "MarineShipmentRow"("marineDetailId");

-- AddForeignKey
ALTER TABLE "PublicLiabilitySectionDetail" ADD CONSTRAINT "PublicLiabilitySectionDetail_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuotationInsuranceSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FireSectionDetail" ADD CONSTRAINT "FireSectionDetail_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuotationInsuranceSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BurglarySectionDetail" ADD CONSTRAINT "BurglarySectionDetail_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuotationInsuranceSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitSingleSectionDetail" ADD CONSTRAINT "GitSingleSectionDetail_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuotationInsuranceSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitAnnualSectionDetail" ADD CONSTRAINT "GitAnnualSectionDetail_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuotationInsuranceSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarineSectionDetail" ADD CONSTRAINT "MarineSectionDetail_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuotationInsuranceSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarineShipmentRow" ADD CONSTRAINT "MarineShipmentRow_marineDetailId_fkey" FOREIGN KEY ("marineDetailId") REFERENCES "MarineSectionDetail"("id") ON DELETE CASCADE ON UPDATE CASCADE;
