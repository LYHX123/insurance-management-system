// Phase 1A.2 "Reusable Policy import foundation" — type-level documentation
// only. Motor does not formally implement these interfaces yet (that would
// mean reshaping motorImportParser.ts/importPreviewBuilder.ts around a
// generic contract before there's a second real category to validate it
// against — a premature abstraction this phase deliberately avoids). They
// exist so the NEXT category (Non-Motor, Bond, or Work Permit) has a
// concrete shape to extract Motor's working pieces into, instead of
// guessing one from scratch.
//
// What's already category-agnostic today, with no change needed:
//   - src/lib/policy/customerMatch.ts (matchCustomerByName)
//   - src/lib/policy/normalize.ts (date/amount/commission/name normalization)
//   - src/lib/policy/duplicateKeys.ts (buildDuplicateKeys)
//   - src/lib/policy/exactDuplicateCheck.ts (detectExactDuplicates — takes a
//     PolicyCategory parameter as of this phase)
//   - src/lib/policy/importBatchSummary.ts (computeImportBatchSummary)
//   - src/lib/policy/recordNumber.ts, src/lib/policy/status.ts
//
// What's still Motor-specific, and would move behind these interfaces for a
// second category:
//   - src/lib/policy/motorImportParser.ts (workbook -> ParsedMotorRow[])
//   - src/lib/policy/motorCoverTypes.ts (Motor's own known-values list)
//   - buildImportPreviewRows / deriveStatusAndWarnings's Motor-shaped input
//     (would become generic over TParsedRow)
//   - the *PolicyDetail creation block inside importOneRow
//     (src/app/(app)/policy/motor/import/actions.ts)

import type { PolicyCategory } from "@/generated/prisma/enums";

// A category's raw-workbook parser: bytes in, category-shaped rows out.
// Motor's real implementation is parseMotorWorkbook — it doesn't currently
// return a value literally typed as PolicyImportParser<ParsedMotorRow>, but
// its signature already matches this shape.
export interface PolicyImportParser<TParsedRow> {
  category: PolicyCategory;
  sheetName: string;
  parse(buffer: Buffer): Promise<{
    sheetNames: string[];
    sheetFound: boolean;
    headerMismatches: { column: number; expected: string; actual: string }[];
    rows: TParsedRow[];
  }>;
}

// A category's mapper from a parsed row into the flat PolicyImportRow
// columns that are NOT already category-agnostic (insuranceType,
// registrationNumber, vehicleValue, ... for Motor; each future category
// defines its own equivalent subset).
export interface PolicyImportMapper<TParsedRow> {
  category: PolicyCategory;
  toImportRowFields(row: TParsedRow): Record<string, unknown>;
  // Creates the category-specific *PolicyDetail row (MotorPolicyDetail's
  // equivalent) once a PolicyRecord exists for this row.
  createDetail(policyRecordId: string, row: TParsedRow): Promise<void>;
}
