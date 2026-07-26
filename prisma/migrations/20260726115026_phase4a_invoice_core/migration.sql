-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PolicyActivityActionType" ADD VALUE 'INVOICE_ISSUED';
ALTER TYPE "PolicyActivityActionType" ADD VALUE 'INVOICE_CANCELLED';

-- CreateTable
CREATE TABLE "InvoiceNumberCounter" (
    "yearMonth" TEXT NOT NULL,
    "lastSequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceNumberCounter_pkey" PRIMARY KEY ("yearMonth")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "totalPremium" DECIMAL(16,2) NOT NULL,
    "generatedFileName" TEXT,
    "generatedStoragePath" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "policyRecordId" TEXT NOT NULL,
    "itemNumber" INTEGER NOT NULL,
    "policyClassSnapshot" TEXT NOT NULL,
    "policyNumberSnapshot" TEXT NOT NULL,
    "premiumSnapshot" DECIMAL(16,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_invoiceDate_idx" ON "Invoice"("invoiceDate");

-- CreateIndex
CREATE INDEX "InvoiceItem_policyRecordId_idx" ON "InvoiceItem"("policyRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceItem_invoiceId_policyRecordId_key" ON "InvoiceItem"("invoiceId", "policyRecordId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_policyRecordId_fkey" FOREIGN KEY ("policyRecordId") REFERENCES "PolicyRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
