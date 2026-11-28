import { BadRequestException } from '@nestjs/common';
import type { ClsService } from 'nestjs-cls';
import { MfgStage } from '../../generated/prisma/client';
import type { AppClsStore } from '../../common/interfaces/cls-store.interface';
import type { PrismaServiceType } from '../../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { ProductionInvoicesService } from '../production-invoices/production-invoices.service';
import type { ViTriKhoService } from '../vi-tri-kho/vi-tri-kho.service';
import { assertManualCkDgAllowed } from './ck-dg-qr.config';
import { CkDgQrService } from './ck-dg-qr.service';

/** Đợt 2 lượt 3 (28/11/2026): câu 10 KCS chuyền kiểm tự thêm nguyên nhân lỗi; câu 12 bật QR thì khoá nhập tay. */
describe('Chuyền kiểm QR - lượt 3', () => {
  const prev = process.env.CK_DG_QR_ENABLED;
  afterEach(() => {
    if (prev === undefined) delete process.env.CK_DG_QR_ENABLED;
    else process.env.CK_DG_QR_ENABLED = prev;
  });

  const build = () => {
    const defectReason = {
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([{ id: 1n, label: 'Đan lỏng' }]),
    };
    const service = new CkDgQrService(
      { defectReason } as unknown as PrismaServiceType,
      {} as unknown as ProductionInvoicesService,
      {} as unknown as NotificationsService,
      { isActive: () => false } as unknown as ClsService<AppClsStore>,
      {} as unknown as ViTriKhoService,
    );
    return { service, defectReason };
  };

  describe('câu 10: addDefectReason', () => {
    it('tắt công tắc -> 400, không ghi', async () => {
      delete process.env.CK_DG_QR_ENABLED;
      const { service, defectReason } = build();
      await expect(service.addDefectReason('Đan lỏng')).rejects.toBeInstanceOf(BadRequestException);
      expect(defectReason.create).not.toHaveBeenCalled();
    });

    it('tên mới: gọn khoảng trắng, ghi vào danh mục chuyền kiểm', async () => {
      process.env.CK_DG_QR_ENABLED = 'true';
      const { service, defectReason } = build();
      defectReason.findFirst.mockResolvedValue(null);
      defectReason.create.mockResolvedValue({ id: 5n, label: 'Khung cong' });
      const out = await service.addDefectReason('  Khung   cong ');
      expect(defectReason.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { label: 'Khung cong', stageType: MfgStage.CHUYEN_KIEM } }),
      );
      expect(out.created).toBe(true);
      expect(out.reason).toEqual({ id: '5', label: 'Khung cong' });
      expect(out.defectReasons).toEqual([{ id: '1', label: 'Đan lỏng' }]);
    });

    it('trùng tên (khác hoa thường) -> dùng lại, không tạo', async () => {
      process.env.CK_DG_QR_ENABLED = 'true';
      const { service, defectReason } = build();
      defectReason.findFirst.mockResolvedValue({ id: 1n, label: 'Đan lỏng' });
      const out = await service.addDefectReason('đan LỎNG');
      expect(defectReason.create).not.toHaveBeenCalled();
      expect(out.created).toBe(false);
      expect(out.reason.id).toBe('1');
    });

    it('chỉ khoảng trắng -> 400', async () => {
      process.env.CK_DG_QR_ENABLED = 'true';
      const { service } = build();
      await expect(service.addDefectReason('   a ')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('câu 12: assertManualCkDgAllowed', () => {
    it('tắt QR -> cho nhập tay', () => {
      delete process.env.CK_DG_QR_ENABLED;
      expect(() => assertManualCkDgAllowed('chuyền kiểm')).not.toThrow();
    });
    it('bật QR -> chặn nhập tay chuyền kiểm và đóng gói', () => {
      process.env.CK_DG_QR_ENABLED = 'true';
      expect(() => assertManualCkDgAllowed('chuyền kiểm')).toThrow(/không nhập tay chuyền kiểm/);
      expect(() => assertManualCkDgAllowed('đóng gói')).toThrow(/không nhập tay đóng gói/);
    });
  });
});
