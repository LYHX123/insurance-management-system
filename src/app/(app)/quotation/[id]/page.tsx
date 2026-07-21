import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasModuleAccess } from "@/lib/permissions";
import { getQuotationDetailData } from "@/lib/quotationRevisions/getQuotationDetail";
import { QuotationDetailView } from "@/components/quotations/quotation-detail";

export default async function QuotationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "quotation")) {
    redirect("/access-denied");
  }

  const { id } = await params;
  const detail = await getQuotationDetailData(id);
  if (!detail) notFound();

  return <QuotationDetailView quotation={detail} />;
}
