import { describe, it, expect, vi } from "vitest";

// Regression guard for the "ReferenceError: X is not defined" class of bug —
// a type-only import (e.g. DropboxErrorCode from ./errors, which is a
// string-union type with no runtime value) accidentally used as a runtime
// value. TypeScript's `import { type X }` / `import type { X }` elides X at
// compile time, so any code path that reads it as a value throws at module
// evaluation, before any handler ever runs — `npx tsc --noEmit` does NOT
// catch this if the misuse is disguised behind a computed/dynamic access.
// The real Dropbox/prisma/filesystem logic is never exercised here (that's
// covered elsewhere) — only that the module graph evaluates cleanly.
//
// next-auth itself (pulled in transitively via @/lib/auth) imports
// "next/server" without an extension, which Next's bundler resolves fine
// but Vitest's plain Node ESM resolver can't — so @/lib/auth is mocked out
// here purely to keep these files importable outside Next, same as
// dropboxActions.test.ts does for @/lib/authz.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const PHASE_5_POLICY_ACTION_MODULES = [
  "../../../../app/(app)/policy/dropboxActions",
  "../../../../app/(app)/policy/motor/documentActions",
  "../../../../app/(app)/settings/policyDocumentDropboxBackfillActions",
];

describe("Phase 5 Policy action modules evaluate without an undefined runtime symbol", () => {
  for (const modulePath of PHASE_5_POLICY_ACTION_MODULES) {
    it(`imports cleanly: ${modulePath}`, async () => {
      await expect(import(modulePath)).resolves.toBeTruthy();
    });
  }
});
