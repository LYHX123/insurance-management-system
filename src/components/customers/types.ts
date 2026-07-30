export type CustomerDetail = {
  id: string;
  customerNumber: string;
  companyName: string;
  pinNumber: string;
  registeredAddress: string | null;
  mainContactPerson: string | null;
  mainPhoneNumber: string | null;
  shortName: string | null;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  updatedAt: string;
};

export type CustomerListRow = CustomerDetail & {
  projectCount: number;
  documentCount: number;
  projects: { id: string; projectName: string }[];
};

export type ProjectRow = {
  id: string;
  customerId: string;
  projectName: string;
  contactPerson: string;
  phoneNumber: string;
  description: string | null;
  status: "ACTIVE" | "COMPLETED" | "SUSPENDED";
  createdAt: string;
  updatedAt: string;
};

export type DocumentType =
  | "REGISTRATION_CERTIFICATE"
  | "PIN_CERTIFICATE"
  | "CR12"
  | "OTHER";

// Safe view model only — never dropboxFileId, dropboxPathLower, or any
// local storage path (Phase 3 Part 7/15: no raw Dropbox IDs, no raw storage
// paths exposed to the client). Dropbox Integration Phase 5 adds the human
// display path itself (dropboxPath below) as an explicit, deliberate
// exception — a safe display path is exactly what Part 2 asks every
// detail page to show; only the ID/token/local-path restrictions remain.
export type DropboxDocumentSyncView = {
  syncStatus: "PENDING" | "SYNCING" | "SYNCED" | "ERROR" | "CONFLICT" | "DISABLED";
  standardizedFileName: string;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
} | null;

// Dropbox Integration Phase 5 — mirrors pathDisplay.ts's DropboxPathView
// shape, duplicated here (rather than importing the server module) so this
// client-safe types file has no dependency on server-only Dropbox code.
export type DropboxPathState = "synced" | "planned" | "pending" | "syncing" | "error" | "conflict" | "not_connected" | "unavailable";

export type DropboxPathViewPlain = {
  state: DropboxPathState;
  path: string | null;
  isPlanned: boolean;
  errorMessage: string | null;
};

export type DocumentRow = {
  id: string;
  customerId: string;
  projectId: string | null;
  projectName: string | null;
  documentType: DocumentType;
  customDocumentName: string | null;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  uploadedByName: string;
  createdAt: string;
  dropboxSync: DropboxDocumentSyncView;
  dropboxPath: DropboxPathViewPlain;
};
