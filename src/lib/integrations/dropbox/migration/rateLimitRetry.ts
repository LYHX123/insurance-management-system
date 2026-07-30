// Narrow, bounded exponential-backoff-with-jitter wrapper for the one
// Dropbox call site Stage E activation actually exercises repeatedly
// (metadata re-resolution's per-object filesGetMetadata lookups). Stage D's
// copy phase empirically hit Dropbox rate limiting; this does not touch the
// copy engine or any existing per-module backfill code — deliberately
// scoped to activation-related retries only, not a broad retry-layer
// redesign.
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 500;
const MAX_SINGLE_DELAY_MS = 8000;
const MAX_TOTAL_DELAY_MS = 20000;

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
export async function withRateLimitBackoff<T>(fn: () => Promise<T>): Promise<T> {
  let totalDelay = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const { limited, retryAfterSeconds } = isRateLimited(err);
      if (!limited || attempt === MAX_ATTEMPTS - 1) throw err;

      const backoff = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_SINGLE_DELAY_MS);
      const jitter = Math.random() * backoff * 0.3;
      const delay = retryAfterSeconds !== undefined ? retryAfterSeconds * 1000 : backoff + jitter;

      if (totalDelay + delay > MAX_TOTAL_DELAY_MS) throw err;
      totalDelay += delay;
      await sleep(delay);
    }
  }
  throw new Error("withRateLimitBackoff: unreachable");
}
