import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { FloorAdminService } from './floor-admin.service';

describe('FloorAdminService', () => {
  let tx: {
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
    floorQueueEntry: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    floorReport: { count: jest.Mock };
  };
  let prisma: {
    workstation: { create: jest.Mock };
    floorQueueEntry: { findMany: jest.Mock };
    floorReport: { count: jest.Mock };
    productionInvoice: { findUnique: jest.Mock };
    productionOrder: { findMany: jest.Mock; count: jest.Mock };
    productionBatch: { groupBy: jest.Mock };
    $transaction: jest.Mock;
  };
  let steelIssues: { getPhoiProgress: jest.Mock };
  let productionBatches: { getBatchPlanBatch: jest.Mock };
  let service: FloorAdminService;

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn(),
      floorQueueEntry: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      floorReport: { count: jest.fn().mockResolvedValue(0) },
    };
    prisma = {
      workstation: {
        create: jest.fn((args: { data: Record<string, unknown> }) => ({
          id: 1n,
          isActive: true,
          createdAt: new Date(),
          ...args.data,
        })),
      },
      floorQueueEntry: { findMany: jest.fn().mockResolvedValue([]) },
      floorReport: { count: jest.fn().mockResolvedValue(0) },
      productionInvoice: { findUnique: jest.fn() },
      productionOrder: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      productionBatch: { groupBy: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    steelIssues = { getPhoiProgress: jest.fn() };
    productionBatches = { getBatchPlanBatch: jest.fn() };
    service = new FloorAdminService(
      prisma as unknown as PrismaServiceType,
      steelIssues as unknown as SteelIssuesService,
      productionBatches as unknown as ProductionBatchesService,
    );
  });

  describe('createWorkstation', () => {
    it('máy cắt/công đoạn phụ/nhận sắt chỉ thuộc tổ Phôi; STEP phải có công đoạn khác Cắt', async () => {
      await expect(
        service.createWorkstation({ code: 'X1', name: 'x', stage: 'HAN', kind: 'CUT' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createWorkstation({ code: 'X2', name: 'x', stage: 'PHOI', kind: 'STEP' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createWorkstation({
          code: 'X3',
          name: 'x',
          stage: 'PHOI',
          kind: 'STEP',
          processStep: 'CAT',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.workstation.create).not.toHaveBeenCalled();
    });

    it('mã viết hoa, token QR ngẫu nhiên 24 ký tự, bỏ processStep nếu không phải STEP', async () => {
      const w = await service.createWorkstation({
        code: ' laser-01 ',
        name: 'Máy laser 1',
        stage: 'PHOI',
        kind: 'CUT',
        processStep: 'UON',
      });
      expect(w.code).toBe('LASER-01');
      expect(w.processStep).toBeNull();
      expect(w.qrToken).toMatch(/^[A-Za-z0-9_-]{24}$/);
    });
  });

  describe('advance ("Chuyển PI tiếp")', () => {
    it('PI đang chạy -> DONE, PI đầu hàng đợi -> RUNNING', async () => {
      tx.floorQueueEntry.findFirst
        .mockResolvedValueOnce({ id: 1n, status: 'RUNNING' })
        .mockResolvedValueOnce({ id: 2n, status: 'QUEUED' });

      await service.advance('PHOI', 'qlsx-1');

      expect(tx.floorQueueEntry.update).toHaveBeenNthCalledWith(1, {
        where: { id: 1n },
        data: expect.objectContaining({ status: 'DONE', endedById: 'qlsx-1' }) as unknown,
      });
      expect(tx.floorQueueEntry.update).toHaveBeenNthCalledWith(2, {
        where: { id: 2n },
        data: expect.objectContaining({ status: 'RUNNING', startedById: 'qlsx-1' }) as unknown,
      });
    });

    it('hàng đợi trống -> 409', async () => {
      tx.floorQueueEntry.findFirst.mockResolvedValue(null);
      await expect(service.advance('HAN', 'q')).rejects.toThrow(ConflictException);
    });
  });

  describe('reopenLast ("Mở lại PI vừa chuyển" - hoàn tác Chuyển PI tiếp nhầm)', () => {
    const entry = (id: bigint, code: string) => ({
      id,
      productionInvoiceId: id + 40n,
      productionInvoice: { code },
    });

    it('trả PI đang chạy (chưa ai báo) về hàng đợi TRƯỚC, rồi mở lại PI vừa đóng', async () => {
      tx.floorQueueEntry.findFirst
        .mockResolvedValueOnce(entry(1n, 'PI-A')) // DONE gần nhất
        .mockResolvedValueOnce(entry(2n, 'PI-B')); // đang RUNNING
      tx.floorReport.count.mockResolvedValue(0);

      await service.reopenLast('PHOI');

      expect(tx.floorQueueEntry.findFirst).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          orderBy: [{ endedAt: 'desc' }, { id: 'desc' }],
        }) as unknown,
      );
      expect(tx.floorReport.count).toHaveBeenCalledWith({
        where: { productionInvoiceId: 42n, workstation: { stage: 'PHOI' } },
      });
      // Thứ tự quan trọng: mỗi tổ đúng 1 dòng RUNNING (partial unique index).
      expect(tx.floorQueueEntry.update).toHaveBeenNthCalledWith(1, {
        where: { id: 2n },
        data: { status: 'QUEUED', startedAt: null, startedById: null },
      });
      expect(tx.floorQueueEntry.update).toHaveBeenNthCalledWith(2, {
        where: { id: 1n },
        data: { status: 'RUNNING', endedAt: null, endedById: null },
      });
    });

    it('tổ đang không chạy PI nào (chuyển khi hết hàng đợi) -> chỉ mở lại PI vừa đóng', async () => {
      tx.floorQueueEntry.findFirst
        .mockResolvedValueOnce(entry(1n, 'PI-A'))
        .mockResolvedValueOnce(null);

      await service.reopenLast('HAN');

      expect(tx.floorReport.count).not.toHaveBeenCalled();
      expect(tx.floorQueueEntry.update).toHaveBeenCalledTimes(1);
      expect(tx.floorQueueEntry.update).toHaveBeenCalledWith({
        where: { id: 1n },
        data: { status: 'RUNNING', endedAt: null, endedById: null },
      });
    });

    it('PI đang chạy đã có lần báo -> 409 nêu số lần báo và cách báo bù, không sửa gì', async () => {
      tx.floorQueueEntry.findFirst
        .mockResolvedValueOnce(entry(1n, 'PI-A'))
        .mockResolvedValueOnce(entry(2n, 'PI-B'));
      tx.floorReport.count.mockResolvedValue(3);

      const err = await service.reopenLast('PHOI').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as Error).message).toContain('PI-B đã có 3 lần báo');
      expect((err as Error).message).toContain('Bù lỗi');
      expect(tx.floorQueueEntry.update).not.toHaveBeenCalled();
    });

    it('chưa chuyển PI nào -> 409', async () => {
      tx.floorQueueEntry.findFirst.mockResolvedValueOnce(null);
      await expect(service.reopenLast('SON')).rejects.toThrow(ConflictException);
      expect(tx.floorQueueEntry.update).not.toHaveBeenCalled();
    });
  });

  describe('enqueue - lời báo khi PI đã có dòng', () => {
    beforeEach(() => {
      prisma.productionInvoice.findUnique.mockResolvedValue({ id: 45n, code: 'PI-45' });
      prisma.productionOrder.count.mockResolvedValue(1);
    });

    it('PI đã chạy xong ở tổ: nói rõ không xếp lại được + cách mở lại / báo bù', async () => {
      tx.floorQueueEntry.findUnique.mockResolvedValue({ id: 1n, status: 'DONE' });
      const err = await service.enqueue('PHOI', '45', 'q').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as Error).message).toContain('đã chạy xong');
      expect((err as Error).message).toContain('Mở lại');
    });

    it('PI đang chờ / đang chạy: vẫn là "đã có trong hàng đợi"', async () => {
      tx.floorQueueEntry.findUnique.mockResolvedValue({ id: 1n, status: 'QUEUED' });
      await expect(service.enqueue('PHOI', '45', 'q')).rejects.toThrow('đã có trong hàng đợi');
    });
  });

  it('reorder: danh sách gửi lên khác tập PI đang chờ -> 409 (người khác vừa sửa)', async () => {
    tx.floorQueueEntry.findMany.mockResolvedValue([
      { id: 2n, position: 2 },
      { id: 3n, position: 3 },
    ]);
    await expect(service.reorder('PHOI', ['3'])).rejects.toThrow(ConflictException);
    await service.reorder('PHOI', ['3', '2']);
    expect(tx.floorQueueEntry.update).toHaveBeenCalledWith({
      where: { id: 3n },
      data: { position: 2 },
    });
  });

  describe('listQueue - tiến độ PI đang chạy (nhắc "đủ số, chuyển PI tiếp")', () => {
    const running = (stage: string) => ({
      id: 1n,
      stage,
      status: 'RUNNING',
      productionInvoiceId: 45n,
      position: 1,
      queuedAt: new Date(),
      startedAt: new Date(),
      endedAt: null,
      productionInvoice: { id: 45n, code: 'PI-45' },
      startedBy: null,
      endedBy: null,
    });

    it('Phôi: mỗi cỡ đoạn chặn trần ở số cần - báo vượt cỡ này không che cỡ khác còn thiếu', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running('PHOI')]);
      steelIssues.getPhoiProgress.mockResolvedValue([
        {
          segments: [
            { required: 60, done: 78 }, // vượt 18 - chỉ tính 60
            { required: 60, done: 10 },
          ],
        },
      ]);

      const [e] = await service.listQueue('PHOI');

      expect(e.progress).toEqual({ required: 120, reported: 70, percent: 58, complete: false });
    });

    it('Hàn: tính cả đợt chưa gửi KCS; đủ số thì complete', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running('HAN')]);
      prisma.productionOrder.findMany
        .mockResolvedValueOnce([]) // PI có SKU đang chạy (hasActiveFloor)
        .mockResolvedValueOnce([{ id: 41n }]); // các SKU của PI
      productionBatches.getBatchPlanBatch.mockResolvedValue({
        '41': { items: [{ pieceId: '73', plannedQty: 60, passedQty: 40, awaitingQcQty: 10 }] },
      });
      prisma.productionBatch.groupBy.mockResolvedValue([
        { productionOrderId: 41n, pieceId: 73n, _sum: { reportedQty: 20 } },
      ]);

      const [e] = await service.listQueue('HAN');

      expect(e.progress).toEqual({ required: 60, reported: 60, percent: 100, complete: true });
    });

    it('canReopen chỉ ở dòng DONE đóng gần nhất; tắt khi PI đang chạy đã có lần báo', async () => {
      const done = (id: bigint, endedAt: string) => ({
        ...running('PHOI'),
        id,
        status: 'DONE',
        productionInvoiceId: id + 100n,
        endedAt: new Date(endedAt),
        productionInvoice: { id: id + 100n, code: `PI-${id}` },
      });
      prisma.floorQueueEntry.findMany.mockResolvedValue([
        running('PHOI'),
        done(2n, '2026-10-13T01:00:00Z'),
        done(3n, '2026-10-13T02:00:00Z'),
      ]);
      steelIssues.getPhoiProgress.mockResolvedValue([]);

      prisma.floorReport.count.mockResolvedValue(0);
      let list = await service.listQueue('PHOI');
      expect(list.filter((e) => e.canReopen).map((e) => e.id)).toEqual(['3']);

      prisma.floorReport.count.mockResolvedValue(2);
      list = await service.listQueue('PHOI');
      expect(list.some((e) => e.canReopen)).toBe(false);
    });

    it('lỗi khi tính tiến độ không làm hỏng danh sách (progress = null)', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running('PHOI')]);
      steelIssues.getPhoiProgress.mockRejectedValue(new Error('boom'));

      const [e] = await service.listQueue('PHOI');

      expect(e.progress).toBeNull();
    });
  });
});
