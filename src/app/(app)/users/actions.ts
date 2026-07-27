"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { isAdminRole, sanitizePermissions } from "@/lib/permissions";
import { normalizeFullName, usernameFromFullName } from "@/lib/users/fullName";
import { isValidKenyanPhone } from "@/lib/validators";
import type { Locale, UserStatus } from "@/generated/prisma/enums";

type ActionResult = { success: true } | { success: false; error: string };

const MIN_PASSWORD_LENGTH = 8;

function validateRoleAndPhone(
  role: string,
  phoneNumber: string | null | undefined
): { error: string } | { role: string; phoneNumber: string | null } {
  const trimmedRole = role.trim();
  if (!trimmedRole) return { error: "ROLE_REQUIRED" };

  const trimmedPhone = phoneNumber?.trim() || null;
  if (trimmedPhone && !isValidKenyanPhone(trimmedPhone)) {
    return { error: "INVALID_PHONE" };
  }

  return { role: trimmedRole, phoneNumber: trimmedPhone };
}

// Counts ACTIVE users whose role normalizes to ADMIN — the basis for every
// "last active administrator" protection below. Fetched in memory (never a
// large table for an internal admin panel) so normalization stays identical
// to isAdminRole() everywhere, rather than duplicating the rule as a DB-level
// string comparison.
async function countActiveAdmins(excludingUserId?: string): Promise<number> {
  const activeUsers = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, role: true },
  });
  return activeUsers.filter(
    (u) => u.id !== excludingUserId && isAdminRole(u.role)
  ).length;
}

async function findByFullNameCaseInsensitive(fullName: string, excludingId?: string) {
  return prisma.user.findFirst({
    where: {
      fullName: { equals: fullName, mode: "insensitive" },
      ...(excludingId ? { NOT: { id: excludingId } } : {}),
    },
  });
}

async function generateUniqueUsername(fullName: string): Promise<string> {
  const base = usernameFromFullName(fullName);
  let candidate = base;
  let suffix = 1;
  // Extremely unlikely (fullName is already globally unique case-insensitively)
  // — only collides against a legacy pre-migration username like "admin"
  // that doesn't match any fullName. Bounded retry, never an infinite loop.
  while (await prisma.user.findUnique({ where: { username: candidate } })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

export async function createUserAction(data: {
  fullName: string;
  password: string;
  role: string;
  phoneNumber?: string | null;
  permissions: string[];
  preferredLanguage: Locale;
}): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const validated = validateRoleAndPhone(data.role, data.phoneNumber);
  if ("error" in validated) return { success: false, error: validated.error };

  const fullName = normalizeFullName(data.fullName);
  if (!fullName) return { success: false, error: "FULLNAME_REQUIRED" };

  if (data.password.length < MIN_PASSWORD_LENGTH) {
    return { success: false, error: "PASSWORD_TOO_SHORT" };
  }

  const existing = await findByFullNameCaseInsensitive(fullName);
  if (existing) return { success: false, error: "FULLNAME_TAKEN" };

  const passwordHash = await bcrypt.hash(data.password, 10);
  const username = await generateUniqueUsername(fullName);

  // ADMIN always has full access via role, regardless of what was submitted
  // (the form disables/hides the checkboxes for ADMIN) — never persist a
  // stale/misleading permissions array for an admin account.
  const permissions = isAdminRole(validated.role)
    ? []
    : sanitizePermissions(data.permissions);

  await prisma.user.create({
    data: {
      username,
      fullName,
      passwordHash,
      role: validated.role,
      phoneNumber: validated.phoneNumber,
      permissions,
      preferredLanguage: data.preferredLanguage,
    },
  });

  revalidatePath("/users");
  return { success: true };
}

export async function updateUserAction(
  id: string,
  data: {
    fullName: string;
    role: string;
    phoneNumber?: string | null;
    permissions: string[];
    preferredLanguage: Locale;
  }
): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return { success: false, error: "NOT_FOUND" };

  const validated = validateRoleAndPhone(data.role, data.phoneNumber);
  if ("error" in validated) return { success: false, error: validated.error };

  const fullName = normalizeFullName(data.fullName);
  if (!fullName) return { success: false, error: "FULLNAME_REQUIRED" };

  const existing = await findByFullNameCaseInsensitive(fullName, id);
  if (existing) return { success: false, error: "FULLNAME_TAKEN" };

  // Closing an obvious loophole in "the last active ADMIN cannot be deleted
  // or deactivated": demoting their role away from ADMIN is equivalent and
  // must be blocked the same way.
  const wasAdmin = isAdminRole(target.role);
  const willBeAdmin = isAdminRole(validated.role);
  if (wasAdmin && !willBeAdmin && target.status === "ACTIVE") {
    const activeAdmins = await countActiveAdmins();
    if (activeAdmins <= 1) {
      return { success: false, error: "LAST_ADMIN_ROLE_CHANGE_BLOCKED" };
    }
  }

  const permissions = willBeAdmin ? [] : sanitizePermissions(data.permissions);

  // Full Name is the login identifier now, but the legacy `username` column
  // is left completely untouched on every edit — it only exists for pre-
  // migration accounts' legacy login compatibility (see auth.ts), and
  // resyncing it here would silently break that compatibility.
  await prisma.user.update({
    where: { id },
    data: {
      fullName,
      role: validated.role,
      phoneNumber: validated.phoneNumber,
      permissions,
      preferredLanguage: data.preferredLanguage,
    },
  });

  revalidatePath("/users");
  return { success: true };
}

export async function deleteUserAction(id: string): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };
  if (session.user.id === id) {
    return { success: false, error: "CANNOT_DELETE_SELF" };
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return { success: false, error: "NOT_FOUND" };

  if (target.status === "ACTIVE" && isAdminRole(target.role)) {
    const activeAdmins = await countActiveAdmins();
    if (activeAdmins <= 1) {
      return { success: false, error: "LAST_ADMIN_DELETE_BLOCKED" };
    }
  }

  await prisma.user.delete({ where: { id } });

  revalidatePath("/users");
  return { success: true };
}

export async function toggleUserStatusAction(
  id: string,
  status: UserStatus
): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };
  if (session.user.id === id) {
    return { success: false, error: "CANNOT_DISABLE_SELF" };
  }

  if (status === "DISABLED") {
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return { success: false, error: "NOT_FOUND" };
    if (target.status === "ACTIVE" && isAdminRole(target.role)) {
      const activeAdmins = await countActiveAdmins();
      if (activeAdmins <= 1) {
        return { success: false, error: "LAST_ADMIN_DISABLE_BLOCKED" };
      }
    }
  }

  await prisma.user.update({ where: { id }, data: { status } });

  revalidatePath("/users");
  return { success: true };
}

export async function resetPasswordAction(
  id: string,
  newPassword: string
): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { success: false, error: "PASSWORD_TOO_SHORT" };
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id }, data: { passwordHash } });

  revalidatePath("/users");
  return { success: true };
}
