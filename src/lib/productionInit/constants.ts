// Production Initialization — shared constants. See execute.ts's doc
// comment for the full design rationale.

// Must be typed EXACTLY (case-sensitive, no surrounding/embedded
// whitespace tolerance) — never trim() or fuzzy-match this anywhere,
// front or back end (Part 4/7 of this feature's spec).
export const CONFIRMATION_TEXT = "INITIALIZE SYSTEM";

// A single, fixed Postgres advisory-lock key — arbitrary but stable, chosen
// to be extremely unlikely to collide with any other advisory lock this
// application (or a future one) might ever take. Never reuse this key for
// anything else. Well within Number.MAX_SAFE_INTEGER, and the query that
// uses it always casts explicitly to ::bigint (see execute.ts) so it's
// never ambiguous with the separate two-int4-argument overload of
// pg_try_advisory_xact_lock.
export const ADVISORY_LOCK_KEY = 8930071142;

// A RUNNING log row older than this is treated as abandoned (crashed
// process / killed container mid-run, never a genuinely still-running
// operation — the whole deletion is expected to take low single-digit
// seconds to at most a couple of minutes on a very large dataset) and is
// auto-transitioned to FAILED so the feature can never be permanently
// locked out by one bad run (spec Part 17: "不要让一次服务器重启导致功能永久锁死").
export const STALE_RUNNING_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

// Minimum time between two successful initializations.
export const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

// Strict, server-side-only check — the raw env var value is never sent to
// the client (see the API routes: only a derived boolean is ever returned,
// and even that only to an already-authenticated admin). Every other value
// (unset, "false", "TRUE", "1", "yes", trailing whitespace, ...) is treated
// as disabled — see this feature's spec, Part 2.
export function isProductionInitializationEnabled(): boolean {
  return process.env.ENABLE_PRODUCTION_INITIALIZATION === "true";
}

// The fixed set of reasons an admin may record for a run — validated
// server-side against this exact whitelist (execute.ts), never an
// arbitrary client-supplied string. Shared between server (validation) and
// client (dropdown options) — this module has no server-only imports, so
// it's safe to import from either side.
export const PRODUCTION_INIT_REASONS = ["PRODUCTION_GO_LIVE", "SYSTEM_RESET", "TESTING", "OTHER"] as const;
export type ProductionInitReason = (typeof PRODUCTION_INIT_REASONS)[number];

export function isValidProductionInitReason(value: unknown): value is ProductionInitReason {
  return typeof value === "string" && (PRODUCTION_INIT_REASONS as readonly string[]).includes(value);
}
