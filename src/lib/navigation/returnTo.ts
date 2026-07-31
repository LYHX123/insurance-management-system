// Shared, isomorphic (server + client safe) validation for the `returnTo`
// query parameter used by the smart-back navigation system. Never trust a
// browser-supplied returnTo value directly — this is the one place that
// decides whether a candidate destination is safe to navigate to, and every
// caller (useSmartBack, server actions that redirect post-submit, etc.)
// must go through it rather than re-implementing its own check.
//
// Rules (all must hold):
//   - must start with "/" (relative, same-origin path)
//   - must NOT start with "//" (protocol-relative — would leave the app)
//   - must NOT contain "://" or start with "javascript:"/"data:" etc.
//   - must NOT point at /login, any /api/* route, or the Dropbox OAuth
//     connect/callback routes — those are one-shot/auth flows, never a
//     legitimate "page to return to"
const DISALLOWED_PREFIXES = ["/login", "/api/", "/access-denied"];

// Phase 8.1 Part 13 — chain-length/loop guards. Every hop that forwards its
// own returnTo into a new one (buildReturnTo(pathname, search) where search
// already contains a `returnTo=`) makes the value longer and adds one more
// nested `returnTo=` occurrence; both are cheap, sufficient signals to
// reject a runaway or maliciously-crafted chain WITHOUT needing to actually
// parse/walk the chain (Part 13: "不要过度设计成复杂全局路由框架"). A normal
// real chain (Customer -> Quotation -> Policy -> Invoice) nests 3 deep at
// most, so a cap of 6 leaves generous headroom while still bounding growth.
const MAX_RETURN_TO_LENGTH = 2000;
const MAX_RETURN_TO_NESTING = 6;

export function isSafeReturnTo(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.length > MAX_RETURN_TO_LENGTH) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (/^\/\s*\//.test(value)) return false; // "/ /evil.com" style whitespace tricks
  if (value.includes("://")) return false;
  if (/[\x00-\x1f]/.test(value)) return false;
  const lower = value.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("vbscript:")) return false;
  if (DISALLOWED_PREFIXES.some((prefix) => lower.startsWith(prefix))) return false;
  // Count nested `returnTo` occurrences without decoding (a malicious or
  // pathological value could nest arbitrarily; decoding it just to count
  // would itself be wasted work on something we're about to reject anyway).
  // Deliberately matches the bare word, not "returnto=" — every nesting
  // level past the outermost one has its own "=" percent-encoded away by
  // the encodeURIComponent() call that embedded it, but the letters
  // "returnTo" themselves are never escaped, so this is the signal that
  // actually survives every encoding layer.
  const nesting = (lower.match(/returnto/g) ?? []).length;
  if (nesting > MAX_RETURN_TO_NESTING) return false;
  return true;
}

// Returns the validated returnTo, or `fallback` when the candidate is
// missing/unsafe. Every consumer of a user/URL-supplied returnTo must go
// through this rather than using the raw value directly.
export function resolveReturnTo(candidate: unknown, fallback: string): string {
  return isSafeReturnTo(candidate) ? candidate : fallback;
}

// Phase 8.1 Part 13 — used by useSmartBackHref. A returnTo whose own
// pathname is the CURRENT page is never a legitimate "go back to" target
// (it would just reload the page you're already on); reject it the same as
// an unsafe candidate rather than resolving to a self-loop.
export function resolveReturnToAvoidingSelf(candidate: unknown, currentPathname: string, fallback: string): string {
  if (typeof candidate === "string" && candidate.split("?")[0] === currentPathname) return fallback;
  return resolveReturnTo(candidate, fallback);
}

// Builds a `returnTo` query value from the current location (pathname +
// search) — used when linking FROM a list page INTO a detail/edit/create
// page, so the destination page can offer a safe way back that preserves
// whatever filters/search/pagination were active.
export function buildReturnTo(pathname: string, search?: string): string {
  const query = search && search.length > 0 ? (search.startsWith("?") ? search : `?${search}`) : "";
  return `${pathname}${query}`;
}
