-- Fix caught by real revision-creation testing immediately after the
-- add_quotation_revisions migration: Quotation.quotationNumber was still
-- globally UNIQUE from before Phase 1, which made it impossible for R02 to
-- ever share R01's case number (by design, every revision under one case
-- displays the same QT{YYYYMM}-{seq}). Uniqueness of the permanent case
-- number now lives on QuotationCase.quotationNumber (already unique);
-- per-case revision uniqueness is enforced by Quotation's own
-- (quotationCaseId, revisionNumber) unique constraint. This migration
-- drops the old unique index and replaces it with a plain (non-unique)
-- index, since quotationNumber is still a common lookup/display key.

-- DropIndex
DROP INDEX "Quotation_quotationNumber_key";

-- CreateIndex
CREATE INDEX "Quotation_quotationNumber_idx" ON "Quotation"("quotationNumber");

