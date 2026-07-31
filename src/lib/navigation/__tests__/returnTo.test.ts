import { describe, it, expect } from "vitest";
import { isSafeReturnTo, resolveReturnTo, resolveReturnToAvoidingSelf, buildReturnTo } from "../returnTo";

describe("isSafeReturnTo (Navigation Phase 8 Part 12.A)", () => {
  it("accepts a plain relative path", () => {
    expect(isSafeReturnTo("/quotation")).toBe(true);
  });

  it("accepts a relative path with query string", () => {
    expect(isSafeReturnTo("/quotation?search=CRSG&status=QUOTED&page=2")).toBe(true);
  });

  it("rejects a protocol-relative URL (//evil.com)", () => {
    expect(isSafeReturnTo("//evil.com")).toBe(false);
  });

  it("rejects an absolute external URL", () => {
    expect(isSafeReturnTo("https://evil.com/phish")).toBe(false);
    expect(isSafeReturnTo("http://evil.com")).toBe(false);
  });

  it("rejects javascript: and data: pseudo-protocols", () => {
    expect(isSafeReturnTo("javascript:alert(1)")).toBe(false);
    expect(isSafeReturnTo("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects a path not starting with /", () => {
    expect(isSafeReturnTo("quotation")).toBe(false);
  });

  it("rejects the login page", () => {
    expect(isSafeReturnTo("/login")).toBe(false);
  });

  it("rejects API routes", () => {
    expect(isSafeReturnTo("/api/integrations/dropbox/callback")).toBe(false);
    expect(isSafeReturnTo("/api/health")).toBe(false);
  });

  it("rejects the access-denied page", () => {
    expect(isSafeReturnTo("/access-denied")).toBe(false);
  });

  it("rejects null, undefined, and empty string", () => {
    expect(isSafeReturnTo(null)).toBe(false);
    expect(isSafeReturnTo(undefined)).toBe(false);
    expect(isSafeReturnTo("")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isSafeReturnTo(123)).toBe(false);
    expect(isSafeReturnTo({})).toBe(false);
  });

  it("rejects whitespace-obfuscated external URLs", () => {
    expect(isSafeReturnTo("/\t/evil.com")).toBe(false);
    expect(isSafeReturnTo("/ /evil.com")).toBe(false);
  });
});

describe("isSafeReturnTo — chain length/loop guards (Phase 8.1 Part 13)", () => {
  it("accepts a realistic 3-hop chain (Customer -> Quotation -> Policy)", () => {
    const customer = "/customer/cust1?tab=relatedRecords";
    const quotation = buildReturnTo("/quotation/case/case1", `returnTo=${encodeURIComponent(customer)}`);
    const policyReturnTo = buildReturnTo("/policy/motor/pol1", `returnTo=${encodeURIComponent(quotation)}`);
    expect(isSafeReturnTo(policyReturnTo)).toBe(true);
  });

  it("rejects a value longer than the max length", () => {
    const huge = "/quotation?search=" + "a".repeat(2100);
    expect(isSafeReturnTo(huge)).toBe(false);
  });

  it("accepts a value right at the length boundary", () => {
    const atLimit = "/q?s=" + "a".repeat(1990);
    expect(atLimit.length).toBeLessThanOrEqual(2000);
    expect(isSafeReturnTo(atLimit)).toBe(true);
  });

  it("rejects a pathologically nested returnTo chain (loop/runaway protection)", () => {
    let value = "/customer/cust1";
    for (let i = 0; i < 8; i++) {
      value = `/quotation/case/case${i}?returnTo=${encodeURIComponent(value)}`;
    }
    expect(isSafeReturnTo(value)).toBe(false);
  });

  it("rejects a straightforward A -> B -> A cycle once nesting grows past the cap", () => {
    let value = "/customer/cust1";
    for (let i = 0; i < 10; i++) {
      value = i % 2 === 0
        ? `/quotation/case/case1?returnTo=${encodeURIComponent(value)}`
        : `/customer/cust1?returnTo=${encodeURIComponent(value)}`;
    }
    expect(isSafeReturnTo(value)).toBe(false);
  });
});

describe("resolveReturnTo", () => {
  it("returns the candidate when safe", () => {
    expect(resolveReturnTo("/customer/123", "/customer")).toBe("/customer/123");
  });

  it("falls back on an unsafe candidate", () => {
    expect(resolveReturnTo("https://evil.com", "/customer")).toBe("/customer");
  });

  it("falls back on a missing candidate", () => {
    expect(resolveReturnTo(null, "/customer")).toBe("/customer");
    expect(resolveReturnTo(undefined, "/customer")).toBe("/customer");
  });
});

describe("resolveReturnToAvoidingSelf (Phase 8.1 Part 13)", () => {
  it("rejects a returnTo pointing at the current page's own pathname", () => {
    expect(resolveReturnToAvoidingSelf("/policy/motor/pol1", "/policy/motor/pol1", "/policy/motor")).toBe("/policy/motor");
  });

  it("rejects self-pointing even with a different query string", () => {
    expect(resolveReturnToAvoidingSelf("/policy/motor/pol1?tab=financial", "/policy/motor/pol1", "/policy/motor")).toBe("/policy/motor");
  });

  it("accepts a returnTo pointing elsewhere", () => {
    expect(resolveReturnToAvoidingSelf("/quotation/case/case1", "/policy/motor/pol1", "/policy/motor")).toBe("/quotation/case/case1");
  });

  it("still falls back on an otherwise-unsafe candidate", () => {
    expect(resolveReturnToAvoidingSelf("https://evil.com", "/policy/motor/pol1", "/policy/motor")).toBe("/policy/motor");
  });
});

describe("buildReturnTo", () => {
  it("combines pathname and search", () => {
    expect(buildReturnTo("/quotation", "?search=CRSG&status=QUOTED&page=2")).toBe("/quotation?search=CRSG&status=QUOTED&page=2");
  });

  it("adds a leading ? if search is missing one", () => {
    expect(buildReturnTo("/quotation", "search=CRSG")).toBe("/quotation?search=CRSG");
  });

  it("returns just the pathname when there is no search", () => {
    expect(buildReturnTo("/quotation")).toBe("/quotation");
    expect(buildReturnTo("/quotation", "")).toBe("/quotation");
  });

  it("round-trips through isSafeReturnTo", () => {
    const built = buildReturnTo("/quotation", "?search=CRSG&status=QUOTED&page=2");
    expect(isSafeReturnTo(built)).toBe(true);
  });
});
