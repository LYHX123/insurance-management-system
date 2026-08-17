// Production Initialization — Phase 7 Part C: the actual dependency-check
// queries, split out from modules.ts (which stays client-safe, see that
// file's own doc comment) because this one needs `@/lib/prisma`. Only ever
// imported from server-side code (executeSelective.ts, the
// validate-selection API route) — never from the "use client" Settings
// panel. Every check below is derived from the SAME real schema relations
// execute.ts's own top-of-file doc comment already audited (onDelete:
// Restrict/Cascade/SetNull) — see prisma/schema.prisma for the
// authoritative source, never re-guessed here.
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { InitializationModule, DependencyViolation, SelectionValidationResult } from "./modules";

type QueryClient = typeof prisma | Prisma.TransactionClient;

// Every check below queries UNSCOPED counts (e.g. "does any Invoice exist at
// all", never "does an Invoice exist for customer X") — correct because a
// selected module is always cleared in full (deleteMany({}), no partial
// selection within a module, exactly matching the existing full-wipe's own
// all-rows-in-that-table semantics). Re-run fresh, authoritatively, inside
// the execute transaction under the same row lock the full-wipe uses (see
// executeSelective.ts) — this exported function is also called earlier,
// read-only, for the UI's pre-flight check, but that earlier call is never
// trusted as the actual gate.
export async function validateInitializationSelection(selected: Set<InitializationModule>, client: QueryClient = prisma): Promise<SelectionValidationResult> {
  const violations: DependencyViolation[] = [];
  const has = (m: InitializationModule) => selected.has(m);

  // CUSTOMER is Restrict-referenced by QuotationCase/Quotation, PolicyRecord,
  // MotorClaim/NonMotorClaim, and Invoice (all four have customerId
  // onDelete: Restrict) — deleting Customer while any of those still exist
  // fails at the database level, so every one of the four must also be
  // selected whenever real rows exist in them.
  if (has("CUSTOMER")) {
    const missing: InitializationModule[] = [];
    if (!has("QUOTATION") && (await client.quotationCase.count()) > 0) missing.push("QUOTATION");
    if (!has("POLICY") && (await client.policyRecord.count()) > 0) missing.push("POLICY");
    if (!has("TASK")) {
      const [motor, nonMotor] = await Promise.all([client.motorClaim.count(), client.nonMotorClaim.count()]);
      if (motor + nonMotor > 0) missing.push("TASK");
    }
    if (!has("INVOICE") && (await client.invoice.count()) > 0) missing.push("INVOICE");
    if (missing.length > 0) {
      violations.push({
        module: "CUSTOMER",
        requiredModules: missing,
        reason: "Selected Customer data is still referenced by existing Quotation/Policy/Task-Claim/Invoice records.",
      });
    }
  }

  // QUOTATION has no hard (Restrict) dependent — PolicyRecord.sourceQuotationId
  // / sourceQuotationSectionId / sourceCustomsBondItemId are all
  // onDelete: SetNull. Deleting every Quotation without also clearing Policy
  // would not fail, but would silently orphan real Policy traceability data
  // — treated as a blocking violation, same as a hard dependency, per this
  // phase's spec ("不要直接执行... 应提示...或者取消操作").
  if (has("QUOTATION") && !has("POLICY") && (await client.policyRecord.count({ where: { sourceQuotationId: { not: null } } })) > 0) {
    violations.push({ module: "QUOTATION", requiredModules: ["POLICY"], reason: "Selected Quotation data is linked to existing Policy records." });
  }

  // POLICY is Restrict-referenced by InvoiceItem.policyRecordId — hard block.
  if (has("POLICY") && !has("INVOICE") && (await client.invoiceItem.count()) > 0) {
    violations.push({ module: "POLICY", requiredModules: ["INVOICE"], reason: "Selected Policy data is linked to existing Invoice records." });
  }

  // POLICY -> TASK: MotorClaim/NonMotorClaim.policyRecordId is
  // onDelete: SetNull (a Claim's optional "Linked Policy" reference) — same
  // silent-orphan reasoning as QUOTATION -> POLICY above.
  if (has("POLICY") && !has("TASK")) {
    const [motor, nonMotor] = await Promise.all([
      client.motorClaim.count({ where: { policyRecordId: { not: null } } }),
      client.nonMotorClaim.count({ where: { policyRecordId: { not: null } } }),
    ]);
    if (motor + nonMotor > 0) {
      violations.push({ module: "POLICY", requiredModules: ["TASK"], reason: "Selected Policy data is linked to existing Motor/Non-Motor Claim records." });
    }
  }

  // INVOICE, LEDGER, TASK, REMINDER, USERS have no upstream selection
  // dependency: LedgerManualEntry has no FK to Customer/Quotation/Policy/
  // Invoice at all (only to the preserved, never-deleted LedgerCategory);
  // Task has no Customer FK at all; Invoice/PolicyRecord are never
  // Restrict-referenced by anything outside their own already-covered
  // relations above; REMINDER has no table; USERS has no relation FK from
  // any business table (every user reference in this schema is a plain
  // unenforced id string — see e.g. PolicyRecord.createdById).

  return violations.length > 0 ? { ok: false, violations } : { ok: true };
}
