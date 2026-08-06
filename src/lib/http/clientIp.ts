// Production Readiness Audit V1, finding H3: best-effort client IP
// extraction for login rate limiting. This app runs behind a reverse proxy
// in production (Nginx — see DEPLOYMENT.md; auth.ts already sets
// `trustHost: true` for the same reason), which is expected to set
// X-Forwarded-For. If that header is absent (local dev without a proxy, or
// a misconfigured proxy), every direct connection falls back to sharing one
// "unknown" bucket — a graceful degradation, not a crash, but it does mean
// the per-source limit effectively becomes global in that situation. The
// per-account limit (see loginRateLimit.ts) is unaffected either way.
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const firstHop = forwardedFor?.split(",")[0]?.trim();
  if (firstHop) return firstHop;

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown";
}
