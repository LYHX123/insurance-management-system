"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { toDecimal } from "@/lib/money";
import { generateInvoiceNumber } from "@/lib/invoice/recordNumber";
import { recordPolicyActivity } from "@/lib/policy/activity";
import {
  POLICY_FOR_INVOICE_INCLUDE,
  POLICY_CATEGORY_ROUTE,
  checkPolicyInvoiceEligibility,
  getActualPolicyNumber,
  getPolicyClassSource,
} from "@/lib/invoice/eligibility";
import { getPolicyClassLabel } from "@/lib/invoice/policyClassLabel";
import { generateInvoiceExcelBuffer, InvoiceTemplateValidationError, InvoiceTemplateNotFoundError } from "@/lib/invoiceTemplateEngine";
import { invoiceDocumentStorage } from "@/lib/invoiceDocuments/storage";

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

async function requireInvoicePermission() {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "invoice")) return null;
  return session;
}

export type CreateInvoiceInput = {
  customerId: string;
  policyRecordIds: string[];
  invoiceDate: string;
};

// Creation flow (see this phase's spec, Part F §22, for the exact safety
// requirement this follows):
//   1. Validate everything server-side — never trusts the client's
//      eligibility computation or query-string-derived selection.
//   2. Generate the Excel buffer in memory (pure — no filesystem/DB writes,
//      and does not need the invoice number itself, since the template has
//      no {{INVOICE_NUMBER}} placeholder).
//   3. In one transaction: allocate the invoice number, create the Invoice
//      row (generatedFileName/StoragePath pre-set to where the file WILL
//      live) and its InvoiceItems. No PolicyActivity yet.
//   4. Only after that transaction commits, save the buffer to persistent
//      storage. On failure, delete the just-created Invoice (cascades to
//      InvoiceItems) and return an error — never leaves an ISSUED Invoice
//      with no downloadable file.
//   5. Only after the file save succeeds, write one PolicyActivity per
//      linked Policy — kept out of step 3 specifically so a failed step 4
//      can never leave a misleading "Invoice issued" activity behind for an
//      Invoice that was rolled back.
export async function createInvoiceAction(input: CreateInvoiceInput): Promise<ActionResult<{ id: string; invoiceNumber: string }>> {
  const session = await requireInvoicePermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  if (!input.customerId) return { success: false, error: "CUSTOMER_REQUIRED" };
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) return { success: false, error: "CUSTOMER_NOT_FOUND" };

  const uniqueIds = Array.from(new Set(input.policyRecordIds));
  if (uniqueIds.length === 0) return { success: false, error: "NO_POLICIES_SELECTED" };

  if (!input.invoiceDate) return { success: false, error: "INVOICE_DATE_REQUIRED" };
  const invoiceDate = new Date(input.invoiceDate);
  if (Number.isNaN(invoiceDate.getTime())) return { success: false, error: "INVOICE_DATE_REQUIRED" };

  const records = await prisma.policyRecord.findMany({
    where: { id: { in: uniqueIds }, deletedAt: null },
    include: POLICY_FOR_INVOICE_INCLUDE,
  });
  if (records.length !== uniqueIds.length) return { success: false, error: "POLICY_NOT_FOUND" };

  // Every selected Policy must belong to the same, selected Customer — the
  // query parameter / client selection is never trusted on its own (see
  // this phase's spec: "Do not trust the query parameter without server
  // validation" / "Query-string manipulation cannot bypass rules").
  if (records.some((r) => r.customerId !== input.customerId)) {
    return { success: false, error: "POLICY_CUSTOMER_MISMATCH" };
  }

  for (const record of records) {
    const eligibility = checkPolicyInvoiceEligibility(record);
    if (!eligibility.eligible) return { success: false, error: `POLICY_NOT_ELIGIBLE_${eligibility.reason}` };
  }

  const items = records.map((record) => {
    const classSource = getPolicyClassSource(record)!;
    return {
      policyRecordId: record.id,
      category: record.category,
      policyClassSnapshot: getPolicyClassLabel(classSource),
      policyNumberSnapshot: getActualPolicyNumber(record)!,
      premiumSnapshot: record.customerPremium,
    };
  });
  const totalPremium = items.reduce((sum, i) => sum.plus(i.premiumSnapshot), toDecimal(0));

  let excelBuffer: Buffer;
  try {
    excelBuffer = await generateInvoiceExcelBuffer({
      customerName: customer.companyName,
      customerPin: customer.pinNumber,
      invoiceDate,
      items: items.map((i) => ({
        policyClass: i.policyClassSnapshot,
        policyNumber: i.policyNumberSnapshot,
        premium: i.premiumSnapshot.toNumber(),
      })),
      totalPremium: totalPremium.toNumber(),
    });
  } catch (err) {
    if (err instanceof InvoiceTemplateValidationError || err instanceof InvoiceTemplateNotFoundError) {
      console.error("Invoice template validation failed:", err);
      return { success: false, error: "TEMPLATE_INVALID" };
    }
    console.error("Failed to generate Invoice workbook:", err);
    return { success: false, error: "GENERATION_FAILED" };
  }

  let created: { id: string; invoiceNumber: string; fileName: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      const invoiceNumber = await generateInvoiceNumber(tx);
      const fileName = `${invoiceNumber}.xlsx`;
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          invoiceDate,
          customerId: input.customerId,
          totalPremium,
          generatedFileName: fileName,
          generatedStoragePath: null,
          createdById: session.user.id,
        },
      });
      await tx.invoiceItem.createMany({
        data: items.map((item, index) => ({
          invoiceId: invoice.id,
          policyRecordId: item.policyRecordId,
          itemNumber: index + 1,
          policyClassSnapshot: item.policyClassSnapshot,
          policyNumberSnapshot: item.policyNumberSnapshot,
          premiumSnapshot: item.premiumSnapshot,
        })),
      });
      return { id: invoice.id, invoiceNumber, fileName };
    });
  } catch (err) {
    console.error("Failed to create Invoice record:", err);
    return { success: false, error: "CREATE_FAILED" };
  }

  try {
    const { storagePath } = await invoiceDocumentStorage.saveFile({
      invoiceNumber: created.invoiceNumber,
      fileName: created.fileName,
      buffer: excelBuffer,
    });
    await prisma.invoice.update({ where: { id: created.id }, data: { generatedStoragePath: storagePath } });
  } catch (err) {
    console.error(`Failed to save generated file for Invoice ${created.invoiceNumber} — rolling back:`, err);
    await prisma.invoice.delete({ where: { id: created.id } }).catch((cleanupErr) => {
      console.error(`Additionally failed to roll back Invoice ${created.id} after file-save failure:`, cleanupErr);
    });
    return { success: false, error: "FILE_SAVE_FAILED" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        await recordPolicyActivity(tx, {
          policyRecordId: item.policyRecordId,
          actionType: "INVOICE_ISSUED",
          summary: `Invoice ${created.invoiceNumber} issued.`,
          performedById: session.user.id,
        });
      }
    });
  } catch (err) {
    // The Invoice and its file are already durable at this point — a
    // failure here is logged, not surfaced as a failed creation (the
    // Invoice was genuinely created successfully).
    console.error(`Failed to record PolicyActivity for Invoice ${created.invoiceNumber}:`, err);
  }

  revalidatePath("/invoice");
  for (const item of items) {
    revalidatePath(`${POLICY_CATEGORY_ROUTE[item.category]}/${item.policyRecordId}`);
  }

  return { success: true, id: created.id, invoiceNumber: created.invoiceNumber };
}

// Idempotent by construction: the status transition is the WHERE clause of
// the update itself (status: "ISSUED"), so a retry/double-click/concurrent
// request that loses the race simply updates zero rows and returns
// ALREADY_CANCELLED rather than writing duplicate PolicyActivity entries
// (see this phase's spec: "Avoid duplicate activity records on retries or
// refresh").
export async function cancelInvoiceAction(invoiceId: string): Promise<ActionResult> {
  const session = await requireInvoicePermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { items: { select: { policyRecordId: true, policyRecord: { select: { category: true } } } } },
  });
  if (!invoice) return { success: false, error: "INVOICE_NOT_FOUND" };

  const updateResult = await prisma.invoice.updateMany({
    where: { id: invoiceId, status: "ISSUED" },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: session.user.id },
  });
  if (updateResult.count === 0) return { success: false, error: "ALREADY_CANCELLED" };

  await prisma.$transaction(async (tx) => {
    for (const item of invoice.items) {
      await recordPolicyActivity(tx, {
        policyRecordId: item.policyRecordId,
        actionType: "INVOICE_CANCELLED",
        summary: `Invoice ${invoice.invoiceNumber} cancelled.`,
        performedById: session.user.id,
      });
    }
  });

  revalidatePath("/invoice");
  revalidatePath(`/invoice/${invoiceId}`);
  for (const item of invoice.items) {
    revalidatePath(`${POLICY_CATEGORY_ROUTE[item.policyRecord.category]}/${item.policyRecordId}`);
  }

  return { success: true };
}
