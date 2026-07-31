"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { runNamespaceDiagnostic } from "@/lib/integrations/dropbox/migration/diagnostics";
import { runDestinationWriteAccessTest } from "@/lib/integrations/dropbox/migration/writeTest";
import { runCopyPreview } from "@/lib/integrations/dropbox/migration/preview";
import { startCopyPhase, pauseCopyPhase, runCopyBatch } from "@/lib/integrations/dropbox/migration/copyEngine";
import { runVerificationBatch, getVerificationSummary } from "@/lib/integrations/dropbox/migration/verify";
import { activateDestinationNamespace } from "@/lib/integrations/dropbox/migration/activation";
import { verifyActiveStorage } from "@/lib/integrations/dropbox/migration/verifyActiveStorage";
import type { MigrationActionResult } from "@/lib/integrations/dropbox/migration/types";
import type { DiagnosticResult } from "@/lib/integrations/dropbox/migration/diagnostics";
import type { WriteTestResult } from "@/lib/integrations/dropbox/migration/writeTest";
import type { PreviewSummary } from "@/lib/integrations/dropbox/migration/preview";
import type { CopyBatchResult } from "@/lib/integrations/dropbox/migration/copyEngine";
import type { VerificationBatchResult, VerificationSummary } from "@/lib/integrations/dropbox/migration/verify";
import type { ActivationResult } from "@/lib/integrations/dropbox/migration/activation";
import type { ActiveStorageVerification } from "@/lib/integrations/dropbox/migration/verifyActiveStorage";

// ADMIN-only, mirroring dropboxActions.ts's convention: every action
// re-checks requireAdmin() itself.
//
// runDestinationWriteAccessTestAction makes REAL Dropbox writes (create +
// delete one temporary folder). Per the migration spec's Stage B boundary,
// this must only ever be invoked from an explicit, separately-confirmed
// Settings UI action — never automatically, and never bundled with the
// (read-only) diagnostic action above it.

export async function runNamespaceDiagnosticAction(): Promise<MigrationActionResult<DiagnosticResult>> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const result = await runNamespaceDiagnostic(session.user.id);
  revalidatePath("/settings");
  return result;
}

export async function runDestinationWriteAccessTestAction(confirmationText: string): Promise<MigrationActionResult<WriteTestResult>> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  // Server-side confirmation check — never trust a disabled-button-only
  // client guard for an action that makes real Dropbox writes.
  if (confirmationText.trim() !== "TEST WRITE ACCESS") {
    return { success: false, error: "ACTIVATION_BLOCKED" };
  }

  const result = await runDestinationWriteAccessTest(session.user.id);
  revalidatePath("/settings");
  return result;
}

// Read-only — safe to call as often as needed, but per the migration
// spec's Stage C boundary, the UI must only surface this action after the
// write-access test has passed.
export async function runCopyPreviewAction(): Promise<MigrationActionResult<PreviewSummary>> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const result = await runCopyPreview(session.user.id);
  revalidatePath("/settings");
  return result;
}

// Stage D — real destination writes (folder creation + copy_reference
// content copies). Only meaningful after an approved preview; the Settings
// UI must gate the "Start Copy" button on previewResult === SAFE_TO_CONTINUE
// (or an admin explicitly acknowledging MANUAL_REVIEW_REQUIRED).
export async function startCopyPhaseAction(jobId: string): Promise<MigrationActionResult<{ started: true }>> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const result = await startCopyPhase(jobId);
  revalidatePath("/settings");
  return result;
}

export async function pauseCopyPhaseAction(jobId: string): Promise<MigrationActionResult<{ paused: true }>> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const result = await pauseCopyPhase(jobId);
  revalidatePath("/settings");
  return result;
}

// Processes exactly one bounded batch per call — the client re-invokes this
// ("Resume Copy") until phaseComplete is true, matching this codebase's
// existing per-entity backfill click-driven-batch convention.
export async function runCopyBatchAction(jobId: string): Promise<MigrationActionResult<CopyBatchResult>> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const result = await runCopyBatch(jobId);
  revalidatePath("/settings");
  return result;
}

export async function runVerificationBatchAction(jobId: string): Promise<MigrationActionResult<VerificationBatchResult>> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const result = await runVerificationBatch(jobId);
  revalidatePath("/settings");
  return result;
}

export async function getVerificationSummaryAction(jobId: string): Promise<MigrationActionResult<VerificationSummary>> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const summary = await getVerificationSummary(jobId);
  return { success: true, ...summary };
}

// Stage E — the one-way switch. Requires BOTH the typed confirmation
// ("ACTIVATE ENFB SYSTEM FILE") and an explicit DB-backup attestation
// checkbox; both are re-checked server-side regardless of client state.
export async function activateDestinationNamespaceAction(
  jobId: string,
  confirmationText: string,
  dbBackupConfirmed: boolean
): Promise<MigrationActionResult<ActivationResult>> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const result = await activateDestinationNamespace(jobId, confirmationText, dbBackupConfirmed);
  revalidatePath("/settings");
  return result;
}

// Post-migration (Phase 8 Part 9/10) — the one action retained indefinitely
// after COMPLETED, alongside Run Diagnostic and View Migration History.
// Read-only; goes through the normal active-client path, not a
// migration-specific one.
export async function verifyActiveStorageAction(): Promise<MigrationActionResult<ActiveStorageVerification>> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  return verifyActiveStorage();
}
