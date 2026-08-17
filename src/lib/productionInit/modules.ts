// Production Initialization — Phase 7 Part C: Selective (per-module)
// initialization. Additive alongside the existing all-or-nothing
// runProductionInitialization (execute.ts) — that function, its route, and
// its UI are completely untouched by this file.
//
// Deliberately has ZERO server-only imports (no `@/lib/prisma`, matching
// constants.ts's own "safe to import from either side" convention) — this
// module is imported directly by the "use client" Settings panel
// (production-initialization-panel.tsx) for its type/constant/
// isModuleAvailable exports. The actual dependency-check queries
// (validateInitializationSelection, which DOES need prisma) live in the
// separate validateSelection.ts instead — importing prisma here would pull
// the `pg` driver into the client bundle and break the production build.

export type InitializationModule = "CUSTOMER" | "QUOTATION" | "POLICY" | "INVOICE" | "LEDGER" | "TASK" | "REMINDER" | "USERS" | "SETTINGS";

export const ALL_MODULES: InitializationModule[] = ["CUSTOMER", "QUOTATION", "POLICY", "INVOICE", "LEDGER", "TASK", "REMINDER", "USERS", "SETTINGS"];

// UI grouping (this phase's spec, Part 五) — purely presentational, the
// server treats every module the same way in validation/execution.
export const BUSINESS_DATA_MODULES: InitializationModule[] = ["CUSTOMER", "QUOTATION", "POLICY", "INVOICE", "LEDGER", "TASK"];
export const SYSTEM_DATA_MODULES: InitializationModule[] = ["REMINDER", "USERS", "SETTINGS"];

// REMINDER has no persisted table at all — src/lib/reminders/service.ts
// computes every reminder live from Policy/Task/Claim data on each request;
// there is no stored "Reminder" row anywhere in prisma/schema.prisma. It is
// still a selectable module (never an error to include it) but it is always
// a structural no-op: reminders simply stop appearing once their SOURCE data
// (Policy/Task/Claim) is itself cleared — there is nothing to delete here.
//
// SETTINGS is deliberately NOT implemented this round. SystemSettings is a
// singleton row (see its own schema doc comment) that mixes business-
// editable fields (company name, PIN, logo, default currency, reminder day
// thresholds) with nothing Dropbox-credential-related — those live in the
// entirely separate DropboxIntegration model, which this feature (both this
// selective path and the existing full-wipe) never touches at all. So the
// concern here is not "might leak a credential" but that this codebase has
// no existing, audited notion of "reset SystemSettings to safe defaults" —
// unlike every other module, there is no precedent deleteMany() call for it
// anywhere, and inventing reset semantics for company/contact info and
// reminder-day thresholds is exactly the kind of guess this phase's spec
// says not to make. Per that spec's own fallback ("如果当前架构无法安全区分：
// 本轮不要开放"), left unavailable — the UI shows it disabled with an
// explanatory label rather than silently omitting it.
export const UNAVAILABLE_MODULES: InitializationModule[] = ["SETTINGS"];

export function isModuleAvailable(module: InitializationModule): boolean {
  return !UNAVAILABLE_MODULES.includes(module);
}

export type DependencyViolation = {
  module: InitializationModule;
  requiredModules: InitializationModule[];
  // Safe, human-readable (server-log-safe, no raw data) English summary —
  // mirrors errorSummary's own "safe summary only" convention in
  // execute.ts. The UI renders its own localized copy keyed by `module` +
  // `requiredModules`, this string is a fallback/log-only description.
  reason: string;
};

export type SelectionValidationResult = { ok: true } | { ok: false; violations: DependencyViolation[] };
