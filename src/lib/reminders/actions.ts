"use server";

import { auth } from "@/lib/auth";
import { isActiveUser } from "@/lib/permissions";
import { getRemindersForUser, type RemindersResult } from "./service";

// The single protected entry point the reminder popup/bell calls (Part 18).
// Authentication and "inactive user" are enforced here directly from the
// server session — never from anything the client sends. Permission
// filtering happens inside getRemindersForUser, driven by that same
// session's role/status/permissions.
export async function getRemindersAction(): Promise<RemindersResult> {
  const session = await auth();
  if (!session?.user || !isActiveUser(session.user)) {
    return { items: [], loginReminderPopupEnabled: false };
  }

  try {
    return await getRemindersForUser(session.user);
  } catch (err) {
    // Safe, non-sensitive technical log only — never surfaced to the
    // client, never a stack trace in the response (Part 18.8/18.9).
    console.error("Failed to compute reminders for user:", session.user.id, err);
    return { items: [], loginReminderPopupEnabled: false };
  }
}
