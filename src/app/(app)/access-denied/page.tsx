import { auth } from "@/lib/auth";
import { firstAccessibleModule, hasModuleAccess } from "@/lib/permissions";
import { AccessDeniedContent } from "@/components/access-denied-content";

export default async function AccessDeniedPage() {
  const session = await auth();
  const permissions = session?.user?.permissions ?? [];

  const target = hasModuleAccess(permissions, "dashboard")
    ? "dashboard"
    : firstAccessibleModule(permissions);

  return <AccessDeniedContent href={target ? `/${target}` : null} />;
}
