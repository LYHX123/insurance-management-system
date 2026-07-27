import type { Dictionary } from "@/i18n/dictionaries/en";
import { PERMISSION_GROUPS, type PermissionKey } from "@/lib/permissions";

// "Policy: Motor" for grouped keys, plain "Dashboard" for standalone ones —
// combines the existing sidebar module label with the group's child label
// rather than maintaining a second, fully-duplicated permission-label map.
export function permissionLabel(t: Dictionary, key: string): string {
  const group = PERMISSION_GROUPS.find((g) => g.children.includes(key as PermissionKey));
  if (!group) return key;
  if (group.standalone) return t.sidebar[group.menuKey];
  const childLabel = t.users.permissionChildLabels[key as keyof typeof t.users.permissionChildLabels];
  return `${t.sidebar[group.menuKey]}: ${childLabel ?? key}`;
}
