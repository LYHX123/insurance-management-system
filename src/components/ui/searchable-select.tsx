"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "./input";

// Searchable "pick one of these options" field — unlike Combobox (in
// combobox.tsx), the stored value is always an opaque id, never the typed
// search text itself: onChange only ever fires with an option's own id, and
// typing without picking a match leaves the previous selection cleared
// rather than substituting the typed text for it. Same dependency-free
// approach as Combobox (filtered list anchored under a plain text input,
// closed on outside click) — no combobox/downshift package.
export type SearchableSelectOption = {
  id: string;
  /** What the closed field displays once this option is selected. */
  label: string;
  /** Lowercased text this option matches against — include every field the caller wants searchable (e.g. company name + short name). */
  searchText: string;
};

/**
 * Pure filter predicate, extracted so it's unit-testable without rendering
 * the component (this codebase has no React component-testing
 * infrastructure — see __tests__/filterSearchableOptions.test.ts). Case-
 * insensitive substring match against each option's own searchText; an
 * empty/whitespace-only query returns every option unfiltered.
 */
export function filterSearchableOptions<T extends SearchableSelectOption>(options: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((o) => o.searchText.includes(q));
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  noResultsLabel,
  className = "",
  id,
  disabled,
  required,
}: {
  /** Selected option's id, or "" for none. */
  value: string;
  onChange: (id: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  noResultsLabel: string;
  className?: string;
  id?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);
  const displayValue = isEditing ? query : (selectedOption?.label ?? "");

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setIsEditing(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const filtered = useMemo(() => filterSearchableOptions(options, query), [query, options]);

  return (
    <div className="relative" ref={containerRef}>
      <Input
        id={id}
        value={displayValue}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsEditing(true);
          setOpen(true);
          if (value) onChange(""); // typing invalidates the previous selection until a new option is picked
        }}
        onFocus={() => {
          setQuery("");
          setIsEditing(true);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setIsEditing(false);
            setQuery("");
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        disabled={disabled}
        required={required}
        className={className}
      />
      {open && !disabled && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-control border border-zinc-200 bg-white py-1 shadow-lg">
          {filtered.length === 0 ? (
            <li className="px-3 py-1.5 text-sm text-zinc-400">{noResultsLabel}</li>
          ) : (
            filtered.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-emerald-50 hover:text-emerald-800"
                  // onMouseDown (not onClick) fires before the input's onBlur,
                  // so the selection registers before the dropdown would
                  // otherwise close first.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(option.id);
                    setQuery("");
                    setIsEditing(false);
                    setOpen(false);
                  }}
                >
                  {option.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
