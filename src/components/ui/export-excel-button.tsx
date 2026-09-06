"use client";

import { Download } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Button } from "@/components/ui/button";

// Phase 13A — the shared "Export Excel" toolbar button (Customer list + the
// four Policy lists). A plain download link to the server-side export route,
// styled like every other secondary toolbar action.
export function ExportExcelButton({ href }: { href: string }) {
  const { t } = useLocale();
  return (
    <a href={href} aria-label={t.common.exportExcel}>
      <Button variant="secondary">
        <Download size={16} />
        {t.common.exportExcel}
      </Button>
    </a>
  );
}
