// Server-only. Stage B: the temporary Team Folder write-access test.
//
// IMPORTANT — this function makes REAL Dropbox write calls (create, then
// delete, exactly one temporary folder). Per the migration spec it must
// never run automatically: it is wired only to an explicit admin action in
// Settings, gated behind its own confirmation, and must not be invoked by
// any code path other than that action.
import { prisma } from "@/lib/prisma";
import { getDropboxEnv } from "../constants";
import { DropboxIntegrationError } from "../errors";
import { getMigrationDestinationClient, mapMigrationError } from "./config";
import { getOrCreateActiveMigrationJob } from "./job";
import { isNotFoundError } from "./notFound";
import type { MigrationActionResult } from "./types";

function buildTempFolderName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `IMS-Migration-Write-Test-${stamp}`;
}

export type WriteTestResult = {
  tempFolderName: string;
  created: boolean;
  verified: boolean;
  cleanedUp: boolean;
};

export async function runDestinationWriteAccessTest(initiatedById?: string | null): Promise<MigrationActionResult<WriteTestResult>> {
  const envResult = getDropboxEnv();
  if (!envResult.ok) return { success: false, error: "CONFIGURATION_MISSING" };

  const job = await getOrCreateActiveMigrationJob(initiatedById);
  const tempFolderName = buildTempFolderName();
  const path = `/${tempFolderName}`;

  let client;
  try {
    client = await getMigrationDestinationClient(envResult.config);
  } catch (err) {
    const mapped = mapMigrationError(err);
    return { success: false, error: mapped.code };
  }

  // 1. Create — autorename:false so a name collision (should never happen
  // given the timestamp) fails loudly instead of silently writing elsewhere.
  let createdId: string | null;
  try {
    const created = await client.filesCreateFolderV2({ path, autorename: false });
    createdId = created.result.metadata.id ?? null;
  } catch (err) {
    const mapped = mapMigrationError(err);
    await prisma.dropboxMigrationJob.update({
      where: { id: job.id },
      data: { safeErrorCode: mapped.code, safeErrorMessage: mapped.message },
    });
    return { success: false, error: "WRITE_TEST_FAILED" };
  }

  // 2. Verify by ID and path — never proceed to delete without an exact
  // match, per the spec's explicit "refuse to delete if the returned
  // ID/path does not match the just-created object" requirement.
  try {
    const meta = await client.filesGetMetadata({ path });
    const matches = meta.result[".tag"] === "folder" && meta.result.id === createdId;
    if (!matches) {
      // Deliberately does NOT attempt cleanup here — we are not certain
      // this is the object we just created, so leaving it for manual admin
      // review is safer than an automated delete.
      await prisma.dropboxMigrationJob.update({
        where: { id: job.id },
        data: { safeErrorCode: "WRITE_TEST_FAILED", safeErrorMessage: "Verification did not match the created object." },
      });
      return { success: false, error: "WRITE_TEST_FAILED" };
    }
  } catch (err) {
    const mapped = mapMigrationError(err);
    await prisma.dropboxMigrationJob.update({
      where: { id: job.id },
      data: { safeErrorCode: mapped.code, safeErrorMessage: mapped.message },
    });
    return { success: false, error: "WRITE_TEST_FAILED" };
  }

  // 3. Delete — only this exact path, never a broad/recursive delete call.
  try {
    const deleted = await client.filesDeleteV2({ path });
    const deletedTag = deleted.result.metadata?.[".tag"];
    const deletedId = deletedTag === "folder" || deletedTag === "file" ? (deleted.result.metadata as { id?: string }).id : undefined;
    if (deletedId && deletedId !== createdId) {
      throw new DropboxIntegrationError("WRITE_TEST_CLEANUP_FAILED", "Deleted object id did not match the created object.");
    }
  } catch (err) {
    const mapped = mapMigrationError(err);
    await prisma.dropboxMigrationJob.update({
      where: { id: job.id },
      data: { safeErrorCode: "WRITE_TEST_CLEANUP_FAILED", safeErrorMessage: mapped.message },
    });
    // Surface the temp folder name so an admin can manually verify/clean up
    // — this is not a secret, just a path we created moments ago.
    return { success: false, error: "WRITE_TEST_CLEANUP_FAILED" };
  }

  // 4. Confirm it's actually gone.
  let cleanedUp = false;
  try {
    await client.filesGetMetadata({ path });
  } catch (err) {
    cleanedUp = isNotFoundError(err);
  }

  await prisma.dropboxMigrationJob.update({
    where: { id: job.id },
    data: {
      status: cleanedUp ? "WRITE_TEST_PASSED" : "WRITE_TEST_REQUIRED",
      currentPhase: "write-test",
      safeErrorCode: cleanedUp ? null : "WRITE_TEST_CLEANUP_FAILED",
      safeErrorMessage: cleanedUp ? null : "Temporary test folder deletion could not be confirmed.",
    },
  });

  return { success: true, tempFolderName, created: true, verified: true, cleanedUp };
}
