import { isNonMotorCoverType, type NonMotorCoverType } from "./nonMotorCoverTypes";

// Normalizes free text to a comparable key: uppercase, non-alphanumeric runs
// collapsed to a single underscore, trimmed. Used only for exact alias
// lookup below — never a substring/fuzzy match, so a Motor/Bond/Work Permit
// type (or anything unrecognized) never silently resolves to a Non-Motor
// type.
function normalize(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// Exact aliases only, sourced from this project's own Non-Motor display
// labels (see src/i18n/dictionaries/en.ts coverContractorsAllRisks etc.) plus
// the handful of common abbreviations already used elsewhere in this
// codebase for the same covers (CAR, EL, CPM, PL, GPA, GIT) — deliberately
// not a broad fuzzy matcher. Motor cover text (COMPREHENSIVE, THIRD PARTY,
// ...), Bond type text (TENDER BOND, ...), and Work Permit type text
// (CLASS D, ...) never appear here, so they always fail to resolve and are
// flagged as an unsupported type by the caller — never silently converted.
const ALIASES: Record<string, NonMotorCoverType> = {
  CAR: "CONTRACTORS_ALL_RISKS",
  CONTRACTORS_ALL_RISKS_CAR: "CONTRACTORS_ALL_RISKS",
  CONTRACTOR_S_ALL_RISKS: "CONTRACTORS_ALL_RISKS",
  WORK_INJURY_BENEFITS_ACT: "WIBA",
  EL: "EMPLOYERS_LIABILITY",
  EMPLOYER_S_LIABILITY_EL: "EMPLOYERS_LIABILITY",
  EMPLOYER_S_LIABILITY: "EMPLOYERS_LIABILITY",
  CPM: "CONTRACTORS_PLANT_MACHINERY",
  CONTRACTORS_PLANT_MACHINERY_CPM: "CONTRACTORS_PLANT_MACHINERY",
  CONTRACTORS_PLANT_AND_MACHINERY: "CONTRACTORS_PLANT_MACHINERY",
  PL: "PUBLIC_LIABILITY",
  PUBLIC_LIABILITY_PL: "PUBLIC_LIABILITY",
  FIRE_AND_ALLIED_PERILS: "FIRE_ALLIED_PERILS",
  FIRE_PERILS: "FIRE_ALLIED_PERILS",
  GOODS_IN_TRANSIT_SINGLE_TRIP: "GOODS_IN_TRANSIT_SINGLE",
  GIT_SINGLE: "GOODS_IN_TRANSIT_SINGLE",
  GIT_ANNUAL: "GOODS_IN_TRANSIT_ANNUAL",
  MARINE_CARGO: "MARINE",
  GPA: "GROUP_PERSONAL_ACCIDENT",
  GROUP_PERSONAL_ACCIDENT_GPA: "GROUP_PERSONAL_ACCIDENT",
};

// Maps free-text TYPE OF COVER cell content to a real NonMotorCoverType, or
// null if it can't be resolved — the caller (nonMotorImportPreviewBuilder)
// treats null as an ERROR-status row, never a silent guess. Accepts the raw
// enum spelling itself (e.g. "WIBA", "Fire Allied Perils") as well as the
// alias table above.
export function mapImportTextToNonMotorCoverType(raw: string | null): NonMotorCoverType | null {
  if (!raw) return null;
  const norm = normalize(raw);
  if (isNonMotorCoverType(norm)) return norm;
  return ALIASES[norm] ?? null;
}
