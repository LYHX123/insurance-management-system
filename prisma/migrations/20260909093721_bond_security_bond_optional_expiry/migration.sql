-- AlterEnum
ALTER TYPE "BondType" ADD VALUE 'SECURITY_BOND';

-- AlterTable
ALTER TABLE "PolicyRecord" ALTER COLUMN "expiryDate" DROP NOT NULL;
