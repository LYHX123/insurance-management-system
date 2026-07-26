-- CreateEnum
CREATE TYPE "LedgerTransactionType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateTable
CREATE TABLE "LedgerCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "transactionType" "LedgerTransactionType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerManualEntry" (
    "id" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "transactionType" "LedgerTransactionType" NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "paymentMethod" TEXT,
    "referenceNumber" TEXT,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,

    CONSTRAINT "LedgerManualEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LedgerCategory_transactionType_idx" ON "LedgerCategory"("transactionType");

-- CreateIndex
CREATE INDEX "LedgerCategory_isActive_idx" ON "LedgerCategory"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerCategory_name_transactionType_key" ON "LedgerCategory"("name", "transactionType");

-- CreateIndex
CREATE INDEX "LedgerManualEntry_transactionDate_idx" ON "LedgerManualEntry"("transactionDate");

-- CreateIndex
CREATE INDEX "LedgerManualEntry_transactionType_idx" ON "LedgerManualEntry"("transactionType");

-- CreateIndex
CREATE INDEX "LedgerManualEntry_categoryId_idx" ON "LedgerManualEntry"("categoryId");

-- CreateIndex
CREATE INDEX "LedgerManualEntry_cancelledAt_idx" ON "LedgerManualEntry"("cancelledAt");

-- CreateIndex
CREATE INDEX "LedgerManualEntry_createdById_idx" ON "LedgerManualEntry"("createdById");

-- AddForeignKey
ALTER TABLE "LedgerManualEntry" ADD CONSTRAINT "LedgerManualEntry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "LedgerCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
