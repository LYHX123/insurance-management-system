import type { DropboxConnectionStatus } from "@/generated/prisma/enums";
import type { DropboxErrorCode } from "./errors";

export type { DropboxConnectionStatus };

// The only shape ever sent to a client component — deliberately excludes
// encryptedRefreshToken and never carries a decrypted token. Constructed in
// src/lib/integrations/dropbox/service.ts's toIntegrationView().
export type DropboxIntegrationView = {
  status: DropboxConnectionStatus;
  dropboxAccountId: string | null;
  accountEmail: string | null;
  accountDisplayName: string | null;
  rootFolder: string;
  rootFolderVerifiedAt: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  lastTestedAt: string | null;
  lastSuccessfulAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  connectedByName: string | null;
  configurationMissing: boolean;
};

export type DropboxActionResult<T = object> =
  | ({ success: true } & T)
  | { success: false; error: DropboxErrorCode };
