import { describe, it, expect, vi } from "vitest";
import { withRateLimitBackoff } from "../rateLimitRetry";

function rateLimitError(retryAfterSeconds?: number) {
  return { status: 429, error: retryAfterSeconds !== undefined ? { retry_after: retryAfterSeconds } : {} };
}

describe("withRateLimitBackoff (Stage E Part 10 — rate-limit safety)", () => {
  it("returns immediately on success, no retry", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRateLimitBackoff(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on a 429 and eventually succeeds", async () => {
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

  it("gives up after the bounded max attempts on persistent rate limiting", async () => {
    const fn = vi.fn().mockRejectedValue(rateLimitError(0.01));

    await expect(withRateLimitBackoff(fn)).rejects.toMatchObject({ status: 429 });
    expect(fn.mock.calls.length).toBeGreaterThan(1);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(5);
  });
});
