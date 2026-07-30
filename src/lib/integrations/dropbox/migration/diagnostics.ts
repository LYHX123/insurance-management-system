// Server-only, read-only. Resolves and caches the destination Team Folder's
// own namespace id (see namespaceClient.ts's resolveTeamFolderNamespace doc
// comment for why this can't be hardcoded or assumed from the Dropbox UI
// label). Makes no writes to Dropbox.
import { prisma } from "@/lib/prisma";
import { getDropboxEnv, DEFAULT_DESTINATION_ROOT_FOLDER } from "../constants";
import { resolveTeamFolderNamespace } from "./namespaceClient";
import { getMigrationSourceClient, storeResolvedDestinationNamespace, recordNamespaceConfigError, mapMigrationError } from "./config";
import { getOrCreateActiveMigrationJob } from "./job";
import type { MigrationActionResult } from "./types";

export type DiagnosticResult = {
  destinationDisplayName: string;
  destinationRootFolder: string;
  jobId: string;
};

export async function runNamespaceDiagnostic(initiatedById?: string | null): Promise<MigrationActionResult<DiagnosticResult>> {
  const envResult = getDropboxEnv();
  if (!envResult.ok) return { success: false, error: "CONFIGURATION_MISSING" };

  const job = await getOrCreateActiveMigrationJob(initiatedById);

  try {
    const { refreshToken } = await getMigrationSourceClient(envResult.config);
    const resolved = await resolveTeamFolderNamespace(envResult.config, refreshToken);

    await storeResolvedDestinationNamespace(envResult.config, resolved.namespaceId, resolved.displayName);

    await prisma.dropboxMigrationJob.update({
      where: { id: job.id },
      data: {
        status: "DIAGNOSTIC_COMPLETE",
        currentPhase: "diagnostic",
        destinationRootPath: DEFAULT_DESTINATION_ROOT_FOLDER,
        safeErrorCode: null,
        safeErrorMessage: null,
      },
    });

    return {
      success: true,
      destinationDisplayName: resolved.displayName,
      destinationRootFolder: DEFAULT_DESTINATION_ROOT_FOLDER,
      jobId: job.id,
    };
  } catch (err) {
    const mapped = mapMigrationError(err);
    await recordNamespaceConfigError(mapped.code, mapped.message);
    await prisma.dropboxMigrationJob.update({
      where: { id: job.id },
      data: { safeErrorCode: mapped.code, safeErrorMessage: mapped.message },
    });
    return { success: false, error: mapped.code };
  }
}
