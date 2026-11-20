import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { plainToInstance } from 'class-transformer';
import { IsOptional, validate } from 'class-validator';
import { AppConfig } from '../../config/configuration';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { CloudinaryService } from '../../modules/uploads/cloudinary.service';
import { flattenValidationErrors } from '../pipes/validation-exception.factory';
import {
  IsSystemUploadUrl,
  isSystemUploadUrl,
  parseSystemUploadUrl,
} from './system-upload-url.validator';

jest.mock('cloudinary', () => ({
  v2: { config: jest.fn(), uploader: { upload_stream: jest.fn(), destroy: jest.fn() } },
}));

const CLOUD = 'demo-cloud';
const OK_IMAGE = `https://res.cloudinary.com/${CLOUD}/image/upload/v1700000000/dna-erp/abc123.jpg`;
const OK_RAW = `https://res.cloudinary.com/${CLOUD}/raw/upload/v1/dna-erp/approvals/abc`;
const OK_RAW_EXT = `https://res.cloudinary.com/${CLOUD}/raw/upload/dna-erp/approvals/ky.pdf`;

describe('parseSystemUploadUrl / @IsSystemUploadUrl', () => {
  const old = process.env.CLOUDINARY_CLOUD_NAME;
  beforeEach(() => {
    process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
  });
  afterAll(() => {
    if (old === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = old;
  });

  it('nhận URL đúng mẫu (ảnh có đuôi, raw có hay không có đuôi, có hay không có v<số>)', () => {
    expect(parseSystemUploadUrl(OK_IMAGE)).toEqual({
      resourceType: 'image',
      publicId: 'dna-erp/abc123',
    });
    expect(parseSystemUploadUrl(OK_RAW)).toEqual({
      resourceType: 'raw',
      publicId: 'dna-erp/approvals/abc',
    });
    expect(parseSystemUploadUrl(OK_RAW_EXT)).toEqual({
      resourceType: 'raw',
      publicId: 'dna-erp/approvals/ky.pdf',
    });
    expect(
      parseSystemUploadUrl(`https://res.cloudinary.com/${CLOUD}/image/upload/dna-erp/a.png`),
    ).not.toBeNull();
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html;base64,AAAA'],
    ['http không s', `http://res.cloudinary.com/${CLOUD}/image/upload/v1/dna-erp/a.jpg`],
    ['host khác', `https://evil.example/${CLOUD}/image/upload/v1/dna-erp/a.jpg`],
    [
      'host con giả',
      `https://res.cloudinary.com.evil.example/${CLOUD}/image/upload/v1/dna-erp/a.jpg`,
    ],
    ['cloud khác', 'https://res.cloudinary.com/other/image/upload/v1/dna-erp/a.jpg'],
    ['thư mục khác', `https://res.cloudinary.com/${CLOUD}/image/upload/v1/other/a.jpg`],
    ['thư mục dna-erp-x', `https://res.cloudinary.com/${CLOUD}/image/upload/v1/dna-erp-x/a.jpg`],
    ['đường dẫn nội bộ', '/uploads/a.png'],
    ['kèm query', `${OK_IMAGE}?x=1`],
    ['kèm hash', `${OK_IMAGE}#x`],
    ['dấu ? rỗng ở cuối', `${OK_IMAGE}?`],
    ['dấu # rỗng ở cuối', `${OK_IMAGE}#`],
    ['user:pass', `https://u:p@res.cloudinary.com/${CLOUD}/image/upload/v1/dna-erp/a.jpg`],
    ['cổng', `https://res.cloudinary.com:444/${CLOUD}/image/upload/v1/dna-erp/a.jpg`],
    ['/../', `https://res.cloudinary.com/${CLOUD}/image/upload/v1/dna-erp/../x/a.jpg`],
    ['%2e%2e', `https://res.cloudinary.com/${CLOUD}/image/upload/v1/dna-erp/%2e%2e/a.jpg`],
    ['viết hoa scheme', OK_IMAGE.replace('https', 'HTTPS')],
    ['viết hoa host', OK_IMAGE.replace('res.cloudinary.com', 'RES.cloudinary.com')],
    ['loại tài nguyên video', `https://res.cloudinary.com/${CLOUD}/video/upload/v1/dna-erp/a.mp4`],
    ['ảnh không đuôi', `https://res.cloudinary.com/${CLOUD}/image/upload/v1/dna-erp/a`],
    ['thiếu tên tệp', `https://res.cloudinary.com/${CLOUD}/image/upload/v1/dna-erp`],
    ['đoạn rỗng', `https://res.cloudinary.com/${CLOUD}/image/upload/v1/dna-erp//a.jpg`],
    [
      'quá dài',
      `https://res.cloudinary.com/${CLOUD}/image/upload/v1/dna-erp/${'a'.repeat(2000)}.jpg`,
    ],
  ])('từ chối: %s', (_name, url) => {
    expect(isSystemUploadUrl(url)).toBe(false);
  });

  it('thiếu CLOUDINARY_CLOUD_NAME thì từ chối mọi URL', () => {
    delete process.env.CLOUDINARY_CLOUD_NAME;
    expect(isSystemUploadUrl(OK_IMAGE)).toBe(false);
    expect(parseSystemUploadUrl(OK_IMAGE, '')).toBeNull();
  });

  it('không phải chuỗi thì từ chối', () => {
    expect(parseSystemUploadUrl(123)).toBeNull();
    expect(parseSystemUploadUrl(null)).toBeNull();
  });

  describe('decorator', () => {
    class Dto {
      @IsOptional()
      @IsSystemUploadUrl()
      one?: string | null;

      @IsOptional()
      @IsSystemUploadUrl({ each: true })
      many?: string[];
    }
    const check = async (plain: object) =>
      flattenValidationErrors(await validate(plainToInstance(Dto, plain)));

    it('chuỗi rỗng / khoảng trắng, null, bỏ trống thì cho qua', async () => {
      expect(await check({ one: '' })).toEqual([]);
      expect(await check({ one: '   ' })).toEqual([]);
      expect(await check({ one: null })).toEqual([]);
      expect(await check({})).toEqual([]);
      expect(await check({ many: ['  '] })).toEqual([]);
    });

    it('URL đúng mẫu qua; sai thì 1 câu tiếng Việt', async () => {
      expect(await check({ one: OK_IMAGE, many: [OK_IMAGE, OK_RAW] })).toEqual([]);
      const errs = await check({ one: 'javascript:alert(1)' });
      expect(errs).toHaveLength(1);
      expect(errs[0]).toContain('phải là tệp đã tải lên hệ thống');
    });

    it('each: một giá trị sai thì lỗi cả lô', async () => {
      const errs = await check({ many: [OK_IMAGE, 'https://evil.example/a.jpg'] });
      expect(errs).toHaveLength(1);
      expect(errs[0]).toContain('phải là tệp đã tải lên hệ thống');
    });
  });

  describe('nhất quán với CloudinaryService.deleteByUrl', () => {
    it('mọi URL parse nhận thì deleteByUrl nhận ra đúng public_id', async () => {
      const destroy = (cloudinary as unknown as { uploader: { destroy: jest.Mock } }).uploader
        .destroy;
      const config = {
        get: jest.fn((k: string) => (k === 'cloudinary.cloudName' ? CLOUD : 'x')),
      };
      const prisma = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      };
      const svc = new CloudinaryService(
        config as unknown as ConfigService<AppConfig, true>,
        prisma as unknown as PrismaServiceType,
      );
      for (const [url, type] of [
        [OK_IMAGE, 'image'],
        [OK_RAW, 'raw'],
        [OK_RAW_EXT, 'raw'],
      ] as const) {
        destroy.mockClear();
        destroy.mockResolvedValue({ result: 'ok' });
        const parsed = parseSystemUploadUrl(url);
        expect(parsed?.resourceType).toBe(type);
        await svc.deleteByUrl(url, type);
        expect(destroy).toHaveBeenCalledWith(parsed?.publicId, { resource_type: type });
      }
    });
  });
});
