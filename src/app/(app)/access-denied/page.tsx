import { auth } from "@/lib/auth";
import { firstAccessibleMenu, hasPermission, isAdmin } from "@/lib/permissions";
import { AccessDeniedContent } from "@/components/access-denied-content";

export default async function AccessDeniedPage() {
  const session = await auth();

  const target =
    hasPermission(session?.user, "dashboard") || isAdmin(session?.user)
      ? "dashboard"
      : firstAccessibleMenu(session?.user);

  return <AccessDeniedContent href={target ? `/${target}` : null} />;
}
