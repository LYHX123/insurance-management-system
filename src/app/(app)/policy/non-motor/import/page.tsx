import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasModuleAccess } from "@/lib/permissions";
import { ImportUploadForm } from "@/components/policy/non-motor/import-upload-form";

export default async function NonMotorImportUploadPage() {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "policy")) {
    redirect("/access-denied");
  }

  return <ImportUploadForm />;
}
