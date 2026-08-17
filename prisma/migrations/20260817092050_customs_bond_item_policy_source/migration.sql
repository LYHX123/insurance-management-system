-- AlterTable
ALTER TABLE "PolicyRecord" ADD COLUMN     "sourceCustomsBondItemId" TEXT;

-- CreateIndex
CREATE INDEX "PolicyRecord_sourceCustomsBondItemId_idx" ON "PolicyRecord"("sourceCustomsBondItemId");

-- AddForeignKey
ALTER TABLE "PolicyRecord" ADD CONSTRAINT "PolicyRecord_sourceCustomsBondItemId_fkey" FOREIGN KEY ("sourceCustomsBondItemId") REFERENCES "CustomsBondItemRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
