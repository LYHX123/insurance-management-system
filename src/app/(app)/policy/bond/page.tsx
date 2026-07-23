"use client";

import { ComingSoon } from "@/components/coming-soon";
import { useLocale } from "@/i18n/locale-provider";

export default function BondPolicyPage() {
  const { t } = useLocale();
  return <ComingSoon moduleName={t.policy.tabBond} />;
}
