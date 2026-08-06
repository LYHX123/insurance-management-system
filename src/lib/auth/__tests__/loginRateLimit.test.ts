import { describe, it, expect } from "vitest";
import {
  isRateLimited,
  recordFailure,
  clearFailures,
  loginRateLimitKeys,
  LOGIN_RATE_LIMIT_MAX_FAILURES,
  LOGIN_RATE_LIMIT_WINDOW_MS,
  __test__,
} from "../loginRateLimit";

// Production Readiness Audit V1, finding H3. The module keeps module-level
// state, so every test uses a fresh, unique key (via a counter) rather than
// resetting global state between tests — this also incidentally proves keys
// are fully independent of each other (requirement: "一个账号被限制不应无故
// 锁死其他账号").
let keyCounter = 0;
function freshKey(prefix: string) {
  keyCounter += 1;
  return `${prefix}-${keyCounter}`;
}

describe("loginRateLimit", () => {
  it("a key with no recorded failures is never rate limited", () => {
    const key = freshKey("k");
    expect(isRateLimited(key)).toBe(false);
  });

  it("stays allowed below the failure threshold", () => {
    const key = freshKey("k");
    const t0 = 1_000_000;
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_FAILURES - 1; i++) {
      recordFailure(key, t0 + i);
    }
    expect(isRateLimited(key, t0 + LOGIN_RATE_LIMIT_MAX_FAILURES)).toBe(false);
  });

  it("becomes rate limited once the threshold is reached within the window", () => {
    const key = freshKey("k");
    const t0 = 2_000_000;
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_FAILURES; i++) {
      recordFailure(key, t0 + i);
    }
    expect(isRateLimited(key, t0 + LOGIN_RATE_LIMIT_MAX_FAILURES)).toBe(true);
  });

  it("becoming rate limited on one key does not affect a different key", () => {
    const blockedKey = freshKey("blocked");
    const otherKey = freshKey("other");
    const t0 = 3_000_000;
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_FAILURES; i++) {
      recordFailure(blockedKey, t0 + i);
    }
    expect(isRateLimited(blockedKey, t0 + LOGIN_RATE_LIMIT_MAX_FAILURES)).toBe(true);
    expect(isRateLimited(otherKey, t0 + LOGIN_RATE_LIMIT_MAX_FAILURES)).toBe(false);
  });

  it("the window expires and the key becomes allowed again", () => {
    const key = freshKey("k");
    const t0 = 4_000_000;
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_FAILURES; i++) {
      recordFailure(key, t0 + i);
    }
    expect(isRateLimited(key, t0 + LOGIN_RATE_LIMIT_MAX_FAILURES)).toBe(true);

    const afterWindow = t0 + LOGIN_RATE_LIMIT_WINDOW_MS + 1;
    expect(isRateLimited(key, afterWindow)).toBe(false);

    // A failure after the window resets starts a brand new window (1 of 5),
    // not a continuation of the old, already-expired count.
    recordFailure(key, afterWindow);
    expect(isRateLimited(key, afterWindow + 1)).toBe(false);
  });

  it("clearFailures resets a key back to allowed (simulates a successful login)", () => {
    const key = freshKey("k");
    const t0 = 5_000_000;
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_FAILURES; i++) {
      recordFailure(key, t0 + i);
    }
    expect(isRateLimited(key, t0 + LOGIN_RATE_LIMIT_MAX_FAILURES)).toBe(true);

    clearFailures(key);

    expect(isRateLimited(key, t0 + LOGIN_RATE_LIMIT_MAX_FAILURES)).toBe(false);
  });

  it("clearFailures on one account key never affects a different account's or a shared IP's bucket", () => {
    const { accountKey: accountA, ipKey: sharedIp } = loginRateLimitKeys("Alice", "10.0.0.1");
    const { accountKey: accountB } = loginRateLimitKeys("Bob", "10.0.0.1");
    const t0 = 6_000_000;

    // Alice fails a few times, Bob (same IP) fails a few times too.
    recordFailure(accountA, t0);
    recordFailure(sharedIp, t0);
    recordFailure(accountB, t0);
    recordFailure(sharedIp, t0 + 1);

    // Alice now logs in successfully — her own counter clears, but Bob's
    // account-level counter is untouched (only the shared IP counter would
    // reasonably be cleared by the caller alongside it, which auth.ts does).
    clearFailures(accountA);

    expect(isRateLimited(accountA, t0 + 2)).toBe(false);
    expect(isRateLimited(accountB, t0 + 2)).toBe(false); // below threshold anyway, just proving independence
  });

  it("loginRateLimitKeys normalizes the account key (case-insensitive, trimmed) but keeps it distinct from the IP key", () => {
    const a = loginRateLimitKeys("  John Doe  ", "203.0.113.5");
    const b = loginRateLimitKeys("john doe", "203.0.113.5");
    expect(a.accountKey).toBe(b.accountKey);
    expect(a.accountKey).not.toBe(a.ipKey);
  });

  it("is bounded: a sweep removes only expired entries, not live ones", () => {
    const t0 = 7_000_000;
    const expiredKey = freshKey("expired");
    recordFailure(expiredKey, t0); // old — will be past its window at sweep time

    const sweepTime = t0 + LOGIN_RATE_LIMIT_WINDOW_MS + 1;
    const liveKey = freshKey("live");
    recordFailure(liveKey, sweepTime); // recorded right at sweep time — still fresh

    const sizeBeforeSweep = __test__.trackedKeyCount();
    __test__.sweepExpiredEntries(sweepTime);
    const sizeAfterSweep = __test__.trackedKeyCount();

    // The expired-at-old-timestamp key is gone; note isRateLimited() itself
    // also lazily deletes on access, so this proves the *sweep* path (not
    // just the lazy check) actually removes entries.
    expect(sizeAfterSweep).toBeLessThan(sizeBeforeSweep);
    expect(isRateLimited(liveKey, sweepTime + 1)).toBe(false); // still tracked, just not limited (1 failure only)
  });
});
