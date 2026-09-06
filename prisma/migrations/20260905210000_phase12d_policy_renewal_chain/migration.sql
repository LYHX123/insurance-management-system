-- CreateEnum
CREATE TYPE "PolicyRenewalDecision" AS ENUM ('PENDING', 'RENEWED', 'NOT_RENEWED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PolicyActivityActionType" ADD VALUE 'POLICY_RENEWED';
ALTER TYPE "PolicyActivityActionType" ADD VALUE 'POLICY_NOT_RENEWED';

-- AlterTable
ALTER TABLE "PolicyRecord" ADD COLUMN     "renewalDecision" "PolicyRenewalDecision",
ADD COLUMN     "renewalIndex" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "renewedFromId" TEXT,
ADD COLUMN     "rootPolicyId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PolicyRecord_renewedFromId_key" ON "PolicyRecord"("renewedFromId");

-- CreateIndex
CREATE INDEX "PolicyRecord_rootPolicyId_idx" ON "PolicyRecord"("rootPolicyId");

-- CreateIndex
CREATE INDEX "PolicyRecord_renewalDecision_idx" ON "PolicyRecord"("renewalDecision");

-- AddForeignKey
ALTER TABLE "PolicyRecord" ADD CONSTRAINT "PolicyRecord_renewedFromId_fkey" FOREIGN KEY ("renewedFromId") REFERENCES "PolicyRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRecord" ADD CONSTRAINT "PolicyRecord_rootPolicyId_fkey" FOREIGN KEY ("rootPolicyId") REFERENCES "PolicyRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

