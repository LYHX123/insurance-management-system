import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Phase 3 Part 17.G — scope guardrails. These assert on the actual source
// text of the Phase 3 modules so a future change that accidentally
// introduces Team Space / pathRoot code or Quotation/Policy/Invoice/Claim
// sync in this phase's files fails a test, not just a code review.

const PHASE_3_FILES = ["customerDocumentFilenames.ts", "customerDocumentSync.ts"].map((f) =>
  readFileSync(join(__dirname, "..", f), "utf8")
);

describe("Phase 3 scope guardrails (Part 17.G.6/G.7)", () => {
  it("G6: no Team Space / pathRoot code was introduced", () => {
    for (const source of PHASE_3_FILES) {
      expect(source).not.toMatch(/path_root/i);
      expect(source).not.toMatch(/team_space/i);
      expect(source).not.toMatch(/namespace_id/i);
      expect(source).not.toMatch(/DropboxTeam/);
    }
  });

  it("G7: no Quotation/Policy/Invoice/Claim synchronization code was introduced", () => {
    for (const source of PHASE_3_FILES) {
      expect(source).not.toMatch(/quotationDocument/i);
      expect(source).not.toMatch(/policyDocument/i);
      expect(source).not.toMatch(/invoiceDocument/i);
      expect(source).not.toMatch(/MotorClaim|NonMotorClaim|ClaimDocument/);
    }
  });

  it("G5/G9: no public/shared link creation API is referenced anywhere in this phase's source", () => {
    for (const source of PHASE_3_FILES) {
      expect(source).not.toMatch(/createSharedLink|sharingCreate|shared_link/i);
    }
  });
});
