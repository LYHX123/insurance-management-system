import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { ImportUploadForm } from "@/components/policy/motor/import-upload-form";

export default async function MotorImportUploadPage() {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "policy.motor")) {
    redirect("/access-denied");
  }

  return <ImportUploadForm />;
}
