import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import type { CloudinaryService } from './cloudinary.service';
import { UploadsController } from './uploads.controller';

/** CK_DG_QR (24/11/2026): công nhân chuyền kiểm / KCS chuyền kiểm (tài khoản PIN) chụp ảnh lỗi - chỉ khi bật công tắc. */
describe('UploadsController - ảnh lỗi chuyền kiểm (CK_DG_QR)', () => {
  const prev = process.env.CK_DG_QR_ENABLED;
  afterEach(() => {
    if (prev === undefined) delete process.env.CK_DG_QR_ENABLED;
    else process.env.CK_DG_QR_ENABLED = prev;
  });
  const controller = new UploadsController({} as CloudinaryService);
  const worker = (mfgRole: string): AuthenticatedUser => ({
    id: 'u',
    username: 'u',
    email: null,
    roles: ['FLOOR_WORKER'],
    permissions: [],
    mfgRole,
    warehouseScope: null,
  });

  it('tắt công tắc: công nhân chuyền kiểm vẫn bị chặn như mọi công nhân xưởng', async () => {
    delete process.env.CK_DG_QR_ENABLED;
    await expect(controller.uploadImage(undefined, worker('CHUYEN_KIEM'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('bật công tắc: chuyền kiểm / KCS chuyền kiểm qua bước chặn (thiếu file -> 400); tổ khác vẫn 403', async () => {
    process.env.CK_DG_QR_ENABLED = 'true';
    await expect(controller.uploadImage(undefined, worker('CHUYEN_KIEM'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      controller.uploadImage(undefined, worker('KCS_CHUYEN_KIEM')),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.uploadImage(undefined, worker('DONG_GOI'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(controller.uploadImage(undefined, worker('HAN'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
