// Server-only. One DropboxMigrationJob row represents one migration attempt
// end-to-end (diagnostic -> write-test -> preview -> copy -> verify ->
// activate). Reused across steps of the same attempt; a fresh COMPLETED (or
// abandoned) job means the next diagnostic starts a new row rather than
// mutating history away.
import { prisma } from "@/lib/prisma";
import { getDropboxIntegrationRow } from "../service";
import { DEFAULT_DESTINATION_ROOT_FOLDER } from "../constants";
import type { DropboxMigrationJobModel } from "@/generated/prisma/models";

const OPEN_STATUSES = [
  "NOT_STARTED",
  "DIAGNOSTIC_COMPLETE",
  "WRITE_TEST_REQUIRED",
  "WRITE_TEST_PASSED",
  "PREVIEW_READY",
  "READY_FOR_COPY",
  "COPYING",
  "COPY_PAUSED",
  "COPY_FAILED",
  "COPY_COMPLETE",
  "VERIFYING",
  "VERIFICATION_FAILED",
  "VERIFIED",
  "READY_TO_ACTIVATE",
  "ACTIVATING",
] as const;

export async function getOrCreateActiveMigrationJob(initiatedById?: string | null): Promise<DropboxMigrationJobModel> {
  const existing = await prisma.dropboxMigrationJob.findFirst({
    where: { status: { in: [...OPEN_STATUSES] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;

  const integrationRow = await getDropboxIntegrationRow();

  return prisma.dropboxMigrationJob.create({
    data: {
      sourceRootPath: integrationRow.rootFolder,
      destinationRootPath: DEFAULT_DESTINATION_ROOT_FOLDER,
      initiatedById: initiatedById ?? null,
    },
  });
}

export async function getLatestMigrationJob(): Promise<DropboxMigrationJobModel | null> {
  return prisma.dropboxMigrationJob.findFirst({ orderBy: { createdAt: "desc" } });
}

export async function getMigrationJobById(id: string): Promise<DropboxMigrationJobModel | null> {
  return prisma.dropboxMigrationJob.findUnique({ where: { id } });
}
