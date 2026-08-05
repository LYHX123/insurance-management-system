import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { ImportUploadForm } from "@/components/policy/non-motor/import-upload-form";

export default async function NonMotorImportUploadPage() {
  const session = await auth();
  if (!session?.user || !canEdit(session.user, "policy.non_motor")) {
    redirect("/access-denied");
  }

  return <ImportUploadForm />;
}
