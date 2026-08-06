/**
 * Cloudinary storage adapter — implements StorageAdapter for payment receipt PDFs.
 *
 * Receipts are uploaded as resource_type 'raw' (no image transformation applied —
 * PDFs are stored and served as-is). Config is read lazily on first use so the
 * app can boot even if Cloudinary env vars aren't set; only storage calls fail.
 */

import { v2 as cloudinary } from 'cloudinary';
import { loadConfig } from '../config/env.js';
import { createDataError } from '../errors/DataError.js';
import type { StorageAdapter, UploadResult } from './storage.interface.js';

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  const config = loadConfig();
  if (!config.CLOUDINARY_CLOUD_NAME || !config.CLOUDINARY_API_KEY || !config.CLOUDINARY_API_SECRET) {
    throw createDataError('STORAGE_UNAVAILABLE', 'Cloudinary credentials are not configured.');
  }
  cloudinary.config({
    cloud_name: config.CLOUDINARY_CLOUD_NAME,
    api_key: config.CLOUDINARY_API_KEY,
    api_secret: config.CLOUDINARY_API_SECRET,
  });
  configured = true;
}

export const cloudinaryStorage: StorageAdapter = {
  async uploadFile({ data, folder, publicId }): Promise<UploadResult> {
    ensureConfigured();
    try {
      const result = await cloudinary.uploader.upload(data, {
        resource_type: 'raw',
        folder,
        public_id: publicId,
        overwrite: false,
      });
      return { url: result.secure_url, publicId: result.public_id, bytes: result.bytes };
    } catch {
      throw createDataError('STORAGE_UNAVAILABLE', 'Failed to upload receipt to storage.');
    }
  },

  async deleteFile(publicId: string): Promise<void> {
    ensureConfigured();
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
    } catch {
      throw createDataError('STORAGE_UNAVAILABLE', 'Failed to delete receipt from storage.');
    }
  },
};
