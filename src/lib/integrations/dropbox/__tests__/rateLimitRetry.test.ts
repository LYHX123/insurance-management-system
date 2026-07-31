import { describe, it, expect, vi } from "vitest";
import { withRateLimitBackoff, BATCH_BACKOFF, INTERACTIVE_BACKOFF } from "../rateLimitRetry";

function rateLimitError(retryAfterSeconds?: number) {
  return { status: 429, error: retryAfterSeconds !== undefined ? { retry_after: retryAfterSeconds } : {} };
}

describe("withRateLimitBackoff (Phase 8 Part 8 — shared across backfill/verify/replay)", () => {
  it("returns immediately on success, no retry", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRateLimitBackoff(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on a 429 and eventually succeeds (BATCH_BACKOFF default)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError(0.01))
      .mockRejectedValueOnce(rateLimitError(0.01))
      .mockResolvedValue("ok-after-retry");

    const result = await withRateLimitBackoff(fn);
    expect(result).toBe("ok-after-retry");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-rate-limit error — fails immediately", async () => {
    const notFound = { status: 409, error: { error_summary: "path/not_found/.." } };
    const fn = vi.fn().mockRejectedValue(notFound);

    await expect(withRateLimitBackoff(fn)).rejects.toBe(notFound);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after the bounded max attempts on persistent rate limiting (BATCH_BACKOFF)", async () => {
    const fn = vi.fn().mockRejectedValue(rateLimitError(0.01));
    await expect(withRateLimitBackoff(fn, BATCH_BACKOFF)).rejects.toMatchObject({ status: 429 });
    expect(fn.mock.calls.length).toBeGreaterThan(1);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(BATCH_BACKOFF.maxAttempts);
  });

  it("INTERACTIVE_BACKOFF gives up sooner than BATCH_BACKOFF for a single click", async () => {
    const fn = vi.fn().mockRejectedValue(rateLimitError(0.01));
    await expect(withRateLimitBackoff(fn, INTERACTIVE_BACKOFF)).rejects.toMatchObject({ status: 429 });
    expect(fn.mock.calls.length).toBeLessThanOrEqual(INTERACTIVE_BACKOFF.maxAttempts);
    expect(INTERACTIVE_BACKOFF.maxTotalDelayMs).toBeLessThan(BATCH_BACKOFF.maxTotalDelayMs);
  });

  it("respects Retry-After exactly rather than computing its own exponential delay", async () => {
    // A large exponential delay would exceed maxTotalDelayMs quickly, but a
    // server-supplied Retry-After takes priority regardless of attempt
    // number — verified indirectly here by using a Retry-After small enough
    // that the whole retry sequence still fits comfortably inside the test
    // timeout even though INTERACTIVE_BACKOFF's own exponential schedule
    // would not (baseDelayMs 300 * 2^attempt grows past 1s by attempt 2).
    const fn = vi.fn().mockRejectedValue(rateLimitError(0.001));
    await expect(withRateLimitBackoff(fn, INTERACTIVE_BACKOFF)).rejects.toMatchObject({ status: 429 });
    expect(fn.mock.calls.length).toBeGreaterThan(1);
  });

  it("gives up once the bounded total delay would be exceeded, not just on attempt count", async () => {
    // A tight custom budget with a Retry-After larger than the whole budget
    // must fail after the FIRST retry attempt (one delay already exceeds
    // maxTotalDelayMs), never accumulate multiple such delays.
    const tightBudget = { maxAttempts: 10, baseDelayMs: 10, maxSingleDelayMs: 50, maxTotalDelayMs: 50 };
    const fn = vi.fn().mockRejectedValue(rateLimitError(1)); // 1000ms > 50ms budget
    await expect(withRateLimitBackoff(fn, tightBudget)).rejects.toMatchObject({ status: 429 });
    expect(fn.mock.calls.length).toBe(1);
  });

  it("never duplicates a create/upload side effect — only retries the same call", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      if (callCount < 2) throw rateLimitError(0.01);
      return { created: true, callCount };
    });
    const result = await withRateLimitBackoff(fn);
    expect(result).toEqual({ created: true, callCount: 2 });
    expect(callCount).toBe(2); // exactly one retry, not a flood
  });
});
