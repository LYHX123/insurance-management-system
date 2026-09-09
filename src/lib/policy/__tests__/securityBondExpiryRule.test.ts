import { describe, it, expect } from "vitest";
import { computeBusinessStatus } from "@/lib/policy/status";
import { bondTypeAllowsNoExpiry, BOND_TYPES, SECURITY_BOND_TYPE } from "@/lib/policy/bondTypes";

// Phase 13C — the two pure helpers the conditional-expiry rule is built on.

describe("bondTypeAllowsNoExpiry", () => {
  it("is true only for SECURITY_BOND", () => {
    expect(bondTypeAllowsNoExpiry(SECURITY_BOND_TYPE)).toBe(true);
    for (const bt of BOND_TYPES.filter((b) => b !== "SECURITY_BOND")) {
      expect(bondTypeAllowsNoExpiry(bt)).toBe(false);
    }
    expect(bondTypeAllowsNoExpiry(null)).toBe(false);
    expect(bondTypeAllowsNoExpiry(undefined)).toBe(false);
    expect(bondTypeAllowsNoExpiry("")).toBe(false);
  });

  it("SECURITY_BOND is part of the shared BOND_TYPES list", () => {
    expect(BOND_TYPES).toContain("SECURITY_BOND");
  });
});

describe("computeBusinessStatus — null (open-ended) expiry", () => {
  const eff = new Date("2026-01-01T00:00:00.000Z");

  it("never returns EXPIRED when there is no expiry date", () => {
    const farFuture = new Date("2099-01-01T00:00:00.000Z");
    expect(computeBusinessStatus(eff, null, "DRAFT", farFuture)).toBe("ACTIVE");
  });

  it("is DRAFT before the effective date and ACTIVE on/after it", () => {
    expect(computeBusinessStatus(eff, null, "DRAFT", new Date("2025-06-01"))).toBe("DRAFT");
    expect(computeBusinessStatus(eff, null, "DRAFT", new Date("2026-06-01"))).toBe("ACTIVE");
  });

  it("still honours an explicit CANCELLED / RENEWED status", () => {
    expect(computeBusinessStatus(eff, null, "CANCELLED", new Date("2026-06-01"))).toBe("CANCELLED");
    expect(computeBusinessStatus(eff, null, "RENEWED", new Date("2026-06-01"))).toBe("RENEWED");
  });

  it("is unchanged for a dated policy", () => {
    const exp = new Date("2026-12-31T00:00:00.000Z");
    expect(computeBusinessStatus(eff, exp, "DRAFT", new Date("2027-01-02"))).toBe("EXPIRED");
    expect(computeBusinessStatus(eff, exp, "DRAFT", new Date("2026-06-01"))).toBe("ACTIVE");
  });
});
