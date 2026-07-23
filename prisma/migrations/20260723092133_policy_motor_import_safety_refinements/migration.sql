/*
  Warnings:

  - The values [DUPLICATE] on the enum `PolicyImportRowStatus` will be removed.
    Replaced by two more precise values, POSSIBLE_DUPLICATE and
    EXACT_DUPLICATE (see PolicyImportRowStatus's schema doc comment). Safe:
    the PolicyImportRow table has zero rows at the time this migration was
    written (Phase 1A's historical import has never been confirmed yet), so
    no existing row uses the old value.

*/
-- CreateEnum
CREATE TYPE "CustomerSource" AS ENUM ('MANUAL', 'HISTORICAL_IMPORT');

-- CreateEnum
CREATE TYPE "PolicyBalanceVerificationStatus" AS ENUM ('VERIFIED', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "PolicyBalanceWarningReason" AS ENUM ('BROKEN_SOURCE_FORMULA', 'BLANK_SOURCE_BALANCE', 'OTHER_UNREADABLE_BALANCE');

-- AlterEnum
BEGIN;
CREATE TYPE "PolicyImportRowStatus_new" AS ENUM ('READY', 'WARNING', 'POSSIBLE_DUPLICATE', 'EXACT_DUPLICATE', 'ERROR', 'IMPORTED', 'SKIPPED');
ALTER TABLE "public"."PolicyImportRow" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "PolicyImportRow" ALTER COLUMN "status" TYPE "PolicyImportRowStatus_new" USING ("status"::text::"PolicyImportRowStatus_new");
ALTER TYPE "PolicyImportRowStatus" RENAME TO "PolicyImportRowStatus_old";
ALTER TYPE "PolicyImportRowStatus_new" RENAME TO "PolicyImportRowStatus";
DROP TYPE "public"."PolicyImportRowStatus_old";
ALTER TABLE "PolicyImportRow" ALTER COLUMN "status" SET DEFAULT 'READY';
COMMIT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "importBatchId" TEXT,
ADD COLUMN     "isIncomplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "originalRowNumber" INTEGER,
ADD COLUMN     "source" "CustomerSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "sourceSheet" TEXT;

-- AlterTable
ALTER TABLE "PolicyImportBatch" ADD COLUMN     "sourceFileHash" TEXT;

-- AlterTable
ALTER TABLE "PolicyImportRow" ADD COLUMN     "clientBalanceVerification" "PolicyBalanceVerificationStatus" NOT NULL DEFAULT 'VERIFIED',
ADD COLUMN     "clientBalanceWarningReason" "PolicyBalanceWarningReason",
ADD COLUMN     "duplicateOfPolicyRecordId" TEXT,
ADD COLUMN     "insurerBalanceVerification" "PolicyBalanceVerificationStatus" NOT NULL DEFAULT 'VERIFIED',
ADD COLUMN     "insurerBalanceWarningReason" "PolicyBalanceWarningReason",
ADD COLUMN     "originalClientBalanceRaw" TEXT,
ADD COLUMN     "originalInsurerBalanceRaw" TEXT;

-- AlterTable
ALTER TABLE "PolicyRecord" ADD COLUMN     "clientBalanceVerification" "PolicyBalanceVerificationStatus" NOT NULL DEFAULT 'VERIFIED',
ADD COLUMN     "clientBalanceWarningReason" "PolicyBalanceWarningReason",
ADD COLUMN     "insurerBalanceVerification" "PolicyBalanceVerificationStatus" NOT NULL DEFAULT 'VERIFIED',
ADD COLUMN     "insurerBalanceWarningReason" "PolicyBalanceWarningReason";

-- CreateIndex
CREATE INDEX "Customer_importBatchId_idx" ON "Customer"("importBatchId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "PolicyImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
