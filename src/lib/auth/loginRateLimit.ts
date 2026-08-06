// Production Readiness Audit V1, finding H3: bounded in-memory login
// failure tracker. No Prisma Schema change, no new infrastructure (Redis
// etc.) — this app runs as a single Node process (see docker-compose.yml's
// `app` service: one container, no replicas), so an in-process Map is a
// correct fit for the current deployment. Two important, deliberate
// consequences of that choice (documented here, not hidden):
//   1. A process restart clears all tracked failures — everyone effectively
//      gets a fresh slate. Acceptable for a login-brute-force mitigation
//      (this is not an audit trail), not acceptable if this app is ever
//      scaled to multiple instances/replicas without a shared store.
//   2. If this app is ever deployed with more than one app instance behind
//      a load balancer, each instance tracks failures independently and the
//      effective threshold becomes (instances x MAX_FAILURES). Revisit with
//      a shared store (e.g. the existing Postgres) if that ever happens.
//
// Bounded by construction: MAX_TRACKED_KEYS caps memory (oldest entry
// evicted on overflow, Map preserves insertion order), and a periodic sweep
// removes entries whose window has already expired — this is not a
// never-cleaned global Map.

export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const LOGIN_RATE_LIMIT_MAX_FAILURES = 5;

const MAX_TRACKED_KEYS = 5000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

type FailureBucket = { count: number; windowStart: number };

const failuresByKey = new Map<string, FailureBucket>();

function isExpired(bucket: FailureBucket, now: number): boolean {
  return now - bucket.windowStart > LOGIN_RATE_LIMIT_WINDOW_MS;
}

function evictOldestIfAtCapacity(): void {
  if (failuresByKey.size < MAX_TRACKED_KEYS) return;
  const oldestKey = failuresByKey.keys().next().value;
  if (oldestKey !== undefined) failuresByKey.delete(oldestKey);
}

/** True if `key` has hit the failure threshold within the current window. */
export function isRateLimited(key: string, now: number = Date.now()): boolean {
  const bucket = failuresByKey.get(key);
  if (!bucket) return false;
  if (isExpired(bucket, now)) {
    failuresByKey.delete(key);
    return false;
  }
  return bucket.count >= LOGIN_RATE_LIMIT_MAX_FAILURES;
}

/** Records one failed attempt for `key`, starting a fresh window if the previous one expired. */
export function recordFailure(key: string, now: number = Date.now()): void {
  const bucket = failuresByKey.get(key);
  if (!bucket || isExpired(bucket, now)) {
    evictOldestIfAtCapacity();
    failuresByKey.set(key, { count: 1, windowStart: now });
    return;
  }
  bucket.count += 1;
}

/** Clears any tracked failures for `key` — called after a successful login. */
export function clearFailures(key: string): void {
  failuresByKey.delete(key);
}

/** Builds the two independent tracking keys for one login attempt: per-account and per-source. */
export function loginRateLimitKeys(login: string, clientIp: string): { accountKey: string; ipKey: string } {
  return {
    accountKey: `account:${login.trim().toLowerCase()}`,
    ipKey: `ip:${clientIp}`,
  };
}

function sweepExpiredEntries(now: number = Date.now()): void {
  for (const [key, bucket] of failuresByKey) {
    if (isExpired(bucket, now)) failuresByKey.delete(key);
  }
}

// Periodic sweep so keys that are never touched again (e.g. a scanner tries
// a batch of distinct account names once each) still get cleaned up, not
// just keys that happen to be re-checked. `unref()` so this timer never
// keeps the process (or a test run) alive on its own.
/* c8 ignore start -- timer wiring, exercised indirectly via sweepExpiredEntries in tests */
if (typeof setInterval === "function") {
  const timer = setInterval(() => sweepExpiredEntries(), CLEANUP_INTERVAL_MS);
  timer.unref?.();
}
/* c8 ignore stop */

// Exposed for tests only — lets a test force a sweep without waiting for
// the real interval, without adding a "reset everything" backdoor to the
// module's real API.
export const __test__ = { sweepExpiredEntries, trackedKeyCount: () => failuresByKey.size };
