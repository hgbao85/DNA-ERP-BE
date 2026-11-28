/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- prisma mock */
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PalletStatus } from '../../generated/prisma/client';
import type { PrismaServiceType } from '../../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { PalletsService } from './pallets.service';

/** Đợt 2 lượt 2 (28/11/2026) - pallet Sơn theo câu 6, 7, 8 chốt 25/11. */
describe('Pallet Sơn - lượt 2', () => {
  const prev = process.env.PALLET_SON_ENABLED;
  beforeEach(() => {
    process.env.PALLET_SON_ENABLED = 'true';
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.PALLET_SON_ENABLED;
    else process.env.PALLET_SON_ENABLED = prev;
  });

  const palletRow = (status: PalletStatus) => ({
    id: 7n,
    code: 'PL-007',
    status,
    warehouse: { code: 'son-pa' },
    currentLoad: null,
    currentLoadId: status === PalletStatus.EMPTY ? null : 70n,
  });

  const build = (status: PalletStatus, over: Record<string, any> = {}) => {
    const tx: any = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ id: 7n, status, currentLoadId: 70n, isActive: true }]),
      palletLoad: { update: jest.fn() },
      pallet: { update: jest.fn() },
    };
    const prisma: any = {
      pallet: { findUnique: jest.fn().mockResolvedValue(palletRow(status)) },
      palletLoad: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: (t: any) => unknown) => fn(tx)),
      ...over,
    };
    const service = new PalletsService(prisma as PrismaServiceType, {} as NotificationsService);
    jest.spyOn(service as any, 'toDtos').mockResolvedValue([{ id: '7', status: 'EMPTY' }]);
    return { service, prisma, tx };
  };

  describe('câu 7a: gỡ pallet đã sơn', () => {
    it('pallet Sơn xong: về Trống, lượt xếp ghi REMOVED_PAINTED + lý do', async () => {
      const { service, tx } = build(PalletStatus.PAINTED);
      await service.clearPainted('7', '  SKU đã huỷ  ', 'son-pa', 'tk-son');
      expect(tx.palletLoad.update).toHaveBeenCalledWith({
        where: { id: 70n },
        data: expect.objectContaining({
          clearedReason: 'REMOVED_PAINTED',
          clearNote: 'SKU đã huỷ',
          clearedById: 'tk-son',
        }),
      });
      expect(tx.pallet.update).toHaveBeenCalledWith({
        where: { id: 7n },
        data: { status: PalletStatus.EMPTY, currentLoadId: null },
      });
    });

    it('thiếu lý do -> 400; pallet đang trên phiếu đan / chờ sơn -> 409; kho khác -> 403', async () => {
      await expect(
        build(PalletStatus.PAINTED).service.clearPainted('7', 'ab', null, 'u'),
      ).rejects.toBeInstanceOf(BadRequestException);
      const onSlip = await build(PalletStatus.ON_SLIP)
        .service.clearPainted('7', 'Lý do thử', null, 'u')
        .catch((e: unknown) => e);
      expect(onSlip).toBeInstanceOf(ConflictException);
      expect((onSlip as Error).message).toMatch(/huỷ phiếu xuất đan/);
      await expect(
        build(PalletStatus.LOADED).service.clearPainted('7', 'Lý do thử', null, 'u'),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        build(PalletStatus.PAINTED).service.clearPainted('7', 'Lý do thử', 'son-pha', 'u'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('tắt công tắc -> 400', async () => {
      process.env.PALLET_SON_ENABLED = 'false';
      await expect(
        build(PalletStatus.PAINTED).service.clearPainted('7', 'Lý do thử', null, 'u'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('câu 7a: xếp pallet mảnh không đan -> 400, nói rõ báo tay ở điểm sơn', async () => {
    const { service } = build(PalletStatus.EMPTY, {
      productionOrder: {
        findFirst: jest.fn().mockResolvedValue({
          bomRevisionId: 9n,
          mfgProduct: { factoryCode: 'SKU' },
          productionInvoiceItem: {
            productionInvoiceId: 100n,
            productionInvoice: { code: 'PI', status: 'PRODUCING' },
          },
        }),
      },
      bomPiece: { findUnique: jest.fn().mockResolvedValue({ needsSon: true, isWoven: false }) },
    });
    const err = await service
      .load('7', { productionOrderId: '70', pieceId: '8', qty: 10 } as any, 'son-pa', 'u')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toMatch(/không đan/);
  });
});

describe('câu 6: báo tay tổ Sơn với mảnh có đan', () => {
  const prevP = process.env.PALLET_SON_ENABLED;
  afterAll(() => {
    if (prevP === undefined) delete process.env.PALLET_SON_ENABLED;
    else process.env.PALLET_SON_ENABLED = prevP;
  });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { FloorScanService } = require('../floor/floor-scan.service');
  const call = (isWoven: boolean, stage = 'SON') => {
    const self: any = {
      prisma: {
        productionOrder: { findUnique: jest.fn().mockResolvedValue({ bomRevisionId: 9n }) },
        bomPiece: { findUnique: jest.fn().mockResolvedValue({ isWoven }) },
      },
    };
    return FloorScanService.prototype.assertNotPalletPiece.call(self, stage, '63', '334');
  };

  it('bật pallet: mảnh có đan báo tay ở điểm sơn -> 400 hướng dẫn quét pallet', async () => {
    process.env.PALLET_SON_ENABLED = 'true';
    await expect(call(true)).rejects.toThrow(/quét tem pallet/);
  });
  it('mảnh không đan / tổ Hàn / tắt pallet -> vẫn báo tay như cũ', async () => {
    process.env.PALLET_SON_ENABLED = 'true';
    await expect(call(false)).resolves.toBeUndefined();
    await expect(call(true, 'HAN')).resolves.toBeUndefined();
    process.env.PALLET_SON_ENABLED = 'false';
    await expect(call(true)).resolves.toBeUndefined();
  });
});
