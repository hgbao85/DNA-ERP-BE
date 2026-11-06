/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any -- prisma giả dạng Record<string, any> trong test */
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../../common/interfaces/cls-store.interface';
import { PrismaServiceType } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ItemDeadlineWriter } from '../item-deadline-writer.service';
import { DeadlineChangesService } from './deadline-changes.service';

const KHSX = { id: 'khsx-1', roles: ['PRODUCTION_PLANNER'] };
const BOSS = { id: 'boss-1', roles: ['BOSS'] };
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

interface FakeItem {
  id: bigint;
  lsxCode: string | null;
  prodApprovalStatus: string | null;
  productionInvoiceId: bigint | null;
  productionInvoice: { id: bigint; code: string; status: string; isMerged: boolean } | null;
  mfgProduct: { factoryCode: string; name: string };
  quantity: number;
  materialDeadline: Date | null;
  finishedMaterialDeadline: Date | null;
  deliveryDeadline: Date | null;
  stages: { stageType: string; deadline: Date }[];
  productionOrder: { floorStage: string } | null;
  deadlineChangeRequests: { id: bigint }[];
}

const makeItem = (id: bigint, over: Partial<FakeItem> = {}): FakeItem => ({
  id,
  lsxCode: `MY-${id}`,
  prodApprovalStatus: null,
  productionInvoiceId: 7n,
  productionInvoice: { id: 7n, code: 'PI-7', status: 'PLANNING', isMerged: false },
  mfgProduct: { factoryCode: `SKU-${id}`, name: `Ghế ${id}` },
  quantity: 100,
  materialDeadline: day('2026-11-01'),
  finishedMaterialDeadline: null,
  deliveryDeadline: day('2026-11-30'),
  stages: [
    { stageType: 'FRAME_PHOI', deadline: day('2026-11-10') },
    { stageType: 'FRAME_HAN', deadline: day('2026-11-12') },
  ],
  productionOrder: null,
  deadlineChangeRequests: [],
  ...over,
});

const approved = (id: bigint, over: Partial<FakeItem> = {}) =>
  makeItem(id, {
    prodApprovalStatus: 'APPROVED',
    productionOrder: { floorStage: 'PENDING' },
    ...over,
  });

describe('DeadlineChangesService', () => {
  let service: DeadlineChangesService;
  let items: FakeItem[];
  let prisma: Record<string, any>;
  let notifications: { emit: jest.Mock; resolve: jest.Mock };
  let writer: {
    applyItemDeadlines: jest.Mock;
    toWrite: jest.Mock;
    assertMergedPiProjectedRule: jest.Mock;
    assertMergedPiDeadlineRule: jest.Mock;
    auditAndNotifyDeadlineChange: jest.Mock;
  };
  let created: { data: any }[];

  const batchRow = (over: Record<string, any> = {}) => ({
    id: 50n,
    source: 'MANUAL',
    status: 'PENDING',
    requestedById: KHSX.id,
    requestedAt: new Date('2026-11-05T03:00:00.000Z'),
    decidedById: null,
    decidedAt: null,
    decisionNote: null,
    note: null,
    idempotencyKey: null,
    requestedBy: { id: KHSX.id, firstName: 'Lan', lastName: 'Nguyễn' },
    decidedBy: null,
    requests: [
      {
        id: 500n,
        batchId: 50n,
        productionInvoiceItemId: 20n,
        status: 'PENDING',
        oldValues: { 'stage.FRAME_HAN': '2026-11-12' },
        newValues: { 'stage.FRAME_HAN': '2026-11-15' },
        createdAt: new Date('2026-11-05T03:00:00.000Z'),
        decidedAt: null,
        productionInvoiceItem: makeItem(20n),
      },
    ],
    ...over,
  });

  beforeEach(() => {
    items = [makeItem(20n), approved(21n)];
    created = [];
    prisma = {
      productionInvoiceItem: {
        findMany: jest.fn((args: { where: Record<string, any> }) => {
          const w = args.where;
          if (w.id?.in) {
            const ids = (w.id.in as bigint[]).map(String);
            return Promise.resolve(items.filter((i) => ids.includes(String(i.id))));
          }
          if (typeof w.productionInvoiceId === 'bigint') {
            return Promise.resolve(
              items
                .filter((i) => i.productionInvoiceId === w.productionInvoiceId)
                .map((i) => ({ ...i, salesOrder: null, deadlineChangeRequests: [] })),
            );
          }
          // loadLenhDisplayCodes: dòng có số LSX
          return Promise.resolve(
            items
              .filter((i) => i.lsxCode)
              .map((i) => ({
                productionInvoiceId: i.productionInvoiceId,
                lsxCode: i.lsxCode,
              })),
          );
        }),
        findUnique: jest.fn(({ where }: { where: { id: bigint } }) =>
          Promise.resolve(items.find((i) => i.id === where.id) ?? null),
        ),
      },
      productionInvoice: {
        findMany: jest.fn().mockResolvedValue([{ id: 7n, code: 'PI-7' }]),
      },
      systemConfig: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ solverMergeWindowDays: 3, solverMergeMaxSkus: 5 }),
      },
      deadlineChangeBatch: {
        create: jest.fn((args: { data: any }) => {
          created.push(args);
          return Promise.resolve({ id: 50n });
        }),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(2),
      },
      deadlineChangeRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
    };
    notifications = {
      emit: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue(undefined),
    };
    writer = {
      applyItemDeadlines: jest.fn().mockResolvedValue(undefined),
      toWrite: jest.fn((v: unknown) => v),
      assertMergedPiProjectedRule: jest.fn().mockResolvedValue(undefined),
      assertMergedPiDeadlineRule: jest.fn().mockResolvedValue(undefined),
      auditAndNotifyDeadlineChange: jest.fn().mockResolvedValue(undefined),
    };
    service = new DeadlineChangesService(
      prisma as unknown as PrismaServiceType,
      { get: jest.fn() } as unknown as ClsService<AppClsStore>,
      notifications as unknown as NotificationsService,
      writer as unknown as ItemDeadlineWriter,
    );
  });

  describe('previewEntries', () => {
    it('dòng chưa duyệt đổi mốc → APPLY; dòng đã duyệt → NEEDS_APPROVAL; không đổi → NO_CHANGE', async () => {
      const checks = await service.previewEntries([
        { itemId: '20', newValues: { 'stage.FRAME_HAN': '2026-11-14' } },
        { itemId: '21', newValues: { 'stage.FRAME_HAN': '2026-11-14' } },
        { itemId: '20', newValues: {} },
      ]);
      expect(checks.map((c) => c.kind)).toEqual(['APPLY', 'NEEDS_APPROVAL', 'ERROR']);
      expect(checks[0]).toMatchObject({ lenhCode: 'MY-20', skuCode: 'SKU-20' });
      expect(checks[0].changes).toEqual([
        { key: 'stage.FRAME_HAN', label: 'Hàn', from: '2026-11-12', to: '2026-11-14' },
      ]);
      expect(checks[2].errors[0]).toMatch(/2 lần/); // trùng dòng 20
      const nochange = await service.previewEntries([
        { itemId: '20', newValues: { 'stage.FRAME_HAN': '2026-11-12' } },
      ]);
      expect(nochange[0].kind).toBe('NO_CHANGE');
    });

    it('lỗi: mã lạ, PI huỷ, lệnh Kết thúc, đang chờ duyệt, ngày sai dạng', async () => {
      items = [
        makeItem(30n, {
          productionInvoice: { id: 7n, code: 'PI-7', status: 'CANCELLED', isMerged: false },
        }),
        approved(31n, { productionOrder: { floorStage: 'FINISHED' } }),
        approved(32n, { deadlineChangeRequests: [{ id: 1n }] }),
        makeItem(33n),
      ];
      const v = { 'stage.FRAME_HAN': '2026-11-14' };
      const checks = await service.previewEntries([
        { itemId: '999', newValues: v },
        { itemId: '30', newValues: v },
        { itemId: '31', newValues: v },
        { itemId: '32', newValues: v },
        { itemId: '33', newValues: { 'stage.FRAME_HAN': '14/11/2026' } },
      ]);
      expect(checks.every((c) => c.kind === 'ERROR')).toBe(true);
      expect(checks[0].errors[0]).toMatch(/không tồn tại/);
      expect(checks[1].errors[0]).toMatch(/huỷ/);
      expect(checks[2].errors[0]).toMatch(/Kết thúc/);
      expect(checks[3].errors[0]).toMatch(/chờ Sếp duyệt lại/);
      expect(checks[4].errors[0]).toMatch(/Ngày không hợp lệ/);
    });

    it('expectedOld khác hiện tại ở mốc đổi → lỗi "đã đổi từ lúc tải file"', async () => {
      const [c] = await service.previewEntries([
        {
          itemId: '20',
          newValues: { 'stage.FRAME_PHOI': '2026-11-11' },
          expectedOld: { 'stage.FRAME_PHOI': '2026-11-09' },
        },
      ]);
      expect(c.kind).toBe('ERROR');
      expect(c.errors[0]).toBe(
        'Mốc Phôi đã đổi từ lúc tải file (lúc tải 09/11, hiện tại 10/11) – tải file mới',
      );
      // expectedOld của mốc KHÔNG đổi thì không cản
      const [ok] = await service.previewEntries([
        {
          itemId: '20',
          newValues: { 'stage.FRAME_HAN': '2026-11-14' },
          expectedOld: { 'stage.FRAME_PHOI': '2026-11-09' },
        },
      ]);
      expect(ok.kind).toBe('APPLY');
    });

    it('lệnh đã bắt đầu sản xuất (ACTIVE / PAUSED) → ERROR, kiểm trước "đang chờ duyệt lại" (Đợt 9 phần 2, Q9-3)', async () => {
      items = [
        approved(51n, { productionOrder: { floorStage: 'ACTIVE' } }),
        approved(52n, { productionOrder: { floorStage: 'PAUSED' } }),
        approved(53n, {
          productionOrder: { floorStage: 'ACTIVE' },
          deadlineChangeRequests: [{ id: 1n }],
        }),
        approved(54n, { productionOrder: { floorStage: 'PENDING' } }),
      ];
      const v = { 'stage.FRAME_HAN': '2026-11-14' };
      const checks = await service.previewEntries(
        ['51', '52', '53', '54'].map((itemId) => ({ itemId, newValues: v })),
      );
      expect(checks.map((c) => c.kind)).toEqual(['ERROR', 'ERROR', 'ERROR', 'NEEDS_APPROVAL']);
      for (const c of checks.slice(0, 3)) {
        expect(c.errors).toEqual(['Lệnh đã bắt đầu sản xuất (cắt phôi) - không sửa mốc được nữa']);
      }
      // strict → 400; không strict → skipped, không ghi / không tạo lô
      await expect(
        service.saveEntries(KHSX, [{ itemId: '51', newValues: v }], 'MANUAL', { strict: true }),
      ).rejects.toThrow(/đã bắt đầu sản xuất/);
      prisma.deadlineChangeBatch.findUnique.mockResolvedValue(batchRow());
      const res = await service.saveEntries(
        KHSX,
        [
          { itemId: '52', newValues: v },
          { itemId: '54', newValues: v },
        ],
        'MANUAL',
        { strict: false },
      );
      expect(res.skipped.map((c) => c.itemId)).toEqual(['52']);
      expect(created).toHaveLength(1);
      expect(created[0].data.requests.create).toHaveLength(1);
    });

    it('thứ tự mốc ngược → ERROR (Q9-2 = B): preview ERROR, strict 400, không strict → skipped', async () => {
      const bad = { itemId: '21', newValues: { 'stage.FRAME_HAN': '2026-11-08' } };
      const [c] = await service.previewEntries([bad]);
      expect(c.kind).toBe('ERROR');
      expect(c.errors).toEqual(['Hàn (08/11) sớm hơn Phôi (10/11)']);
      expect(c.warnings).toEqual([]);
      await expect(service.saveEntries(KHSX, [bad], 'MANUAL', { strict: true })).rejects.toThrow(
        /MY-21 · SKU-21: Hàn \(08\/11\) sớm hơn Phôi \(10\/11\)/,
      );
      const res = await service.saveEntries(KHSX, [bad], 'MANUAL', { strict: false });
      expect(res.skipped.map((x) => x.itemId)).toEqual(['21']);
      expect(res.batch).toBeNull();
      expect(created).toHaveLength(0);
      // dòng chưa duyệt (sửa thẳng) cũng bị chặn
      const [d] = await service.previewEntries([{ ...bad, itemId: '20' }]);
      expect(d.kind).toBe('ERROR');
    });

    it('lệnh gộp: luật gộp trên giá trị DỰ KIẾN vi phạm → mọi dòng đổi của lệnh mang lỗi', async () => {
      items = [
        makeItem(40n, {
          productionInvoice: { id: 7n, code: 'PI-7', status: 'PLANNING', isMerged: true },
        }),
        makeItem(41n, {
          productionInvoice: { id: 7n, code: 'PI-7', status: 'PLANNING', isMerged: true },
        }),
      ];
      writer.assertMergedPiProjectedRule.mockRejectedValue(
        new BadRequestException('Mốc cần sắt các SKU của lệnh gộp cách nhau 9 ngày'),
      );
      const checks = await service.previewEntries([
        { itemId: '40', newValues: { materialDeadline: '2026-11-10' } },
        { itemId: '41', newValues: { materialDeadline: '2026-11-02' } },
      ]);
      expect(checks.map((c) => c.kind)).toEqual(['ERROR', 'ERROR']);
      expect(checks[0].errors[0]).toMatch(/cách nhau 9 ngày/);
      const overrides = writer.assertMergedPiProjectedRule.mock.calls[0][2] as Map<string, unknown>;
      expect(overrides.get('40')).toEqual({ materialDeadline: '2026-11-10' });
      expect(overrides.get('41')).toEqual({ materialDeadline: '2026-11-02' });
    });
  });

  describe('saveEntries', () => {
    it('strict: có dòng ERROR → 400 gộp câu lỗi, không ghi gì, không tạo lô', async () => {
      await expect(
        service.saveEntries(
          KHSX,
          [
            { itemId: '20', newValues: { 'stage.FRAME_HAN': '2026-11-14' } },
            { itemId: '999', newValues: { 'stage.FRAME_HAN': '2026-11-14' } },
          ],
          'MANUAL',
          { strict: true },
        ),
      ).rejects.toThrow(BadRequestException);
      expect(writer.applyItemDeadlines).not.toHaveBeenCalled();
      expect(prisma.deadlineChangeBatch.create).not.toHaveBeenCalled();
    });

    it('không strict: dòng lỗi vào skipped; APPLY ghi qua writer + audit; NEEDS_APPROVAL gom 1 lô và báo Sếp', async () => {
      // lần 1 (kiểm khoá chống gửi 2 lần): chưa có lô; lần sau (nạp lô vừa tạo): có
      prisma.deadlineChangeBatch.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValue(batchRow());
      const result = await service.saveEntries(
        KHSX,
        [
          { itemId: '20', newValues: { 'stage.FRAME_HAN': '2026-11-14' } },
          { itemId: '21', newValues: { 'stage.FRAME_HAN': '2026-11-15' } },
          { itemId: '999', newValues: { 'stage.FRAME_HAN': '2026-11-15' } },
        ],
        'EXCEL',
        { strict: false, note: 'ke-hoach.xlsx', idempotencyKey: 'k1' },
      );
      expect(result.applied.map((c) => c.itemId)).toEqual(['20']);
      expect(result.skipped.map((c) => c.itemId)).toEqual(['999']);
      expect(result.batch?.id).toBe('50');
      // ghi thẳng dòng 20, KHÔNG ghi dòng 21 (đã duyệt)
      expect(writer.applyItemDeadlines).toHaveBeenCalledTimes(1);
      expect(writer.applyItemDeadlines.mock.calls[0][1]).toBe(20n);
      expect(writer.auditAndNotifyDeadlineChange).toHaveBeenCalledTimes(1);
      // lô: source, ghi chú, khoá, yêu cầu chỉ chứa khoá đổi
      const data = created[0].data;
      expect(data).toMatchObject({
        source: 'EXCEL',
        requestedById: 'khsx-1',
        note: 'ke-hoach.xlsx',
        idempotencyKey: 'k1',
      });
      expect(data.requests.create).toEqual([
        {
          productionInvoiceItemId: 21n,
          oldValues: { 'stage.FRAME_HAN': '2026-11-12' },
          newValues: { 'stage.FRAME_HAN': '2026-11-15' },
        },
      ]);
      expect(notifications.emit).toHaveBeenCalledWith(
        'DEADLINE_CHANGE_PENDING',
        expect.objectContaining({ entityId: '50' }),
      );
    });

    it('khoá chống gửi 2 lần: đã có lô mang khoá → trả lô đó, không ghi / tạo lại', async () => {
      prisma.deadlineChangeBatch.findUnique.mockResolvedValue(batchRow({ idempotencyKey: 'k1' }));
      const result = await service.saveEntries(
        KHSX,
        [{ itemId: '21', newValues: { 'stage.FRAME_HAN': '2026-11-15' } }],
        'EXCEL',
        { strict: false, idempotencyKey: 'k1' },
      );
      expect(result.batch?.id).toBe('50');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.deadlineChangeBatch.create).not.toHaveBeenCalled();
    });
  });

  describe('decide', () => {
    const pendingBatch = (reqs: Record<string, unknown>[]) => ({
      id: 50n,
      status: 'PENDING',
      requestedById: KHSX.id,
      requests: reqs,
    });
    const req = (id: bigint, itemId: bigint, over: Record<string, unknown> = {}) => ({
      id,
      batchId: 50n,
      productionInvoiceItemId: itemId,
      status: 'PENDING',
      oldValues: { 'stage.FRAME_HAN': '2026-11-12' },
      newValues: { 'stage.FRAME_HAN': '2026-11-15' },
      ...over,
    });

    beforeEach(() => {
      items = [approved(21n), approved(22n)];
      // lần findUnique đầu (trong giao dịch) là lô thô; lần sau (loadBatch) là lô đầy đủ
      prisma.deadlineChangeBatch.findUnique
        .mockResolvedValueOnce(pendingBatch([req(501n, 21n), req(502n, 22n)]))
        .mockResolvedValue(batchRow({ status: 'DECIDED' }));
    });

    it('từ chối yêu cầu mà không ghi lý do → 400', async () => {
      await expect(
        service.decide(BOSS, '50', { approveRequestIds: ['501'], rejectReason: 'ab' }),
      ).rejects.toThrow(/lý do/);
      expect(writer.applyItemDeadlines).not.toHaveBeenCalled();
    });

    it('id không thuộc lô → 400', async () => {
      await expect(service.decide(BOSS, '50', { approveRequestIds: ['999'] })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('mốc hiện tại lệch oldValues → 409 nêu lệnh + mốc', async () => {
      items[0].stages = [{ stageType: 'FRAME_HAN', deadline: day('2026-11-13') }];
      await expect(
        service.decide(BOSS, '50', { approveRequestIds: ['501', '502'] }),
      ).rejects.toThrow(ConflictException);
      items[0].stages = [{ stageType: 'FRAME_HAN', deadline: day('2026-11-13') }];
      prisma.deadlineChangeBatch.findUnique.mockReset();
      prisma.deadlineChangeBatch.findUnique
        .mockResolvedValueOnce(pendingBatch([req(501n, 21n)]))
        .mockResolvedValue(batchRow());
      await expect(service.decide(BOSS, '50', { approveRequestIds: ['501'] })).rejects.toThrow(
        /Mốc Hàn của lệnh MY-21 · SKU-21 đã đổi từ lúc gửi \(lúc gửi 12\/11, hiện tại 13\/11\)/,
      );
    });

    it('duyệt 1 + từ chối 1 (có lý do): chỉ áp dòng duyệt, yêu cầu còn lại REJECTED, lô DECIDED, báo KHSX và đóng thông báo chờ', async () => {
      items[0].stages = [{ stageType: 'FRAME_HAN', deadline: day('2026-11-12') }];
      items[1].stages = [{ stageType: 'FRAME_HAN', deadline: day('2026-11-12') }];
      await service.decide(BOSS, '50', {
        approveRequestIds: ['501'],
        rejectReason: 'Không kịp xưởng',
      });
      expect(writer.applyItemDeadlines).toHaveBeenCalledTimes(1);
      expect(writer.applyItemDeadlines.mock.calls[0][1]).toBe(21n);
      expect(prisma.deadlineChangeRequest.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [501n] } },
        data: expect.objectContaining({ status: 'APPROVED' }) as unknown,
      });
      expect(prisma.deadlineChangeRequest.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [502n] } },
        data: expect.objectContaining({ status: 'REJECTED' }) as unknown,
      });
      expect(prisma.deadlineChangeBatch.update).toHaveBeenCalledWith({
        where: { id: 50n },
        data: expect.objectContaining({
          status: 'DECIDED',
          decidedById: 'boss-1',
          decisionNote: 'Không kịp xưởng',
        }) as unknown,
      });
      expect(writer.auditAndNotifyDeadlineChange).toHaveBeenCalledWith(
        'PI-7',
        expect.anything(),
        expect.anything(),
        'Sếp đã duyệt',
      );
      expect(notifications.emit).toHaveBeenCalledWith(
        'DEADLINE_CHANGE_DECIDED',
        expect.objectContaining({
          params: expect.objectContaining({
            total: 2,
            approved: 1,
            rejected: 1,
            requestedById: 'khsx-1',
          }) as unknown,
        }),
      );
      expect(notifications.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'DEADLINE_CHANGE_BATCH', entityId: '50' }),
      );
    });

    it('duyệt yêu cầu của lệnh đã bắt đầu sản xuất → 409, nêu lệnh + SKU (Đợt 9 phần 2, Q9-3)', async () => {
      items[0].productionOrder = { floorStage: 'ACTIVE' };
      await expect(
        service.decide(BOSS, '50', { approveRequestIds: ['501', '502'] }),
      ).rejects.toThrow(
        /Lệnh MY-21 · SKU-21 đã bắt đầu sản xuất \(cắt phôi\) - không đổi mốc được nữa, hãy bỏ chọn \(từ chối\) yêu cầu này/,
      );
      expect(writer.applyItemDeadlines).not.toHaveBeenCalled();
      // từ chối thì vẫn được (không đọc lệnh SX)
      prisma.deadlineChangeBatch.findUnique
        .mockReset()
        .mockResolvedValueOnce(pendingBatch([req(501n, 21n)]))
        .mockResolvedValue(batchRow({ status: 'DECIDED' }));
      await expect(
        service.decide(BOSS, '50', { approveRequestIds: [], rejectReason: 'Lệnh đã cắt' }),
      ).resolves.toBeDefined();
    });

    it('lô đã quyết → 409', async () => {
      prisma.deadlineChangeBatch.findUnique.mockReset();
      prisma.deadlineChangeBatch.findUnique.mockResolvedValue({
        ...pendingBatch([]),
        status: 'DECIDED',
      });
      await expect(service.decide(BOSS, '50', { approveRequestIds: [] })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('cancelRequest', () => {
    const setup = (requestedById: string, siblings: { status: string }[]) => {
      prisma.deadlineChangeRequest.findUnique.mockResolvedValue({
        id: 500n,
        batchId: 50n,
        batch: { requestedById },
      });
      prisma.deadlineChangeRequest.findUniqueOrThrow.mockResolvedValue({
        id: 500n,
        status: 'PENDING',
      });
      prisma.deadlineChangeRequest.findMany = jest.fn().mockResolvedValue(siblings);
      prisma.deadlineChangeBatch.findUnique.mockResolvedValue(batchRow({ status: 'CANCELLED' }));
    };

    it('người khác (không phải người gửi / Admin) → 403', async () => {
      setup('someone-else', [{ status: 'CANCELLED' }]);
      await expect(service.cancelRequest(KHSX, '500')).rejects.toThrow(ForbiddenException);
    });

    it('huỷ yêu cầu cuối cùng của lô, chưa yêu cầu nào được quyết → lô CANCELLED + đóng thông báo chờ', async () => {
      setup(KHSX.id, [{ status: 'CANCELLED' }]);
      await service.cancelRequest(KHSX, '500');
      expect(prisma.deadlineChangeBatch.update).toHaveBeenCalledWith({
        where: { id: 50n },
        data: { status: 'CANCELLED' },
      });
      expect(notifications.resolve).toHaveBeenCalled();
    });

    it('còn yêu cầu chờ khác → lô giữ nguyên PENDING, không đóng thông báo', async () => {
      setup(KHSX.id, [{ status: 'CANCELLED' }, { status: 'PENDING' }]);
      await service.cancelRequest(KHSX, '500');
      expect(prisma.deadlineChangeBatch.update).not.toHaveBeenCalled();
      expect(notifications.resolve).not.toHaveBeenCalled();
    });

    it('có yêu cầu đã được duyệt trong lô → lô DECIDED', async () => {
      setup(KHSX.id, [{ status: 'CANCELLED' }, { status: 'APPROVED' }]);
      await service.cancelRequest(KHSX, '500');
      expect(prisma.deadlineChangeBatch.update).toHaveBeenCalledWith({
        where: { id: 50n },
        data: { status: 'DECIDED' },
      });
    });
  });

  describe('đọc', () => {
    it('listBatches: KHSX luôn lọc theo lô của mình; Sếp xem hết', async () => {
      await service.listBatches(KHSX, {});
      expect(prisma.deadlineChangeBatch.findMany.mock.calls[0][0].where).toEqual({
        status: 'PENDING',
        requestedById: 'khsx-1',
      });
      await service.listBatches(BOSS, { status: 'ALL' });
      expect(prisma.deadlineChangeBatch.findMany.mock.calls[1][0].where).toEqual({});
      await service.listBatches(BOSS, { mine: true });
      expect(prisma.deadlineChangeBatch.findMany.mock.calls[2][0].where).toEqual({
        status: 'PENDING',
        requestedById: 'boss-1',
      });
    });

    it('getBatch: KHSX khác không xem được lô của người khác → 403; DTO có counts, changes, warnings', async () => {
      prisma.deadlineChangeBatch.findUnique.mockResolvedValue(batchRow());
      await expect(
        service.getBatch({ id: 'x', roles: ['PRODUCTION_PLANNER'] }, '50'),
      ).rejects.toThrow(ForbiddenException);
      const dto = await service.getBatch(BOSS, '50');
      expect(dto.counts).toEqual({ total: 1, pending: 1, approved: 0, rejected: 0, cancelled: 0 });
      expect(dto.requestedBy).toEqual({ id: 'khsx-1', name: 'Lan Nguyễn' });
      expect(dto.requests[0]).toMatchObject({
        lenhCode: 'MY-20',
        skuCode: 'SKU-20',
        quantity: 100,
        rejectReason: null,
        changes: [{ key: 'stage.FRAME_HAN', label: 'Hàn', from: '2026-11-12', to: '2026-11-15' }],
        warnings: [],
        blockedReason: null,
      });
    });

    it('blockedReason: PI huỷ / Kết thúc / đã bắt đầu sản xuất → câu chỉ-từ-chối-được; còn lại và yêu cầu không PENDING → null', async () => {
      const mk = (id: bigint, status: string, item: FakeItem) => ({
        id,
        batchId: 50n,
        productionInvoiceItemId: item.id,
        status,
        oldValues: { 'stage.FRAME_HAN': '2026-11-12' },
        newValues: { 'stage.FRAME_HAN': '2026-11-15' },
        createdAt: new Date('2026-11-05T03:00:00.000Z'),
        decidedAt: null,
        productionInvoiceItem: item,
      });
      prisma.deadlineChangeBatch.findUnique.mockResolvedValue(
        batchRow({
          requests: [
            mk(
              1n,
              'PENDING',
              makeItem(60n, {
                productionInvoice: { id: 7n, code: 'PI-7', status: 'CANCELLED', isMerged: false },
              }),
            ),
            mk(2n, 'PENDING', approved(61n, { productionOrder: { floorStage: 'FINISHED' } })),
            mk(3n, 'PENDING', approved(62n, { productionOrder: { floorStage: 'ACTIVE' } })),
            mk(4n, 'PENDING', approved(63n, { productionOrder: { floorStage: 'PAUSED' } })),
            mk(5n, 'PENDING', approved(64n)),
            mk(6n, 'APPROVED', approved(65n, { productionOrder: { floorStage: 'ACTIVE' } })),
          ],
        }),
      );
      const dto = await service.getBatch(BOSS, '50');
      expect(dto.requests.map((r) => r.blockedReason)).toEqual([
        'Lệnh đã huỷ – chỉ từ chối được',
        'Lệnh đã Kết thúc – chỉ từ chối được',
        'Lệnh đã bắt đầu sản xuất (cắt phôi) – không đổi mốc được nữa, chỉ từ chối được',
        'Lệnh đã bắt đầu sản xuất (cắt phôi) – không đổi mốc được nữa, chỉ từ chối được',
        null,
        null,
      ]);
    });

    it('pendingByItem + countPendingBatches', async () => {
      prisma.deadlineChangeRequest.findMany.mockResolvedValue([
        {
          id: 500n,
          batchId: 50n,
          productionInvoiceItemId: 21n,
          createdAt: new Date('2026-11-05T03:00:00.000Z'),
          oldValues: { 'stage.FRAME_HAN': '2026-11-12' },
          newValues: { 'stage.FRAME_HAN': '2026-11-15' },
        },
      ]);
      const map = await service.pendingByItem([21n]);
      expect(map.get('21')).toMatchObject({ requestId: '500', batchId: '50' });
      expect(await service.countPendingBatches()).toBe(2);
    });

    it('historyOf: sửa thẳng (audit) + yêu cầu / duyệt / từ chối, mới nhất trước; bỏ audit "Sếp đã duyệt"', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        {
          createdAt: new Date('2026-11-01T01:00:00.000Z'),
          userId: 'khsx-1',
          oldValue: { 'stage.FRAME_HAN': '2026-11-10T00:00:00.000Z' },
          newValue: { 'stage.FRAME_HAN': '2026-11-12T00:00:00.000Z' },
        },
        {
          createdAt: new Date('2026-11-06T01:00:00.000Z'),
          userId: 'boss-1',
          oldValue: { 'stage.FRAME_HAN': '2026-11-12T00:00:00.000Z' },
          newValue: { 'stage.FRAME_HAN': '2026-11-15T00:00:00.000Z', _note: 'Sếp đã duyệt' },
        },
      ]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'khsx-1', firstName: 'Lan', lastName: 'Nguyễn' },
      ]);
      prisma.deadlineChangeRequest.findMany.mockResolvedValue([
        {
          id: 500n,
          createdAt: new Date('2026-11-05T03:00:00.000Z'),
          decidedAt: new Date('2026-11-06T01:00:00.000Z'),
          status: 'APPROVED',
          oldValues: { 'stage.FRAME_HAN': '2026-11-12' },
          newValues: { 'stage.FRAME_HAN': '2026-11-15' },
          batch: {
            source: 'MANUAL',
            note: null,
            decisionNote: null,
            requestedBy: { id: 'khsx-1', firstName: 'Lan', lastName: 'Nguyễn' },
            decidedBy: { id: 'boss-1', firstName: 'Sếp', lastName: 'Nhân' },
          },
        },
      ]);
      const history = await service.historyOf('21');
      expect(history.map((h) => h.kind)).toEqual(['APPROVED', 'REQUESTED', 'DIRECT']);
      expect(history[2]).toMatchObject({
        by: { id: 'khsx-1', name: 'Lan Nguyễn' },
        changes: [{ key: 'stage.FRAME_HAN', from: '2026-11-10', to: '2026-11-12' }],
      });
      expect(history[0].by).toEqual({ id: 'boss-1', name: 'Sếp Nhân' });
    });
  });
});
