import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Dropbox Integration Phase 5 — scope guardrails, mirrors
// phase4Regression.test.ts's convention: assert on actual source text so a
// future change that accidentally introduces Team Space/pathRoot code, a
// public-link API call, Invoice/Claim synchronization, or a Dropbox delete
// call in this phase's files fails a test, not just a code review.

const PHASE_5_FILES = [
  "policyDocumentFilenames.ts",
  "policyBusinessFile.ts",
  "policyDocumentSync.ts",
  "policyPathViewModel.ts",
  "pathDisplay.ts",
].map((f) => readFileSync(join(__dirname, "..", f), "utf8"));

describe("Phase 5 scope guardrails", () => {
  it("no Team Space / pathRoot code was introduced", () => {
    for (const source of PHASE_5_FILES) {
      expect(source).not.toMatch(/path_root/i);
      expect(source).not.toMatch(/team_space/i);
      expect(source).not.toMatch(/namespace_id/i);
      expect(source).not.toMatch(/DropboxTeam/);
    }
  });

  it("no Invoice/Claim synchronization code was introduced", () => {
    for (const source of PHASE_5_FILES) {
      expect(source).not.toMatch(/invoiceDocument/i);
      expect(source).not.toMatch(/MotorClaim|NonMotorClaim|ClaimDocument/);
    }
  });

  it("no public/shared link creation API is referenced anywhere in this phase's source", () => {
    for (const source of PHASE_5_FILES) {
      expect(source).not.toMatch(/createSharedLink|sharingCreate|shared_link/i);
    }
  });

  it("no Dropbox delete API is referenced anywhere in this phase's source", () => {
    for (const source of PHASE_5_FILES) {
      expect(source).not.toMatch(/filesDeleteV2|filesPermanentlyDelete/);
    }
  });

  it("only the 'Policy' subfolder is ever created under a business file — never Invoice/Claim", () => {
    const syncSource = readFileSync(join(__dirname, "..", "policyDocumentSync.ts"), "utf8");
    expect(syncSource).toMatch(/POLICY_SUBFOLDER_NAME = "Policy"/);
    expect(syncSource).not.toMatch(/"Invoice"|"Claim"/);
  });
});
