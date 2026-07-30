import { describe, it, expect, vi } from "vitest";

// Regression guard for the "ReferenceError: X is not defined" class of bug
// found and fixed in an earlier phase (a type-only import used as a runtime
// value, or a dangling `export type { }` re-export inside a "use server"
// file mishandled by Next.js's server-actions loader). Actually imports the
// real Phase 7 Claim Dropbox action modules (unmocked) so their module
// graph gets genuinely evaluated — a mocked unit test never re-evaluates
// the real module graph, so this is the only reliable guard. Mirrors
// phase6ActionModuleEvaluation.test.ts exactly.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const PHASE_7_ACTION_MODULES = [
  "../../../../app/(app)/task/motor-claim/actions",
  "../../../../app/(app)/task/motor-claim/documentActions",
  "../../../../app/(app)/task/motor-claim/dropboxActions",
  "../../../../app/(app)/task/non-motor-claim/actions",
  "../../../../app/(app)/task/non-motor-claim/documentActions",
  "../../../../app/(app)/task/non-motor-claim/dropboxActions",
  "../../../../app/(app)/settings/motorClaimDocumentDropboxBackfillActions",
  "../../../../app/(app)/settings/nonMotorClaimDocumentDropboxBackfillActions",
];

describe("Phase 7 Claim action modules evaluate without an undefined runtime symbol", () => {
  for (const modulePath of PHASE_7_ACTION_MODULES) {
    it(`imports cleanly: ${modulePath}`, async () => {
      await expect(import(modulePath)).resolves.toBeTruthy();
    });
  }
});
