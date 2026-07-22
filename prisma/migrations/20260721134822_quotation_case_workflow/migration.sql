/*
  Warnings:

  - You are about to drop the column `title` on the `QuotationCase` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "QuotationCase" DROP COLUMN "title",
ADD COLUMN     "enquiryDate" TIMESTAMP(3),
ADD COLUMN     "intendedInsuranceTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "internalNote" TEXT;
