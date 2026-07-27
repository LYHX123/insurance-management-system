import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getQuotationDetailData } from "@/lib/quotationRevisions/getQuotationDetail";
import { QuotationDetailView } from "@/components/quotations/quotation-detail";

export default async function QuotationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "quotation")) {
    redirect("/access-denied");
  }

  const { id } = await params;
  const detail = await getQuotationDetailData(id);
  if (!detail) notFound();

  const quotationCase = detail.quotationCaseId
    ? await prisma.quotationCase.findUnique({
        where: { id: detail.quotationCaseId },
        select: { status: true },
      })
    : null;

  return <QuotationDetailView quotation={detail} caseStatus={quotationCase?.status ?? null} />;
}
