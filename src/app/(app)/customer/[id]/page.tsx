import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, isAdmin } from "@/lib/permissions";
import { getDropboxIntegrationRow } from "@/lib/integrations/dropbox/service";
import { CustomerDetailView } from "@/components/customers/customer-detail";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "customer")) {
    redirect("/access-denied");
  }

  const { id } = await params;
  const [customer, dropboxIntegration] = await Promise.all([
    prisma.customer.findUnique({
      where: { id },
      include: {
        projects: { orderBy: { createdAt: "asc" } },
        documents: { orderBy: { createdAt: "desc" }, include: { dropboxSync: true } },
        dropboxFolder: true,
      },
    }),
    getDropboxIntegrationRow(),
  ]);

  if (!customer) notFound();

  const uploaderIds = Array.from(new Set(customer.documents.map((d) => d.uploadedBy)));
  const uploaders = uploaderIds.length
    ? await prisma.user.findMany({
        where: { id: { in: uploaderIds } },
        select: { id: true, fullName: true, username: true },
      })
    : [];
  const uploaderNameById = new Map(uploaders.map((u) => [u.id, u.fullName || u.username]));

  const projectNameById = new Map(customer.projects.map((p) => [p.id, p.projectName]));

  const customerDetail = {
    id: customer.id,
    customerNumber: customer.customerNumber,
    companyName: customer.companyName,
    pinNumber: customer.pinNumber,
    registeredAddress: customer.registeredAddress,
    mainContactPerson: customer.mainContactPerson,
    mainPhoneNumber: customer.mainPhoneNumber,
    status: customer.status,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };

  const projects = customer.projects.map((p) => ({
    id: p.id,
    customerId: p.customerId,
    projectName: p.projectName,
    contactPerson: p.contactPerson,
    phoneNumber: p.phoneNumber,
    description: p.description,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));

  const documents = customer.documents.map((d) => ({
    id: d.id,
    customerId: d.customerId,
    projectId: d.projectId,
    projectName: d.projectId ? projectNameById.get(d.projectId) ?? null : null,
    documentType: d.documentType,
    customDocumentName: d.customDocumentName,
    originalFileName: d.originalFileName,
    mimeType: d.mimeType,
    fileSize: d.fileSize,
    uploadedByName: uploaderNameById.get(d.uploadedBy) ?? "—",
    createdAt: d.createdAt.toISOString(),
    dropboxSync: d.dropboxSync
      ? {
          syncStatus: d.dropboxSync.syncStatus,
          standardizedFileName: d.dropboxSync.standardizedFileName,
          lastSyncedAt: d.dropboxSync.lastSyncedAt?.toISOString() ?? null,
          lastErrorCode: d.dropboxSync.lastErrorCode,
          lastErrorMessage: d.dropboxSync.lastErrorMessage,
        }
      : null,
  }));

  // Safe view model only — never the raw dropboxFolderId (Phase 2 spec,
  // Part 7: "do not show raw folder IDs unless partially masked").
  const dropboxFolder = customer.dropboxFolder
    ? {
        syncStatus: customer.dropboxFolder.syncStatus,
        folderName: customer.dropboxFolder.folderName,
        displayPath: customer.dropboxFolder.displayPath,
        lastSyncedAt: customer.dropboxFolder.lastSyncedAt?.toISOString() ?? null,
        lastSyncAttemptAt: customer.dropboxFolder.lastSyncAttemptAt?.toISOString() ?? null,
        lastErrorMessage: customer.dropboxFolder.lastErrorMessage,
      }
    : null;

  return (
    <CustomerDetailView
      customer={customerDetail}
      projects={projects}
      documents={documents}
      dropboxFolder={dropboxFolder}
      dropboxConnected={dropboxIntegration.status === "CONNECTED"}
      isAdmin={isAdmin(session.user)}
    />
  );
}
