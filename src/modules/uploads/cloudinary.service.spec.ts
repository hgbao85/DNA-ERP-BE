import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { AppConfig } from '../../config/configuration';
import { CloudinaryService } from './cloudinary.service';

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: jest.fn(),
      destroy: jest.fn(),
    },
  },
}));

describe('CloudinaryService', () => {
  let service: CloudinaryService;
  let configService: { get: jest.Mock };
  const mockedCloudinary = cloudinary as unknown as {
    config: jest.Mock;
    uploader: { upload_stream: jest.Mock; destroy: jest.Mock };
  };

  const configuredValues: Record<string, string> = {
    'cloudinary.cloudName': 'demo-cloud',
    'cloudinary.apiKey': 'key',
    'cloudinary.apiSecret': 'secret',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    configService = { get: jest.fn((key: string) => configuredValues[key]) };
    service = new CloudinaryService(configService as unknown as ConfigService<AppConfig, true>);
  });

  describe('constructor', () => {
    it('configures the cloudinary SDK from ConfigService at construction time', () => {
      expect(mockedCloudinary.config).toHaveBeenCalledWith({
        cloud_name: 'demo-cloud',
        api_key: 'key',
        api_secret: 'secret',
      });
    });
  });

  describe('uploadBuffer', () => {
    it('throws 500 immediately when Cloudinary credentials are not configured, without touching the SDK', () => {
      configService.get.mockImplementation((key: string) =>
        key === 'cloudinary.cloudName' ? undefined : configuredValues[key],
      );

      // uploadBuffer() isn't `async` - the guard clause throws synchronously (before any
      // Promise exists), not as a rejection, so this must be a plain sync-throw assertion.
      expect(() => service.uploadBuffer(Buffer.from('x'), 'dna-erp')).toThrow(
        InternalServerErrorException,
      );
      expect(mockedCloudinary.uploader.upload_stream).not.toHaveBeenCalled();
    });

    it('resolves with the secure_url on a successful upload', async () => {
      mockedCloudinary.uploader.upload_stream.mockImplementation(
        (_opts: unknown, callback: (error: unknown, result: unknown) => void) => {
          callback(null, {
            secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/dna-erp/abc.jpg',
          });
          return { end: jest.fn() };
        },
      );

      const url = await service.uploadBuffer(Buffer.from('x'), 'dna-erp');

      expect(url).toBe('https://res.cloudinary.com/demo/image/upload/v1/dna-erp/abc.jpg');
      expect(mockedCloudinary.uploader.upload_stream).toHaveBeenCalledWith(
        { folder: 'dna-erp', resource_type: 'image' },
        expect.any(Function),
      );
    });

    // PDF/Excel (POST /uploads/document, 2026-08-27) PHẢI đi resource_type='raw' - mặc định của
    // Cloudinary là 'image' và pipeline ảnh sẽ từ chối/làm hỏng file không phải ảnh.
    it('passes resource_type=raw through to the SDK for non-image documents', async () => {
      mockedCloudinary.uploader.upload_stream.mockImplementation(
        (_opts: unknown, callback: (error: unknown, result: unknown) => void) => {
          callback(null, {
            secure_url: 'https://res.cloudinary.com/demo/raw/upload/v1/dna-erp/approvals/ky.pdf',
          });
          return { end: jest.fn() };
        },
      );

      const url = await service.uploadBuffer(Buffer.from('x'), 'dna-erp/approvals', 'raw');

      expect(url).toBe('https://res.cloudinary.com/demo/raw/upload/v1/dna-erp/approvals/ky.pdf');
      expect(mockedCloudinary.uploader.upload_stream).toHaveBeenCalledWith(
        { folder: 'dna-erp/approvals', resource_type: 'raw' },
        expect.any(Function),
      );
    });

    it('rejects with 500 when the SDK reports an upload error', async () => {
      mockedCloudinary.uploader.upload_stream.mockImplementation(
        (_opts: unknown, callback: (error: unknown, result: unknown) => void) => {
          callback(new Error('network down'), null);
          return { end: jest.fn() };
        },
      );

      await expect(service.uploadBuffer(Buffer.from('x'), 'dna-erp')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('deleteByUrl - best-effort, never throws', () => {
    it('extracts the public_id from a real Cloudinary URL and destroys it', async () => {
      mockedCloudinary.uploader.destroy.mockResolvedValue({ result: 'ok' });

      await service.deleteByUrl(
        'https://res.cloudinary.com/demo/image/upload/v1690000000/dna-erp/abc123.jpg',
      );

      expect(mockedCloudinary.uploader.destroy).toHaveBeenCalledWith('dna-erp/abc123');
    });

    it('no-ops when the URL does not match the Cloudinary upload shape', async () => {
      await service.deleteByUrl('https://example.com/not-cloudinary.jpg');

      expect(mockedCloudinary.uploader.destroy).not.toHaveBeenCalled();
    });

    it('swallows a destroy() failure instead of throwing - callers must never be blocked by cleanup', async () => {
      mockedCloudinary.uploader.destroy.mockRejectedValue(new Error('Cloudinary is down'));

      await expect(
        service.deleteByUrl('https://res.cloudinary.com/demo/image/upload/dna-erp/abc123.jpg'),
      ).resolves.toBeUndefined();
    });
  });
});
