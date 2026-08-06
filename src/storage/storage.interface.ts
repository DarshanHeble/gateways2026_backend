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
}
