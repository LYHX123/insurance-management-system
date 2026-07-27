"use server";

import { auth } from "@/lib/auth";
import { isActiveUser } from "@/lib/permissions";
import { getDashboardData } from "./service";
import type { DashboardData } from "./types";

// Part 2/18 — authentication + "inactive user denied" enforced directly
// from the server session; every downstream permission filter derives from
// that same session (never anything the client could influence).
export async function getDashboardDataAction(): Promise<DashboardData | null> {
  const session = await auth();
  if (!session?.user || !isActiveUser(session.user)) return null;

  try {
    return await getDashboardData(session.user);
  } catch (err) {
    // Safe, non-sensitive technical log only (Part 22.2/22.3) — never a
    // stack trace or raw error surfaced to the client.
    console.error("Failed to compute dashboard data for user:", session.user.id, err);
    return null;
  }
}
