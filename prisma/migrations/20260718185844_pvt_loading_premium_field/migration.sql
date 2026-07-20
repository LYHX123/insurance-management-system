-- AlterTable
ALTER TABLE "CarSectionDetail" ADD COLUMN     "pvtLoadingPremium" DECIMAL(16,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CpmSectionDetail" ADD COLUMN     "pvtLoadingPremium" DECIMAL(16,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "FireSectionDetail" ADD COLUMN     "pvtLoadingPremium" DECIMAL(16,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "GitAnnualSectionDetail" ADD COLUMN     "pvtLoadingPremium" DECIMAL(16,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "GitSingleSectionDetail" ADD COLUMN     "pvtLoadingPremium" DECIMAL(16,2) NOT NULL DEFAULT 0;

-- Backfill: under the previous logic pvtLoadingAmount was entered manually
-- and functioned AS the premium (added directly into gross premium, no
-- rate multiplication). This does not touch any existing total/gross/tax
-- column on any row — those were already computed and saved under the old
-- formula and remain untouched. It only initializes the new column to the
-- value that was actually charged historically, so legacy quotations
-- display/export a consistent PVT premium instead of a default 0. Rows
-- created or edited-and-resaved after this migration compute
-- pvtLoadingPremium from amount x rate going forward (see
-- src/lib/insuranceCalculations/pvtLoading.ts).
UPDATE "CarSectionDetail" SET "pvtLoadingPremium" = "pvtLoadingAmount";
UPDATE "CpmSectionDetail" SET "pvtLoadingPremium" = "pvtLoadingAmount";
UPDATE "FireSectionDetail" SET "pvtLoadingPremium" = "pvtLoadingAmount";
UPDATE "GitAnnualSectionDetail" SET "pvtLoadingPremium" = "pvtLoadingAmount";
UPDATE "GitSingleSectionDetail" SET "pvtLoadingPremium" = "pvtLoadingAmount";
