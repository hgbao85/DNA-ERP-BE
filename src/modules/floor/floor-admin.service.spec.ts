import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
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
    workstation: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    floorQueueEntry: { findMany: jest.Mock };
    floorReport: { count: jest.Mock };
    productionInvoice: { findUnique: jest.Mock };
    productionOrder: { findMany: jest.Mock; count: jest.Mock };
    productionBatch: { groupBy: jest.Mock };
    $transaction: jest.Mock;
  };
  let steelIssues: { getPhoiProgressBatch: jest.Mock };
  let productionBatches: { getBatchPlanBatch: jest.Mock };
  let service: FloorAdminService;

  /** 1 cỡ đoạn của phoi-progress (mặc định chưa lỗi, chưa có phần chưa gửi/chờ KCS). */
  const seg = (s: {
    required: number;
    done: number;
    failed?: number;
    openQty?: number;
    awaitingQcQty?: number;
  }) => ({ failed: 0, openQty: 0, awaitingQcQty: 0, ...s });

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
        findUnique: jest.fn().mockResolvedValue({ id: 1n }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn((args: { data: Record<string, unknown> }) => ({
          id: 1n,
          code: 'LASER-01',
          name: 'Máy laser 1',
          stage: 'PHOI',
          kind: 'CUT',
          processStep: null,
          qrToken: 'old-token-old-token-old-',
          isActive: true,
          createdAt: new Date(),
          ...Object.fromEntries(Object.entries(args.data).filter(([, v]) => v !== undefined)),
        })),
      },
      floorQueueEntry: { findMany: jest.fn().mockResolvedValue([]) },
      floorReport: { count: jest.fn().mockResolvedValue(0) },
      productionInvoice: { findUnique: jest.fn() },
      productionOrder: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      productionBatch: { groupBy: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    steelIssues = { getPhoiProgressBatch: jest.fn().mockResolvedValue({ 45: [] }) };
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

    it('tổ Đan không dùng mã QR (kể cả loại mảnh); khu nhận sắt chỉ của Phôi', async () => {
      await expect(
        service.createWorkstation({ code: 'D1', name: 'x', stage: 'DAN', kind: 'PIECE' }),
      ).rejects.toThrow(/Đan/);
      await expect(
        service.createWorkstation({ code: 'N1', name: 'x', stage: 'HAN', kind: 'STEEL_RECEIVE' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.workstation.create).not.toHaveBeenCalled();
    });

    it('hợp lệ: PIECE cho Phôi/Hàn/Sơn, STEEL_RECEIVE cho Phôi, STEP giữ công đoạn phụ', async () => {
      for (const stage of ['PHOI', 'HAN', 'SON'] as const) {
        await service.createWorkstation({ code: `P-${stage}`, name: 'x', stage, kind: 'PIECE' });
      }
      await service.createWorkstation({
        code: 'KN',
        name: 'x',
        stage: 'PHOI',
        kind: 'STEEL_RECEIVE',
      });
      const step = await service.createWorkstation({
        code: 'UON-1',
        name: 'Máy uốn',
        stage: 'PHOI',
        kind: 'STEP',
        processStep: 'UON',
      });
      expect(prisma.workstation.create).toHaveBeenCalledTimes(5);
      expect(step.processStep).toBe('UON');
    });

    it('trùng mã điểm làm việc (P2002) -> 409 nêu mã; lỗi khác ném lại nguyên văn', async () => {
      const dto = { code: 'laser-01', name: 'x', stage: 'PHOI', kind: 'CUT' } as const;
      prisma.workstation.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
      );
      await expect(service.createWorkstation(dto)).rejects.toThrow(
        new ConflictException('Mã điểm làm việc LASER-01 đã có'),
      );
      prisma.workstation.create.mockRejectedValueOnce(new Error('mất kết nối'));
      await expect(service.createWorkstation(dto)).rejects.toThrow('mất kết nối');
    });
  });

  describe('danh sách / sửa máy / đổi mã QR', () => {
    it('danh sách xếp theo tổ rồi mã máy', async () => {
      await service.listWorkstations();
      expect(prisma.workstation.findMany).toHaveBeenCalledWith({
        orderBy: [{ stage: 'asc' }, { code: 'asc' }],
      });
    });

    it('sửa: tên được cắt khoảng trắng, bật/tắt máy; id không tồn tại -> 404, không sửa', async () => {
      const w = await service.updateWorkstation('1', { name: '  Máy laser mới ', isActive: false });
      expect(prisma.workstation.update).toHaveBeenCalledWith({
        where: { id: 1n },
        data: { name: 'Máy laser mới', isActive: false },
      });
      expect(w).toMatchObject({ name: 'Máy laser mới', isActive: false });

      prisma.workstation.update.mockClear();
      prisma.workstation.findUnique.mockResolvedValue(null);
      await expect(service.updateWorkstation('9', { name: 'x' })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.workstation.update).not.toHaveBeenCalled();
    });

    it('đổi mã QR: sinh token ngẫu nhiên mới (24 ký tự, khác token cũ) -> tem cũ hết dùng; id lạ -> 404', async () => {
      const w = await service.regenerateWorkstationToken('1');
      const data = (prisma.workstation.update.mock.calls as unknown[][])[0][0] as {
        data: { qrToken: string };
      };
      expect(data.data.qrToken).toMatch(/^[A-Za-z0-9_-]{24}$/);
      expect(data.data.qrToken).not.toBe('old-token-old-token-old-');
      expect(w.qrToken).toBe(data.data.qrToken);

      const again = await service.regenerateWorkstationToken('1');
      expect(again.qrToken).not.toBe(w.qrToken); // mỗi lần một mã khác

      prisma.workstation.update.mockClear();
      prisma.workstation.findUnique.mockResolvedValue(null);
      await expect(service.regenerateWorkstationToken('9')).rejects.toThrow(NotFoundException);
      expect(prisma.workstation.update).not.toHaveBeenCalled();
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
      steelIssues.getPhoiProgressBatch.mockResolvedValue({
        45: [
          {
            steelBalance: { receivedBarCount: 12 },
            steps: [],
            segments: [
              seg({ required: 60, done: 78, awaitingQcQty: 78 }), // vượt 18 - chỉ tính 60
              seg({ required: 60, done: 10, openQty: 10 }),
            ],
          },
        ],
      });

      const [e] = await service.listQueue('PHOI');

      expect(e.progress).toMatchObject({
        required: 120,
        reported: 70,
        awaiting: 60,
        open: 10,
        percent: 58,
        complete: false,
        missing: { lines: 1, materialsNotReceived: 0 },
      });
    });

    it('Phôi: tính cả công đoạn phụ + trừ lỗi KCS; breakdown theo công đoạn; loại sắt chưa nhận được đếm', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running('PHOI')]);
      steelIssues.getPhoiProgressBatch.mockResolvedValue({
        45: [
          {
            steelBalance: { receivedBarCount: 12 },
            segments: [seg({ required: 100, done: 100, failed: 4 })], // đạt 96, thiếu 4 do lỗi
            steps: [{ step: 'UON', segments: [seg({ required: 100, done: 0 })] }],
          },
          {
            steelBalance: null, // chưa nhận sắt
            segments: [seg({ required: 50, done: 0 })],
            steps: [],
          },
        ],
      });

      const [e] = await service.listQueue('PHOI');

      expect(e.progress).toMatchObject({
        required: 250,
        reported: 96,
        passed: 96,
        failed: 4,
        percent: 38,
        complete: false,
        missing: { lines: 3, materialsNotReceived: 1 },
      });
      expect(e.progress!.breakdown.map((b) => [b.step, b.required, b.reported])).toEqual([
        ['CAT', 150, 96],
        ['UON', 100, 0],
      ]);
    });

    it('Phôi: thiếu PI trong kết quả batch (PI lỗi) → progress null, không coi là xong', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running('PHOI')]);
      steelIssues.getPhoiProgressBatch.mockResolvedValue({});

      const [e] = await service.listQueue('PHOI');

      expect(e.progress).toBeNull();
    });

    it('Phôi: mảnh Phôi + vật tư thành phẩm vào công đoạn PIECE', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running('PHOI')]);
      prisma.productionOrder.findMany
        .mockResolvedValueOnce([]) // hasActiveFloor
        .mockResolvedValueOnce([{ id: 41n }]);
      productionBatches.getBatchPlanBatch.mockResolvedValue({
        '41': {
          items: [{ plannedQty: 10, passedQty: 4, awaitingQcQty: 3, openQty: 3 }],
          materialYieldItems: [{ plannedQty: 10, passedQty: 5, awaitingQcQty: 0 }],
        },
      });

      const [e] = await service.listQueue('PHOI');

      expect(productionBatches.getBatchPlanBatch).toHaveBeenCalledWith(['41'], 'PHOI');
      expect(e.progress!.breakdown).toEqual([
        expect.objectContaining({ step: 'PIECE', required: 20, reported: 15, percent: 75 }),
      ]);
    });

    it('Hàn: tính cả đợt chưa gửi KCS; đủ số thì complete', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running('HAN')]);
      prisma.productionOrder.findMany
        .mockResolvedValueOnce([]) // PI có SKU đang chạy (hasActiveFloor)
        .mockResolvedValueOnce([{ id: 41n }]); // các SKU của PI
      productionBatches.getBatchPlanBatch.mockResolvedValue({
        '41': {
          items: [{ pieceId: '73', plannedQty: 60, passedQty: 40, awaitingQcQty: 10, openQty: 20 }],
        },
      });

      const [e] = await service.listQueue('HAN');

      expect(steelIssues.getPhoiProgressBatch).not.toHaveBeenCalled();
      expect(e.progress).toMatchObject({
        required: 60,
        reported: 60,
        percent: 100,
        complete: true,
        missing: { lines: 0, materialsNotReceived: 0 },
      });
    });

    it('% chưa đủ không làm tròn lên 100', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running('HAN')]);
      prisma.productionOrder.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 41n }]);
      productionBatches.getBatchPlanBatch.mockResolvedValue({
        '41': { items: [{ plannedQty: 1000, passedQty: 999, awaitingQcQty: 0, openQty: 0 }] },
      });

      const [e] = await service.listQueue('HAN');

      expect(e.progress).toMatchObject({ percent: 99, complete: false });
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
      steelIssues.getPhoiProgressBatch.mockResolvedValue({ 45: [] });

      prisma.floorReport.count.mockResolvedValue(0);
      let list = await service.listQueue('PHOI');
      expect(list.filter((e) => e.canReopen).map((e) => e.id)).toEqual(['3']);

      prisma.floorReport.count.mockResolvedValue(2);
      list = await service.listQueue('PHOI');
      expect(list.some((e) => e.canReopen)).toBe(false);
    });

    it('lỗi khi tính tiến độ không làm hỏng danh sách (progress = null)', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running('PHOI')]);
      steelIssues.getPhoiProgressBatch.mockRejectedValue(new Error('boom'));

      const [e] = await service.listQueue('PHOI');

      expect(e.progress).toBeNull();
    });
  });

  describe('stageDetail (ngăn "còn thiếu gì", mục 45.4)', () => {
    it('PI không tồn tại → 404, không tính gì', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(null);

      await expect(service.stageDetail('PHOI', '45')).rejects.toThrow(NotFoundException);
      expect(steelIssues.getPhoiProgressBatch).not.toHaveBeenCalled();
    });

    it('trả tiến độ + đúng dữ liệu gốc đã dùng để tính (phoi + batch-plan theo SKU) + danh sách SKU', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue({ id: 45n, code: 'PI-45' });
      const phoi = [
        {
          steelBalance: null,
          steps: [],
          segments: [{ required: 10, done: 4, failed: 0, openQty: 4, awaitingQcQty: 0 }],
        },
      ];
      steelIssues.getPhoiProgressBatch.mockResolvedValue({ 45: phoi });
      prisma.productionOrder.findMany.mockResolvedValue([
        {
          id: 41n,
          wireMaterial: { id: 7n, code: 'SHT29', name: 'Dây SHT29', imageUrl: null },
          cushionMaterial: null,
        },
      ]);
      const plans = {
        '41': {
          poNumber: 'PO-1',
          productName: 'Ghế J55',
          items: [{ plannedQty: 2, passedQty: 2, awaitingQcQty: 0, openQty: 0 }],
          materialYieldItems: [],
        },
      };
      productionBatches.getBatchPlanBatch.mockResolvedValue(plans);

      const d = await service.stageDetail('PHOI', '45');

      expect(d).toMatchObject({
        productionInvoiceId: '45',
        piCode: 'PI-45',
        stage: 'PHOI',
        phoi,
        plans,
      });
      expect(d.orders).toEqual([
        {
          productionOrderId: '41',
          poNumber: 'PO-1',
          productName: 'Ghế J55',
          wireMaterial: {
            materialId: '7',
            materialCode: 'SHT29',
            materialName: 'Dây SHT29',
            imageUrl: null,
          },
          cushionMaterial: null,
        },
      ]);
      expect(d.progress).toMatchObject({
        required: 12,
        reported: 6,
        missing: { lines: 1, materials: 1, materialsNotReceived: 1, pieces: 0 },
      });
    });

    it('Hàn: không gọi phoi-progress, phoi = null', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue({ id: 45n, code: 'PI-45' });
      prisma.productionOrder.findMany.mockResolvedValue([]);

      const d = await service.stageDetail('HAN', '45');

      expect(steelIssues.getPhoiProgressBatch).not.toHaveBeenCalled();
      expect(d.phoi).toBeNull();
      expect(d.progress).toMatchObject({ required: 0, percent: 0, complete: false });
    });
  });
});
