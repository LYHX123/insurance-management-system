import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasUnreadTaskSidebarActivity } from "@/lib/task/sidebarUnread";

// Phase 8 — lightweight polling target the Sidebar's client-side hook calls
// after an SSE "something may have changed" signal (or on visibilitychange
// regain). Deliberately the SAME hasUnreadTaskSidebarActivity function
// (app)/layout.tsx uses for the server-rendered initial paint — this is not
// a second, parallel unread computation (this phase's spec, Part A5: "不允许
// 因为 Phase 8 再引入第二套 unread 状态"), just a second call site for the
// identical one.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ hasUnread: false }, { status: 401 });
  }

  const hasUnread = await hasUnreadTaskSidebarActivity(session.user.id, {
    role: session.user.role,
    status: session.user.status,
    permissions: session.user.permissions ?? [],
  });

  return NextResponse.json({ hasUnread });
}
