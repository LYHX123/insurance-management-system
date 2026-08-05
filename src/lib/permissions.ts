// Centralized, client-safe permission model. Pure data + pure functions only
// (no `auth()`/prisma import here) — this module is imported directly by
// client components (Sidebar, the Add/Edit User form), so pulling in any
// server-only dependency here would break the client bundle. Server-only
// helpers that call `auth()` live in `src/lib/authz.ts` instead.
import type { PolicyCategory } from "@/generated/prisma/enums";

export const POLICY_PERMISSION_KEYS = [
  "policy.motor",
  "policy.non_motor",
  "policy.bond",
  "policy.work_permit",
] as const;

export const LEDGER_PERMISSION_KEYS = [
  "ledger.manual_record",
  "ledger.system_record",
] as const;

export const TASK_PERMISSION_KEYS = [
  "task.daily_task",
  "claim.motor",
  "claim.non_motor",
] as const;

export const GENERAL_PERMISSION_KEYS = [
  "dashboard",
  "customer",
  "quotation",
  "invoice",
  "settings",
] as const;

// "users" is deliberately excluded — User Management is never granted
// through the permissions array; it is isAdmin-only (see hasMenuAccess).
export const ALL_PERMISSION_KEYS = [
  ...GENERAL_PERMISSION_KEYS,
  ...POLICY_PERMISSION_KEYS,
  ...LEDGER_PERMISSION_KEYS,
  ...TASK_PERMISSION_KEYS,
] as const;

export type PermissionKey = (typeof ALL_PERMISSION_KEYS)[number];

export function isPermissionKey(value: string): value is PermissionKey {
  return (ALL_PERMISSION_KEYS as readonly string[]).includes(value);
}

// Accepts both the legacy bare module keys (isPermissionKey) AND the new
// "<resource>.view"/"<resource>.edit" stored values (see the VIEW/EDIT
// section below) — the single allowlist every write path (Add/Edit User
// form, seed/migration scripts) must run stored permissions through, so a
// typo'd or stale string can never silently sit in the database.
export function isStoredPermissionValue(value: string): boolean {
  if (isPermissionKey(value)) return true;
  for (const resource of VIEW_EDIT_RESOURCE_KEYS) {
    if (value === `${resource}.view`) return true;
    if (value === `${resource}.edit` && isEditCapableResource(resource)) return true;
  }
  return false;
}

export function sanitizePermissions(permissions: string[]): string[] {
  return Array.from(new Set(permissions.filter(isStoredPermissionValue)));
}

// ---------------------------------------------------------------------------
// Role / admin
// ---------------------------------------------------------------------------

// The single, reliable definition of "is this user an administrator" used
// everywhere (frontend visibility AND backend enforcement) — never a
// separate frontend-only flag. `role` otherwise stays a free-text label
// (e.g. "MD", "Staff") with no other meaning to the app.
export function normalizeRole(role: string | null | undefined): string {
  return (role ?? "").trim().toUpperCase();
}

export function isAdminRole(role: string | null | undefined): boolean {
  return normalizeRole(role) === "ADMIN";
}

export type AuthzUser = {
  role: string;
  status: string; // UserStatus: "ACTIVE" | "DISABLED"
  permissions: string[];
};

export function isActiveUser(user: AuthzUser | null | undefined): boolean {
  return !!user && user.status === "ACTIVE";
}

// Inactive users are never authorized, regardless of role or permissions.
export function isAdmin(user: AuthzUser | null | undefined): boolean {
  return isActiveUser(user) && isAdminRole(user!.role);
}

// ---------------------------------------------------------------------------
// VIEW / EDIT levels
// ---------------------------------------------------------------------------
//
// Every module/sub-module key below used to mean one thing: "has this
// permission" = full read+write access. This section layers a VIEW/EDIT
// distinction on top WITHOUT changing what's stored — still plain strings in
// User.permissions: string[], no new table, no Prisma migration.
//
// New stored values are the resource key plus a suffix: "customer.view",
// "customer.edit", "policy.motor.view", "policy.motor.edit", etc. The
// original bare key (e.g. "customer", "policy.motor") remains a valid stored
// value forever — for an existing user who already has it, it now resolves
// to EDIT (their old "full access" is preserved exactly, never downgraded to
// VIEW). This is a parse-layer compatibility shim, not a data migration: old
// rows keep working unmodified.
//
// "dashboard" and "settings" are deliberately NOT part of this scheme — they
// stay the plain boolean keys they always were (dashboard has no write
// operations of its own; settings is ADMIN-only regardless, see
// ADMIN_ONLY_MENU_KEYS below).
export const VIEW_EDIT_RESOURCE_KEYS = [
  "customer",
  "quotation",
  "invoice",
  "policy.motor",
  "policy.non_motor",
  "policy.bond",
  "policy.work_permit",
  "ledger.manual_record",
  "ledger.system_record",
  "task.daily_task",
  "claim.motor",
  "claim.non_motor",
] as const;

export type ViewEditResourceKey = (typeof VIEW_EDIT_RESOURCE_KEYS)[number];

// The system ledger is a read-only derived view of auto-generated entries
// (see ledger/actions.ts and the LEDGER_PERMISSION_KEYS comment) — there has
// never been a manual write path for it, so it never gets an EDIT level, only
// VIEW. Adding one here would be inventing a capability the app doesn't have.
const EDIT_INCAPABLE_RESOURCE_KEYS = new Set<ViewEditResourceKey>(["ledger.system_record"]);

export function isViewEditResourceKey(key: string): key is ViewEditResourceKey {
  return (VIEW_EDIT_RESOURCE_KEYS as readonly string[]).includes(key);
}

export function isEditCapableResource(key: ViewEditResourceKey): boolean {
  return !EDIT_INCAPABLE_RESOURCE_KEYS.has(key);
}

function viewStoredKey(resource: ViewEditResourceKey): string {
  return `${resource}.view`;
}

function editStoredKey(resource: ViewEditResourceKey): string {
  return `${resource}.edit`;
}

export type PermissionLevel = "NONE" | "VIEW" | "EDIT";

// hasPermission == "VIEW or above" for any key — the existing meaning of
// "has this permission" for keys with no view/edit split (dashboard,
// settings), extended to also recognize the new .view/.edit suffixes for
// keys that do. This is intentionally the SAME function every existing call
// site (Sidebar, layouts, page guards, proxy.ts) already uses — every one of
// them now automatically treats VIEW-only as "has access" with zero changes
// required at those call sites.
export function hasPermission(
  user: AuthzUser | null | undefined,
  key: PermissionKey
): boolean {
  if (!isActiveUser(user)) return false;
  if (isAdmin(user)) return true;
  if (user!.permissions.includes(key)) return true;
  if (isViewEditResourceKey(key)) {
    if (user!.permissions.includes(viewStoredKey(key))) return true;
    if (isEditCapableResource(key) && user!.permissions.includes(editStoredKey(key))) return true;
  }
  return false;
}

// Alias kept distinct from hasPermission for readability at call sites that
// are specifically about read access (page guards, document preview/
// download) — same implementation, "VIEW or above".
export const canView = hasPermission;

// EDIT-level check — the only thing that may authorize a write. Fails closed
// for keys with no view/edit split (dashboard/settings — never grantable
// through this scheme) and for ledger.system_record (no EDIT capability
// exists). A legacy bare key (pre-VIEW/EDIT full access) resolves to EDIT,
// never NONE — required by the "don't downgrade existing users" rule.
export function canEdit(
  user: AuthzUser | null | undefined,
  key: PermissionKey
): boolean {
  if (!isActiveUser(user)) return false;
  if (isAdmin(user)) return true;
  if (!isViewEditResourceKey(key) || !isEditCapableResource(key)) return false;
  if (user!.permissions.includes(editStoredKey(key))) return true;
  if (user!.permissions.includes(key)) return true; // legacy full-access key
  return false;
}

// Pure, role-independent version of the same resolution — used by the
// Add/Edit User form, which edits a raw permissions: string[] draft for a
// non-admin account (the form hides this whole section for ADMIN, see
// user-form-modal.tsx) and has no AuthzUser/session to check isAdmin against.
export function levelForStoredPermissions(
  permissions: readonly string[],
  key: ViewEditResourceKey
): PermissionLevel {
  if (isEditCapableResource(key) && permissions.includes(editStoredKey(key))) return "EDIT";
  if (permissions.includes(key)) return isEditCapableResource(key) ? "EDIT" : "VIEW"; // legacy bare key
  if (permissions.includes(viewStoredKey(key))) return "VIEW";
  return "NONE";
}

// The level for one resource — used by tests and anywhere a full AuthzUser
// (with role/status) is available. Admins are reported as EDIT (their actual
// access is unconditional via isAdmin(), this is purely a display value for
// a UI that never renders a selector for admin accounts anyway).
export function resourceLevel(
  user: AuthzUser | null | undefined,
  key: ViewEditResourceKey
): PermissionLevel {
  if (canEdit(user, key)) return "EDIT";
  if (hasPermission(user, key)) return "VIEW";
  return "NONE";
}

// Inverse of resourceLevel — used by the Add/Edit User form to turn a
// None/View/Edit selection back into the (0, 1, or 2) stored permission
// strings for one resource. Always emits the new .view/.edit form, never the
// legacy bare key — the legacy key is only ever read for backward
// compatibility, never written by new code.
export function levelToStoredKeys(resource: ViewEditResourceKey, level: PermissionLevel): string[] {
  if (level === "EDIT" && isEditCapableResource(resource)) return [editStoredKey(resource)];
  if (level === "NONE") return [];
  return [viewStoredKey(resource)];
}

export function hasAnyPermission(
  user: AuthzUser | null | undefined,
  keys: readonly PermissionKey[]
): boolean {
  if (!isActiveUser(user)) return false;
  if (isAdmin(user)) return true;
  return keys.some((k) => hasPermission(user, k));
}

// ---------------------------------------------------------------------------
// Menu / top-level module visibility (sidebar + route guard)
// ---------------------------------------------------------------------------

export const MENU_KEYS = [
  "dashboard",
  "customer",
  "quotation",
  "invoice",
  "policy",
  "ledger",
  "task",
  "users",
  "settings",
] as const;

export type MenuKey = (typeof MENU_KEYS)[number];

// Menus that are never granted through the stored permissions array, no
// matter what it contains — access is isAdmin-only. "users" always has
// been; "settings" joined it in the reminders/Settings phase (the
// `settings` permission key is kept in ALL_PERMISSION_KEYS purely for
// database/back-compat with rows that already have it stored — it is
// simply never consulted for access anymore, see hasMenuAccess below).
const ADMIN_ONLY_MENU_KEYS = new Set<MenuKey>(["users", "settings"]);

// Which detailed permission keys grant visibility for each non-admin-only
// menu item.
export const MENU_PERMISSION_KEYS: Record<
  Exclude<MenuKey, "users" | "settings">,
  readonly PermissionKey[]
> = {
  dashboard: ["dashboard"],
  customer: ["customer"],
  quotation: ["quotation"],
  invoice: ["invoice"],
  policy: POLICY_PERMISSION_KEYS,
  ledger: LEDGER_PERMISSION_KEYS,
  task: TASK_PERMISSION_KEYS,
};

export function isMenuKey(value: string): value is MenuKey {
  return (MENU_KEYS as readonly string[]).includes(value);
}

export function hasMenuAccess(
  user: AuthzUser | null | undefined,
  menuKey: MenuKey
): boolean {
  if (!isActiveUser(user)) return false;
  if (isAdmin(user)) return true;
  if (ADMIN_ONLY_MENU_KEYS.has(menuKey)) return false;
  const keys = MENU_PERMISSION_KEYS[menuKey as Exclude<MenuKey, "users" | "settings">];
  // hasPermission (VIEW-or-above) — a VIEW-only user must still see the menu
  // and be able to browse; it's write actions that get gated separately.
  return keys.some((k) => hasPermission(user, k));
}

export function firstAccessibleMenu(
  user: AuthzUser | null | undefined
): MenuKey | null {
  if (isAdmin(user)) return "dashboard";
  return (
    MENU_KEYS.find((key) => !ADMIN_ONLY_MENU_KEYS.has(key) && hasMenuAccess(user, key)) ??
    null
  );
}

export function moduleKeyFromPathname(pathname: string): MenuKey | null {
  const segment = pathname.split("/").filter(Boolean)[0] ?? "";
  return isMenuKey(segment) ? segment : null;
}

// ---------------------------------------------------------------------------
// Sub-category routes (Policy / Ledger / Task & Claim second URL segment) —
// used by proxy.ts for direct-URL enforcement, and by each section's
// layout.tsx to filter which tabs are rendered.
// ---------------------------------------------------------------------------

export type CategoryRoute = { key: PermissionKey; slug: string };

// Maps a PolicyRecord's `category` column to its detailed permission key —
// used wherever a route only has the record (not the URL) to determine
// which permission applies (e.g. a shared /api/policy-documents/[id]
// download route serving documents from every category).
export const POLICY_CATEGORY_PERMISSION: Record<PolicyCategory, PermissionKey> = {
  MOTOR: "policy.motor",
  NON_MOTOR: "policy.non_motor",
  BOND: "policy.bond",
  WORK_PERMIT: "policy.work_permit",
};

export const POLICY_CATEGORY_ROUTES: readonly CategoryRoute[] = [
  { key: "policy.motor", slug: "motor" },
  { key: "policy.non_motor", slug: "non-motor" },
  { key: "policy.bond", slug: "bond" },
  { key: "policy.work_permit", slug: "work-permit" },
];

export const LEDGER_CATEGORY_ROUTES: readonly CategoryRoute[] = [
  { key: "ledger.manual_record", slug: "manual" },
  { key: "ledger.system_record", slug: "system" },
];

export const TASK_CATEGORY_ROUTES: readonly CategoryRoute[] = [
  { key: "task.daily_task", slug: "daily" },
  { key: "claim.motor", slug: "motor-claim" },
  { key: "claim.non_motor", slug: "non-motor-claim" },
];

const CATEGORY_ROUTES_BY_MENU: Partial<Record<MenuKey, readonly CategoryRoute[]>> = {
  policy: POLICY_CATEGORY_ROUTES,
  ledger: LEDGER_CATEGORY_ROUTES,
  task: TASK_CATEGORY_ROUTES,
};

// Second URL segment's required permission key, if the first segment is one
// of the grouped modules (Policy/Ledger/Task & Claim). Null for every other
// path shape (including the bare `/policy`, `/ledger`, `/task` index routes,
// which redirect to the first accessible category page instead).
export function subPermissionForPathname(pathname: string): PermissionKey | null {
  const segments = pathname.split("/").filter(Boolean);
  const [top, sub] = segments;
  if (!top || !sub) return null;
  const routes = CATEGORY_ROUTES_BY_MENU[top as MenuKey];
  if (!routes) return null;
  return routes.find((r) => r.slug === sub)?.key ?? null;
}

export function firstAccessibleCategorySlug(
  user: AuthzUser | null | undefined,
  routes: readonly CategoryRoute[]
): string | null {
  if (isAdmin(user)) return routes[0]?.slug ?? null;
  return routes.find((r) => hasPermission(user, r.key))?.slug ?? null;
}

// ---------------------------------------------------------------------------
// Permission group config for the Add/Edit User form UI (Part 5 layout).
// "standalone" groups render one plain checkbox; grouped ones render a
// parent "Select All" checkbox (checked/indeterminate/unchecked) plus one
// child checkbox per key.
// ---------------------------------------------------------------------------

export type PermissionGroupConfig =
  | { menuKey: "dashboard"; kind: "boolean"; booleanKey: PermissionKey; standalone: true; children: readonly [] }
  | { menuKey: Exclude<MenuKey, "users" | "settings" | "dashboard">; kind: "levels"; standalone: boolean; children: readonly ViewEditResourceKey[] };

// "settings" is deliberately absent — Settings is ADMIN-only (see
// ADMIN_ONLY_MENU_KEYS above); showing a selector for it here would imply a
// non-admin selection could grant access, which it no longer can. "dashboard"
// keeps its original plain boolean checkbox (it has no write operations of
// its own, so a VIEW/EDIT split would be meaningless) — every other group
// renders a None/View/Edit selector per child (Part 7 of the user
// management UI: one row per module/sub-module, never a checkbox grid).
export const PERMISSION_GROUPS: readonly PermissionGroupConfig[] = [
  { menuKey: "dashboard", kind: "boolean", booleanKey: "dashboard", standalone: true, children: [] },
  { menuKey: "customer", kind: "levels", standalone: true, children: ["customer"] },
  { menuKey: "quotation", kind: "levels", standalone: true, children: ["quotation"] },
  { menuKey: "invoice", kind: "levels", standalone: true, children: ["invoice"] },
  { menuKey: "policy", kind: "levels", standalone: false, children: POLICY_PERMISSION_KEYS },
  { menuKey: "ledger", kind: "levels", standalone: false, children: LEDGER_PERMISSION_KEYS },
  { menuKey: "task", kind: "levels", standalone: false, children: TASK_PERMISSION_KEYS },
];
