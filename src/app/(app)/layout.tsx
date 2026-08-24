import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { hasUnreadTaskSidebarActivity } from "@/lib/task/sidebarUnread";
import { TaskRealtimeNotifications } from "@/components/task/task-realtime-notifications";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const authzUser = {
    role: session.user.role,
    status: session.user.status,
    permissions: session.user.permissions ?? [],
  };
  // Computed fresh on every server-rendered navigation (this layout is
  // already dynamic — it reads the session via auth() on every request) so
  // it reflects any Task/Motor Claim/Non-Motor Claim activity from other
  // users without requiring polling or realtime push (see this phase's
  // spec, Part 7 — Server-driven refresh only).
  const hasUnreadTask = await hasUnreadTaskSidebarActivity(session.user.id, authzUser);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Phase 8 — one SSE connection per tab, alive across every route
          under (app); see that component's doc comment. Renders nothing. */}
      <TaskRealtimeNotifications />
      <Sidebar user={authzUser} hasUnreadTask={hasUnreadTask} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar fullName={session.user.name ?? session.user.username} role={session.user.role} />
        <main className="flex-1 overflow-y-auto bg-zinc-50 p-page">
          {children}
        </main>
      </div>
    </div>
  );
}
