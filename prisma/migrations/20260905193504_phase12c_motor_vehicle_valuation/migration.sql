-- CreateEnum
CREATE TYPE "MotorValuationStatus" AS ENUM ('NOT_ARRANGED', 'IN_PROGRESS', 'COMPLETED');

-- AlterEnum
ALTER TYPE "PolicyDocumentType" ADD VALUE 'VALUATION_REPORT';

-- AlterTable
ALTER TABLE "MotorPolicyDetail" ADD COLUMN     "assessedVehicleValue" DECIMAL(18,2),
ADD COLUMN     "valuationStatus" "MotorValuationStatus";
