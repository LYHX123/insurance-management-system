import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Phase 12B — source-structure guardrails (this project asserts on source
// text for layout/structure — see documentTableLayout.test.ts). Covers the
// spec points that are about "does the code still do X", not runtime data.

const root = join(__dirname, "..", "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

const detailView = read("components", "invoice", "invoice-detail-view.tsx");
const detailPage = read("app", "(app)", "invoice", "[id]", "page.tsx");
const actions = read("app", "(app)", "invoice", "actions.ts");
const downloadRoute = read("app", "api", "invoice", "[id]", "download", "route.ts");
const systemLedger = read("lib", "ledger", "systemRecords.ts");
const manualLedger = read("app", "(app)", "ledger", "actions.ts");
const enDict = read("i18n", "dictionaries", "en.ts");
const zhDict = read("i18n", "dictionaries", "zh.ts");

describe("B11/B12: Invoice detail shows Insured vs Bill-To only when they differ", () => {
  it("renders a separate Insured / Bill To block gated on hasSeparateInsured", () => {
    expect(detailView).toMatch(/detail\.hasSeparateInsured \?/);
    expect(detailView).toMatch(/t\.invoice\.insured\b/);
    expect(detailView).toMatch(/t\.invoice\.billTo\b/);
  });
  it("B12: the same-party branch still renders a single Customer row (no duplicate insured display)", () => {
    // The else branch keeps the original two cells.
    const elseBranch = detailView.split("detail.hasSeparateInsured ?")[1] ?? "";
    expect(elseBranch).toMatch(/t\.invoice\.customer\b[\s\S]*t\.invoice\.customerPin/);
  });
  it("B1: the detail page derives hasSeparateInsured from stored fields, treating NULL as same-party", () => {
    expect(detailPage).toMatch(/hasSeparateInsured\s*=\s*invoice\.insuredCustomerId !== null \|\| invoice\.insuredNameSnapshot !== null/);
    // Fallback chain ends at the Bill-To customer, so a null insured never throws.
    expect(detailPage).toMatch(/insuredNameSnapshot \?\? invoice\.insuredCustomer\?\.companyName \?\? invoice\.customer\.companyName/);
  });
});

describe("createInvoiceAction — Phase 12B validation shape", () => {
  it("no longer compares policy.customerId to input.customerId (POLICY_CUSTOMER_MISMATCH removed)", () => {
    expect(actions).not.toMatch(/error:\s*"POLICY_CUSTOMER_MISMATCH"/);
    expect(actions).not.toMatch(/r\.customerId !== input\.customerId/);
    expect(actions).not.toMatch(/records\.some\(\(r\) => r\.customerId !== input\.customerId\)/);
  });
  it("derives the insured customer from the selected policies and requires exactly one", () => {
    expect(actions).toMatch(/insuredCustomerIds\s*=\s*Array\.from\(new Set\(records\.map\(\(r\) => r\.customerId\)\)\)/);
    expect(actions).toMatch(/SAME_INSURED_REQUIRED/);
  });
  it("stores Bill-To in Invoice.customerId and the insured snapshot only when they differ", () => {
    expect(actions).toMatch(/customerId: input\.customerId/);
    expect(actions).toMatch(/insuredCustomerId: billToIsInsured \? null : insuredCustomerId/);
    expect(actions).toMatch(/insuredNameSnapshot: billToIsInsured \? null : insuredCustomer\.companyName/);
  });
  it("B8: the Excel is generated with the Bill-To customer's name/PIN", () => {
    expect(actions).toMatch(/customerName: billToCustomer\.companyName/);
    expect(actions).toMatch(/customerPin: billToCustomer\.pinNumber/);
    expect(actions).not.toMatch(/customerName: insuredCustomer/);
  });
});

describe("B9: historical invoice download is untouched", () => {
  it("the download route serves the stored file and never regenerates it", () => {
    expect(downloadRoute).toMatch(/generatedStoragePath/);
    expect(downloadRoute).not.toMatch(/generateInvoiceExcelBuffer/);
  });
});

describe("B14: ledger is not derived from Invoice and was not touched", () => {
  it("system ledger projects only from policy receipts / payments / commission — never Invoice", () => {
    expect(systemLedger).not.toMatch(/\bInvoice\b|prisma\.invoice/);
    expect(systemLedger).toMatch(/policyCustomerReceipt|PolicyCustomerReceipt/);
  });
  it("manual ledger actions do not reference Invoice at all", () => {
    expect(manualLedger).not.toMatch(/prisma\.invoice|InvoiceItem/);
  });
});

describe("i18n keys", () => {
  it("both dictionaries define the new Bill-To keys and drop the removed ones", () => {
    for (const d of [enDict, zhDict]) {
      expect(d).toMatch(/\binsured:\s*"/);
      expect(d).toMatch(/\bbillTo:\s*"/);
      expect(d).toMatch(/\bbillToIfDifferent:\s*"/);
      expect(d).toMatch(/\bsameInsuredRequired:\s*"/);
      expect(d).toMatch(/\bbillToNotFound:\s*"/);
    }
    // policyCustomerMismatch still exists in the claims section, but not with
    // the invoice "same Customer" wording.
    expect(enDict).not.toMatch(/policyCustomerMismatch: "All selected Policies must belong to the same Customer\."/);
  });
});
