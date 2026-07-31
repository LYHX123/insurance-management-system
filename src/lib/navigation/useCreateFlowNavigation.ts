"use client";

import { useSearchParams } from "next/navigation";
import { isSafeReturnTo } from "./returnTo";

// Shared by every "create X from Y's detail page" flow (create Policy from
// a Quotation, create Invoice from a Policy, etc.) — Phase 8 Part 2.B:
//   - Cancel should return to wherever the user actually came from (the
//     originating detail page), not a hardcoded module list.
//   - On success, the newly created record's own detail page should still
//     offer a way back to that same origin (its own back button falls back
//     to the module list otherwise).
export function useCreateFlowNavigation(fallbackListHref: string) {
  const searchParams = useSearchParams();
  const rawReturnTo = searchParams.get("returnTo");
  const validReturnTo = isSafeReturnTo(rawReturnTo) ? rawReturnTo : null;

  const cancelHref = validReturnTo ?? fallbackListHref;

  const buildSuccessHref = (detailHref: string): string =>
    validReturnTo ? `${detailHref}?returnTo=${encodeURIComponent(validReturnTo)}` : detailHref;

  return { cancelHref, buildSuccessHref, originReturnTo: validReturnTo };
}
