"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess, sanitizePermissions } from "@/lib/permissions";
import { isValidKenyanPhone } from "@/lib/validators";
import type { Locale, UserStatus } from "@/generated/prisma/enums";

type ActionResult = { success: true } | { success: false; error: string };

async function requireUsersPermission() {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "users")) {
    return null;
  }
  return session;
}

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

export async function createUserAction(data: {
  username: string;
  fullName: string;
  password: string;
  role: string;
  phoneNumber?: string | null;
  permissions: string[];
  preferredLanguage: Locale;
}): Promise<ActionResult> {
  const session = await requireUsersPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const validated = validateRoleAndPhone(data.role, data.phoneNumber);
  if ("error" in validated) return { success: false, error: validated.error };

  const existing = await prisma.user.findUnique({
    where: { username: data.username },
  });
  if (existing) return { success: false, error: "USERNAME_TAKEN" };

  const passwordHash = await bcrypt.hash(data.password, 10);

  await prisma.user.create({
    data: {
      username: data.username,
      fullName: data.fullName,
      passwordHash,
      role: validated.role,
      phoneNumber: validated.phoneNumber,
      permissions: sanitizePermissions(data.permissions),
      preferredLanguage: data.preferredLanguage,
    },
  });

  revalidatePath("/users");
  return { success: true };
}

export async function updateUserAction(
  id: string,
  data: {
    username: string;
    fullName: string;
    role: string;
    phoneNumber?: string | null;
    permissions: string[];
    preferredLanguage: Locale;
  }
): Promise<ActionResult> {
  const session = await requireUsersPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const validated = validateRoleAndPhone(data.role, data.phoneNumber);
  if ("error" in validated) return { success: false, error: validated.error };

  const sanitizedPermissions = sanitizePermissions(data.permissions);
  if (session.user.id === id && !sanitizedPermissions.includes("users")) {
    return { success: false, error: "CANNOT_REMOVE_OWN_USERS_PERMISSION" };
  }

  const existing = await prisma.user.findUnique({
    where: { username: data.username },
  });
  if (existing && existing.id !== id) {
    return { success: false, error: "USERNAME_TAKEN" };
  }

  await prisma.user.update({
    where: { id },
    data: {
      username: data.username,
      fullName: data.fullName,
      role: validated.role,
      phoneNumber: validated.phoneNumber,
      permissions: sanitizedPermissions,
      preferredLanguage: data.preferredLanguage,
    },
  });

  revalidatePath("/users");
  return { success: true };
}

export async function deleteUserAction(id: string): Promise<ActionResult> {
  const session = await requireUsersPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };
  if (session.user.id === id) {
    return { success: false, error: "CANNOT_DELETE_SELF" };
  }

  await prisma.user.delete({ where: { id } });

  revalidatePath("/users");
  return { success: true };
}

export async function toggleUserStatusAction(
  id: string,
  status: UserStatus
): Promise<ActionResult> {
  const session = await requireUsersPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };
  if (session.user.id === id) {
    return { success: false, error: "CANNOT_DISABLE_SELF" };
  }

  await prisma.user.update({ where: { id }, data: { status } });

  revalidatePath("/users");
  return { success: true };
}

export async function resetPasswordAction(
  id: string,
  newPassword: string
): Promise<ActionResult> {
  const session = await requireUsersPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id }, data: { passwordHash } });

  revalidatePath("/users");
  return { success: true };
}
