"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";

// Shown on a Policy list page right after a permanent delete redirects here
// with ?deleted=<recordNumber>. Strips the query param on mount (via
// router.replace, no history entry) so a later page refresh/back-navigation
// doesn't re-show it.
export function PolicyDeleteSuccessBanner({ listPath }: { listPath: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [recordNumber] = useState(() => searchParams.get("deleted"));

  useEffect(() => {
    if (searchParams.get("deleted")) {
      router.replace(listPath);
    }
    // Intentionally run once on mount only — this only ever needs to strip
    // the query param the page was first loaded with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!recordNumber) return null;

  return (
    <div className="flex items-center justify-between rounded-surface border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
      <span>{t.policy.deletePolicySuccess.replace("{recordNumber}", recordNumber)}</span>
      <button type="button" className="text-emerald-600 hover:text-emerald-800" onClick={() => router.replace(listPath)}>
        <X size={16} />
      </button>
    </div>
  );
}
