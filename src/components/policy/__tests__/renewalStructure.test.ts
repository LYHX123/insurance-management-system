import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Phase 12D — source-structure guardrails (this project asserts on source
// text for structure/layout — see documentTableLayout.test.ts).

const root = join(__dirname, "..", "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

describe("D25: every policy list renders the compact renewal badge next to the record number", () => {
  for (const dir of ["motor", "non-motor", "bond", "work-permit"]) {
    it(`${dir} list table`, () => {
      const s = read("components", "policy", dir, `${dir}-list-table.tsx`);
      expect(s).toMatch(/import \{ RenewalBadge \}/);
      expect(s).toMatch(/<RenewalBadge renewalIndex=\{r\.renewalIndex\} renewalDecision=\{r\.renewalDecision\} \/>/);
    });
  }
});

describe("D26: the Renewal History card is wired into all 4 detail views and shows the whole chain", () => {
  for (const dir of ["motor", "non-motor", "bond", "work-permit"]) {
    it(`${dir} detail view`, () => {
      const s = read("components", "policy", dir, `${dir}-detail-view.tsx`);
      expect(s).toMatch(/<PolicyRenewalCard policyRecordId=\{detail\.id\} category="[A-Z_]+" canEdit=\{canEdit\} renewal=\{renewal\}/);
    });
  }
  it("the card renders each chain member with a View link to its own detail page (both directions)", () => {
    const s = read("components", "policy", "policy-renewal-card.tsx");
    expect(s).toMatch(/renewal\.chain\.map/);
    expect(s).toMatch(/\$\{route\}\/\$\{m\.id\}/); // View link per member
    expect(s).toMatch(/setPolicyRenewalDecisionAction/);
  });
});

describe("D29 / D31: Dropbox — renewal documents go to Policy/{year}/, root business folder reused", () => {
  it("policyDocumentSync appends the renewal year segment for renewalIndex >= 1 only", () => {
    const s = read("lib", "integrations", "dropbox", "policyDocumentSync.ts");
    expect(s).toMatch(/renewalYearSegment/);
    expect(s).toMatch(/document\.policyRecord\.renewalIndex >= 1/);
  });
  it("policyBusinessFile delegates a renewal to the ROOT policy — never its own business file", () => {
    const s = read("lib", "integrations", "dropbox", "policyBusinessFile.ts");
    expect(s).toMatch(/policy\.renewalIndex >= 1 && policy\.rootPolicyId/);
    expect(s).toMatch(/return ensurePolicyDropboxBusinessFile\(policy\.rootPolicyId\)/);
    expect(s).toMatch(/return resolvePolicyBusinessFileRefReadOnly\(policy\.rootPolicyId\)/);
  });
});

describe("D12 / §12: renewal is separate from PolicyBusinessStatus; RENEWED stays sticky", () => {
  it("computeBusinessStatus still returns an explicit RENEWED unchanged (not touched this phase)", () => {
    const s = read("lib", "policy", "status.ts");
    expect(s).toMatch(/currentStatus === "CANCELLED" \|\| currentStatus === "RENEWED"\) return currentStatus/);
  });
  it("renewPolicyAction sets the previous period to businessStatus RENEWED + renewalDecision RENEWED", () => {
    const s = read("app", "(app)", "policy", "renewal", "actions.ts");
    expect(s).toMatch(/renewalDecision: "RENEWED", businessStatus: "RENEWED"/);
    expect(s).toMatch(/renewedFromId is @unique|renewedFrom: \{ connect: \{ id: source\.id \} \}/);
  });
});

describe("D7 / D32: reminders drop NOT_RENEWED periods; renewed periods already excluded via RENEWED status", () => {
  it("reminder query excludes NOT_RENEWED (keeping NULL / PENDING)", () => {
    const s = read("lib", "reminders", "policy.ts");
    expect(s).toMatch(/renewalDecision: null \}, \{ renewalDecision: \{ not: "NOT_RENEWED" \}/);
  });
});

describe("D38: ledger / systemRecords not touched by this phase", () => {
  it("systemRecords.ts still projects only from receipts / payments / commission — no renewal refs", () => {
    const s = read("lib", "ledger", "systemRecords.ts");
    expect(s).not.toMatch(/renewal|renewedFrom|rootPolicy/i);
  });
});
