"use client";

import { X } from "lucide-react";

type ModalWidth = "sm" | "md" | "lg";

const WIDTH_CLASS: Record<ModalWidth, string> = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
};

export function Modal({
  title,
  onClose,
  children,
  width = "sm",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: ModalWidth;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className={`flex max-h-[90vh] w-full ${WIDTH_CLASS[width]} flex-col rounded-surface bg-white p-card shadow-lg`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="section-title">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600"
          >
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
