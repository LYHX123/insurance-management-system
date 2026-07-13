export const MODULE_KEYS = [
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

export type ModuleKey = (typeof MODULE_KEYS)[number];

export const ALL_MODULE_KEYS: ModuleKey[] = [...MODULE_KEYS];

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

export function sanitizePermissions(permissions: string[]): ModuleKey[] {
  return Array.from(new Set(permissions.filter(isModuleKey)));
}

export function hasModuleAccess(
  permissions: string[],
  moduleKey: ModuleKey
): boolean {
  return permissions.includes(moduleKey);
}

export function firstAccessibleModule(permissions: string[]): ModuleKey | null {
  return MODULE_KEYS.find((key) => permissions.includes(key)) ?? null;
}

export function moduleKeyFromPathname(pathname: string): ModuleKey | null {
  const segment = pathname.split("/").filter(Boolean)[0] ?? "";
  return isModuleKey(segment) ? segment : null;
}
