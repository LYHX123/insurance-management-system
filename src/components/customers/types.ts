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

// Safe view model only — never dropboxFileId, dropboxDisplayPath,
// dropboxPathLower, or any local storage path (Phase 3 Part 7/15: no raw
// Dropbox IDs, no raw storage paths exposed to the client).
export type DropboxDocumentSyncView = {
  syncStatus: "PENDING" | "SYNCING" | "SYNCED" | "ERROR" | "CONFLICT" | "DISABLED";
  standardizedFileName: string;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
} | null;

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
};
