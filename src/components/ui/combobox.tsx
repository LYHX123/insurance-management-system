"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "./input";

// Searchable "select or type your own" field — used by WIBASection.tsx for
// Occupation (preset list from wibaOccupations.ts, but any free-text value
// is accepted and never rejected). Deliberately dependency-free: no
// combobox/downshift package, just a filtered list anchored under a plain
// text input, closed on outside click. `value` is always the source of
// truth (typing freely is never blocked by the option list), so an old,
// custom occupation loaded from the database renders exactly as saved.
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  className = "",
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  placeholder?: string;
  className?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [value, options]);

  return (
    <div className="relative" ref={containerRef}>
      <Input
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        autoComplete="off"
        className={className}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-control border border-zinc-200 bg-white py-1 shadow-lg">
          {filtered.map((option) => (
            <li key={option}>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-emerald-50 hover:text-emerald-800"
                // onMouseDown (not onClick) fires before the input's onBlur,
                // so the selection registers before the dropdown would
                // otherwise close first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(option);
                  setOpen(false);
                }}
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
