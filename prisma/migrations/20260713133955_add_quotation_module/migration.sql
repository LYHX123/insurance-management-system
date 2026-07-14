-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'ISSUED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CalculationMethod" AS ENUM ('PERCENTAGE', 'FIXED_PREMIUM', 'MANUAL_PREMIUM');

-- CreateTable
CREATE TABLE "InsuranceType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "defaultPHCFRate" DECIMAL(10,4) NOT NULL DEFAULT 0.25,
    "defaultITLRate" DECIMAL(10,4) NOT NULL DEFAULT 0.20,
    "defaultStampDuty" DECIMAL(12,2) NOT NULL DEFAULT 40,
    "applyPHCF" BOOLEAN NOT NULL DEFAULT true,
    "applyITL" BOOLEAN NOT NULL DEFAULT true,
    "applyStampDuty" BOOLEAN NOT NULL DEFAULT true,
    "defaultClauses" TEXT,
    "defaultExclusions" TEXT,
    "defaultConditions" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsuranceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationNumberCounter" (
    "yearMonth" TEXT NOT NULL,
    "lastSequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuotationNumberCounter_pkey" PRIMARY KEY ("yearMonth")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "quotationNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "projectId" TEXT,
    "quotationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "internalNotes" TEXT,
    "subtotalPremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalPHCF" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalITL" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalStampDuty" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationInsuranceSection" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "insuranceTypeId" TEXT NOT NULL,
    "insuranceTypeNameSnapshot" TEXT NOT NULL,
    "description" TEXT,
    "phcfRate" DECIMAL(10,4) NOT NULL,
    "itlRate" DECIMAL(10,4) NOT NULL,
    "stampDuty" DECIMAL(12,2) NOT NULL,
    "applyPHCF" BOOLEAN NOT NULL,
    "applyITL" BOOLEAN NOT NULL,
    "applyStampDuty" BOOLEAN NOT NULL,
    "clausesSnapshot" TEXT,
    "exclusionsSnapshot" TEXT,
    "conditionsSnapshot" TEXT,
    "basePremium" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "phcfAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "itlAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "sectionTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotationInsuranceSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationCoverageItem" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "insuredContent" TEXT NOT NULL,
    "sumInsured" DECIMAL(18,2),
    "rate" DECIMAL(10,4),
    "calculationMethod" "CalculationMethod" NOT NULL,
    "premium" DECIMAL(16,2) NOT NULL,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotationCoverageItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceType_code_key" ON "InsuranceType"("code");

-- CreateIndex
CREATE INDEX "InsuranceType_active_idx" ON "InsuranceType"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_quotationNumber_key" ON "Quotation"("quotationNumber");

-- CreateIndex
CREATE INDEX "Quotation_customerId_idx" ON "Quotation"("customerId");

-- CreateIndex
CREATE INDEX "Quotation_projectId_idx" ON "Quotation"("projectId");

-- CreateIndex
CREATE INDEX "Quotation_status_idx" ON "Quotation"("status");

-- CreateIndex
CREATE INDEX "QuotationInsuranceSection_quotationId_idx" ON "QuotationInsuranceSection"("quotationId");

-- CreateIndex
CREATE INDEX "QuotationInsuranceSection_insuranceTypeId_idx" ON "QuotationInsuranceSection"("insuranceTypeId");

-- CreateIndex
CREATE INDEX "QuotationCoverageItem_sectionId_idx" ON "QuotationCoverageItem"("sectionId");

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CustomerProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationInsuranceSection" ADD CONSTRAINT "QuotationInsuranceSection_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationInsuranceSection" ADD CONSTRAINT "QuotationInsuranceSection_insuranceTypeId_fkey" FOREIGN KEY ("insuranceTypeId") REFERENCES "InsuranceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationCoverageItem" ADD CONSTRAINT "QuotationCoverageItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuotationInsuranceSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
