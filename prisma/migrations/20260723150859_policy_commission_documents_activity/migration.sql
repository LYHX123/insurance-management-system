-- CreateEnum
CREATE TYPE "PolicyDocumentType" AS ENUM ('POLICY_SCHEDULE', 'CERTIFICATE', 'STICKER', 'DEBIT_NOTE', 'RECEIPT', 'ENDORSEMENT', 'CANCELLATION', 'OTHER');

-- CreateEnum
CREATE TYPE "PolicyDocumentStorageProvider" AS ENUM ('LOCAL', 'DROPBOX');

-- CreateEnum
CREATE TYPE "PolicyActivityActionType" AS ENUM ('POLICY_CREATED', 'POLICY_UPDATED', 'POLICY_CANCELLED', 'CUSTOMER_RECEIPT_ADDED', 'INSURER_PAYMENT_ADDED', 'COMMISSION_UPDATED', 'DOCUMENT_UPLOADED', 'DOCUMENT_DELETED', 'BALANCE_VERIFIED', 'HISTORICAL_POLICY_IMPORTED');

-- AlterTable
ALTER TABLE "PolicyRecord" ADD COLUMN     "commissionAmount" DECIMAL(16,2);

-- CreateTable
CREATE TABLE "PolicyDocument" (
    "id" TEXT NOT NULL,
    "policyRecordId" TEXT NOT NULL,
    "documentType" "PolicyDocumentType" NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "storedFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "storageProvider" "PolicyDocumentStorageProvider" NOT NULL DEFAULT 'LOCAL',
    "storagePath" TEXT NOT NULL,
    "externalFileId" TEXT,
    "externalPath" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "notes" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyActivity" (
    "id" TEXT NOT NULL,
    "policyRecordId" TEXT NOT NULL,
    "actionType" "PolicyActivityActionType" NOT NULL,
    "summary" TEXT NOT NULL,
    "details" TEXT,
    "performedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PolicyDocument_policyRecordId_idx" ON "PolicyDocument"("policyRecordId");

-- CreateIndex
CREATE INDEX "PolicyDocument_documentType_idx" ON "PolicyDocument"("documentType");

-- CreateIndex
CREATE INDEX "PolicyActivity_policyRecordId_idx" ON "PolicyActivity"("policyRecordId");

-- CreateIndex
CREATE INDEX "PolicyActivity_createdAt_idx" ON "PolicyActivity"("createdAt");

-- AddForeignKey
ALTER TABLE "PolicyDocument" ADD CONSTRAINT "PolicyDocument_policyRecordId_fkey" FOREIGN KEY ("policyRecordId") REFERENCES "PolicyRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyActivity" ADD CONSTRAINT "PolicyActivity_policyRecordId_fkey" FOREIGN KEY ("policyRecordId") REFERENCES "PolicyRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

