-- CreateEnum
CREATE TYPE "PolicyCategory" AS ENUM ('MOTOR', 'NON_MOTOR', 'BOND', 'WORK_PERMIT');

-- CreateEnum
CREATE TYPE "PolicyBusinessStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'RENEWED');

-- CreateEnum
CREATE TYPE "PolicyRecordSource" AS ENUM ('MANUAL', 'HISTORICAL_IMPORT');

-- CreateEnum
CREATE TYPE "PolicyPaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'FULLY_PAID', 'OVERPAID');

-- CreateEnum
CREATE TYPE "PolicyImportBatchStatus" AS ENUM ('UPLOADED', 'PREVIEWED', 'CONFIRMED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PolicyImportRowStatus" AS ENUM ('READY', 'WARNING', 'DUPLICATE', 'ERROR', 'IMPORTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "PolicyCustomerMatchStatus" AS ENUM ('MATCHED', 'POSSIBLE', 'MANUAL', 'UNMATCHED');

-- CreateTable
CREATE TABLE "PolicyRecordNumberCounter" (
    "key" TEXT NOT NULL,
    "lastSequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PolicyRecordNumberCounter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PolicyRecord" (
    "id" TEXT NOT NULL,
    "recordNumber" TEXT NOT NULL,
    "category" "PolicyCategory" NOT NULL,
    "processingDate" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "projectId" TEXT,
    "insurerName" TEXT,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "businessStatus" "PolicyBusinessStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "customerPremium" DECIMAL(16,2) NOT NULL,
    "insurerCost" DECIMAL(16,2) NOT NULL,
    "commissionReceived" BOOLEAN NOT NULL DEFAULT false,
    "commissionReceivedDate" TIMESTAMP(3),
    "historicalNetProfit" DECIMAL(16,2),
    "source" "PolicyRecordSource" NOT NULL DEFAULT 'MANUAL',
    "importBatchId" TEXT,
    "sourceSheet" TEXT,
    "originalRowNumber" INTEGER,
    "remarks" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PolicyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotorPolicyDetail" (
    "id" TEXT NOT NULL,
    "policyRecordId" TEXT NOT NULL,
    "insuranceType" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "vehicleValue" DECIMAL(18,2),
    "policyNumber" TEXT,
    "vehicleMake" TEXT,
    "vehicleModel" TEXT,

    CONSTRAINT "MotorPolicyDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyCustomerReceipt" (
    "id" TEXT NOT NULL,
    "policyRecordId" TEXT NOT NULL,
    "receiptDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "paymentMethod" TEXT,
    "referenceNumber" TEXT,
    "notes" TEXT,
    "source" "PolicyRecordSource" NOT NULL DEFAULT 'MANUAL',
    "originalRowNumber" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PolicyCustomerReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyProviderPayment" (
    "id" TEXT NOT NULL,
    "policyRecordId" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "paymentMethod" TEXT,
    "referenceNumber" TEXT,
    "notes" TEXT,
    "source" "PolicyRecordSource" NOT NULL DEFAULT 'MANUAL',
    "originalRowNumber" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PolicyProviderPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyImportBatch" (
    "id" TEXT NOT NULL,
    "category" "PolicyCategory" NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "sourceSheet" TEXT NOT NULL,
    "status" "PolicyImportBatchStatus" NOT NULL DEFAULT 'UPLOADED',
    "totalRows" INTEGER NOT NULL,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PolicyImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyImportRow" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "originalRowNumber" INTEGER NOT NULL,
    "processingDate" TIMESTAMP(3),
    "customerNameRaw" TEXT,
    "matchedCustomerId" TEXT,
    "customerMatchStatus" "PolicyCustomerMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "insuranceType" TEXT,
    "registrationNumber" TEXT,
    "insurerName" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "insurerCost" DECIMAL(16,2),
    "amountPaidToInsurer" DECIMAL(16,2),
    "insurerPaymentDate" TIMESTAMP(3),
    "calculatedInsurerBalance" DECIMAL(16,2),
    "originalInsurerBalance" DECIMAL(16,2),
    "clientPremium" DECIMAL(16,2),
    "amountReceivedFromClient" DECIMAL(16,2),
    "clientReceiptDate" TIMESTAMP(3),
    "calculatedClientBalance" DECIMAL(16,2),
    "originalClientBalance" DECIMAL(16,2),
    "vehicleValue" DECIMAL(18,2),
    "commissionReceived" BOOLEAN NOT NULL DEFAULT false,
    "commissionReceivedDate" TIMESTAMP(3),
    "historicalNetProfit" DECIMAL(16,2),
    "remarks" TEXT,
    "duplicateOfRowNumbers" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "status" "PolicyImportRowStatus" NOT NULL DEFAULT 'READY',
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "includeInImport" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PolicyRecord_recordNumber_key" ON "PolicyRecord"("recordNumber");

-- CreateIndex
CREATE INDEX "PolicyRecord_category_idx" ON "PolicyRecord"("category");

-- CreateIndex
CREATE INDEX "PolicyRecord_customerId_idx" ON "PolicyRecord"("customerId");

-- CreateIndex
CREATE INDEX "PolicyRecord_projectId_idx" ON "PolicyRecord"("projectId");

-- CreateIndex
CREATE INDEX "PolicyRecord_businessStatus_idx" ON "PolicyRecord"("businessStatus");

-- CreateIndex
CREATE INDEX "PolicyRecord_expiryDate_idx" ON "PolicyRecord"("expiryDate");

-- CreateIndex
CREATE INDEX "PolicyRecord_importBatchId_idx" ON "PolicyRecord"("importBatchId");

-- CreateIndex
CREATE INDEX "PolicyRecord_deletedAt_idx" ON "PolicyRecord"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MotorPolicyDetail_policyRecordId_key" ON "MotorPolicyDetail"("policyRecordId");

-- CreateIndex
CREATE INDEX "MotorPolicyDetail_registrationNumber_idx" ON "MotorPolicyDetail"("registrationNumber");

-- CreateIndex
CREATE INDEX "MotorPolicyDetail_insuranceType_idx" ON "MotorPolicyDetail"("insuranceType");

-- CreateIndex
CREATE INDEX "PolicyCustomerReceipt_policyRecordId_idx" ON "PolicyCustomerReceipt"("policyRecordId");

-- CreateIndex
CREATE INDEX "PolicyCustomerReceipt_deletedAt_idx" ON "PolicyCustomerReceipt"("deletedAt");

-- CreateIndex
CREATE INDEX "PolicyProviderPayment_policyRecordId_idx" ON "PolicyProviderPayment"("policyRecordId");

-- CreateIndex
CREATE INDEX "PolicyProviderPayment_deletedAt_idx" ON "PolicyProviderPayment"("deletedAt");

-- CreateIndex
CREATE INDEX "PolicyImportBatch_category_idx" ON "PolicyImportBatch"("category");

-- CreateIndex
CREATE INDEX "PolicyImportBatch_status_idx" ON "PolicyImportBatch"("status");

-- CreateIndex
CREATE INDEX "PolicyImportRow_importBatchId_idx" ON "PolicyImportRow"("importBatchId");

-- CreateIndex
CREATE INDEX "PolicyImportRow_status_idx" ON "PolicyImportRow"("status");

-- AddForeignKey
ALTER TABLE "PolicyRecord" ADD CONSTRAINT "PolicyRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRecord" ADD CONSTRAINT "PolicyRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CustomerProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRecord" ADD CONSTRAINT "PolicyRecord_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "PolicyImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotorPolicyDetail" ADD CONSTRAINT "MotorPolicyDetail_policyRecordId_fkey" FOREIGN KEY ("policyRecordId") REFERENCES "PolicyRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyCustomerReceipt" ADD CONSTRAINT "PolicyCustomerReceipt_policyRecordId_fkey" FOREIGN KEY ("policyRecordId") REFERENCES "PolicyRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyProviderPayment" ADD CONSTRAINT "PolicyProviderPayment_policyRecordId_fkey" FOREIGN KEY ("policyRecordId") REFERENCES "PolicyRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyImportRow" ADD CONSTRAINT "PolicyImportRow_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "PolicyImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
