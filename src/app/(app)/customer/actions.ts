"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import { isValidKenyanPhone } from "@/lib/validators";
import { formatCustomerNumber } from "@/lib/customer-utils";
import type { CustomerStatus } from "@/generated/prisma/enums";

type ActionResult<T = object> =
  | ({ success: true } & T)
  | { success: false; error: string };

export type InitialProjectInput = {
  projectName: string;
  contactPerson: string;
  phoneNumber: string;
  description?: string | null;
};

type CompanyInput = {
  companyName: string;
  pinNumber: string;
  registeredAddress?: string | null;
  mainContactPerson?: string | null;
  mainPhoneNumber?: string | null;
};

async function requireCustomerPermission() {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "customer")) {
    return null;
  }
  return session;
}

function validateCompanyInput(
  data: CompanyInput
): { error: string } | (CompanyInput & { companyName: string; pinNumber: string }) {
  const companyName = data.companyName.trim();
  const pinNumber = data.pinNumber.trim();
  if (!companyName) return { error: "COMPANY_NAME_REQUIRED" };
  if (!pinNumber) return { error: "PIN_NUMBER_REQUIRED" };

  const mainPhoneNumber = data.mainPhoneNumber?.trim() || null;
  if (mainPhoneNumber && !isValidKenyanPhone(mainPhoneNumber)) {
    return { error: "INVALID_PHONE" };
  }

  return {
    companyName,
    pinNumber,
    registeredAddress: data.registeredAddress?.trim() || null,
    mainContactPerson: data.mainContactPerson?.trim() || null,
    mainPhoneNumber,
  };
}

function validateProjectInput(
  data: InitialProjectInput
): { error: string } | InitialProjectInput {
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

export async function createCustomerAction(data: {
  company: CompanyInput;
  projects: InitialProjectInput[];
}): Promise<ActionResult<{ customerId: string; customerNumber: string }>> {
  const session = await requireCustomerPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const company = validateCompanyInput(data.company);
  if ("error" in company) return { success: false, error: company.error };

  const validatedProjects: InitialProjectInput[] = [];
  for (const project of data.projects) {
    const validated = validateProjectInput(project);
    if ("error" in validated) return { success: false, error: validated.error };
    validatedProjects.push(validated);
  }

  const [existingName, existingPin] = await Promise.all([
    prisma.customer.findFirst({
      where: { companyName: { equals: company.companyName, mode: "insensitive" } },
    }),
    prisma.customer.findFirst({
      where: { pinNumber: { equals: company.pinNumber, mode: "insensitive" } },
    }),
  ]);
  if (existingName) return { success: false, error: "COMPANY_NAME_TAKEN" };
  if (existingPin) return { success: false, error: "PIN_NUMBER_TAKEN" };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const [{ nextval }] = await tx.$queryRaw<{ nextval: bigint }[]>`
        SELECT nextval(pg_get_serial_sequence('"Customer"', 'sequenceNumber')) as nextval
      `;
      const sequenceNumber = Number(nextval);
      const customerNumber = formatCustomerNumber(sequenceNumber);

      const customer = await tx.customer.create({
        data: {
          sequenceNumber,
          customerNumber,
          ...company,
          projects: {
            create: validatedProjects,
          },
        },
      });

      return customer;
    });

    revalidatePath("/customer");
    return {
      success: true,
      customerId: result.id,
      customerNumber: result.customerNumber,
    };
  } catch {
    return { success: false, error: "CREATE_FAILED" };
  }
}

export async function updateCustomerAction(
  id: string,
  data: CompanyInput
): Promise<ActionResult> {
  const session = await requireCustomerPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const company = validateCompanyInput(data);
  if ("error" in company) return { success: false, error: company.error };

  const [existingName, existingPin] = await Promise.all([
    prisma.customer.findFirst({
      where: {
        companyName: { equals: company.companyName, mode: "insensitive" },
        NOT: { id },
      },
    }),
    prisma.customer.findFirst({
      where: {
        pinNumber: { equals: company.pinNumber, mode: "insensitive" },
        NOT: { id },
      },
    }),
  ]);
  if (existingName) return { success: false, error: "COMPANY_NAME_TAKEN" };
  if (existingPin) return { success: false, error: "PIN_NUMBER_TAKEN" };

  await prisma.customer.update({ where: { id }, data: company });

  revalidatePath("/customer");
  revalidatePath(`/customer/${id}`);
  return { success: true };
}

export async function toggleCustomerStatusAction(
  id: string,
  status: CustomerStatus
): Promise<ActionResult> {
  const session = await requireCustomerPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  await prisma.customer.update({ where: { id }, data: { status } });

  revalidatePath("/customer");
  revalidatePath(`/customer/${id}`);
  return { success: true };
}

export async function deleteCustomerAction(
  id: string
): Promise<ActionResult<{ deactivatedInstead: boolean }>> {
  const session = await requireCustomerPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const [projectCount, documentCount, quotationCount] = await Promise.all([
    prisma.customerProject.count({ where: { customerId: id } }),
    prisma.customerDocument.count({ where: { customerId: id } }),
    prisma.quotation.count({ where: { customerId: id } }),
  ]);

  if (projectCount > 0 || documentCount > 0 || quotationCount > 0) {
    await prisma.customer.update({ where: { id }, data: { status: "INACTIVE" } });
    revalidatePath("/customer");
    revalidatePath(`/customer/${id}`);
    return { success: true, deactivatedInstead: true };
  }

  await prisma.customer.delete({ where: { id } });
  revalidatePath("/customer");
  return { success: true, deactivatedInstead: false };
}
