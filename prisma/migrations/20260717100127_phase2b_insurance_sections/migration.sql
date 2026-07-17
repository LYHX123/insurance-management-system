-- CreateEnum
CREATE TYPE "MedicalFamilyCategory" AS ENUM ('M', 'M+1', 'M+2', 'M+3', 'M+4', 'M+5');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "QuotationSectionKind" ADD VALUE 'MOTOR_COMP_PRIVATE';
ALTER TYPE "QuotationSectionKind" ADD VALUE 'MOTOR_COMP_COMMERCIAL';
ALTER TYPE "QuotationSectionKind" ADD VALUE 'MOTOR_TPO_PRIVATE';
ALTER TYPE "QuotationSectionKind" ADD VALUE 'MOTOR_TPO_COMMERCIAL';
ALTER TYPE "QuotationSectionKind" ADD VALUE 'GROUP_PERSONAL_ACCIDENT';
ALTER TYPE "QuotationSectionKind" ADD VALUE 'GROUP_MEDICAL';
ALTER TYPE "QuotationSectionKind" ADD VALUE 'TENDER_SECURITY';
ALTER TYPE "QuotationSectionKind" ADD VALUE 'PERFORMANCE_BOND';
ALTER TYPE "QuotationSectionKind" ADD VALUE 'ADVANCE_PAYMENT_GUARANTEE';
ALTER TYPE "QuotationSectionKind" ADD VALUE 'CUSTOMS_BOND';

-- CreateTable
CREATE TABLE "MotorCompPrivateSectionDetail" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "plateNo" TEXT NOT NULL,
    "vehicleValue" DECIMAL(18,2) NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "excessProtector" TEXT,
    "pvt" TEXT,
    "rate" DECIMAL(10,4) NOT NULL,
    "grossPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "phcfAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "itlAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "stampDutyAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MotorCompPrivateSectionDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotorCompCommercialSectionDetail" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "plateNo" TEXT NOT NULL,
    "vehicleValue" DECIMAL(18,2) NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "excessProtector" TEXT,
    "pvt" TEXT,
    "rate" DECIMAL(10,4) NOT NULL,
    "grossPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "phcfAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "itlAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "stampDutyAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MotorCompCommercialSectionDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotorTpoPrivateSectionDetail" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "plateNo" TEXT NOT NULL,
    "basePremium" DECIMAL(16,2) NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "grossPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "phcfAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "itlAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "stampDutyAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MotorTpoPrivateSectionDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotorTpoCommercialSectionDetail" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "plateNo" TEXT NOT NULL,
    "loadingCapacity" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "basePremium" DECIMAL(16,2) NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "grossPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "phcfAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "itlAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "stampDutyAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MotorTpoCommercialSectionDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GpaSectionDetail" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "deathLimit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ptdLimit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ttdLimit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "medicalLimit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "funeralLimit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "deathRate" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "ptdRate" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "ttdRate" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "medicalRate" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "funeralRate" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "numberOfPeople" INTEGER NOT NULL DEFAULT 0,
    "deathPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "ptdPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "ttdPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "medicalPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "funeralPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "premiumPerPerson" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "grossPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "phcfAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "itlAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "stampDutyAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GpaSectionDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalSectionDetail" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "inpatientLimit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "outpatientLimit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "inpatientPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "outpatientPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "grossPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "phcfAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "itlAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "stampDutyAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalSectionDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalFamilyCategoryRow" (
    "id" TEXT NOT NULL,
    "medicalDetailId" TEXT NOT NULL,
    "category" "MedicalFamilyCategory" NOT NULL,
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "inpatientRate" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "outpatientRate" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "inpatientAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "outpatientAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MedicalFamilyCategoryRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderSecuritySectionDetail" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "bondValue" DECIMAL(18,2) NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "grossPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "phcfAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "itlAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "stampDutyAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenderSecuritySectionDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceBondSectionDetail" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "bondValue" DECIMAL(18,2) NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "grossPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "phcfAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "itlAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "stampDutyAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceBondSectionDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvancePaymentGuaranteeSectionDetail" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "bondValue" DECIMAL(18,2) NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "grossPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "phcfAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "itlAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "stampDutyAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvancePaymentGuaranteeSectionDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomsBondSectionDetail" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "grossPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "phcfAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "itlAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "stampDutyAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomsBondSectionDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomsBondItemRow" (
    "id" TEXT NOT NULL,
    "customsBondDetailId" TEXT NOT NULL,
    "bondType" TEXT NOT NULL,
    "bondValue" DECIMAL(18,2) NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "premium" DECIMAL(16,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CustomsBondItemRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MotorCompPrivateSectionDetail_sectionId_key" ON "MotorCompPrivateSectionDetail"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "MotorCompCommercialSectionDetail_sectionId_key" ON "MotorCompCommercialSectionDetail"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "MotorTpoPrivateSectionDetail_sectionId_key" ON "MotorTpoPrivateSectionDetail"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "MotorTpoCommercialSectionDetail_sectionId_key" ON "MotorTpoCommercialSectionDetail"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "GpaSectionDetail_sectionId_key" ON "GpaSectionDetail"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalSectionDetail_sectionId_key" ON "MedicalSectionDetail"("sectionId");

-- CreateIndex
CREATE INDEX "MedicalFamilyCategoryRow_medicalDetailId_idx" ON "MedicalFamilyCategoryRow"("medicalDetailId");

-- CreateIndex
CREATE UNIQUE INDEX "TenderSecuritySectionDetail_sectionId_key" ON "TenderSecuritySectionDetail"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceBondSectionDetail_sectionId_key" ON "PerformanceBondSectionDetail"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "AdvancePaymentGuaranteeSectionDetail_sectionId_key" ON "AdvancePaymentGuaranteeSectionDetail"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomsBondSectionDetail_sectionId_key" ON "CustomsBondSectionDetail"("sectionId");

-- CreateIndex
CREATE INDEX "CustomsBondItemRow_customsBondDetailId_idx" ON "CustomsBondItemRow"("customsBondDetailId");

-- AddForeignKey
ALTER TABLE "MotorCompPrivateSectionDetail" ADD CONSTRAINT "MotorCompPrivateSectionDetail_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuotationInsuranceSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotorCompCommercialSectionDetail" ADD CONSTRAINT "MotorCompCommercialSectionDetail_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuotationInsuranceSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotorTpoPrivateSectionDetail" ADD CONSTRAINT "MotorTpoPrivateSectionDetail_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuotationInsuranceSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotorTpoCommercialSectionDetail" ADD CONSTRAINT "MotorTpoCommercialSectionDetail_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuotationInsuranceSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpaSectionDetail" ADD CONSTRAINT "GpaSectionDetail_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuotationInsuranceSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalSectionDetail" ADD CONSTRAINT "MedicalSectionDetail_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuotationInsuranceSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalFamilyCategoryRow" ADD CONSTRAINT "MedicalFamilyCategoryRow_medicalDetailId_fkey" FOREIGN KEY ("medicalDetailId") REFERENCES "MedicalSectionDetail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderSecuritySectionDetail" ADD CONSTRAINT "TenderSecuritySectionDetail_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuotationInsuranceSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceBondSectionDetail" ADD CONSTRAINT "PerformanceBondSectionDetail_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuotationInsuranceSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvancePaymentGuaranteeSectionDetail" ADD CONSTRAINT "AdvancePaymentGuaranteeSectionDetail_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuotationInsuranceSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomsBondSectionDetail" ADD CONSTRAINT "CustomsBondSectionDetail_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuotationInsuranceSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomsBondItemRow" ADD CONSTRAINT "CustomsBondItemRow_customsBondDetailId_fkey" FOREIGN KEY ("customsBondDetailId") REFERENCES "CustomsBondSectionDetail"("id") ON DELETE CASCADE ON UPDATE CASCADE;
