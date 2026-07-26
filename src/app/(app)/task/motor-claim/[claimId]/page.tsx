import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { checkMotorClaimAccess } from "@/lib/claims/access";
import { getMotorClaimDetailForDisplay, getActiveClaimCustomers } from "@/lib/claims/queries";
import { getDistinctInsurers } from "@/lib/claims/insurers";
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

  const [detail, customers, insurers, activeUsers] = await Promise.all([
    getMotorClaimDetailForDisplay(claimId),
    getActiveClaimCustomers(),
    getDistinctInsurers(),
    prisma.user.findMany({ where: { status: "ACTIVE" }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, username: true, role: true } }),
  ]);
  if (!detail) notFound();

  return (
    <MotorClaimDetailView
      claim={detail}
      currentUserId={access.userId}
      customers={customers}
      insurers={insurers}
      activeUsers={activeUsers.map((u) => ({ id: u.id, name: u.fullName || u.username, role: u.role }))}
    />
  );
}
