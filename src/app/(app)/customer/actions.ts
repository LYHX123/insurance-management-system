"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { isValidKenyanPhone } from "@/lib/validators";
import { formatCustomerNumber, validateCustomerShortName } from "@/lib/customer-utils";
import { buildCustomerFolderName } from "@/lib/integrations/dropbox/customer-folder-names";
import { syncCustomerFolder, renameCustomerFolder, type SyncOutcomeStatus } from "@/lib/integrations/dropbox/customer-folders";
import type { CustomerStatus } from "@/generated/prisma/enums";

// Dropbox filing must never make Customer creation depend on third-party
// network availability (Phase 2 spec, Part 5) — bounded so a hung Dropbox
// call can't hang the response; the Customer row is already committed
// regardless of how this resolves.
const DROPBOX_SYNC_TIMEOUT_MS = 15_000;

async function syncCustomerFolderWithTimeout(customerId: string): Promise<SyncOutcomeStatus> {
  try {
    const result = await Promise.race([
      syncCustomerFolder(customerId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), DROPBOX_SYNC_TIMEOUT_MS)),
    ]);
    return result?.status ?? "PENDING";
  } catch {
    return "ERROR";
  }
}

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
  shortName?: string | null;
};

async function requireCustomerPermission() {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "customer")) {
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

  const shortNameResult = validateCustomerShortName(data.shortName ?? "");
  if (!shortNameResult.ok) return { error: shortNameResult.error };

  return {
    companyName,
    pinNumber,
    registeredAddress: data.registeredAddress?.trim() || null,
    mainContactPerson: data.mainContactPerson?.trim() || null,
    mainPhoneNumber,
    shortName: shortNameResult.value || null,
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
}): Promise<ActionResult<{ customerId: string; customerNumber: string; dropboxSyncStatus: SyncOutcomeStatus }>> {
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

  let result: { id: string; customerNumber: string };
  try {
    result = await prisma.$transaction(async (tx) => {
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
          // Dropbox filing metadata row, PENDING until the post-transaction
          // sync attempt below resolves — pure DB write, no network call
          // inside the transaction (Phase 2 spec, Part 5, requirement 9).
          dropboxFolder: {
            create: {
              folderName: buildCustomerFolderName({ customerNumber, companyName: company.companyName }),
              syncStatus: "PENDING",
            },
          },
        },
      });

      return customer;
    });
  } catch {
    return { success: false, error: "CREATE_FAILED" };
  }

  // The Customer row is committed at this point — nothing below this line
  // may ever turn a successful creation into a reported failure. Dropbox
  // filing is intentionally outside the try/catch above and has its own
  // internal error handling (syncCustomerFolderWithTimeout never throws).
  revalidatePath("/customer");
  const dropboxSyncStatus = await syncCustomerFolderWithTimeout(result.id);
  revalidatePath(`/customer/${result.id}`);

  return {
    success: true,
    customerId: result.id,
    customerNumber: result.customerNumber,
    dropboxSyncStatus,
  };
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

  const before = await prisma.customer.findUnique({ where: { id }, select: { companyName: true } });
  await prisma.customer.update({ where: { id }, data: company });

  revalidatePath("/customer");
  revalidatePath(`/customer/${id}`);

  // Rename the Dropbox folder to match, best-effort — the Customer edit
  // above has already succeeded regardless of how this resolves (Phase 2
  // spec, Part 10, requirement 5).
  if (before && before.companyName !== company.companyName) {
    await renameCustomerFolder(id).catch(() => {});
  }

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

  // The CustomerDropboxFolder metadata row cascades away with the Customer
  // (onDelete: Cascade), but Dropbox itself is never touched — Phase 2
  // spec, Part 11: Customer deletion and Dropbox archival stay separate.
  const dropboxFolder = await prisma.customerDropboxFolder.findUnique({
    where: { customerId: id },
    select: { displayPath: true },
  });

  await prisma.customer.delete({ where: { id } });
  if (dropboxFolder?.displayPath) {
    console.info(`[dropbox-customer-sync] customer=${id} deleted — Dropbox folder retained at "${dropboxFolder.displayPath}"`);
  }
  revalidatePath("/customer");
  return { success: true, deactivatedInstead: false };
}
