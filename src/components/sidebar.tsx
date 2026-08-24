"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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
import { UnreadDot } from "@/components/ui/unread-dot";
import { subscribeToTaskActivity } from "@/lib/task/liveNotificationsClient";

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

export function Sidebar({ user, hasUnreadTask: serverHasUnreadTask = false }: { user: AuthzUser; hasUnreadTask?: boolean }) {
  const pathname = usePathname();
  const { t } = useLocale();

  const visibleMenuItems = menuItems.filter(({ key }) =>
    hasMenuAccess(user, key)
  );

  // Phase 8 — starts from the server-rendered value (authoritative on every
  // real navigation, since (app)/layout recomputes it per request) and is
  // then kept live in between navigations by re-querying
  // /api/task-notifications/unread-status whenever the SSE bus reports a
  // signal (see src/components/task/task-realtime-notifications.tsx and
  // src/lib/task/liveNotificationsClient.ts) — the user's stated preference
  // for this phase (Part G): a dedicated endpoint + client state, not
  // router.refresh().
  //
  // Re-synced from a genuinely new server-rendered value by adjusting state
  // during render (React's own recommended pattern for this — see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  // — rather than a setState-in-effect, which the project's lint config
  // treats as an error).
  const [hasUnreadTask, setHasUnreadTask] = useState(serverHasUnreadTask);
  const [prevServerHasUnreadTask, setPrevServerHasUnreadTask] = useState(serverHasUnreadTask);
  if (serverHasUnreadTask !== prevServerHasUnreadTask) {
    setPrevServerHasUnreadTask(serverHasUnreadTask);
    setHasUnreadTask(serverHasUnreadTask);
  }

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      fetch("/api/task-notifications/unread-status", { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<{ hasUnread: boolean }>) : null))
        .then((data) => {
          if (!cancelled && data && typeof data.hasUnread === "boolean") setHasUnreadTask(data.hasUnread);
        })
        .catch(() => {
          // Best-effort — a failed refresh just leaves the sidebar dot at
          // its last known value; the next real navigation still gets the
          // authoritative server-rendered one regardless.
        });
    };
    // Any signal — a specific Task/Claim's activity, or a bare resync — can
    // change the OR across Daily Task/Motor Claim/Non-Motor Claim, so every
    // signal kind triggers the same lightweight re-check here.
    const unsubscribe = subscribeToTaskActivity(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

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
              <span className="inline-flex items-center gap-1.5">
                {t.sidebar[key]}
                {key === "task" && <UnreadDot show={hasUnreadTask} />}
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
