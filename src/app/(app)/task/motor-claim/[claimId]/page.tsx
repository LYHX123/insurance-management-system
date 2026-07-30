import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/permissions";
import { checkMotorClaimAccess } from "@/lib/claims/access";
import { getMotorClaimDetailForDisplay, getActiveClaimCustomers } from "@/lib/claims/queries";
import { getDistinctInsurers } from "@/lib/claims/insurers";
import { getMotorPolicyLinkOptions } from "@/lib/claims/policyLink";
import { buildMotorClaimDropboxViewModel } from "@/lib/integrations/dropbox/motorClaimPathViewModel";
import { MotorClaimDetailView } from "@/components/claims/motor-claim-detail";

export default async function MotorClaimDetailPage({ params }: { params: Promise<{ claimId: string }> }) {
  const { claimId } = await params;

  // The single security gate for direct URL access (see this phase's spec,
  // Part K.40/44): "no-module-access" means the user lacks the Task
  // permission entirely; "not-found" covers a missing Claim, a soft-deleted
  // Claim, AND a real Claim the current user isn't a participant of — all
  // render the exact same 404 so a non-participant can never learn which
  // case it is, or see any Claim field.
  const access = await checkMotorClaimAccess(claimId);
  if (access.kind === "no-module-access") redirect("/access-denied");
  if (access.kind === "not-found") notFound();

  const session = await auth();

  const [detail, customers, insurers, activeUsers, dropbox] = await Promise.all([
    getMotorClaimDetailForDisplay(claimId),
    getActiveClaimCustomers(),
    getDistinctInsurers(),
    prisma.user.findMany({ where: { status: "ACTIVE" }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, username: true, role: true } }),
    buildMotorClaimDropboxViewModel(claimId),
  ]);
  if (!detail) notFound();

  // Dropbox Integration Phase 7, Part 2 — customer-scoped Motor Policy
  // candidates for the Linked Policy selector, re-fetched fresh on every
  // detail-page load (never trusted from client state).
  const policyOptions = await getMotorPolicyLinkOptions(detail.customerId);

  const documents = detail.documents.map((d) => ({ ...d, dropbox: dropbox.documents[d.id] ?? d.dropbox }));

  return (
    <MotorClaimDetailView
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
