"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import {
  syncCustomerFolder,
  verifyCustomerFolder,
  rebuildCustomerSubfolders,
} from "@/lib/integrations/dropbox/customer-folders";
import type { FolderOpResult } from "@/lib/integrations/dropbox/customer-folders";

// Admin-only, per Phase 2 spec Part 19: bulk backfill / retry / rebuild /
// conflict resolution are all ADMIN-only regardless of UI visibility —
// each action re-checks requireAdmin() itself. Regular sync-STATUS
// visibility (read-only) is handled by the Customer detail server page
// including the CustomerDropboxFolder relation directly (gated by the
// existing "customer" view permission), not by an action here.

export type CustomerDropboxActionResult = FolderOpResult & { forbidden?: boolean };

export async function syncCustomerFolderAction(customerId: string): Promise<CustomerDropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, status: "ERROR", forbidden: true };

  const result = await syncCustomerFolder(customerId);
  revalidatePath(`/customer/${customerId}`);
  return result;
}

export async function verifyCustomerFolderAction(customerId: string): Promise<CustomerDropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, status: "ERROR", forbidden: true };

  const result = await verifyCustomerFolder(customerId);
  revalidatePath(`/customer/${customerId}`);
  return result;
}

export async function rebuildCustomerSubfoldersAction(customerId: string): Promise<CustomerDropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, status: "ERROR", forbidden: true };

  const result = await rebuildCustomerSubfolders(customerId);
  revalidatePath(`/customer/${customerId}`);
  return result;
}
