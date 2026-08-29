-- AlterEnum
-- Phase 10: business correction — the Motor vehicle tax class "SPV" is
-- really "PSV" (Public Service Vehicle). RENAME VALUE is an in-place
-- catalog rename that runs inside this migration's transaction and rewrites
-- no table data, so any MotorPolicyDetail row that stored 'SPV' now reads
-- back as 'PSV' automatically.
ALTER TYPE "MotorTaxClass" RENAME VALUE 'SPV' TO 'PSV';
