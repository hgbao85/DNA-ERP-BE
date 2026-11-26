import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { ClsService } from 'nestjs-cls';
import { MfgStage, WorkstationKind } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import type { AppClsStore } from '../../common/interfaces/cls-store.interface';
import type { PrismaServiceType } from '../../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { ProductionInvoicesService } from '../production-invoices/production-invoices.service';
import { CkDgQrService } from './ck-dg-qr.service';
import type { ViTriKhoService } from '../vi-tri-kho/vi-tri-kho.service';

const user = (mfgRole: string): AuthenticatedUser => ({
  id: 'u1',
  username: 'ck',
  email: null,
  roles: ['FLOOR_WORKER'],
  permissions: [],
  mfgRole,
  warehouseScope: null,
});

const ws = (kind: WorkstationKind, stage: MfgStage) => ({
  id: 9n,
  code: 'CK-01',
  name: 'CK-01',
  stage,
  kind,
  isActive: true,
  qrToken: 'tok',
  warehouse: { id: 3n, code: 'thanh-pham', name: 'Kho thành phẩm' },
});

function build(overrides: Record<string, unknown> = {}) {
  const prisma = {
    workstation: { findUnique: jest.fn() },
    transferCheckBatch: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    packingReport: { findUnique: jest.fn(), findMany: jest.fn() },
    defectReason: { findUnique: jest.fn() },
    $transaction: jest.fn(),
    ...overrides,
  };
  const pis = { recordPackagingEntry: jest.fn() };
  const notifications = { emit: jest.fn(), resolve: jest.fn() };
  const service = new CkDgQrService(
    prisma as unknown as PrismaServiceType,
    pis as unknown as ProductionInvoicesService,
    notifications as unknown as NotificationsService,
    { isActive: () => false } as unknown as ClsService<AppClsStore>,
    {} as unknown as ViTriKhoService,
  );
  return { service, prisma, pis, notifications };
}

describe('CkDgQrService', () => {
  const prev = process.env.CK_DG_QR_ENABLED;
  afterAll(() => {
    if (prev === undefined) delete process.env.CK_DG_QR_ENABLED;
    else process.env.CK_DG_QR_ENABLED = prev;
  });

  describe('công tắc tắt (mặc định)', () => {
    beforeEach(() => {
      delete process.env.CK_DG_QR_ENABLED;
    });

    it('màn quét / danh sách trả enabled false, không đọc DB', async () => {
      const { service, prisma } = build();
      await expect(service.scanContext('tok', user('CHUYEN_KIEM'))).resolves.toEqual({
        enabled: false,
      });
      await expect(service.listBatches({})).resolves.toEqual({ enabled: false, batches: [] });
      await expect(service.listPackingReports({})).resolves.toEqual({
        enabled: false,
        reports: [],
      });
      await expect(service.countAwaitingKcs()).resolves.toBe(0);
      expect(prisma.workstation.findUnique).not.toHaveBeenCalled();
      expect(service.getConfig()).toEqual({ enabled: false });
    });

    it('mọi thao tác ghi trả 400', async () => {
      const { service } = build();
      const dto = { itemId: '1', pieceId: '2', passedQty: 1, defectQty: 0 };
      await expect(
        service.reportTransferCheck('tok', user('CHUYEN_KIEM'), dto, 'k'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.reportPacking('tok', user('DONG_GOI'), { itemId: '1', qty: 1 }, 'k'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.gradeBatch('1', { passedQty: 1, reworkQty: 0, scrapQty: 0 }, 'k1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.cancelPackingReport('1', { reason: 'nhầm' }, { id: 'u' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('công tắc bật', () => {
    beforeEach(() => {
      process.env.CK_DG_QR_ENABLED = 'true';
    });

    it('báo chuyền kiểm bắt buộc Idempotency-Key', async () => {
      const { service } = build();
      await expect(
        service.reportTransferCheck(
          'tok',
          user('CHUYEN_KIEM'),
          { itemId: '1', pieceId: '2', passedQty: 1, defectQty: 0 },
          undefined,
        ),
      ).rejects.toThrow('Idempotency-Key');
    });

    it('tem không có / đang tắt -> 404; tổ khác -> 403; sai loại điểm -> 400', async () => {
      const { service, prisma } = build();
      prisma.workstation.findUnique.mockResolvedValueOnce(null);
      await expect(service.scanContext('x', user('CHUYEN_KIEM'))).rejects.toBeInstanceOf(
        NotFoundException,
      );
      prisma.workstation.findUnique.mockResolvedValueOnce({
        ...ws(WorkstationKind.TRANSFER_CHECK, MfgStage.CHUYEN_KIEM),
        isActive: false,
      });
      await expect(service.scanContext('x', user('CHUYEN_KIEM'))).rejects.toBeInstanceOf(
        NotFoundException,
      );
      prisma.workstation.findUnique.mockResolvedValueOnce(
        ws(WorkstationKind.TRANSFER_CHECK, MfgStage.CHUYEN_KIEM),
      );
      await expect(service.scanContext('x', user('DONG_GOI'))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      prisma.workstation.findUnique.mockResolvedValueOnce(ws(WorkstationKind.PIECE, MfgStage.HAN));
      await expect(service.scanContext('x', user('HAN'))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      prisma.workstation.findUnique.mockResolvedValueOnce(
        ws(WorkstationKind.PACKING, MfgStage.DONG_GOI),
      );
      await expect(
        service.reportTransferCheck(
          'x',
          user('DONG_GOI'),
          { itemId: '1', pieceId: '2', passedQty: 1, defectQty: 0 },
          'k',
        ),
      ).rejects.toThrow('không phải tem điểm chuyền kiểm');
    });

    it('báo lỗi mà không có nguyên nhân / ảnh -> 400; đạt + lỗi = 0 -> 400', async () => {
      const { service, prisma } = build();
      prisma.workstation.findUnique.mockResolvedValue(
        ws(WorkstationKind.TRANSFER_CHECK, MfgStage.CHUYEN_KIEM),
      );
      prisma.transferCheckBatch.findUnique.mockResolvedValue(null);
      const base = { itemId: '1', pieceId: '2', passedQty: 0 };
      await expect(
        service.reportTransferCheck('tok', user('CHUYEN_KIEM'), { ...base, defectQty: 0 }, 'k1'),
      ).rejects.toThrow('lớn hơn 0');
      await expect(
        service.reportTransferCheck(
          'tok',
          user('CHUYEN_KIEM'),
          { ...base, defectQty: 2, photoUrls: ['https://x/a.jpg'] },
          'k2',
        ),
      ).rejects.toThrow('nguyên nhân');
      await expect(
        service.reportTransferCheck(
          'tok',
          user('CHUYEN_KIEM'),
          { ...base, defectQty: 2, defectReasonId: '5', photoUrls: [] },
          'k3',
        ),
      ).rejects.toThrow('ảnh');
    });

    it('gửi lại cùng khoá của người khác -> 409', async () => {
      const { service, prisma } = build();
      prisma.workstation.findUnique.mockResolvedValue(
        ws(WorkstationKind.TRANSFER_CHECK, MfgStage.CHUYEN_KIEM),
      );
      prisma.transferCheckBatch.findUnique.mockResolvedValue({ id: 1n, reportedById: 'other' });
      await expect(
        service.reportTransferCheck(
          'tok',
          user('CHUYEN_KIEM'),
          { itemId: '1', pieceId: '2', passedQty: 1, defectQty: 0 },
          'k',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    describe('KCS chấm', () => {
      const batch = (extra: Record<string, unknown> = {}) => ({
        id: 7n,
        status: 'AWAITING_KCS',
        passedQty: 8,
        defectQty: 2,
        pieceId: 2n,
        photoUrls: ['https://x/a.jpg'],
        defectReason: { label: 'Trầy' },
        piece: { name: 'Mảnh tay' },
        productionInvoiceItem: {
          id: 1n,
          productionInvoiceId: 4n,
          mfgProduct: { factoryCode: 'SKU', name: 'Ghế' },
          productionInvoice: { code: 'PI-1' },
        },
        ...extra,
      });

      it('đợt không có -> 404; đã chấm -> 409', async () => {
        const { service, prisma } = build();
        prisma.transferCheckBatch.findUnique.mockResolvedValueOnce(null);
        await expect(
          service.gradeBatch('7', { passedQty: 8, reworkQty: 2, scrapQty: 0 }, 'k'),
        ).rejects.toBeInstanceOf(NotFoundException);
        prisma.transferCheckBatch.findUnique.mockResolvedValueOnce(batch({ status: 'KCS_DONE' }));
        await expect(
          service.gradeBatch('7', { passedQty: 8, reworkQty: 2, scrapQty: 0 }, 'k'),
        ).rejects.toBeInstanceOf(ConflictException);
      });

      it('đạt vượt báo / tổng lệch -> 400; chấm lỗi thêm không nguyên nhân -> 400', async () => {
        const { service, prisma } = build();
        prisma.transferCheckBatch.findUnique.mockResolvedValue(batch());
        await expect(
          service.gradeBatch('7', { passedQty: 9, reworkQty: 1, scrapQty: 0 }, 'k'),
        ).rejects.toThrow('không được vượt');
        await expect(
          service.gradeBatch('7', { passedQty: 8, reworkQty: 0, scrapQty: 0 }, 'k'),
        ).rejects.toThrow('phải bằng');
        await expect(
          service.gradeBatch('7', { passedQty: 6, reworkQty: 3, scrapQty: 1 }, 'k'),
        ).rejects.toThrow('nguyên nhân');
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    });

    it('huỷ lần báo đóng gói: không có -> 404, đã huỷ -> 409, kho khác -> 403', async () => {
      const { service, prisma } = build();
      prisma.packingReport.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.cancelPackingReport('1', { reason: 'đếm nhầm' }, { id: 'tk' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      prisma.packingReport.findUnique.mockResolvedValueOnce({ id: 1n, cancelledAt: new Date() });
      await expect(
        service.cancelPackingReport('1', { reason: 'đếm nhầm' }, { id: 'tk' }),
      ).rejects.toBeInstanceOf(ConflictException);
      prisma.packingReport.findUnique.mockResolvedValueOnce({
        id: 1n,
        cancelledAt: null,
        productionInvoiceItem: { id: 1n, warehouseCode: 'thanh-pham-2' },
      });
      await expect(
        service.cancelPackingReport(
          '1',
          { reason: 'đếm nhầm' },
          { id: 'tk', warehouseScope: 'thanh-pham' },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
