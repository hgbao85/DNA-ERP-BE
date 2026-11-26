import { BadRequestException, ConflictException } from '@nestjs/common';
import { PalletStatus } from '../../generated/prisma/client';
import { PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PALLET_SON_DISABLED_MESSAGE } from './pallet-son.config';
import { PalletsService } from './pallets.service';

/** Pallet 5 (PL-005) kho Sơn 30, lượt xếp 50: SKU 70 + mảnh 8, xếp 6, đã sơn 6. */
function palletRow(over: Record<string, unknown> = {}, load: Record<string, unknown> = {}) {
  return {
    id: 5n,
    code: 'PL-005',
    qrToken: 'tok5',
    warehouseId: 30n,
    status: PalletStatus.PAINTED,
    currentLoadId: 50n,
    isActive: true,
    note: null,
    updatedAt: new Date(),
    warehouse: { code: 'son', name: 'Kho Sơn' },
    currentLoad: {
      id: 50n,
      productionInvoiceId: 100n,
      productionOrderId: 70n,
      pieceId: 8n,
      qty: 6,
      paintedQty: 6,
      floorReport: null,
      piece: { code: 'M8', name: 'Mảnh 8', palletCapacity: null },
      productionOrder: { mfgProduct: { factoryCode: 'SKU70', name: 'Ghế' } },
      issueSlipLine: null,
      ...load,
    },
    ...over,
  };
}

function makeService(db: Record<string, unknown>, emit = jest.fn()) {
  return new PalletsService(
    db as unknown as PrismaServiceType,
    { emit } as unknown as NotificationsService,
  );
}

describe('PalletsService - pallet Sơn (24/11/2026)', () => {
  const prev = process.env.PALLET_SON_ENABLED;
  beforeEach(() => {
    process.env.PALLET_SON_ENABLED = 'true';
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.PALLET_SON_ENABLED;
    else process.env.PALLET_SON_ENABLED = prev;
  });

  describe('tắt công tắc', () => {
    beforeEach(() => {
      process.env.PALLET_SON_ENABLED = 'false';
    });

    it('màn đọc trả enabled false, không đọc DB', async () => {
      const db = { pallet: { findMany: jest.fn(), findUnique: jest.fn() } };
      const s = makeService(db);
      await expect(s.list({}, 'son')).resolves.toMatchObject({ enabled: false, pallets: [] });
      await expect(s.loadOptions({}, 'son')).resolves.toMatchObject({ enabled: false });
      await expect(s.workerView('tok')).resolves.toEqual({ enabled: false, pallet: null });
      expect(db.pallet.findMany).not.toHaveBeenCalled();
      expect(db.pallet.findUnique).not.toHaveBeenCalled();
    });

    it('thao tác ghi -> 400', async () => {
      const s = makeService({});
      await expect(s.create({ count: 1 }, 'son', 'u1')).rejects.toThrow(
        PALLET_SON_DISABLED_MESSAGE,
      );
      await expect(
        s.load('5', { productionOrderId: '70', pieceId: '8', qty: 1 }, 'son', 'u1'),
      ).rejects.toThrow(BadRequestException);
      await expect(s.preparePaint('tok', {}, 'k')).rejects.toThrow(BadRequestException);
      await expect(
        s.prepareSlipPallets(['5'], {
          productionOrderId: 70n,
          pieceId: 8n,
          qty: 1,
          warehouseId: 30n,
        }),
      ).rejects.toThrow(PALLET_SON_DISABLED_MESSAGE);
    });
  });

  describe('preparePaint', () => {
    const db = (row: unknown) => ({ pallet: { findUnique: jest.fn().mockResolvedValue(row) } });

    it('pallet Chờ sơn -> số mặc định = số trên pallet', async () => {
      const s = makeService(db(palletRow({ status: PalletStatus.LOADED }, { paintedQty: null })));
      const r = await s.preparePaint('tok5', {}, 'k1');
      expect(r).toMatchObject({
        replay: false,
        prepared: { qty: 6, short: false, loadId: 50n, productionOrderId: 70n, pieceId: 8n },
      });
    });

    it('pallet đã sơn -> 409; gửi lại đúng khoá của lần đã báo -> replay', async () => {
      const painted = palletRow({}, { floorReport: { idempotencyKey: 'k-old' } });
      await expect(makeService(db(painted)).preparePaint('tok5', {}, 'k-new')).rejects.toThrow(
        ConflictException,
      );
      await expect(makeService(db(painted)).preparePaint('tok5', {}, 'k-old')).resolves.toEqual({
        replay: true,
        palletId: 5n,
      });
    });

    it('pallet trống -> 409 "đang trống"; báo thiếu không lý do -> 400', async () => {
      const empty = palletRow({
        status: PalletStatus.EMPTY,
        currentLoadId: null,
        currentLoad: null,
      });
      await expect(makeService(db(empty)).preparePaint('tok5', {}, 'k')).rejects.toThrow(
        'đang trống',
      );
      const loaded = palletRow({ status: PalletStatus.LOADED }, { paintedQty: null });
      await expect(makeService(db(loaded)).preparePaint('tok5', { qty: 2 }, 'k')).rejects.toThrow(
        'lý do',
      );
    });
  });

  describe('prepareSlipPallets (xuất đan quét pallet)', () => {
    const line = { productionOrderId: 70n, pieceId: 8n, qty: 6, warehouseId: 30n };
    const db = (rows: unknown[]) => ({ pallet: { findMany: jest.fn().mockResolvedValue(rows) } });

    it('pallet Sơn xong đúng SKU + mảnh -> nhận, số ≤ tổng đã sơn', async () => {
      await expect(makeService(db([palletRow()])).prepareSlipPallets(['5'], line)).resolves.toEqual(
        {
          palletIds: [5n],
          productionOrderId: 70n,
          pieceId: 8n,
          qty: 6,
        },
      );
    });

    it('sửa TĂNG quá số trên pallet -> 400', async () => {
      await expect(
        makeService(db([palletRow()])).prepareSlipPallets(['5'], { ...line, qty: 7 }),
      ).rejects.toThrow('chỉ sửa giảm');
    });

    it('pallet đang trên phiếu chờ ký khác -> 409 nêu mã phiếu', async () => {
      const onSlip = palletRow(
        { status: PalletStatus.ON_SLIP },
        { issueSlipLine: { slip: { id: 9n, code: 'XK-261124-001', status: 'DRAFT' } } },
      );
      await expect(makeService(db([onSlip])).prepareSlipPallets(['5'], line)).rejects.toThrow(
        'XK-261124-001',
      );
    });

    it('khác SKU / mảnh hoặc khác kho -> 400; quét trùng pallet -> 400', async () => {
      await expect(
        makeService(db([palletRow()])).prepareSlipPallets(['5'], { ...line, pieceId: 9n }),
      ).rejects.toThrow('không đúng SKU / mảnh');
      await expect(
        makeService(db([palletRow()])).prepareSlipPallets(['5'], { ...line, warehouseId: 31n }),
      ).rejects.toThrow('không cùng kho');
      await expect(
        makeService(db([palletRow()])).prepareSlipPallets(['5', '5'], line),
      ).rejects.toThrow('quét 2 lần');
    });
  });

  describe('releaseForSlipInTx', () => {
    it('phiếu không có pallet: chỉ 1 lần đọc, không ghi', async () => {
      const tx = {
        palletLoad: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
        pallet: { updateMany: jest.fn() },
      };
      const n = await makeService({}).releaseForSlipInTx(
        tx as unknown as PrismaTx,
        1n,
        'ISSUED',
        'u1',
      );
      expect(n).toBe(0);
      expect(tx.palletLoad.updateMany).not.toHaveBeenCalled();
      expect(tx.pallet.updateMany).not.toHaveBeenCalled();
    });

    it('xác nhận -> pallet Trống, lượt xếp ghi ISSUED; huỷ -> Sơn xong, bỏ gắn dòng', async () => {
      const mk = () => ({
        $queryRaw: jest
          .fn()
          .mockResolvedValue([
            { id: 5n, status: PalletStatus.ON_SLIP, currentLoadId: 50n, isActive: true },
          ]),
        palletLoad: {
          findMany: jest.fn().mockResolvedValue([{ id: 50n, palletId: 5n }]),
          updateMany: jest.fn(),
        },
        pallet: { updateMany: jest.fn() },
      });
      const issued = mk();
      await makeService({}).releaseForSlipInTx(issued as unknown as PrismaTx, 1n, 'ISSUED', 'u1');
      expect(issued.pallet.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [5n] } },
        data: { status: PalletStatus.EMPTY, currentLoadId: null },
      });
      const [[issuedArg]] = issued.palletLoad.updateMany.mock.calls as [
        { where: unknown; data: Record<string, unknown> },
      ][];
      expect(issuedArg.where).toEqual({ id: { in: [50n] } });
      expect(issuedArg.data).toMatchObject({ clearedReason: 'ISSUED', clearedById: 'u1' });
      expect(issuedArg.data.clearedAt).toBeInstanceOf(Date);
      const cancelled = mk();
      await makeService({}).releaseForSlipInTx(
        cancelled as unknown as PrismaTx,
        1n,
        'CANCELLED',
        'u1',
      );
      expect(cancelled.palletLoad.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [50n] } },
        data: { issueSlipLineId: null },
      });
      expect(cancelled.pallet.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [5n] } },
        data: { status: PalletStatus.PAINTED },
      });
    });
  });
});
