import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { SettingsContent } from "@/components/settings-content";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "settings")) {
    redirect("/access-denied");
  }

  return <SettingsContent />;
}
