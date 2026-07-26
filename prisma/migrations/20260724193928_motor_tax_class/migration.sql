-- CreateEnum
CREATE TYPE "MotorTaxClass" AS ENUM ('PRIVATE', 'COMMERCIAL', 'SPV', 'SPECIAL_USE');

-- AlterTable
ALTER TABLE "MotorPolicyDetail" ADD COLUMN     "taxClass" "MotorTaxClass";
