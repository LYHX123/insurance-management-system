import { auth } from "@/lib/auth";
import {
  hasAnyPermission,
  hasPermission,
  isAdmin,
  type PermissionKey,
} from "@/lib/permissions";

// The single set of server-side authorization primitives every page, server
// action, and API route routes through. Frontend checks (Sidebar,
// layout tab bars) are for UI/UX only — these are the source of truth.
// Each helper re-derives the session itself so callers never need to (and
// can never forget to) pass the "current" session along.

export async function requireAdmin() {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user)) return null;
  return session;
}

export async function requirePermission(key: PermissionKey) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, key)) return null;
  return session;
}

export async function requireAnyPermission(keys: readonly PermissionKey[]) {
  const session = await auth();
  if (!session?.user || !hasAnyPermission(session.user, keys)) return null;
  return session;
}
