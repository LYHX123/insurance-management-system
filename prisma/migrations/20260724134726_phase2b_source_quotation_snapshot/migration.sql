-- AlterTable
ALTER TABLE "PolicyRecord" ADD COLUMN     "sourceQuotationDateSnapshot" TIMESTAMP(3),
ADD COLUMN     "sourceQuotationNumberSnapshot" TEXT,
ADD COLUMN     "sourceQuotationRevisionSnapshot" TEXT;
