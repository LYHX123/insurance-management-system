import { auth } from "@/lib/auth";
import { DashboardContent } from "@/components/dashboard-content";

export default async function DashboardPage() {
  const session = await auth();

  return <DashboardContent fullName={session?.user?.name ?? ""} />;
}
