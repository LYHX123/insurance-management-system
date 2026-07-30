import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Dropbox Integration Phase 6 — scope guardrails, mirrors
// phase5Regression.test.ts's convention: assert on actual source text so a
// future change that accidentally introduces Team Space/pathRoot code, a
// public-link API call, Claim synchronization, or a Dropbox delete call in
// this phase's files fails a test, not just a code review.

const PHASE_6_FILES = [
  "invoiceBusinessFile.ts",
  "invoiceDocumentFilenames.ts",
  "invoiceDocumentSync.ts",
  "invoicePathViewModel.ts",
].map((f) => readFileSync(join(__dirname, "..", f), "utf8"));

describe("Phase 6 scope guardrails", () => {
  it("no Team Space / pathRoot code was introduced", () => {
    for (const source of PHASE_6_FILES) {
      expect(source).not.toMatch(/path_root/i);
      expect(source).not.toMatch(/team_space/i);
      expect(source).not.toMatch(/namespace_id/i);
      expect(source).not.toMatch(/DropboxTeam/);
    }
  });

  it("no Claim synchronization code was introduced", () => {
    for (const source of PHASE_6_FILES) {
      expect(source).not.toMatch(/MotorClaim|NonMotorClaim|ClaimDocument|ClaimDropbox/);
      expect(source).not.toMatch(/"Claim"/);
    }
  });

  it("no public/shared link creation API is referenced anywhere in this phase's source", () => {
    for (const source of PHASE_6_FILES) {
      expect(source).not.toMatch(/createSharedLink|sharingCreate|shared_link/i);
    }
  });

  it("no Dropbox delete API is referenced anywhere in this phase's source", () => {
    for (const source of PHASE_6_FILES) {
      expect(source).not.toMatch(/filesDeleteV2|filesPermanentlyDelete/);
    }
  });

  it("only the 'Invoice' subfolder is ever created under a business file — never Claim, and Quotation/Policy subfolder names are untouched by this phase", () => {
    const syncSource = readFileSync(join(__dirname, "..", "invoiceDocumentSync.ts"), "utf8");
    expect(syncSource).toMatch(/INVOICE_SUBFOLDER_NAME = "Invoice"/);
    expect(syncSource).not.toMatch(/"Claim"/);
  });

  it("the Invoice business-file source enum is its own dedicated enum, not a reused/overloaded Policy enum", () => {
    const bizFileSource = readFileSync(join(__dirname, "..", "invoiceBusinessFile.ts"), "utf8");
    expect(bizFileSource).toMatch(/InvoiceDropboxBusinessFileSource/);
  });

  it("no `export type { ... }` re-export exists inside any Invoice \"use server\" action file (the prior Next.js server-action loader bug)", () => {
    const dropboxActionsSource = readFileSync(
      join(__dirname, "..", "..", "..", "..", "app", "(app)", "invoice", "dropboxActions.ts"),
      "utf8"
    );
    const backfillActionsSource = readFileSync(
      join(__dirname, "..", "..", "..", "..", "app", "(app)", "settings", "invoiceDocumentDropboxBackfillActions.ts"),
      "utf8"
    );
    expect(dropboxActionsSource).toMatch(/^"use server";/);
    expect(backfillActionsSource).toMatch(/^"use server";/);
    expect(dropboxActionsSource).not.toMatch(/^export type \{/m);
    expect(backfillActionsSource).not.toMatch(/^export type \{/m);
  });
});
