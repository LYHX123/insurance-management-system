"use client";

import Link from "next/link";
import {
  ShieldCheck,
  Wallet,
  Landmark,
  Car,
  FileWarning,
  ListTodo,
  CalendarClock,
  Users2,
  type LucideIcon,
} from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/components/ui/money-input";
import type { StatCard, StatCardKey } from "@/lib/dashboard/types";

const ICON: Record<StatCardKey, LucideIcon> = {
  activePolicies: ShieldCheck,
  clientPremiumOutstanding: Wallet,
  insurerPaymentOutstanding: Landmark,
  openMotorClaims: Car,
  openNonMotorClaims: FileWarning,
  overdueDailyTasks: ListTodo,
  policiesExpiringSoon: CalendarClock,
  activeCustomers: Users2,
};

export function StatCardGrid({ currency, cards }: { currency: string; cards: StatCard[] }) {
  const { t } = useLocale();

  if (cards.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = ICON[card.key];
        return (
          <Link key={card.key} href={card.targetUrl}>
            <Card className="flex flex-col gap-2 transition-shadow hover:shadow-md">
              <div className="flex items-center justify-between">
                <p className="text-secondary text-xs font-medium">{t.dashboard.statCards[card.key]}</p>
                <Icon size={18} className="shrink-0 text-emerald-700" />
              </div>
              <p className="text-xl font-semibold text-zinc-900">
                {card.isMoney ? `${currency} ${formatMoney(card.value)}` : card.value.toLocaleString()}
              </p>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
