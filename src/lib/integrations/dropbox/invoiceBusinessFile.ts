// Server-only. Dropbox Integration Phase 6 — resolves (and lazily creates)
// the ONE Dropbox business file an Invoice's generated document gets filed
// under. Mirrors policyBusinessFile.ts's shape, with one structural
// difference forced by the actual schema (see this phase's Part 1
// inspection): an Invoice has no direct relation to a PolicyRecord or
// QuotationCase at all — only an indirect, potentially many-to-many one via
// InvoiceItem (an Invoice can bundle multiple PolicyRecords). "Reuse the
// Policy's business folder" is therefore only well-defined when an Invoice
// has EXACTLY ONE linked PolicyRecord:
//   - exactly one InvoiceItem: resolve through that Policy's own resolver
//     (ensurePolicyDropboxBusinessFile), reusing whichever business file it
//     already resolves to (QUOTATION_CASE or POLICY_FALLBACK) — never a
//     second, duplicate business folder for the same insurance transaction.
//   - zero or 2+ InvoiceItems: no single Policy/QuotationCase folder is
//     well-defined, so an Invoice-scoped fallback (INVOICE_FALLBACK) is
//     used instead — a dedicated InvoiceDropboxBusinessFile, 1:1 with the
//     Invoice.
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { InvoiceDropboxBusinessFileSource } from "@/generated/prisma/enums";
import { ensurePolicyDropboxBusinessFile, resolvePolicyBusinessFileRefReadOnly, type PolicyBusinessFileRef } from "./policyBusinessFile";
import { buildBusinessFolderName } from "./quotationDropboxNaming";
import { deriveCustomerShortName } from "./customerShortName";

// "INVOICE" is not one of quotationDropboxNaming's InsuranceType-derived
// codes — deliberately: an Invoice fallback folder isn't about one specific
// insurance type (it may have zero or several linked Policies of different
// types), it's about the Invoice itself. Kept short/uppercase to match the
// visual convention of every other folder-code segment.
const INVOICE_FOLDER_CODE = "INVOICE";

const INVOICE_BUSINESS_FILE_INCLUDE = {
  customer: { select: { shortName: true, companyName: true, customerNumber: true } },
  items: { select: { policyRecordId: true } },
  dropboxBusinessFile: true,
} satisfies Prisma.InvoiceInclude;

type InvoiceForBusinessFile = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_BUSINESS_FILE_INCLUDE }>;

// Fallback title priority uses only real, already-available data — the
// Invoice's own number, never an invented employee/project/business name
// (Part 2: "Do not invent a business title that does not exist in the
// schema"). Unlike Policy's fallback naming (which reads category-specific
// detail relations because a Policy always has exactly one type), an
// Invoice fallback has no single insurance category to key off — the
// invoice number is the one piece of data that's always present, unique,
// and meaningful here.
function resolveInvoiceFallbackNaming(invoice: InvoiceForBusinessFile): { insuranceTypeCode: string; businessTitle: string } {
  return { insuranceTypeCode: INVOICE_FOLDER_CODE, businessTitle: invoice.invoiceNumber };
}

async function ensureInvoiceFallbackBusinessFile(invoice: InvoiceForBusinessFile) {
  if (invoice.dropboxBusinessFile) return invoice.dropboxBusinessFile;

  const { insuranceTypeCode, businessTitle } = resolveInvoiceFallbackNaming(invoice);
  const customerShortName = deriveCustomerShortName({
    shortName: invoice.customer.shortName,
    companyName: invoice.customer.companyName,
    customerNumber: invoice.customer.customerNumber,
  });
  const businessFolderName = buildBusinessFolderName({ businessDate: invoice.invoiceDate, insuranceTypeCode, businessTitle });

  try {
    return await prisma.invoiceDropboxBusinessFile.create({
      data: {
        invoiceId: invoice.id,
        businessDate: invoice.invoiceDate,
        insuranceTypeCode,
        customerShortName,
        businessTitle,
        businessFolderName,
        syncStatus: "PENDING",
      },
    });
  } catch {
    // Lost a create race (unique invoiceId) — reuse rather than error.
    return prisma.invoiceDropboxBusinessFile.findUniqueOrThrow({ where: { invoiceId: invoice.id } });
  }
}

export type InvoiceBusinessFileRef = {
  source: InvoiceDropboxBusinessFileSource;
  businessFileId: string;
  businessFolderName: string;
  dropboxDisplayPath: string | null;
  dropboxFolderId: string | null;
  syncStatus: string;
  lastErrorMessage: string | null;
};

function fromPolicyRef(ref: PolicyBusinessFileRef): InvoiceBusinessFileRef {
  return {
    source: ref.source, // "QUOTATION_CASE" | "POLICY_FALLBACK" — both valid members of InvoiceDropboxBusinessFileSource too.
    businessFileId: ref.businessFileId,
    businessFolderName: ref.businessFolderName,
    dropboxDisplayPath: ref.dropboxDisplayPath,
    dropboxFolderId: ref.dropboxFolderId,
    syncStatus: ref.syncStatus,
    lastErrorMessage: ref.lastErrorMessage,
  };
}

function toFallbackRef(row: {
  id: string;
  businessFolderName: string;
  dropboxDisplayPath: string | null;
  dropboxFolderId: string | null;
  syncStatus: string;
  lastErrorMessage?: string | null;
}): InvoiceBusinessFileRef {
  return {
    source: "INVOICE_FALLBACK",
    businessFileId: row.id,
    businessFolderName: row.businessFolderName,
    dropboxDisplayPath: row.dropboxDisplayPath,
    dropboxFolderId: row.dropboxFolderId,
    syncStatus: row.syncStatus,
    lastErrorMessage: row.lastErrorMessage ?? null,
  };
}

export type EnsureInvoiceBusinessFileResult = { ok: true; ref: InvoiceBusinessFileRef } | { ok: false; error: "INVOICE_NOT_FOUND" };

// Main entry point — used by invoiceDocumentSync.ts before every upload
// attempt and by verify/admin actions. Never creates a duplicate business
// file: an Invoice with exactly one linked Policy always resolves through
// that Policy's own resolver (which itself never duplicates a Quotation
// case's business file); an Invoice with zero or 2+ linked Policies always
// resolves to its OWN ONE InvoiceDropboxBusinessFile (unique invoiceId).
export async function ensureInvoiceDropboxBusinessFile(invoiceId: string): Promise<EnsureInvoiceBusinessFileResult> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: INVOICE_BUSINESS_FILE_INCLUDE });
  if (!invoice) return { ok: false, error: "INVOICE_NOT_FOUND" };

  if (invoice.items.length === 1) {
    const policyResult = await ensurePolicyDropboxBusinessFile(invoice.items[0].policyRecordId);
    if (policyResult.ok) return { ok: true, ref: fromPolicyRef(policyResult.ref) };
    // The linked PolicyRecord vanished (should not happen — InvoiceItem's
    // FK is onDelete: Restrict, so a referenced Policy can never actually
    // be deleted) — fall through to the Invoice's own fallback rather than
    // failing outright.
  }

  const fallback = await ensureInvoiceFallbackBusinessFile(invoice);
  return { ok: true, ref: toFallbackRef(fallback) };
}

// Read-only resolution (no create) — used for planned-path display before
// any sync has happened, so the UI never triggers a write as a side effect
// of merely being viewed.
export async function resolveInvoiceBusinessFileRefReadOnly(invoiceId: string): Promise<InvoiceBusinessFileRef | null> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: INVOICE_BUSINESS_FILE_INCLUDE });
  if (!invoice) return null;

  if (invoice.items.length === 1) {
    const ref = await resolvePolicyBusinessFileRefReadOnly(invoice.items[0].policyRecordId);
    if (ref) return fromPolicyRef(ref);
  }

  if (invoice.dropboxBusinessFile) return toFallbackRef(invoice.dropboxBusinessFile);

  // Nothing created yet — compute the deterministic planned name without
  // writing anything, so a brand-new Invoice still shows a sensible planned
  // folder name before its first sync.
  const { insuranceTypeCode, businessTitle } = resolveInvoiceFallbackNaming(invoice);
  const businessFolderName = buildBusinessFolderName({ businessDate: invoice.invoiceDate, insuranceTypeCode, businessTitle });
  return {
    source: "INVOICE_FALLBACK",
    businessFileId: "",
    businessFolderName,
    dropboxDisplayPath: null,
    dropboxFolderId: null,
    syncStatus: "PENDING",
    lastErrorMessage: null,
  };
}
