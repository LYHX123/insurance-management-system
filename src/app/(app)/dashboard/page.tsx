import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { DashboardContent } from "@/components/dashboard/dashboard-content";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "dashboard")) {
    redirect("/access-denied");
  }

  return <DashboardContent fullName={session.user.name ?? session.user.username} />;
}
