import { v2 as cloudinary } from 'cloudinary';
import { StorageService } from './storage.interface';

// Configure cloudinary with environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export class CloudinaryStorageService implements StorageService {
  async uploadFile(fileBuffer: Buffer, fileName: string, mimeType: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'gateways2026',
          public_id: fileName.split('.')[0],
          resource_type: 'auto',
        },
        (error, result) => {
          if (error) return reject(error);
          if (!result) return reject(new Error('Upload failed'));
          resolve(result.secure_url);
        }
      );
      
      uploadStream.end(fileBuffer);
    });
  }

  async deleteFile(fileUrl: string): Promise<void> {
    try {
      // Extract public ID from URL
      const urlParts = fileUrl.split('/');
      const filenameWithExtension = urlParts[urlParts.length - 1];
      const filename = filenameWithExtension.split('.')[0];
      const folder = urlParts[urlParts.length - 2];
      
      let publicId = filename;
      if (folder !== 'upload') {
          // If there's a folder, include it in the publicId
          publicId = `${folder}/${filename}`;
      }

      await cloudinary.uploader.destroy(publicId);
    } catch (error) {
      console.error('Failed to delete file from Cloudinary:', error);
      throw error;
    }
  }
}

export const storageService = new CloudinaryStorageService();
