-- AlterTable
-- Phase 10: selectable Employers' Liability option tiers. All columns are
-- additive with a NOT NULL DEFAULT equal to the original fixed Option 1
-- behaviour (25% of WIBA gross; limits 2m / 10m / 20m), so every existing
-- ElSectionDetail row reads back identically with no backfill.
ALTER TABLE "ElSectionDetail"
  ADD COLUMN     "elOption" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN     "elRatePercent" DECIMAL(6,2) NOT NULL DEFAULT 25,
  ADD COLUMN     "anyOnePersonLimit" DECIMAL(18,2) NOT NULL DEFAULT 2000000,
  ADD COLUMN     "anyOneOccurrenceLimit" DECIMAL(18,2) NOT NULL DEFAULT 10000000,
  ADD COLUMN     "anyOneYearLimit" DECIMAL(18,2) NOT NULL DEFAULT 20000000;
