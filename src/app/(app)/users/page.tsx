import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { UsersTable } from "@/components/users/users-table";

export default async function UsersPage() {
  const session = await requireAdmin();
  if (!session) {
    redirect("/access-denied");
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
  });

  const plainUsers = users.map((u) => ({
    id: u.id,
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
