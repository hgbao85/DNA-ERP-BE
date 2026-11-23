import type { PrismaServiceType } from '../../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import {
  buildPullSteelParams,
  CutAllocationFollowUpService,
} from './cut-allocation-follow-up.service';
import type { CutAllocationService } from './cut-allocation.service';
import type { AllocatedOrder } from './cut-allocation-types';

describe('CutAllocationFollowUpService', () => {
  let prisma: {
    productionInvoice: { findMany: jest.Mock };
  };
  let notifications: { emit: jest.Mock };
  let cutAllocation: { steelGapsByPi: jest.Mock };
  let service: CutAllocationFollowUpService;

  const gap = (over: Partial<AllocatedOrder['steelGaps'][number]> = {}) => ({
    materialId: '7',
    materialCode: 'S1',
    materialLabel: 'Sắt hộp · 25x50',
    requiredBars: 10,
    issuedBars: 6,
    missingBars: 4,
    warehouseCodes: ['KHO-SAT'],
    ...over,
  });
  /** Chỗ thiếu sắt hiện hành của cả lệnh (steelGapsByPi), theo id lệnh. */
  const fullGaps = (m: Record<string, AllocatedOrder['steelGaps']>) =>
    cutAllocation.steelGapsByPi.mockResolvedValue(new Map(Object.entries(m)));
  const order = (id: string, steelGaps = [gap()]): AllocatedOrder => ({
    productionInvoiceId: id,
    piCode: `PI-${id}`,
    steelGaps,
  });

  beforeEach(() => {
    prisma = {
      productionInvoice: { findMany: jest.fn().mockResolvedValue([]) },
    };
    notifications = { emit: jest.fn().mockResolvedValue(undefined) };
    cutAllocation = { steelGapsByPi: jest.fn().mockResolvedValue(new Map()) };
    delete process.env.FLOOR_ALERTS;
    service = new CutAllocationFollowUpService(
      prisma as unknown as PrismaServiceType,
      notifications as unknown as NotificationsService,
      cutAllocation as unknown as CutAllocationService,
    );
  });

  afterEach(() => {
    delete process.env.FLOOR_ALERTS;
  });

  describe('afterAllocated', () => {
    it('báo thủ kho xuất sắt (source đúng, dedupeKey theo lệnh)', async () => {
      fullGaps({ '100': [gap()] });
      await service.afterAllocated({
        workshopId: 5n,
        orders: [order('100'), order('101', [])],
        source: 'MANUAL',
      });
      expect(notifications.emit).toHaveBeenCalledTimes(1);
      expect(notifications.emit).toHaveBeenCalledWith('CUT_PULL_STEEL_TO_ISSUE', {
        entityId: '100',
        dedupeKey: 'cut-pull-steel:100',
        params: {
          piCode: 'PI-100',
          workshopId: '5',
          lines: 'Sắt hộp · 25x50: còn 4 cây',
          warehouseCodes: ['KHO-SAT'],
          source: 'MANUAL',
        },
      });
    });

    it('source AUTO_PULL được truyền nguyên; nhiều loại sắt gộp 1 tin, kho không trùng', async () => {
      const both = [
        gap(),
        gap({ materialLabel: 'Sắt tròn', missingBars: 2, warehouseCodes: ['KHO-SAT', 'KHO-B'] }),
      ];
      fullGaps({ '100': both });
      await service.afterAllocated({
        workshopId: '5',
        orders: [order('100', both)],
        source: 'AUTO_PULL',
      });
      const arg = (notifications.emit.mock.calls as unknown[][])[0][1] as {
        params: Record<string, unknown>;
      };
      expect(arg.params).toMatchObject({
        source: 'AUTO_PULL',
        warehouseCodes: ['KHO-B', 'KHO-SAT'],
        lines: 'Sắt hộp · 25x50: còn 4 cây; Sắt tròn: còn 2 cây',
      });
    });

    it('thiếu sắt nhưng không kho nào còn giữ chỗ -> không phát tin', async () => {
      await service.afterAllocated({
        workshopId: 5n,
        orders: [order('100', [gap({ warehouseCodes: [] })])],
        source: 'MANUAL',
      });
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('lệnh cờ cuttingRecheckRequired: KHÔNG báo thủ kho', async () => {
      prisma.productionInvoice.findMany.mockResolvedValue([{ id: 100n }]);
      fullGaps({ '100': [gap()], '101': [gap()] });
      await service.afterAllocated({
        workshopId: 5n,
        orders: [order('100'), order('101')],
        source: 'MANUAL',
      });
      expect(notifications.emit).toHaveBeenCalledTimes(1);
      expect(notifications.emit).toHaveBeenCalledWith(
        'CUT_PULL_STEEL_TO_ISSUE',
        expect.objectContaining({ entityId: '101' }),
      );
    });

    it('không có lệnh nào -> không làm gì', async () => {
      await service.afterAllocated({ workshopId: 5n, orders: [], source: 'MANUAL' });
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('lỗi phát tin chỉ ghi log, không throw, vẫn báo các lệnh còn lại', async () => {
      notifications.emit.mockRejectedValueOnce(new Error('emit down'));
      fullGaps({ '100': [gap()], '101': [gap()] });
      await expect(
        service.afterAllocated({
          workshopId: 5n,
          orders: [order('100'), order('101')],
          source: 'MANUAL',
        }),
      ).resolves.toBeUndefined();
      expect(notifications.emit).toHaveBeenCalledTimes(2);
    });

    it('lỗi tra cờ kiểm lại: coi như không có cờ, vẫn báo', async () => {
      prisma.productionInvoice.findMany.mockRejectedValue(new Error('db'));
      fullGaps({ '100': [gap()] });
      await service.afterAllocated({ workshopId: 5n, orders: [order('100')], source: 'MANUAL' });
      expect(notifications.emit).toHaveBeenCalledTimes(1);
    });
  });

  describe('afterAllocated: tin gộp chứa toàn bộ chỗ thiếu sắt của lệnh', () => {
    it('tin cũ có S1, QLSX chia thêm S2: tin mới liệt kê cả S1 lẫn S2, kho là hợp các kho', async () => {
      const s1 = gap({ materialId: '7', materialLabel: 'S1', missingBars: 4 });
      const s2 = gap({
        materialId: '8',
        materialLabel: 'S2',
        missingBars: 3,
        warehouseCodes: ['KHO-B'],
      });
      // Lần chia này chỉ tăng S2; S1 vẫn còn thiếu từ lần trước.
      fullGaps({ '100': [s1, s2] });
      await service.afterAllocated({
        workshopId: 5n,
        orders: [order('100', [s2])],
        source: 'MANUAL',
      });
      expect(cutAllocation.steelGapsByPi).toHaveBeenCalledWith(5n);
      expect(notifications.emit).toHaveBeenCalledTimes(1);
      expect(notifications.emit).toHaveBeenCalledWith('CUT_PULL_STEEL_TO_ISSUE', {
        entityId: '100',
        dedupeKey: 'cut-pull-steel:100',
        params: {
          piCode: 'PI-100',
          workshopId: '5',
          lines: 'S1: còn 4 cây; S2: còn 3 cây',
          warehouseCodes: ['KHO-B', 'KHO-SAT'],
          source: 'MANUAL',
        },
      });
    });

    it('cặp vừa chia đã xuất đủ trong lúc chờ (không còn thiếu) -> không phát', async () => {
      fullGaps({});
      await service.afterAllocated({ workshopId: 5n, orders: [order('100')], source: 'MANUAL' });
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('tra thiếu sắt hiện hành lỗi -> dùng các cặp vừa chia, vẫn phát', async () => {
      cutAllocation.steelGapsByPi.mockRejectedValue(new Error('db'));
      await service.afterAllocated({ workshopId: 5n, orders: [order('100')], source: 'MANUAL' });
      expect(notifications.emit).toHaveBeenCalledTimes(1);
    });

    it('FLOOR_ALERTS=off: KHÔNG phát tin xuất sắt', async () => {
      process.env.FLOOR_ALERTS = 'off';
      fullGaps({ '100': [gap()] });
      await service.afterAllocated({ workshopId: 5n, orders: [order('100')], source: 'MANUAL' });
      expect(notifications.emit).not.toHaveBeenCalled();
    });
  });

  describe('buildPullSteelParams (câu chữ dùng chung)', () => {
    it('sắp theo mã loại sắt, kho không trùng và sắp tên', () => {
      const p = buildPullSteelParams({
        piCode: 'PI-1',
        workshopId: '5',
        gaps: [
          gap({ materialId: '9', materialLabel: 'B', missingBars: 1, warehouseCodes: ['Z'] }),
          gap({ materialId: '7', materialLabel: 'A', missingBars: 2, warehouseCodes: ['Y', 'Z'] }),
        ],
        source: 'RECONCILE',
      });
      expect(p).toEqual({
        piCode: 'PI-1',
        workshopId: '5',
        lines: 'A: còn 2 cây; B: còn 1 cây',
        warehouseCodes: ['Y', 'Z'],
        source: 'RECONCILE',
      });
    });
  });
});
