"use client";

import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Button } from "@/components/ui/button";

export function AccessDeniedContent({ href }: { href: string | null }) {
  const { t } = useLocale();

  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 rounded-surface border border-dashed border-zinc-300 bg-white text-center">
      <ShieldAlert size={40} className="text-red-600" />
      <h2 className="section-title">{t.accessDenied.title}</h2>
      <p className="max-w-sm text-secondary">{t.accessDenied.message}</p>
      {href && (
        <Link href={href}>
          <Button className="mt-2">{t.accessDenied.backButton}</Button>
        </Link>
      )}
    </div>
  );
}
