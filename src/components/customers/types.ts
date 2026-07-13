export type CustomerDetail = {
  id: string;
  customerNumber: string;
  companyName: string;
  pinNumber: string;
  registeredAddress: string | null;
  mainContactPerson: string | null;
  mainPhoneNumber: string | null;
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
};
