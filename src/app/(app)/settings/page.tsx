import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasModuleAccess } from "@/lib/permissions";
import { SettingsContent } from "@/components/settings-content";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "settings")) {
    redirect("/access-denied");
  }

  return <SettingsContent />;
}
