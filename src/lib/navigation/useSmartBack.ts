"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { resolveReturnToAvoidingSelf } from "./returnTo";

// The one hook every "back"/"cancel" affordance should use instead of a
// hardcoded <Link href="...">. Priority order (Phase 8 Part 2):
//   1. an explicit, validated `returnTo` query param (set by whichever list/
//      detail page linked the user here, capturing its own URL so filters/
//      search/pagination/tab survive the round trip)
//   2. the caller-supplied fallbackHref (the page's own known business
//      parent — e.g. a Quotation detail page's fallback is always
//      "/quotation", never a guess)
// There is no history-based fallback (no router.back()) — every page
// using this hook already knows its correct fallback destination, which is
// safer than trusting browser history (which can point at a login page,
// an OAuth callback, or an external referrer).
export function useSmartBackHref(fallbackHref: string): string {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const candidate = searchParams.get("returnTo");
  return resolveReturnToAvoidingSelf(candidate, pathname, fallbackHref);
}
