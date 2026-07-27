import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { firstAccessibleCategorySlug, POLICY_CATEGORY_ROUTES } from "@/lib/permissions";

export default async function PolicyIndexPage() {
  const session = await auth();
  const slug = firstAccessibleCategorySlug(session?.user, POLICY_CATEGORY_ROUTES);
  redirect(slug ? `/policy/${slug}` : "/access-denied");
}
