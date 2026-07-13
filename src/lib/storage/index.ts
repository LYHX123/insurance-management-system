import { LocalStorageProvider } from "./local-storage-provider";
import type { StorageProvider } from "./types";

// Single swap point for future Dropbox support: introduce a
// DropboxStorageProvider implementing the same interface and select it here
// based on an env var, without touching any customer business logic.
export const storageService: StorageProvider = new LocalStorageProvider();

export type { StorageProvider, UploadFileInput, StoredFile } from "./types";
