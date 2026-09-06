import { RenewPolicyRoute } from "@/app/(app)/policy/renewal/RenewPolicyRoute";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RenewPolicyRoute id={id} category="MOTOR" permissionKey="policy.motor" />;
}
