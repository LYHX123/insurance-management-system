// Server-only, read-only. "Verify Active Storage" — Phase 8 Part 9/10's
// retained post-migration action. Deliberately goes through the exact same
// getAuthenticatedDropboxClient() every normal Customer/Quotation/Policy/
// Invoice/Claim sync module already uses (not a migration-specific
// client), so this proves the ACTIVE application path resolves correctly
// — not just that the destination namespace is reachable in isolation.
import { getAuthenticatedDropboxClient } from "../service";
import { mapMigrationError } from "./config";
import type { MigrationActionResult } from "./types";
import { withRateLimitBackoff, INTERACTIVE_BACKOFF } from "../rateLimitRetry";

export type ActiveStorageVerification = {
  activeRootFolder: string;
  rootReachable: boolean;
  topLevelEntryCount: number;
};

export async function verifyActiveStorage(): Promise<MigrationActionResult<ActiveStorageVerification>> {
  const auth = await getAuthenticatedDropboxClient();
  if (!auth.ok) return { success: false, error: auth.code };

  try {
    // Single admin-triggered "Verify Active Storage" check — bounded
    // tightly so the click never hangs.
    const listing = await withRateLimitBackoff(() => auth.client.filesListFolder({ path: auth.row.rootFolder }), INTERACTIVE_BACKOFF);
    return {
      success: true,
      activeRootFolder: auth.row.rootFolder,
      rootReachable: true,
      topLevelEntryCount: listing.result.entries.length,
    };
  } catch (err) {
    const mapped = mapMigrationError(err);
    return { success: false, error: mapped.code };
  }
}
