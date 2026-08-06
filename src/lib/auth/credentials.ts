// Extracted from src/lib/auth.ts's authorize() callback so it can be unit
// tested directly (importing src/lib/auth.ts itself pulls in the full
// NextAuth() initialization, which no existing test in this codebase does —
// see loginRateLimit.ts and this module's own __tests__ for the actual
// coverage). Behavior is unchanged from the original inline implementation.
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export type VerifiedLoginUser = {
  id: string;
  username: string;
  name: string;
  role: string;
  status: string;
  preferredLanguage: string;
  permissions: string[];
};

// Full Name is the primary login identifier — case-insensitive, trimmed
// (see src/lib/users/fullName.ts's matching normalization used at
// create/edit time). Legacy compatibility: accounts migrated from the old
// username+password login (e.g. "admin") keep working if someone types the
// old username instead of the Full Name.
export async function verifyCredentials(login: string, password: string): Promise<VerifiedLoginUser | null> {
  let user = await prisma.user.findFirst({
    where: { fullName: { equals: login, mode: "insensitive" } },
  });
  if (!user) {
    user = await prisma.user.findFirst({
      where: { username: { equals: login, mode: "insensitive" } },
    });
  }

  if (!user || user.status !== "ACTIVE") return null;

  const passwordValid = await bcrypt.compare(password, user.passwordHash);
  if (!passwordValid) return null;

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return {
    id: user.id,
    username: user.username,
    name: user.fullName,
    role: user.role,
    status: user.status,
    preferredLanguage: user.preferredLanguage,
    permissions: user.permissions,
  };
}
