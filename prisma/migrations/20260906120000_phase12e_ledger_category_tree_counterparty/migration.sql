-- Phase 12E — Manual Ledger: hierarchical categories + counterparty.
--
-- Safety summary (all additive / non-destructive):
--   * DROP TABLE?              no
--   * DROP COLUMN?             no
--   * RENAME COLUMN?           no
--   * mass UPDATE / backfill?  no — existing rows keep parentId = NULL,
--                              sortOrder = 0 (column default), counterpartyName
--                              = NULL. No historical row is rewritten.
--   * destructive ALTER?       no — only ADD COLUMN (nullable, or NOT NULL with
--                              a constant default which is metadata-only on
--                              PostgreSQL 11+, no table rewrite).
--   * index replacement?       yes — the old single-level unique index
--                              "LedgerCategory_name_transactionType_key" is
--                              dropped and replaced by sibling-scoped
--                              uniqueness (parentId, name, transactionType)
--                              PLUS a partial unique index for roots (see
--                              bottom of this file). A pre-flight query
--                              confirmed the live table cannot violate either
--                              new constraint. For every existing row
--                              parentId IS NULL, so the partial root index is
--                              exactly as strict as the old index was.
--   * foreign-key behaviour?   new self-FK LedgerCategory.parentId ->
--                              LedgerCategory.id, ON DELETE RESTRICT (a parent
--                              can never be deleted while it has children;
--                              deleteLedgerCategoryAction rejects it earlier
--                              with a friendly error). All existing parentId
--                              values are NULL, so the constraint validates
--                              instantly.
--   * paymentMethod schema change? none — paymentMethod stays "String?".
--                              The 4-value dropdown is an application rule
--                              only; legacy values keep rendering/editing.
--
-- The partial unique index below is not expressible in the Prisma schema.
-- This migration file is its source of truth. A future `prisma migrate diff`
-- against a database that has it will not list it (Prisma does not model
-- partial indexes) and MUST NOT be allowed to drop it — keep this statement.

-- DropIndex
DROP INDEX "LedgerCategory_name_transactionType_key";

-- AlterTable
ALTER TABLE "LedgerCategory" ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "LedgerManualEntry" ADD COLUMN     "counterpartyName" TEXT;

-- CreateIndex
CREATE INDEX "LedgerCategory_parentId_idx" ON "LedgerCategory"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerCategory_parentId_name_transactionType_key" ON "LedgerCategory"("parentId", "name", "transactionType");

-- AddForeignKey
ALTER TABLE "LedgerCategory" ADD CONSTRAINT "LedgerCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "LedgerCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex (manual — root-category uniqueness)
-- PostgreSQL treats NULL as distinct in a unique index, so the composite
-- index above does NOT stop two root categories (parentId IS NULL) sharing a
-- name within one transactionType. This partial unique index closes that gap.
-- createLedgerCategoryAction also performs an explicit pre-insert check so the
-- user gets a friendly "duplicate" error rather than a raw constraint error.
CREATE UNIQUE INDEX "LedgerCategory_root_name_transactionType_key"
  ON "LedgerCategory"("name", "transactionType")
  WHERE "parentId" IS NULL;
