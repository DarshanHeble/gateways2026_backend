import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/env.js', () => ({
  loadConfig: vi.fn(() => ({
    CLOUDINARY_CLOUD_NAME: undefined,
    CLOUDINARY_API_KEY: undefined,
    CLOUDINARY_API_SECRET: undefined,
  })),
}));

describe('cloudinaryStorage', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws STORAGE_UNAVAILABLE when Cloudinary credentials are missing', async () => {
    const { cloudinaryStorage } = await import('./cloudinary.storage.js');
    await expect(
      cloudinaryStorage.uploadFile({ data: 'data:application/pdf;base64,AAAA', folder: 'x', publicId: 'y' }),
    ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });
});
