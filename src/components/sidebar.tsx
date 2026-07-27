"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users2,
  FileText,
  Receipt,
  ShieldCheck,
  BookText,
  ListChecks,
  UsersRound,
  Settings,
} from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { hasMenuAccess, type AuthzUser } from "@/lib/permissions";

const menuItems = [
  { href: "/dashboard", key: "dashboard", icon: LayoutDashboard },
  { href: "/customer", key: "customer", icon: Users2 },
  { href: "/quotation", key: "quotation", icon: FileText },
  { href: "/policy", key: "policy", icon: ShieldCheck },
  { href: "/invoice", key: "invoice", icon: Receipt },
  { href: "/ledger", key: "ledger", icon: BookText },
  { href: "/task", key: "task", icon: ListChecks },
  { href: "/users", key: "users", icon: UsersRound },
  { href: "/settings", key: "settings", icon: Settings },
] as const;

export function Sidebar({ user }: { user: AuthzUser }) {
  const pathname = usePathname();
  const { t } = useLocale();

  const visibleMenuItems = menuItems.filter(({ key }) =>
    hasMenuAccess(user, key)
  );

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col bg-emerald-900 text-emerald-50">
      <div className="flex h-16 items-center gap-2 border-b border-emerald-800 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-50 text-sm font-bold text-emerald-900">
          IMS
        </div>
        <span className="text-sm font-semibold tracking-wide">
          {t.login.title}
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {visibleMenuItems.map(({ href, key, icon: Icon }) => {
          const isActive =
            pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-emerald-700 text-white"
                  : "text-emerald-100/80 hover:bg-emerald-800 hover:text-white"
              }`}
            >
              <Icon size={18} strokeWidth={2} />
              {t.sidebar[key]}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
