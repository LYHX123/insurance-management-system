"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import {
  testDropboxConnection,
  disconnectDropbox,
  saveDropboxRootFolder,
} from "@/lib/integrations/dropbox/service";
import type { DropboxActionResult } from "@/lib/integrations/dropbox/types";

// Mirrors the Policy-category-actions convention: one dedicated file per
// subsystem rather than folding into the already-large settings/actions.ts.
// Every action re-checks requireAdmin() itself — Connect/Reconnect are
// plain browser navigations to /api/integrations/dropbox/connect (real
// redirects to Dropbox), not server actions.

export async function testDropboxConnectionAction(): Promise<DropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const result = await testDropboxConnection();
  revalidatePath("/settings");
  if (!result.success) return { success: false, error: result.code };
  return { success: true };
}

export async function disconnectDropboxAction(): Promise<DropboxActionResult<{ warning?: string }>> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const result = await disconnectDropbox();
  revalidatePath("/settings");
  return { success: true, warning: result.warning };
}

export async function saveDropboxRootFolderAction(newRootFolder: string): Promise<DropboxActionResult<{ path: string }>> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const result = await saveDropboxRootFolder(newRootFolder);
  revalidatePath("/settings");
  if (!result.success) return { success: false, error: result.code };
  return { success: true, path: result.path };
}
