// Shared, bounded exponential-backoff-with-jitter wrapper for Dropbox API
// calls that may hit rate limiting (HTTP 429) — promoted out of the
// migration module (Phase 8 Part 8) since Stage D's copy phase empirically
// showed this Dropbox app gets rate-limited more aggressively than
// expected, and the same risk applies to ordinary backfill/retry/verify
// calls, not just migration.
//
// Two presets are exported rather than one fixed bound: a background batch
// operation (migration copy/verify, backfill batches) can reasonably wait
// several seconds per retry, but a single interactive admin click (Retry
// Sync / Verify on one record) must not block a request for that long
// (Part 8 item 9 — "a single ordinary interaction must not block for too
// long"). Callers pick whichever preset matches their context, or pass a
// custom one.
export type BackoffOptions = {
  maxAttempts: number;
  baseDelayMs: number;
  maxSingleDelayMs: number;
  maxTotalDelayMs: number;
};

// Migration/backfill batches, verify batches, pending-sync replay — running
// server-side, already batch-bounded, tolerant of a few extra seconds.
export const BATCH_BACKOFF: BackoffOptions = {
  maxAttempts: 5,
  baseDelayMs: 500,
  maxSingleDelayMs: 8000,
  maxTotalDelayMs: 20000,
};

// A single admin-triggered click (Retry/Verify on one record) — bounded
// much tighter so the request never appears to hang.
export const INTERACTIVE_BACKOFF: BackoffOptions = {
  maxAttempts: 3,
  baseDelayMs: 300,
  maxSingleDelayMs: 1500,
  maxTotalDelayMs: 3000,
};

type RateLimitInfo = { limited: boolean; retryAfterSeconds?: number };

function isRateLimited(err: unknown): RateLimitInfo {
  if (!err || typeof err !== "object" || !("status" in err)) return { limited: false };
  const status = (err as { status: unknown }).status;
  if (status !== 429) return { limited: false };

  const error = (err as { error?: unknown }).error;
  let retryAfterSeconds: number | undefined;
  if (error && typeof error === "object") {
    const direct = (error as { retry_after?: unknown }).retry_after;
    if (typeof direct === "number") retryAfterSeconds = direct;
    const nested = (error as { error?: { retry_after?: unknown } }).error?.retry_after;
    if (retryAfterSeconds === undefined && typeof nested === "number") retryAfterSeconds = nested;
  }
  return { limited: true, retryAfterSeconds };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Respects Dropbox's own Retry-After value when supplied; otherwise falls
// back to exponential backoff with jitter. Bounded attempts AND bounded
// total delay, so a persistently rate-limited call fails loudly (caller's
// existing per-object error handling takes over) rather than hanging.
// Idempotent by construction — this only ever retries the exact same call,
// never duplicates a create/upload/copy as a side effect of retrying.
export async function withRateLimitBackoff<T>(fn: () => Promise<T>, options: BackoffOptions = BATCH_BACKOFF): Promise<T> {
  let totalDelay = 0;
  for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const { limited, retryAfterSeconds } = isRateLimited(err);
      if (!limited || attempt === options.maxAttempts - 1) throw err;

      const backoff = Math.min(options.baseDelayMs * 2 ** attempt, options.maxSingleDelayMs);
      const jitter = Math.random() * backoff * 0.3;
      const delay = retryAfterSeconds !== undefined ? retryAfterSeconds * 1000 : backoff + jitter;

      if (totalDelay + delay > options.maxTotalDelayMs) throw err;
      totalDelay += delay;
      await sleep(delay);
    }
  }
  throw new Error("withRateLimitBackoff: unreachable");
}
