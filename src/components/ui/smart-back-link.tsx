"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useSmartBackHref } from "@/lib/navigation/useSmartBack";

// Unified back affordance (Phase 8 Part 5) — same icon, spacing, hover,
// focus ring, and touch target everywhere it's used, instead of every page
// hand-rolling its own `<Link><ArrowLeft/>...</Link>`. Resolves its href via
// useSmartBack (validated returnTo, else the caller's own fallback) so
// callers never construct a raw back URL themselves.
export function SmartBackLink({
  fallbackHref,
  label,
  className = "",
}: {
  fallbackHref: string;
  label: string;
  className?: string;
}) {
  const href = useSmartBackHref(fallbackHref);
  return (
    <Link
      href={href}
      className={`mb-2 inline-flex min-h-[36px] items-center gap-1.5 rounded py-1.5 text-sm text-emerald-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${className}`}
    >
      <ArrowLeft size={14} />
      {label}
    </Link>
  );
}
