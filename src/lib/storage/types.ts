export type UploadFileInput = {
  folderPath: string;
  fileName: string;
  buffer: Buffer;
  mimeType: string;
};

export type StoredFile = {
  buffer: Buffer;
  mimeType: string;
};

export interface StorageProvider {
  uploadFile(input: UploadFileInput): Promise<{ storageKey: string }>;
  downloadFile(storageKey: string): Promise<Buffer>;
  getFile(storageKey: string): Promise<StoredFile | null>;
  deleteFile(storageKey: string): Promise<void>;
  fileExists(storageKey: string): Promise<boolean>;
  createFolder(folderPath: string): Promise<void>;
}
