export interface StorageService {
  uploadFile(fileBuffer: Buffer, fileName: string, mimeType: string): Promise<string>;
  deleteFile(fileUrl: string): Promise<void>;
}
