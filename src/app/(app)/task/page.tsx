import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { firstAccessibleCategorySlug, TASK_CATEGORY_ROUTES } from "@/lib/permissions";

export default async function TaskIndexPage() {
  const session = await auth();
  const slug = firstAccessibleCategorySlug(session?.user, TASK_CATEGORY_ROUTES);
  redirect(slug ? `/task/${slug}` : "/access-denied");
}
