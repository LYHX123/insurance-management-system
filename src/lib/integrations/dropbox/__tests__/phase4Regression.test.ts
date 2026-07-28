import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Phase 4 Part 17.H / 19 — scope guardrails. These assert on the actual
// source text of the Phase 4 modules so a future change that accidentally
// introduces Team Space / pathRoot code, a public-link API call, or
// Policy/Invoice/Claim synchronization in this phase's files fails a test,
// not just a code review.

const PHASE_4_FILES = [
  "customerShortName.ts",
  "quotationDropboxNaming.ts",
  "quotationContentFingerprint.ts",
  "quotationDropboxSync.ts",
].map((f) => readFileSync(join(__dirname, "..", f), "utf8"));

describe("Phase 4 scope guardrails (Part 17.H / 19)", () => {
  it("no Team Space / pathRoot code was introduced", () => {
    for (const source of PHASE_4_FILES) {
      expect(source).not.toMatch(/path_root/i);
      expect(source).not.toMatch(/team_space/i);
      expect(source).not.toMatch(/namespace_id/i);
      expect(source).not.toMatch(/DropboxTeam/);
    }
  });

  it("no Policy/Invoice/Claim synchronization code was introduced", () => {
    for (const source of PHASE_4_FILES) {
      expect(source).not.toMatch(/policyDocument/i);
      expect(source).not.toMatch(/invoiceDocument/i);
      expect(source).not.toMatch(/MotorClaim|NonMotorClaim|ClaimDocument/);
    }
  });

  it("no public/shared link creation API is referenced anywhere in this phase's source", () => {
    for (const source of PHASE_4_FILES) {
      expect(source).not.toMatch(/createSharedLink|sharingCreate|shared_link/i);
    }
  });

  it("no Dropbox delete API is referenced anywhere in this phase's source", () => {
    for (const source of PHASE_4_FILES) {
      expect(source).not.toMatch(/filesDeleteV2|filesPermanentlyDelete/);
    }
  });

  it("the Policy/Invoice/Claim business-file folders are never created — only 'Quotation' is referenced as a subfolder name", () => {
    const syncSource = readFileSync(join(__dirname, "..", "quotationDropboxSync.ts"), "utf8");
    expect(syncSource).not.toMatch(/"Policy"|"Invoice"|"Claim"/);
  });
});
