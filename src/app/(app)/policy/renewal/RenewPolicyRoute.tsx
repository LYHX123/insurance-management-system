import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { getLocale } from "@/i18n/get-locale";
import { dictionaries } from "@/i18n/config";
import { RenewPolicyForm } from "@/components/policy/renew-policy-form";
import { RENEWAL_CATEGORY_ROUTE } from "@/lib/policy/renewal";
import { loadRenewSource } from "./loadRenewSource";
import type { PolicyCategory } from "@/generated/prisma/enums";
import type { PermissionKey } from "@/lib/permissions";

// Shared body for the 4 category-specific /policy/<cat>/[id]/renew routes.
export async function RenewPolicyRoute({
  id,
  category,
  permissionKey,
}: {
  id: string;
  category: PolicyCategory;
  permissionKey: PermissionKey;
}) {
  const session = await auth();
  if (!session?.user || !canEdit(session.user, permissionKey)) {
    redirect("/access-denied");
  }

  const result = await loadRenewSource(id, category);
  const route = RENEWAL_CATEGORY_ROUTE[category];

  if (!result.ok) {
    const t = dictionaries[await getLocale()].policy;
    const msg =
      result.reason === "NOT_FOUND"
        ? t.recordNotFound
        : result.reason === "ALREADY_RENEWED"
          ? t.renewalAlreadyRenewedError
          : t.renewalNotRenewableError;
    return (
      <div className="flex flex-col gap-section">
        <div className="rounded-control border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{msg}</div>
        <Link href={result.recordNumber ? `${route}/${id}` : route} className="text-sm font-medium text-emerald-700 hover:underline">
          {t.backToList}
        </Link>
      </div>
    );
  }

  return <RenewPolicyForm source={result.source} />;
}
