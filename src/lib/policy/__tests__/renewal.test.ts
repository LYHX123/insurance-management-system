import { describe, it, expect } from "vitest";
import {
  renewalPeriodKey,
  resolveRootPolicyId,
  renewalYearSegment,
  canRenewPolicy,
  canMarkNotRenewed,
  canReopenRenewal,
} from "@/lib/policy/renewal";

describe("renewalPeriodKey", () => {
  it("index 0 -> original; index >= 1 -> renewal N", () => {
    expect(renewalPeriodKey(0)).toEqual({ key: "original", index: 0 });
    expect(renewalPeriodKey(-1)).toEqual({ key: "original", index: 0 });
    expect(renewalPeriodKey(1)).toEqual({ key: "renewal", index: 1 });
    expect(renewalPeriodKey(3)).toEqual({ key: "renewal", index: 3 });
  });
});

describe("resolveRootPolicyId", () => {
  it("an original is its own root; a renewal points at rootPolicyId", () => {
    expect(resolveRootPolicyId({ id: "p1", rootPolicyId: null })).toBe("p1");
    expect(resolveRootPolicyId({ id: "r1", rootPolicyId: "p1" })).toBe("p1");
  });
});

describe("renewalYearSegment", () => {
  it("is the UTC calendar year of the effective date", () => {
    expect(renewalYearSegment(new Date("2027-09-04T00:00:00.000Z"))).toBe("2027");
    expect(renewalYearSegment(new Date("2028-01-01T00:00:00.000Z"))).toBe("2028");
  });
});

describe("renewal decision gates", () => {
  const base = { deletedAt: null, hasSuccessor: false, renewalDecision: null as "PENDING" | "RENEWED" | "NOT_RENEWED" | null };

  it("canRenewPolicy: only when not deleted, no successor, not NOT_RENEWED", () => {
    expect(canRenewPolicy(base)).toBe(true);
    expect(canRenewPolicy({ ...base, renewalDecision: "PENDING" })).toBe(true);
    expect(canRenewPolicy({ ...base, renewalDecision: "RENEWED" })).toBe(true);
    expect(canRenewPolicy({ ...base, renewalDecision: "NOT_RENEWED" })).toBe(false);
    expect(canRenewPolicy({ ...base, hasSuccessor: true })).toBe(false);
    expect(canRenewPolicy({ ...base, deletedAt: new Date() })).toBe(false);
  });

  it("canMarkNotRenewed: never once a successor exists or already NOT_RENEWED", () => {
    expect(canMarkNotRenewed(base)).toBe(true);
    expect(canMarkNotRenewed({ ...base, hasSuccessor: true })).toBe(false);
    expect(canMarkNotRenewed({ ...base, renewalDecision: "NOT_RENEWED" })).toBe(false);
  });

  it("canReopenRenewal: only from NOT_RENEWED with no successor", () => {
    expect(canReopenRenewal({ ...base, renewalDecision: "NOT_RENEWED" })).toBe(true);
    expect(canReopenRenewal(base)).toBe(false);
    expect(canReopenRenewal({ ...base, renewalDecision: "NOT_RENEWED", hasSuccessor: true })).toBe(false);
  });
});
