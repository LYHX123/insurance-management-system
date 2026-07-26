import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { checkNonMotorClaimAccess } from "@/lib/claims/access";
import { getNonMotorClaimDetailForDisplay, getActiveClaimCustomers } from "@/lib/claims/queries";
import { getDistinctInsurers } from "@/lib/claims/insurers";
import { NonMotorClaimDetailView } from "@/components/claims/non-motor-claim-detail";

export default async function NonMotorClaimDetailPage({ params }: { params: Promise<{ claimId: string }> }) {
  const { claimId } = await params;

  const access = await checkNonMotorClaimAccess(claimId);
  if (access.kind === "no-module-access") redirect("/access-denied");
  if (access.kind === "not-found") notFound();

  const [detail, customers, insurers, activeUsers] = await Promise.all([
    getNonMotorClaimDetailForDisplay(claimId),
    getActiveClaimCustomers(),
    getDistinctInsurers(),
    prisma.user.findMany({ where: { status: "ACTIVE" }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, username: true, role: true } }),
  ]);
  if (!detail) notFound();

  return (
    <NonMotorClaimDetailView
      claim={detail}
      currentUserId={access.userId}
      customers={customers}
      insurers={insurers}
      activeUsers={activeUsers.map((u) => ({ id: u.id, name: u.fullName || u.username, role: u.role }))}
    />
  );
}
