"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { isValidKenyanPhone } from "@/lib/validators";
import { storageService } from "@/lib/storage";
import type { ProjectStatus } from "@/generated/prisma/enums";

type ActionResult = { success: true } | { success: false; error: string };

export type ProjectInput = {
  projectName: string;
  contactPerson: string;
  phoneNumber: string;
  description?: string | null;
};

async function requireCustomerPermission() {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "customer")) {
    return null;
  }
  return session;
}

function validateProjectInput(
  data: ProjectInput
): { error: string } | ProjectInput {
  const projectName = data.projectName.trim();
  const contactPerson = data.contactPerson.trim();
  const phoneNumber = data.phoneNumber.trim();

  if (!projectName) return { error: "PROJECT_NAME_REQUIRED" };
  if (!contactPerson) return { error: "PROJECT_CONTACT_REQUIRED" };
  if (!phoneNumber || !isValidKenyanPhone(phoneNumber)) {
    return { error: "INVALID_PHONE" };
  }

  return {
    projectName,
    contactPerson,
    phoneNumber,
    description: data.description?.trim() || null,
  };
}

export async function createProjectAction(
  customerId: string,
  data: ProjectInput
): Promise<ActionResult> {
  const session = await requireCustomerPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const validated = validateProjectInput(data);
  if ("error" in validated) return { success: false, error: validated.error };

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return { success: false, error: "CUSTOMER_NOT_FOUND" };

  await prisma.customerProject.create({
    data: { ...validated, customerId },
  });

  revalidatePath(`/customer/${customerId}`);
  revalidatePath("/customer");
  return { success: true };
}

export async function updateProjectAction(
  id: string,
  data: ProjectInput & { status?: ProjectStatus }
): Promise<ActionResult> {
  const session = await requireCustomerPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const validated = validateProjectInput(data);
  if ("error" in validated) return { success: false, error: validated.error };

  const project = await prisma.customerProject.findUnique({ where: { id } });
  if (!project) return { success: false, error: "PROJECT_NOT_FOUND" };

  await prisma.customerProject.update({
    where: { id },
    data: { ...validated, ...(data.status ? { status: data.status } : {}) },
  });

  revalidatePath(`/customer/${project.customerId}`);
  return { success: true };
}

export async function deleteProjectAction(id: string): Promise<ActionResult> {
  const session = await requireCustomerPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const project = await prisma.customerProject.findUnique({
    where: { id },
    include: { documents: true },
  });
  if (!project) return { success: false, error: "PROJECT_NOT_FOUND" };

  const quotationCount = await prisma.quotation.count({ where: { projectId: id } });
  if (quotationCount > 0) {
    return { success: false, error: "PROJECT_HAS_QUOTATIONS" };
  }

  // The DB row (and its CustomerDocument children, via onDelete: Cascade) is
  // the source of truth; physical file cleanup is best-effort afterwards.
  await prisma.customerProject.delete({ where: { id } });

  await Promise.all(
    project.documents.map((doc) =>
      storageService.deleteFile(doc.storageKey).catch((err) => {
        console.error(`Failed to delete file for document ${doc.id}:`, err);
      })
    )
  );

  revalidatePath(`/customer/${project.customerId}`);
  revalidatePath("/customer");
  return { success: true };
}
