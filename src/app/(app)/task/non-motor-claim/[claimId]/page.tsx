import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/permissions";
import { checkNonMotorClaimAccess } from "@/lib/claims/access";
import { getNonMotorClaimDetailForDisplay, getActiveClaimCustomers } from "@/lib/claims/queries";
import { getDistinctInsurers } from "@/lib/claims/insurers";
import { getNonMotorPolicyLinkOptions } from "@/lib/claims/policyLink";
import { buildNonMotorClaimDropboxViewModel } from "@/lib/integrations/dropbox/nonMotorClaimPathViewModel";
import { NonMotorClaimDetailView } from "@/components/claims/non-motor-claim-detail";

export default async function NonMotorClaimDetailPage({ params }: { params: Promise<{ claimId: string }> }) {
  const { claimId } = await params;

  const access = await checkNonMotorClaimAccess(claimId);
  if (access.kind === "no-module-access") redirect("/access-denied");
  if (access.kind === "not-found") notFound();

  const session = await auth();

  const [detail, customers, insurers, activeUsers, dropbox] = await Promise.all([
    getNonMotorClaimDetailForDisplay(claimId),
    getActiveClaimCustomers(),
    getDistinctInsurers(),
    prisma.user.findMany({ where: { status: "ACTIVE" }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, username: true, role: true } }),
    buildNonMotorClaimDropboxViewModel(claimId),
  ]);
  if (!detail) notFound();

  const policyOptions = await getNonMotorPolicyLinkOptions(detail.customerId);

  const documents = detail.documents.map((d) => ({ ...d, dropbox: dropbox.documents[d.id] ?? d.dropbox }));

  return (
    <NonMotorClaimDetailView
      claim={{ ...detail, documents }}
      currentUserId={access.userId}
      customers={customers}
      insurers={insurers}
      activeUsers={activeUsers.map((u) => ({ id: u.id, name: u.fullName || u.username, role: u.role }))}
      policyOptions={policyOptions}
      dropbox={{
        dropboxConnected: dropbox.dropboxConnected,
        source: dropbox.source,
        businessFolderName: dropbox.businessFolderName,
        businessFolder: dropbox.businessFolder,
        claimFolder: dropbox.claimFolder,
        claimReferenceFolder: dropbox.claimReferenceFolder,
      }}
      isAdmin={session?.user ? isAdmin(session.user) : false}
    />
  );
}
