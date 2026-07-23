-- AlterEnum
ALTER TYPE "PolicyImportBatchStatus" ADD VALUE 'PARTIALLY_IMPORTED';

-- AlterTable
ALTER TABLE "PolicyImportRow" ADD COLUMN     "isSelectedForImport" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PolicyRecord" ADD COLUMN     "clientBalanceResolutionNote" TEXT,
ADD COLUMN     "clientBalanceResolvedAt" TIMESTAMP(3),
ADD COLUMN     "clientBalanceResolvedById" TEXT,
ADD COLUMN     "insurerBalanceResolutionNote" TEXT,
ADD COLUMN     "insurerBalanceResolvedAt" TIMESTAMP(3),
ADD COLUMN     "insurerBalanceResolvedById" TEXT;
