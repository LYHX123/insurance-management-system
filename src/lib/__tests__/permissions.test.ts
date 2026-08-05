import { describe, it, expect } from "vitest";
import {
  hasPermission,
  canView,
  canEdit,
  resourceLevel,
  levelForStoredPermissions,
  levelToStoredKeys,
  hasMenuAccess,
  hasAnyPermission,
  firstAccessibleCategorySlug,
  isAdmin,
  sanitizePermissions,
  isStoredPermissionValue,
  POLICY_CATEGORY_ROUTES,
  type AuthzUser,
} from "../permissions";

function user(permissions: string[], overrides: Partial<AuthzUser> = {}): AuthzUser {
  return { role: "Staff", status: "ACTIVE", permissions, ...overrides };
}

const ADMIN = user([], { role: "Admin" });

describe("VIEW/EDIT permission model (Insurance permission upgrade)", () => {
  // --- 1. NONE ----------------------------------------------------------
  it("NONE: a user with no relevant permission strings cannot view or edit the module", () => {
    const u = user([]);
    expect(hasPermission(u, "policy.motor")).toBe(false);
    expect(canEdit(u, "policy.motor")).toBe(false);
    expect(hasMenuAccess(u, "policy")).toBe(false);
    expect(resourceLevel(u, "policy.motor")).toBe("NONE");
  });

  // --- 2/3/10. VIEW can browse list/detail/download but never write -----
  it("VIEW-only: can view (list/detail/menu/download) but cannot edit", () => {
    const u = user(["policy.motor.view"]);
    expect(hasPermission(u, "policy.motor")).toBe(true); // list/detail/download gate
    expect(canView(u, "policy.motor")).toBe(true);
    expect(hasMenuAccess(u, "policy")).toBe(true);
    expect(canEdit(u, "policy.motor")).toBe(false); // 4/5/6/7/8/9
    expect(resourceLevel(u, "policy.motor")).toBe("VIEW");
  });

  // --- 11/12. EDIT implies VIEW and allows writes ------------------------
  it("EDIT: implies VIEW and allows write operations", () => {
    const u = user(["policy.motor.edit"]);
    expect(hasPermission(u, "policy.motor")).toBe(true); // EDIT => VIEW
    expect(canView(u, "policy.motor")).toBe(true);
    expect(canEdit(u, "policy.motor")).toBe(true);
    expect(resourceLevel(u, "policy.motor")).toBe("EDIT");
  });

  // --- 13. Admin bypasses everything --------------------------------------
  it("Admin: has VIEW and EDIT on every resource regardless of stored permissions", () => {
    expect(hasPermission(ADMIN, "policy.motor")).toBe(true);
    expect(canEdit(ADMIN, "policy.motor")).toBe(true);
    expect(canEdit(ADMIN, "customer")).toBe(true);
    expect(canEdit(ADMIN, "ledger.system_record")).toBe(true); // display-only EDIT for a UI that never shows admin a selector
    expect(hasMenuAccess(ADMIN, "users")).toBe(true);
    expect(hasMenuAccess(ADMIN, "settings")).toBe(true);
  });

  // --- 14/15. Policy sub-modules are fully independent --------------------
  it("Policy Motor VIEW does not grant any access to Non-Motor/Bond/Work-Permit", () => {
    const u = user(["policy.motor.view"]);
    expect(hasPermission(u, "policy.non_motor")).toBe(false);
    expect(hasPermission(u, "policy.bond")).toBe(false);
    expect(hasPermission(u, "policy.work_permit")).toBe(false);
    expect(canEdit(u, "policy.motor")).toBe(false);
  });

  it("each Policy sub-module resolves its own independent level", () => {
    const u = user(["policy.motor.edit", "policy.non_motor.view", "policy.bond.edit"]);
    expect(resourceLevel(u, "policy.motor")).toBe("EDIT");
    expect(resourceLevel(u, "policy.non_motor")).toBe("VIEW");
    expect(resourceLevel(u, "policy.bond")).toBe("EDIT");
    expect(resourceLevel(u, "policy.work_permit")).toBe("NONE");
  });

  it("firstAccessibleCategorySlug only offers a Policy category the user actually has VIEW/EDIT on", () => {
    const u = user(["policy.bond.view"]);
    expect(firstAccessibleCategorySlug(u, POLICY_CATEGORY_ROUTES)).toBe("bond");
  });

  // --- 16. Legacy bare-key permissions are preserved as EDIT --------------
  describe("Backward compatibility: legacy bare-key permissions", () => {
    it("a legacy bare 'policy.motor' string (pre-VIEW/EDIT full access) resolves to EDIT, never downgraded to VIEW", () => {
      const u = user(["policy.motor"]);
      expect(hasPermission(u, "policy.motor")).toBe(true);
      expect(canEdit(u, "policy.motor")).toBe(true);
      expect(resourceLevel(u, "policy.motor")).toBe("EDIT");
    });

    it("legacy bare 'customer' resolves to EDIT", () => {
      const u = user(["customer"]);
      expect(canEdit(u, "customer")).toBe(true);
    });

    it("legacy bare 'ledger.system_record' resolves to VIEW only — it never had a write path", () => {
      const u = user(["ledger.system_record"]);
      expect(hasPermission(u, "ledger.system_record")).toBe(true);
      expect(canEdit(u, "ledger.system_record")).toBe(false);
      expect(resourceLevel(u, "ledger.system_record")).toBe("VIEW");
    });

    it("sanitizePermissions never strips a legacy bare key, and never invents a new one", () => {
      const stored = sanitizePermissions(["policy.motor", "customer", "not-a-real-key"]);
      expect(stored).toContain("policy.motor");
      expect(stored).toContain("customer");
      expect(stored).not.toContain("not-a-real-key");
    });

    it("sanitizePermissions accepts the new .view/.edit suffixed forms", () => {
      const stored = sanitizePermissions(["policy.motor.view", "invoice.edit", "ledger.system_record.edit"]);
      expect(stored).toContain("policy.motor.view");
      expect(stored).toContain("invoice.edit");
      // ledger.system_record has no EDIT capability — a stray ".edit" value must never be accepted.
      expect(stored).not.toContain("ledger.system_record.edit");
    });
  });

  // --- ledger.system_record has no EDIT capability at all -----------------
  it("ledger.system_record can never resolve to EDIT even if a '.edit' value is somehow stored", () => {
    const u = user(["ledger.system_record.edit"]);
    expect(canEdit(u, "ledger.system_record")).toBe(false);
    expect(isStoredPermissionValue("ledger.system_record.edit")).toBe(false);
  });

  // --- dashboard/settings are unaffected boolean keys ----------------------
  it("dashboard has no VIEW/EDIT split — plain membership grants access, canEdit is always false for it", () => {
    const u = user(["dashboard"]);
    expect(hasPermission(u, "dashboard")).toBe(true);
    expect(canEdit(u, "dashboard")).toBe(false);
  });

  // --- Inactive users are never authorized regardless of permissions ------
  it("a DISABLED user has neither VIEW nor EDIT even with every permission stored", () => {
    const u = user(["policy.motor.edit"], { status: "DISABLED" });
    expect(hasPermission(u, "policy.motor")).toBe(false);
    expect(canEdit(u, "policy.motor")).toBe(false);
  });

  // --- levelToStoredKeys / levelForStoredPermissions round-trip (User form) ---
  describe("Add/Edit User form level <-> stored-keys round trip", () => {
    it("NONE stores nothing", () => {
      expect(levelToStoredKeys("policy.motor", "NONE")).toEqual([]);
    });
    it("VIEW stores exactly the .view key", () => {
      expect(levelToStoredKeys("policy.motor", "VIEW")).toEqual(["policy.motor.view"]);
    });
    it("EDIT stores exactly the .edit key for an edit-capable resource", () => {
      expect(levelToStoredKeys("policy.motor", "EDIT")).toEqual(["policy.motor.edit"]);
    });
    it("EDIT on a non-edit-capable resource (ledger.system_record) falls back to .view — never invents a capability", () => {
      expect(levelToStoredKeys("ledger.system_record", "EDIT")).toEqual(["ledger.system_record.view"]);
    });
    it("levelForStoredPermissions reads back exactly what levelToStoredKeys wrote, for every level", () => {
      for (const level of ["NONE", "VIEW", "EDIT"] as const) {
        const stored = levelToStoredKeys("invoice", level);
        expect(levelForStoredPermissions(stored, "invoice")).toBe(level);
      }
    });
    it("selecting a new level for a resource that already has a legacy bare key must fully replace it (simulated form draft)", () => {
      // Mirrors user-form-modal.tsx's setResourceLevel: strip bare + .view + .edit, then re-add.
      const draft = ["policy.motor", "customer.view"];
      const withoutMotor = draft.filter((p) => p !== "policy.motor" && p !== "policy.motor.view" && p !== "policy.motor.edit");
      const next = [...withoutMotor, ...levelToStoredKeys("policy.motor", "VIEW")];
      expect(next).toEqual(["customer.view", "policy.motor.view"]);
      expect(levelForStoredPermissions(next, "policy.motor")).toBe("VIEW");
    });
  });

  // --- hasAnyPermission / hasMenuAccess recognize VIEW as "has access" ----
  it("hasAnyPermission treats VIEW-only as satisfying the check (used by Ledger/Task menu gating)", () => {
    const u = user(["ledger.manual_record.view"]);
    expect(hasAnyPermission(u, ["ledger.manual_record", "ledger.system_record"])).toBe(true);
    expect(hasMenuAccess(u, "ledger")).toBe(true);
  });

  it("isAdmin is unaffected by the VIEW/EDIT change and still requires the ADMIN role on an ACTIVE user", () => {
    expect(isAdmin(user([], { role: "Admin" }))).toBe(true);
    expect(isAdmin(user([], { role: "Admin", status: "DISABLED" }))).toBe(false);
    expect(isAdmin(user(["policy.motor.edit"], { role: "Staff" }))).toBe(false);
  });
});
