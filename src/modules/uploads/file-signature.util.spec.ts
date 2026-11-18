import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { CloudinaryService } from './cloudinary.service';
import { contentMatchesDeclaredType, sniffFileType } from './file-signature.util';
import { UploadsController } from './uploads.controller';

const bytes = (...b: number[]) => Buffer.from(b);
const text = (s: string) => Buffer.from(s, 'ascii');

/** B5 (danh sách lỗi 16/11): kiểm loại file theo nội dung, không tin mimetype client khai. */
describe('sniffFileType / contentMatchesDeclaredType', () => {
  const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
  const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0);
  const WEBP = Buffer.concat([text('RIFF'), bytes(1, 2, 3, 4), text('WEBPVP8 ')]);
  const PDF = text('%PDF-1.7\n');
  const XLSX = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0);
  const XLS = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0);
  const HTML = text('<html><script>alert(1)</script>');

  it('nhận đúng các loại được phép', () => {
    expect(sniffFileType(JPEG)).toBe('image/jpeg');
    expect(sniffFileType(PNG)).toBe('image/png');
    expect(sniffFileType(text('GIF89a...'))).toBe('image/gif');
    expect(sniffFileType(WEBP)).toBe('image/webp');
    expect(sniffFileType(PDF)).toBe('application/pdf');
    expect(sniffFileType(XLSX)).toBe('zip');
    expect(sniffFileType(XLS)).toBe('ole');
    expect(sniffFileType(HTML)).toBeNull();
    expect(sniffFileType(Buffer.alloc(0))).toBeNull();
  });

  it('khai đúng loại thì qua; khai "image/png" mà nội dung là HTML / JPEG thì không', () => {
    expect(contentMatchesDeclaredType(PNG, 'image/png')).toBe(true);
    expect(contentMatchesDeclaredType(HTML, 'image/png')).toBe(false);
    expect(contentMatchesDeclaredType(JPEG, 'image/png')).toBe(false);
    expect(
      contentMatchesDeclaredType(
        XLSX,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe(true);
    expect(contentMatchesDeclaredType(XLS, 'application/vnd.ms-excel')).toBe(true);
    expect(contentMatchesDeclaredType(PDF, 'application/pdf')).toBe(true);
    expect(contentMatchesDeclaredType(PDF, 'text/html')).toBe(false);
  });
});

describe('UploadsController (B5 17/11)', () => {
  const cloudinary = {
    uploadBuffer: jest.fn().mockResolvedValue('https://res.cloudinary.com/x.png'),
  };
  const controller = new UploadsController(cloudinary as unknown as CloudinaryService);
  const file = (buffer: Buffer, mimetype: string) => ({ buffer, mimetype }) as Express.Multer.File;
  const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0);
  const user = (roles: string[]) => ({
    id: 'u',
    roles,
    permissions: [],
    username: 'u',
    email: null,
    mfgRole: null,
    warehouseScope: null,
  });

  beforeEach(() => cloudinary.uploadBuffer.mockClear());

  it('ảnh thật của vai trò nghiệp vụ (vd KCS): tải lên bình thường', async () => {
    await expect(
      controller.uploadImage(file(PNG, 'image/png'), user(['KCS_STAFF'])),
    ).resolves.toEqual({ imageUrl: 'https://res.cloudinary.com/x.png' });
  });

  it('khai ảnh mà nội dung không phải ảnh -> 400, không đẩy lên kho lưu trữ', async () => {
    await expect(
      controller.uploadImage(file(text('<svg onload=alert(1)>'), 'image/png'), user(['KCS_STAFF'])),
    ).rejects.toThrow(BadRequestException);
    await expect(
      controller.uploadDocument(file(text('MZ...exe'), 'application/pdf'), user(['PURCHASER'])),
    ).rejects.toThrow(BadRequestException);
    expect(cloudinary.uploadBuffer).not.toHaveBeenCalled();
  });

  it('tài khoản chỉ là công nhân xưởng -> 403; công nhân kiêm vai trò khác vẫn tải được', async () => {
    await expect(
      controller.uploadImage(file(PNG, 'image/png'), user(['FLOOR_WORKER'])),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      controller.uploadImage(file(PNG, 'image/png'), user(['FLOOR_WORKER', 'KCS_STAFF'])),
    ).resolves.toBeDefined();
  });
});
