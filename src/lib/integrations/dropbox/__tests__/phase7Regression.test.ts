import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Dropbox Integration Phase 7 — scope guardrails, mirrors
// phase6Regression.test.ts's convention: assert on actual source text so a
// future change that accidentally introduces Team Space/pathRoot code, a
// public-link API call, or a Dropbox delete call in this phase's files
// fails a test, not just a code review.

const PHASE_7_LIB_FILES = [
  "motorClaimBusinessFile.ts",
  "nonMotorClaimBusinessFile.ts",
  "motorClaimDocumentSync.ts",
  "nonMotorClaimDocumentSync.ts",
  "claimDocumentFilenames.ts",
  "motorClaimPathViewModel.ts",
  "nonMotorClaimPathViewModel.ts",
].map((f) => ({ name: f, source: readFileSync(join(__dirname, "..", f), "utf8") }));

const CLAIM_ACTION_FILES = [
  ["..", "..", "..", "..", "app", "(app)", "task", "motor-claim", "documentActions.ts"],
  ["..", "..", "..", "..", "app", "(app)", "task", "motor-claim", "dropboxActions.ts"],
  ["..", "..", "..", "..", "app", "(app)", "task", "non-motor-claim", "documentActions.ts"],
  ["..", "..", "..", "..", "app", "(app)", "task", "non-motor-claim", "dropboxActions.ts"],
  ["..", "..", "..", "..", "app", "(app)", "settings", "motorClaimDocumentDropboxBackfillActions.ts"],
  ["..", "..", "..", "..", "app", "(app)", "settings", "nonMotorClaimDocumentDropboxBackfillActions.ts"],
].map((parts) => ({ path: parts.join("/"), source: readFileSync(join(__dirname, ...parts), "utf8") }));

describe("Phase 7 scope guardrails", () => {
  it("no Team Space / pathRoot code was introduced", () => {
    for (const { source } of PHASE_7_LIB_FILES) {
      expect(source).not.toMatch(/path_root/i);
      expect(source).not.toMatch(/team_space/i);
      expect(source).not.toMatch(/namespace_id/i);
      expect(source).not.toMatch(/DropboxTeam/);
    }
  });

  it("no public/shared link creation API is referenced anywhere in this phase's source", () => {
    for (const { source } of PHASE_7_LIB_FILES) {
      expect(source).not.toMatch(/createSharedLink|sharingCreate|shared_link/i);
    }
  });

  it("no Dropbox delete API is referenced anywhere in this phase's source (pre-existing files/folders are never deleted or moved)", () => {
    for (const { source } of PHASE_7_LIB_FILES) {
      expect(source).not.toMatch(/filesDeleteV2|filesPermanentlyDelete|filesMoveV2/);
    }
  });

  it("the Claim business-file source enum is its own dedicated enum, not a reused/overloaded Invoice or Policy enum", () => {
    const motor = PHASE_7_LIB_FILES.find((f) => f.name === "motorClaimBusinessFile.ts")!.source;
    const nonMotor = PHASE_7_LIB_FILES.find((f) => f.name === "nonMotorClaimBusinessFile.ts")!.source;
    // Declared once (motorClaimBusinessFile.ts); nonMotorClaimBusinessFile.ts
    // imports the shared ClaimBusinessFileRef type rather than redefining
    // it, so it won't mention the enum's name directly — that's DRY, not a
    // scope violation.
    expect(motor).toMatch(/ClaimDropboxBusinessFileSource/);
    expect(nonMotor).toMatch(/import type \{ ClaimBusinessFileRef \} from "\.\/motorClaimBusinessFile"/);
    expect(motor).not.toMatch(/InvoiceDropboxBusinessFileSource/);
    expect(nonMotor).not.toMatch(/InvoiceDropboxBusinessFileSource/);
  });

  it("only the 'Claim' subfolder is ever created under a business file by this phase — never Invoice, and Quotation/Policy/Invoice subfolder names are untouched", () => {
    const motorSync = PHASE_7_LIB_FILES.find((f) => f.name === "motorClaimDocumentSync.ts")!.source;
    const nonMotorSync = PHASE_7_LIB_FILES.find((f) => f.name === "nonMotorClaimDocumentSync.ts")!.source;
    for (const source of [motorSync, nonMotorSync]) {
      expect(source).toMatch(/CLAIM_SUBFOLDER_NAME = "Claim"/);
      // A bare `/"Invoice"/` scan would also match this file's own
      // explanatory comments contrasting itself with the Invoice sync
      // module (a known false-positive class — see phase6Regression.test.ts's
      // precedent) — so assert on the actual API call shape instead.
      expect(source).not.toMatch(/ensureNestedFolder\([^)]*"Invoice"/);
    }
  });

  it("no `export type { ... }` re-export exists inside any Claim \"use server\" action file (the prior Next.js server-action loader bug)", () => {
    for (const { path, source } of CLAIM_ACTION_FILES) {
      expect(source, `${path} must start with "use server"`).toMatch(/^"use server";/);
      expect(source, `${path} must not re-export a type`).not.toMatch(/^export type \{/m);
    }
  });

  it("the Motor Claim action module only ever checks the claim.motor permission, never claim.non_motor", () => {
    const source = readFileSync(join(__dirname, "..", "..", "..", "..", "app", "(app)", "task", "motor-claim", "actions.ts"), "utf8");
    expect(source).toMatch(/"claim\.motor"/);
    expect(source).not.toMatch(/"claim\.non_motor"/);
  });

  it("the Non-Motor Claim action module only ever checks the claim.non_motor permission, never claim.motor", () => {
    const source = readFileSync(join(__dirname, "..", "..", "..", "..", "app", "(app)", "task", "non-motor-claim", "actions.ts"), "utf8");
    expect(source).toMatch(/"claim\.non_motor"/);
    expect(source).not.toMatch(/\"claim\.motor\"/);
  });

  it("every admin-only Claim Dropbox action module imports and actually invokes requireAdmin (never just imports it for show)", () => {
    for (const { path, source } of CLAIM_ACTION_FILES) {
      if (!/dropboxActions\.ts$/.test(path) && !/BackfillActions\.ts$/.test(path)) continue;
      expect(source, `${path} must import requireAdmin`).toMatch(/import \{ requireAdmin \} from "@\/lib\/authz"/);
      const requireAdminCalls = source.match(/await requireAdmin\(\)/g) ?? [];
      expect(requireAdminCalls.length, `${path} must actually call requireAdmin()`).toBeGreaterThan(0);
    }
  });

  it("the linked-Policy resolver re-validates against the Claim's own customer and category rather than trusting a client-supplied id", () => {
    const policyLinkSource = readFileSync(join(__dirname, "..", "..", "..", "claims", "policyLink.ts"), "utf8");
    expect(policyLinkSource).toMatch(/POLICY_CUSTOMER_MISMATCH/);
    expect(policyLinkSource).toMatch(/POLICY_CATEGORY_MISMATCH/);
  });

  it("Policy reassignment after a synced document is blocked, in both Motor and Non-Motor update actions", () => {
    const motorActions = readFileSync(join(__dirname, "..", "..", "..", "..", "app", "(app)", "task", "motor-claim", "actions.ts"), "utf8");
    const nonMotorActions = readFileSync(join(__dirname, "..", "..", "..", "..", "app", "(app)", "task", "non-motor-claim", "actions.ts"), "utf8");
    for (const source of [motorActions, nonMotorActions]) {
      expect(source).toMatch(/CLAIM_POLICY_REASSIGNMENT_BLOCKED/);
      expect(source).toMatch(/syncStatus: "SYNCED"/);
    }
  });
});
