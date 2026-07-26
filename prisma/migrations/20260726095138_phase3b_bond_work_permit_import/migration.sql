-- CreateEnum
CREATE TYPE "BondType" AS ENUM ('TENDER_BOND', 'PERFORMANCE_BOND', 'ADVANCE_PAYMENT_GUARANTEE', 'CUSTOM_BOND');

-- CreateEnum
CREATE TYPE "WorkPermitType" AS ENUM ('CLASS_D', 'CLASS_G', 'SPECIAL_PASS', 'DEPENDANT_PASS', 'OTHER');

-- AlterTable
ALTER TABLE "PolicyImportRow" ADD COLUMN     "matchedProjectId" TEXT,
ADD COLUMN     "policyNumber" TEXT,
ADD COLUMN     "projectNameRaw" TEXT;

-- CreateTable
CREATE TABLE "BondPolicyDetail" (
    "id" TEXT NOT NULL,
    "policyRecordId" TEXT NOT NULL,
    "bondType" "BondType" NOT NULL,
    "bondAmount" DECIMAL(16,2) NOT NULL,
    "customBondType" TEXT,
    "policyNumber" TEXT,

    CONSTRAINT "BondPolicyDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkPermitPolicyDetail" (
    "id" TEXT NOT NULL,
    "policyRecordId" TEXT NOT NULL,
    "permitType" "WorkPermitType" NOT NULL,
    "agent" TEXT NOT NULL,
    "otherPermitType" TEXT,
    "permitNumber" TEXT,

    CONSTRAINT "WorkPermitPolicyDetail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BondPolicyDetail_policyRecordId_key" ON "BondPolicyDetail"("policyRecordId");

-- CreateIndex
CREATE INDEX "BondPolicyDetail_bondType_idx" ON "BondPolicyDetail"("bondType");

-- CreateIndex
CREATE UNIQUE INDEX "WorkPermitPolicyDetail_policyRecordId_key" ON "WorkPermitPolicyDetail"("policyRecordId");

-- CreateIndex
CREATE INDEX "WorkPermitPolicyDetail_permitType_idx" ON "WorkPermitPolicyDetail"("permitType");

-- AddForeignKey
ALTER TABLE "BondPolicyDetail" ADD CONSTRAINT "BondPolicyDetail_policyRecordId_fkey" FOREIGN KEY ("policyRecordId") REFERENCES "PolicyRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPermitPolicyDetail" ADD CONSTRAINT "WorkPermitPolicyDetail_policyRecordId_fkey" FOREIGN KEY ("policyRecordId") REFERENCES "PolicyRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
