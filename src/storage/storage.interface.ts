/**
 * Storage contract — implemented by cloudinary.storage.ts.
 * Kept adapter-shaped (not Cloudinary-specific) so a future swap to another
 * provider only requires a new file implementing this interface.
 */

export interface UploadResult {
  url: string;
  publicId: string;
  bytes: number;
}

export interface StorageAdapter {
  uploadFile(params: { data: string; folder: string; publicId: string }): Promise<UploadResult>;
  deleteFile(publicId: string): Promise<void>;
  createSignedDownloadUrl(publicId: string): string;
}

/**
 * Older buffer-based contract, used only by `POST /upload` (upload.routes.ts).
 *
 * Kept alongside StorageAdapter rather than merged into it because the two have
 * genuinely different semantics: this one streams a Buffer with resource_type
 * 'auto' and identifies files by URL, while StorageAdapter uploads a base64
 * payload as 'raw' and identifies them by publicId. Collapsing them would change
 * how existing uploads are stored and addressed.
 */
export interface StorageService {
  uploadFile(fileBuffer: Buffer, fileName: string, mimeType: string): Promise<string>;
  deleteFile(fileUrl: string): Promise<void>;
}
