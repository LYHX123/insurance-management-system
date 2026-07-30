import { describe, it, expect, vi } from "vitest";

// Regression guard for the "ReferenceError: X is not defined" class of bug
// found and fixed in Phase 5 (a type-only import used as a runtime value,
// or a dangling `export type { }` re-export inside a "use server" file
// mishandled by Next.js's server-actions loader). Actually imports the real
// Phase 6 Invoice Dropbox action modules (unmocked) so their module graph
// gets genuinely evaluated — a mocked unit test never re-evaluates the real
// module graph, so this is the only reliable guard.
//
// next-auth (pulled in transitively via @/lib/auth) imports "next/server"
// without an extension, which Next's bundler resolves fine but Vitest's
// plain Node ESM resolver can't — so @/lib/auth is mocked out here purely
// to keep these files importable outside Next, same as
// phase5ActionModuleEvaluation.test.ts does.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const PHASE_6_ACTION_MODULES = [
  "../../../../app/(app)/invoice/dropboxActions",
  "../../../../app/(app)/invoice/actions",
  "../../../../app/(app)/settings/invoiceDocumentDropboxBackfillActions",
];

describe("Phase 6 Invoice action modules evaluate without an undefined runtime symbol", () => {
  for (const modulePath of PHASE_6_ACTION_MODULES) {
    it(`imports cleanly: ${modulePath}`, async () => {
      await expect(import(modulePath)).resolves.toBeTruthy();
    });
  }
});
