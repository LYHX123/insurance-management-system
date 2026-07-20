-- AlterTable
ALTER TABLE "FireSectionDetail" ADD COLUMN     "earthquakeLoadingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "floodLoadingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: infer Enabled = true for pre-existing rows that already carried
-- a nonzero earthquake/flood loading rate or amount, so historical
-- quotations keep showing their original loading instead of silently
-- losing it once the page switches to a Yes/No toggle. New rows going
-- forward set these columns explicitly at save time.
UPDATE "FireSectionDetail"
SET "earthquakeLoadingEnabled" = true
WHERE "earthquakeLoadingRate" > 0 OR "earthquakeLoadingAmount" > 0;

UPDATE "FireSectionDetail"
SET "floodLoadingEnabled" = true
WHERE "floodLoadingRate" > 0 OR "floodLoadingAmount" > 0;
