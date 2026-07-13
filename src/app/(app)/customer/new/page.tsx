import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasModuleAccess } from "@/lib/permissions";
import { NewCustomerForm } from "@/components/customers/new-customer-form";

export default async function NewCustomerPage() {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "customer")) {
    redirect("/access-denied");
  }

  return <NewCustomerForm />;
}
