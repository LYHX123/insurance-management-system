import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import { UsersTable } from "@/components/users/users-table";

export default async function UsersPage() {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "users")) {
    redirect("/access-denied");
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
  });

  const plainUsers = users.map((u) => ({
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    role: u.role,
    phoneNumber: u.phoneNumber,
    permissions: u.permissions,
    status: u.status,
    preferredLanguage: u.preferredLanguage,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
  }));

  return <UsersTable users={plainUsers} currentUserId={session.user.id} />;
}
