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

export function sanitizePermissions(permissions: string[]): PermissionKey[] {
  return Array.from(new Set(permissions.filter(isPermissionKey)));
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

export function hasPermission(
  user: AuthzUser | null | undefined,
  key: PermissionKey
): boolean {
  if (!isActiveUser(user)) return false;
  if (isAdmin(user)) return true;
  return user!.permissions.includes(key);
}

export function hasAnyPermission(
  user: AuthzUser | null | undefined,
  keys: readonly PermissionKey[]
): boolean {
  if (!isActiveUser(user)) return false;
  if (isAdmin(user)) return true;
  return keys.some((k) => user!.permissions.includes(k));
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

// Which detailed permission keys grant visibility for each menu item.
// "users" has no entry: it is never satisfied via this map (isAdmin-only).
export const MENU_PERMISSION_KEYS: Record<
  Exclude<MenuKey, "users">,
  readonly PermissionKey[]
> = {
  dashboard: ["dashboard"],
  customer: ["customer"],
  quotation: ["quotation"],
  invoice: ["invoice"],
  policy: POLICY_PERMISSION_KEYS,
  ledger: LEDGER_PERMISSION_KEYS,
  task: TASK_PERMISSION_KEYS,
  settings: ["settings"],
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
  if (menuKey === "users") return false;
  return MENU_PERMISSION_KEYS[menuKey].some((k) => user!.permissions.includes(k));
}

export function firstAccessibleMenu(
  user: AuthzUser | null | undefined
): MenuKey | null {
  if (isAdmin(user)) return "dashboard";
  return (
    MENU_KEYS.find((key) => key !== "users" && hasMenuAccess(user, key)) ??
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
  return routes.find((r) => user && user.permissions.includes(r.key))?.slug ?? null;
}

// ---------------------------------------------------------------------------
// Permission group config for the Add/Edit User form UI (Part 5 layout).
// "standalone" groups render one plain checkbox; grouped ones render a
// parent "Select All" checkbox (checked/indeterminate/unchecked) plus one
// child checkbox per key.
// ---------------------------------------------------------------------------

export type PermissionGroupConfig = {
  menuKey: Exclude<MenuKey, "users">;
  standalone: boolean;
  children: readonly PermissionKey[];
};

export const PERMISSION_GROUPS: readonly PermissionGroupConfig[] = [
  { menuKey: "dashboard", standalone: true, children: ["dashboard"] },
  { menuKey: "customer", standalone: true, children: ["customer"] },
  { menuKey: "quotation", standalone: true, children: ["quotation"] },
  { menuKey: "invoice", standalone: true, children: ["invoice"] },
  { menuKey: "policy", standalone: false, children: POLICY_PERMISSION_KEYS },
  { menuKey: "ledger", standalone: false, children: LEDGER_PERMISSION_KEYS },
  { menuKey: "task", standalone: false, children: TASK_PERMISSION_KEYS },
  { menuKey: "settings", standalone: true, children: ["settings"] },
];
