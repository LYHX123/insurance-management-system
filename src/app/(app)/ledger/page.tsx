import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { firstAccessibleCategorySlug, LEDGER_CATEGORY_ROUTES } from "@/lib/permissions";

export default async function LedgerIndexPage() {
  const session = await auth();
  const slug = firstAccessibleCategorySlug(session?.user, LEDGER_CATEGORY_ROUTES);
  redirect(slug ? `/ledger/${slug}` : "/access-denied");
}
