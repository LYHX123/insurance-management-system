"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

function getPageList(page: number, totalPages: number): (number | "ellipsis")[] {
  const items: (number | "ellipsis")[] = [];
  const windowStart = Math.max(2, page - 1);
  const windowEnd = Math.min(totalPages - 1, page + 1);

  items.push(1);
  if (windowStart > 2) items.push("ellipsis");
  for (let p = windowStart; p <= windowEnd; p++) items.push(p);
  if (windowEnd < totalPages - 1) items.push("ellipsis");
  if (totalPages > 1) items.push(totalPages);

  return items;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  previousLabel = "Previous page",
  nextLabel = "Next page",
  className = "",
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  previousLabel?: string;
  nextLabel?: string;
  className?: string;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className={`flex items-center justify-end gap-1 ${className}`.trim()}>
      <button
        type="button"
        className="btn-icon"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label={previousLabel}
      >
        <ChevronLeft size={16} />
      </button>

      {getPageList(page, totalPages).map((item, index) =>
        item === "ellipsis" ? (
          <span
            key={`ellipsis-${index}`}
            className="flex h-8 w-8 items-center justify-center text-sm text-zinc-400"
          >
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            aria-current={item === page ? "page" : undefined}
            onClick={() => onPageChange(item)}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-control text-sm font-medium transition-colors ${
              item === page
                ? "bg-emerald-700 text-white"
                : "text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            {item}
          </button>
        )
      )}

      <button
        type="button"
        className="btn-icon"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label={nextLabel}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
