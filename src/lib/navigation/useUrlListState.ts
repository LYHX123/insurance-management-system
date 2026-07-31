"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

// Shared list-page state helper: keeps search/filter/pagination/sort state
// in the URL (so a returnTo captured from this page restores everything),
// while debouncing the actual URL write so typing a search term doesn't
// spam history or trigger a server round-trip per keystroke (Phase 8 Part
// 6.6). Uses router.replace (never push), so this never grows the history
// stack — the list page itself only ever occupies one history entry
// regardless of how many filters the user tries.
//
// Values equal to their default are omitted from the URL entirely, so the
// address bar stays clean when nothing non-default is active.
export function useUrlListState<T extends Record<string, string>>(
  defaults: T,
  options?: { debounceMs?: number }
): [T, (updates: Partial<T>, opts?: { immediate?: boolean }) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const debounceMs = options?.debounceMs ?? 400;

  const [state, setStateInternal] = useState<T>(() => {
    const initial = { ...defaults };
    for (const key of Object.keys(defaults) as Array<keyof T>) {
      const raw = searchParams.get(String(key));
      if (raw !== null) initial[key] = raw as T[typeof key];
    }
    return initial;
  });

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncToUrl = useCallback(
    (next: T) => {
      const params = new URLSearchParams();
      for (const key of Object.keys(next)) {
        const value = next[key];
        if (value !== undefined && value !== null && value !== "" && value !== defaults[key]) {
          params.set(key, String(value));
        }
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    // defaults is expected to be a stable/module-level object per call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, pathname]
  );

  const setState = useCallback(
    (updates: Partial<T>, opts?: { immediate?: boolean }) => {
      setStateInternal((prev) => {
        const next = { ...prev, ...updates };
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (opts?.immediate) {
          syncToUrl(next);
        } else {
          timeoutRef.current = setTimeout(() => syncToUrl(next), debounceMs);
        }
        return next;
      });
    },
    [syncToUrl, debounceMs]
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return [state, setState];
}
