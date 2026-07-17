"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Card } from "./card";

export function CollapsibleCard({
  title,
  defaultOpen = true,
  actions,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="flex flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown size={18} className={`shrink-0 text-zinc-400 transition-transform ${open ? "" : "-rotate-90"}`} />
          <h2 className="section-title">{title}</h2>
        </button>
        {actions}
      </div>
      {open && <div className="mt-4">{children}</div>}
    </Card>
  );
}
