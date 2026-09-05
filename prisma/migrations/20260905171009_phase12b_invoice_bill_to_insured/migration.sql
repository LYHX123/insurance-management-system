-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "insuredCustomerId" TEXT,
ADD COLUMN     "insuredNameSnapshot" TEXT,
ADD COLUMN     "insuredPinSnapshot" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_insuredCustomerId_idx" ON "Invoice"("insuredCustomerId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_insuredCustomerId_fkey" FOREIGN KEY ("insuredCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
