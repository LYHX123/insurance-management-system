import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { NewCustomerForm } from "@/components/customers/new-customer-form";

export default async function NewCustomerPage() {
  const session = await auth();
  if (!session?.user || !canEdit(session.user, "customer")) {
    redirect("/access-denied");
  }

  return <NewCustomerForm />;
}
