import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { CustomersTable } from "@/components/customers/customers-table";

export default async function CustomerPage() {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "customer")) {
    redirect("/access-denied");
  }

  const customers = await prisma.customer.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      projects: { select: { id: true, projectName: true }, orderBy: { createdAt: "asc" } },
      _count: { select: { projects: true, documents: true } },
    },
  });

  const rows = customers.map((c) => ({
    id: c.id,
    customerNumber: c.customerNumber,
    companyName: c.companyName,
    pinNumber: c.pinNumber,
    registeredAddress: c.registeredAddress,
    mainContactPerson: c.mainContactPerson,
    mainPhoneNumber: c.mainPhoneNumber,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    projectCount: c._count.projects,
    documentCount: c._count.documents,
    projects: c.projects,
  }));

  return <CustomersTable customers={rows} />;
}
