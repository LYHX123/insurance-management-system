import type { Dictionary } from "@/i18n/dictionaries/en";
import { PERMISSION_GROUPS } from "@/lib/permissions";

// Strips a VIEW/EDIT suffix (see permissions.ts) so the underlying resource
// key can still be looked up in PERMISSION_GROUPS — legacy bare keys (no
// suffix) pass through unchanged and are labeled with no level annotation,
// exactly as before this upgrade.
function splitLevelSuffix(key: string): { base: string; suffix: "view" | "edit" | null } {
  if (key.endsWith(".view")) return { base: key.slice(0, -".view".length), suffix: "view" };
  if (key.endsWith(".edit")) return { base: key.slice(0, -".edit".length), suffix: "edit" };
  return { base: key, suffix: null };
}

// "Policy: Motor (View)" for grouped keys, plain "Dashboard" for the
// boolean-only group — combines the existing sidebar module label with the
// group's child label rather than maintaining a second, fully-duplicated
// permission-label map.
export function permissionLabel(t: Dictionary, key: string): string {
  const { base, suffix } = splitLevelSuffix(key);
  const levelSuffix = suffix === "edit" ? ` (${t.users.permissionLevelEdit})` : suffix === "view" ? ` (${t.users.permissionLevelView})` : "";

  const booleanGroup = PERMISSION_GROUPS.find((g) => g.kind === "boolean" && g.booleanKey === base);
  if (booleanGroup) return t.sidebar[booleanGroup.menuKey];

  const group = PERMISSION_GROUPS.find((g) => g.kind === "levels" && (g.children as readonly string[]).includes(base));
  if (!group) return key;
  if (group.standalone) return `${t.sidebar[group.menuKey]}${levelSuffix}`;
  const childLabel = t.users.permissionChildLabels[base as keyof typeof t.users.permissionChildLabels];
  return `${t.sidebar[group.menuKey]}: ${childLabel ?? base}${levelSuffix}`;
}
