import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { WorkshopScopeService } from '../../common/workshop-scope/workshop-scope.service';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { FloorAdminService } from './floor-admin.service';
import { listKcsPendingItems, type KcsPendingItem } from './kcs-pending.util';

jest.mock('./kcs-pending.util', () => ({
  ...jest.requireActual<typeof import('./kcs-pending.util')>('./kcs-pending.util'),
  listKcsPendingItems: jest.fn(),
}));
const listPending = listKcsPendingItems as jest.MockedFunction<typeof listKcsPendingItems>;

const PHU_AN = 1n;
const PHUOC_AN = 2n;

describe('FloorAdminService', () => {
  let tx: {
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
    floorQueueEntry: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
      aggregate: jest.Mock;
      deleteMany: jest.Mock;
    };
    floorReport: { count: jest.Mock };
    workstation: { update: jest.Mock };
    cutAllocation: { findMany: jest.Mock; deleteMany: jest.Mock };
    cutAllocationLog: { createMany: jest.Mock };
  };
  let prisma: {
    workstation: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    workshop: { findUnique: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock };
    warehouse: { findUnique: jest.Mock };
    productionInvoiceItem: { findMany: jest.Mock };
    user: { findUnique: jest.Mock };
    floorQueueEntry: { findMany: jest.Mock; delete: jest.Mock; findUnique: jest.Mock };
    floorReport: { count: jest.Mock };
    productionInvoice: { findUnique: jest.Mock; findMany: jest.Mock };
    productionOrder: { findMany: jest.Mock; count: jest.Mock };
    productionBatch: { groupBy: jest.Mock };
    cutBundle: { count: jest.Mock };
    stepBatch: { findMany: jest.Mock };
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
    baseRequired?: number;
    extraNeed?: number;
    shortQty?: number;
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
        create: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _max: { position: null } }),
        // PH3 19/11: bỏ khỏi hàng đợi = xoá có điều kiện QUEUED trong khoá hàng đợi
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      floorReport: { count: jest.fn().mockResolvedValue(0) },
      workstation: {
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
      cutAllocation: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
      cutAllocationLog: { createMany: jest.fn() },
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
      workshop: {
        findUnique: jest.fn().mockResolvedValue({ id: 5n, isActive: true }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: PHU_AN }),
      },
      // Kho gốc 'phoi-son-han' thuộc Phú An -> xưởng mặc định của PI chưa có xưởng.
      warehouse: { findUnique: jest.fn().mockResolvedValue({ workshopId: PHU_AN }) },
      productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findUnique: jest.fn().mockResolvedValue({ workshopId: null, workshop: null }) },
      floorQueueEntry: {
        findMany: jest.fn().mockResolvedValue([]),
        delete: jest.fn(),
        findUnique: jest.fn(),
      },
      floorReport: { count: jest.fn().mockResolvedValue(0) },
      productionInvoice: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      productionOrder: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      productionBatch: { groupBy: jest.fn().mockResolvedValue([]) },
      cutBundle: { count: jest.fn().mockResolvedValue(0) },
      stepBatch: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    steelIssues = { getPhoiProgressBatch: jest.fn().mockResolvedValue({ 45: [] }) };
    productionBatches = { getBatchPlanBatch: jest.fn() };
    service = new FloorAdminService(
      prisma as unknown as PrismaServiceType,
      steelIssues as unknown as SteelIssuesService,
      productionBatches as unknown as ProductionBatchesService,
      new WorkshopScopeService(prisma as unknown as PrismaServiceType),
    );
  });

  /** QLSX gắn xưởng `id` (Phước An có paintWorkshop = Phú An). */
  const scopedTo = (id: bigint, name: string, paintsFor: bigint[] = []) =>
    prisma.user.findUnique.mockResolvedValue({
      workshopId: id,
      workshop: { name, paintsFor: paintsFor.map((x) => ({ id: x })) },
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

    it('máy cắt: thiếu loại -> mặc định laser; gửi tu_dong -> giữ tu_dong; có xưởng -> ghi xưởng', async () => {
      const def = await service.createWorkstation({
        code: 'C1',
        name: 'x',
        stage: 'PHOI',
        kind: 'CUT',
      });
      expect(def.cutMachineType).toBe('laser');
      expect(def.workshopId).toBeNull();
      const auto = await service.createWorkstation({
        code: 'C2',
        name: 'x',
        stage: 'PHOI',
        kind: 'CUT',
        cutMachineType: 'tu_dong',
        workshopId: '5',
      });
      expect(auto.cutMachineType).toBe('tu_dong');
      const data = (prisma.workstation.create.mock.calls as unknown[][])[1][0] as {
        data: { workshopId: bigint };
      };
      expect(data.data.workshopId).toBe(5n);
    });

    it('máy không phải máy cắt: gửi loại máy cắt -> 400; ghi cutMachineType = null', async () => {
      await expect(
        service.createWorkstation({
          code: 'U1',
          name: 'x',
          stage: 'PHOI',
          kind: 'STEP',
          processStep: 'UON',
          cutMachineType: 'laser',
        }),
      ).rejects.toThrow(/máy cắt/);
      expect(prisma.workstation.create).not.toHaveBeenCalled();
      const ok = await service.createWorkstation({
        code: 'P1',
        name: 'x',
        stage: 'HAN',
        kind: 'PIECE',
      });
      expect(ok.cutMachineType).toBeNull();
    });

    it('xưởng không tồn tại hoặc đã ngừng -> 400, không tạo máy', async () => {
      const dto = { code: 'C3', name: 'x', stage: 'PHOI', kind: 'CUT', workshopId: '5' } as const;
      prisma.workshop.findUnique.mockResolvedValueOnce(null);
      await expect(service.createWorkstation(dto)).rejects.toThrow(/không tồn tại/);
      prisma.workshop.findUnique.mockResolvedValueOnce({ id: 5n, isActive: false });
      await expect(service.createWorkstation(dto)).rejects.toThrow(/ngừng hoạt động/);
      expect(prisma.workstation.create).not.toHaveBeenCalled();
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
        where: {},
        orderBy: [{ stage: 'asc' }, { code: 'asc' }],
        include: { workshop: { select: { name: true } } },
      });
    });

    it('danh sách trả tên xưởng + loại máy cắt (null khi chưa gán)', async () => {
      prisma.workstation.findMany.mockResolvedValueOnce([
        {
          id: 1n,
          code: 'C1',
          name: 'x',
          stage: 'PHOI',
          kind: 'CUT',
          processStep: null,
          qrToken: 't',
          isActive: true,
          createdAt: new Date(),
          workshopId: 5n,
          cutMachineType: 'tu_dong',
          workshop: { name: 'Phước An' },
        },
        {
          id: 2n,
          code: 'P1',
          name: 'y',
          stage: 'HAN',
          kind: 'PIECE',
          processStep: null,
          qrToken: 't2',
          isActive: true,
          createdAt: new Date(),
          workshopId: null,
          cutMachineType: null,
          workshop: null,
        },
      ]);
      const rows = await service.listWorkstations();
      expect(rows[0]).toMatchObject({
        workshopId: '5',
        workshopName: 'Phước An',
        cutMachineType: 'tu_dong',
      });
      expect(rows[1]).toMatchObject({ workshopId: null, workshopName: null, cutMachineType: null });
    });

    it('sửa: đổi loại máy cắt, đổi/bỏ xưởng', async () => {
      prisma.workstation.findUnique.mockResolvedValue({ id: 1n, kind: 'CUT' });
      await service.updateWorkstation('1', { cutMachineType: 'tu_dong', workshopId: '5' });
      const first = (prisma.workstation.update.mock.calls as unknown[][]).at(-1)![0] as {
        data: { cutMachineType: string; workshopId: bigint };
      };
      expect(first.data).toMatchObject({ cutMachineType: 'tu_dong', workshopId: 5n });
      await service.updateWorkstation('1', { workshopId: null });
      const last = (prisma.workstation.update.mock.calls as unknown[][]).at(-1)![0] as {
        data: { workshopId: unknown };
      };
      expect(last.data.workshopId).toBeNull();
      await service.updateWorkstation('1', { name: 'chỉ đổi tên' });
      const keep = (prisma.workstation.update.mock.calls as unknown[][]).at(-1)![0] as {
        data: { workshopId: unknown };
      };
      expect(keep.data.workshopId).toBeUndefined(); // không gửi = giữ nguyên
    });

    it('sửa: đổi loại máy cắt trên máy không phải CUT -> 400; xưởng ngừng -> 400', async () => {
      prisma.workstation.findUnique.mockResolvedValue({ id: 1n, kind: 'STEP' });
      await expect(service.updateWorkstation('1', { cutMachineType: 'laser' })).rejects.toThrow(
        BadRequestException,
      );
      prisma.workshop.findUnique.mockResolvedValueOnce({ id: 5n, isActive: false });
      await expect(service.updateWorkstation('1', { workshopId: '5' })).rejects.toThrow(
        /ngừng hoạt động/,
      );
      expect(prisma.workstation.update).not.toHaveBeenCalled();
    });

    it('sửa: tên được cắt khoảng trắng, bật/tắt máy; id không tồn tại -> 404, không sửa', async () => {
      const w = await service.updateWorkstation('1', { name: '  Máy laser mới ', isActive: false });
      expect(prisma.workstation.update).toHaveBeenCalledWith({
        where: { id: 1n },
        data: { name: 'Máy laser mới', isActive: false },
        include: { workshop: { select: { name: true } } },
      });
      expect(w).toMatchObject({ name: 'Máy laser mới', isActive: false });

      prisma.workstation.update.mockClear();
      prisma.workstation.findUnique.mockResolvedValue(null);
      await expect(service.updateWorkstation('9', { name: 'x' })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.workstation.update).not.toHaveBeenCalled();
    });

    describe('máy cắt tắt / đổi xưởng: xoá dòng chia của máy cùng transaction', () => {
      const cutRows = [
        {
          id: 11n,
          workshopId: 5n,
          workstationId: 1n,
          productionInvoiceId: 100n,
          patternId: 200n,
          barCount: 4,
          pattern: { bundles: null },
        },
        {
          id: 12n,
          workshopId: 5n,
          workstationId: 1n,
          productionInvoiceId: 101n,
          patternId: 201n,
          barCount: 2,
          pattern: { bundles: { '16': 3 } },
        },
      ];
      const lockedKeys = () => JSON.stringify(tx.$executeRaw.mock.calls);

      beforeEach(() => {
        prisma.workstation.findUnique.mockResolvedValue({
          id: 1n,
          kind: 'CUT',
          isActive: true,
          workshopId: 5n,
        });
        tx.cutAllocation.findMany.mockResolvedValue(cutRows);
      });

      it('tắt máy cắt: khoá xưởng, ghi nhật ký REMOVE từng dòng, xoá dòng, rồi tắt máy', async () => {
        const w = await service.updateWorkstation('1', { isActive: false }, 'u1');
        expect(lockedKeys()).toContain('cut-allocation:5');
        expect(tx.cutAllocationLog.createMany).toHaveBeenCalledTimes(1);
        const logs = (tx.cutAllocationLog.createMany.mock.calls[0] as [{ data: unknown[] }])[0]
          .data;
        expect(logs).toEqual([
          expect.objectContaining({
            action: 'REMOVE',
            cutAllocationId: 11n,
            fromWorkstationId: 1n,
            barCount: 4,
            isBundle: false,
            note: 'Máy cắt bị tắt',
            createdById: 'u1',
          }),
          expect.objectContaining({ cutAllocationId: 12n, isBundle: true, barCount: 2 }),
        ]);
        expect(tx.cutAllocation.deleteMany).toHaveBeenCalledWith({ where: { workstationId: 1n } });
        expect(tx.workstation.update).toHaveBeenCalledTimes(1);
        expect(prisma.workstation.update).not.toHaveBeenCalled();
        expect(w.isActive).toBe(false);
      });

      it('đổi xưởng máy cắt: cũng xoá dòng chia, ghi lý do đổi xưởng', async () => {
        await service.updateWorkstation('1', { workshopId: '7' }, 'u1');
        expect(tx.cutAllocation.deleteMany).toHaveBeenCalledWith({ where: { workstationId: 1n } });
        const logs = (tx.cutAllocationLog.createMany.mock.calls[0] as [{ data: unknown[] }])[0]
          .data;
        expect(logs[0]).toMatchObject({ note: 'Máy cắt đổi xưởng' });
        expect(tx.workstation.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ workshopId: 7n }) as unknown }),
        );
      });

      it('lỗi khi xoá dòng chia -> không tắt máy (cùng transaction)', async () => {
        tx.cutAllocation.deleteMany.mockRejectedValue(new Error('db'));
        await expect(service.updateWorkstation('1', { isActive: false }, 'u1')).rejects.toThrow(
          'db',
        );
        expect(tx.workstation.update).not.toHaveBeenCalled();
      });

      it('chỉ đổi tên / bật máy / đổi xưởng về đúng xưởng cũ: không đụng dòng chia', async () => {
        await service.updateWorkstation('1', { name: 'Tên mới' }, 'u1');
        await service.updateWorkstation('1', { isActive: true }, 'u1');
        await service.updateWorkstation('1', { workshopId: '5' }, 'u1');
        expect(tx.cutAllocation.deleteMany).not.toHaveBeenCalled();
        expect(prisma.workstation.update).toHaveBeenCalledTimes(3);
      });

      it('máy không phải máy cắt (STEP) tắt: không đụng dòng chia', async () => {
        prisma.workstation.findUnique.mockResolvedValue({
          id: 1n,
          kind: 'STEP',
          isActive: true,
          workshopId: 5n,
        });
        await service.updateWorkstation('1', { isActive: false }, 'u1');
        expect(tx.cutAllocation.deleteMany).not.toHaveBeenCalled();
      });

      it('tắt / đổi xưởng máy cắt: transaction dùng maxWait 10 giây, timeout 30 giây (như chỗ khác giữ khoá cut-allocation)', async () => {
        await service.updateWorkstation('1', { isActive: false }, 'u1');
        expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
          maxWait: 10_000,
          timeout: 30_000,
        });
      });

      it('bật lại máy cắt còn dòng chia: khoá xưởng, xoá dòng cũ, ghi nhật ký REMOVE kèm lý do', async () => {
        prisma.workstation.findUnique.mockResolvedValue({
          id: 1n,
          kind: 'CUT',
          isActive: false,
          workshopId: 5n,
        });
        const w = await service.updateWorkstation('1', { isActive: true }, 'u1');
        expect(lockedKeys()).toContain('cut-allocation:5');
        expect(tx.cutAllocation.deleteMany).toHaveBeenCalledWith({ where: { workstationId: 1n } });
        const logs = (tx.cutAllocationLog.createMany.mock.calls[0] as [{ data: unknown[] }])[0]
          .data;
        expect(logs).toHaveLength(2);
        expect(logs[0]).toMatchObject({
          action: 'REMOVE',
          note: 'Dọn dòng cũ khi bật lại máy',
          createdById: 'u1',
        });
        expect(tx.workstation.update).toHaveBeenCalledTimes(1);
        expect(w.isActive).toBe(true);
      });

      it('bật lại máy cắt không có dòng chia: bật được, không ghi nhật ký', async () => {
        prisma.workstation.findUnique.mockResolvedValue({
          id: 1n,
          kind: 'CUT',
          isActive: false,
          workshopId: 5n,
        });
        tx.cutAllocation.findMany.mockResolvedValue([]);
        await service.updateWorkstation('1', { isActive: true }, 'u1');
        expect(tx.cutAllocationLog.createMany).not.toHaveBeenCalled();
        expect(tx.cutAllocation.deleteMany).not.toHaveBeenCalled();
        expect(tx.workstation.update).toHaveBeenCalledTimes(1);
      });

      it('máy cắt không có dòng chia: vẫn tắt được, không ghi nhật ký', async () => {
        tx.cutAllocation.findMany.mockResolvedValue([]);
        await service.updateWorkstation('1', { isActive: false }, 'u1');
        expect(tx.cutAllocationLog.createMany).not.toHaveBeenCalled();
        expect(tx.workstation.update).toHaveBeenCalledTimes(1);
      });
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

  describe('X4 16/11: máy theo xưởng của QLSX', () => {
    const scopedTo = (workshopId: bigint) =>
      prisma.user.findUnique.mockResolvedValue({
        workshopId,
        workshop: { name: `Xưởng ${workshopId}`, paintsFor: [] },
      });

    it('danh sách: QLSX gắn xưởng chỉ thấy máy xưởng mình + máy chưa khai xưởng', async () => {
      scopedTo(1n);
      await service.listWorkstations('qlsx-1');
      expect(prisma.workstation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { OR: [{ workshopId: 1n }, { workshopId: null }] } }),
      );
    });

    it('tạo: không chọn xưởng -> gán xưởng mình; chọn xưởng khác -> 403, không tạo', async () => {
      scopedTo(1n);
      const dto = { code: 'L9', name: 'x', stage: 'PHOI', kind: 'CUT' } as const;
      await service.createWorkstation(dto, 'qlsx-1');
      expect(prisma.workstation.create).toHaveBeenCalledWith(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- matcher của jest
        expect.objectContaining({ data: expect.objectContaining({ workshopId: 1n }) }),
      );
      prisma.workstation.create.mockClear();
      await expect(
        service.createWorkstation({ ...dto, workshopId: '5' }, 'qlsx-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.workstation.create).not.toHaveBeenCalled();
    });

    it('sửa / đổi mã QR máy của xưởng khác -> 403; bỏ xưởng của máy -> 403; không ghi gì', async () => {
      scopedTo(1n);
      prisma.workstation.findUnique.mockResolvedValue({ id: 1n, kind: 'CUT', workshopId: 2n });
      await expect(service.updateWorkstation('1', { name: 'x' }, 'qlsx-1')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.regenerateWorkstationToken('1', 'qlsx-1')).rejects.toThrow(
        ForbiddenException,
      );
      prisma.workstation.findUnique.mockResolvedValue({ id: 1n, kind: 'CUT', workshopId: 1n });
      await expect(service.updateWorkstation('1', { workshopId: null }, 'qlsx-1')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.updateWorkstation('1', { workshopId: '5' }, 'qlsx-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.workstation.update).not.toHaveBeenCalled();
    });

    it('máy xưởng mình hoặc chưa khai xưởng: sửa được', async () => {
      scopedTo(1n);
      prisma.workstation.findUnique.mockResolvedValue({ id: 1n, kind: 'CUT', workshopId: null });
      await service.updateWorkstation('1', { name: 'x' }, 'qlsx-1');
      expect(prisma.workstation.update).toHaveBeenCalled();
    });
  });

  describe('advance ("Chuyển PI tiếp")', () => {
    it('PI đang chạy -> DONE, PI đầu hàng đợi -> RUNNING', async () => {
      tx.floorQueueEntry.findFirst
        .mockResolvedValueOnce({ id: 1n, status: 'RUNNING' })
        .mockResolvedValueOnce({ id: 2n, status: 'QUEUED' });

      await service.advance('PHOI', 'qlsx-1', '1');

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
      await expect(service.advance('HAN', 'q', '1')).rejects.toThrow(ConflictException);
    });

    describe('expectedRunningPiId (màn QLSX cũ không đóng nhầm lệnh kế)', () => {
      const MSG =
        'Lệnh đang chạy của tổ Phôi đã đổi (hệ thống có thể vừa tự chuyển) - tải lại màn rồi xem lại';
      const running = (piId: bigint) => ({ id: 1n, status: 'RUNNING', productionInvoiceId: piId });

      it('khớp lệnh đang chạy -> chạy như cũ', async () => {
        tx.floorQueueEntry.findFirst
          .mockResolvedValueOnce(running(10n))
          .mockResolvedValueOnce({ id: 2n, status: 'QUEUED' });
        await service.advance('PHOI', 'q', '1', '10');
        expect(tx.floorQueueEntry.update).toHaveBeenCalledTimes(2);
      });

      it('khác lệnh đang chạy (hệ thống vừa tự chuyển) -> 409 đúng câu, không dòng nào đổi', async () => {
        tx.floorQueueEntry.findFirst
          .mockResolvedValueOnce(running(11n))
          .mockResolvedValueOnce({ id: 3n, status: 'QUEUED' });
        const call = service.advance('PHOI', 'q', '1', '10');
        await expect(call).rejects.toThrow(ConflictException);
        await expect(call).rejects.toThrow(MSG);
        expect(tx.floorQueueEntry.update).not.toHaveBeenCalled();
      });

      it('câu 409 ghi đúng tên tổ Hàn / Sơn', async () => {
        tx.floorQueueEntry.findFirst.mockResolvedValue(null);
        await expect(service.advance('HAN', 'q', '1', '10')).rejects.toThrow(
          /^Lệnh đang chạy của tổ Hàn đã đổi/,
        );
        await expect(service.advance('SON', 'q', '1', '10')).rejects.toThrow(
          /^Lệnh đang chạy của tổ Sơn đã đổi/,
        );
      });

      it('có truyền mà tổ không có lệnh RUNNING -> 409', async () => {
        tx.floorQueueEntry.findFirst
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 2n, status: 'QUEUED' });
        await expect(service.advance('PHOI', 'q', '1', '10')).rejects.toThrow(MSG);
        expect(tx.floorQueueEntry.update).not.toHaveBeenCalled();
      });

      it('null (màn thấy tổ chưa chạy lệnh nào) mà đã có lệnh chạy -> 409, không đóng nhầm', async () => {
        tx.floorQueueEntry.findFirst
          .mockResolvedValueOnce(running(10n))
          .mockResolvedValueOnce({ id: 2n, status: 'QUEUED' });
        await expect(service.advance('PHOI', 'q', '1', null)).rejects.toThrow(MSG);
        expect(tx.floorQueueEntry.update).not.toHaveBeenCalled();
      });

      it('null và đúng là chưa có lệnh chạy -> bắt đầu lệnh đầu hàng đợi', async () => {
        tx.floorQueueEntry.findFirst
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 2n, status: 'QUEUED' });
        await service.advance('PHOI', 'q', '1', null);
        expect(tx.floorQueueEntry.update).toHaveBeenCalledTimes(1);
      });

      it('việc so khớp nằm SAU khoá hàng đợi (lockBusinessKey) và trong transaction', async () => {
        const order: string[] = [];
        tx.$executeRaw.mockImplementation(() => {
          order.push('lock');
          return Promise.resolve(0);
        });
        tx.floorQueueEntry.findFirst.mockImplementation(() => {
          order.push('read');
          return Promise.resolve(running(11n));
        });
        await expect(service.advance('PHOI', 'q', '1', '10')).rejects.toThrow(ConflictException);
        expect(order[0]).toBe('lock');
        expect(order).toContain('read');
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('autoCompletePhoi (xong Phôi tự tính, Sếp chốt 14/11 câu 8)', () => {
    const phoi = (status: string) => ({ id: 1n, stage: 'PHOI', workshopId: 2n, status });
    const lockedKey = () => JSON.stringify((tx.$executeRaw.mock.calls as unknown[][])[0] ?? []);

    it('dòng RUNNING -> DONE (endedById null), PI đầu hàng đợi của đúng xưởng -> RUNNING', async () => {
      prisma.floorQueueEntry.findUnique.mockResolvedValue(phoi('RUNNING'));
      tx.floorQueueEntry.findUnique.mockResolvedValue(phoi('RUNNING'));
      tx.floorQueueEntry.findFirst.mockResolvedValue({
        id: 7n,
        productionInvoice: { code: 'PI-77' },
      });

      const r = await service.autoCompletePhoi(1n);

      expect(r).toEqual({ closed: true, nextPiCode: 'PI-77' });
      expect(lockedKey()).toContain('floor-queue:PHOI:2');
      expect(tx.floorQueueEntry.update).toHaveBeenNthCalledWith(1, {
        where: { id: 1n },
        data: expect.objectContaining({ status: 'DONE', endedById: null }) as unknown,
      });
      expect(tx.floorQueueEntry.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { stage: 'PHOI', workshopId: 2n, status: 'QUEUED' },
        }) as unknown,
      );
      expect(tx.floorQueueEntry.update).toHaveBeenNthCalledWith(2, {
        where: { id: 7n },
        data: expect.objectContaining({ status: 'RUNNING', startedById: null }) as unknown,
      });
    });

    it('RUNNING nhưng hàng đợi không còn PI chờ -> chỉ đóng', async () => {
      prisma.floorQueueEntry.findUnique.mockResolvedValue(phoi('RUNNING'));
      tx.floorQueueEntry.findUnique.mockResolvedValue(phoi('RUNNING'));
      tx.floorQueueEntry.findFirst.mockResolvedValue(null);
      expect(await service.autoCompletePhoi(1n)).toEqual({ closed: true, nextPiCode: null });
      expect(tx.floorQueueEntry.update).toHaveBeenCalledTimes(1);
    });

    it('dòng QUEUED -> DONE, không kéo PI khác lên chạy', async () => {
      prisma.floorQueueEntry.findUnique.mockResolvedValue(phoi('QUEUED'));
      tx.floorQueueEntry.findUnique.mockResolvedValue(phoi('QUEUED'));
      expect(await service.autoCompletePhoi(1n)).toEqual({ closed: true, nextPiCode: null });
      expect(tx.floorQueueEntry.update).toHaveBeenCalledTimes(1);
      expect(tx.floorQueueEntry.update).toHaveBeenCalledWith({
        where: { id: 1n },
        data: expect.objectContaining({ status: 'DONE', endedById: null }) as unknown,
      });
      expect(tx.floorQueueEntry.findFirst).not.toHaveBeenCalled();
    });

    it('gọi lại khi đã DONE (hoặc dòng không còn) -> không làm gì', async () => {
      prisma.floorQueueEntry.findUnique.mockResolvedValue(phoi('RUNNING'));
      tx.floorQueueEntry.findUnique.mockResolvedValue(phoi('DONE'));
      expect(await service.autoCompletePhoi(1n)).toEqual({ closed: false, nextPiCode: null });
      expect(tx.floorQueueEntry.update).not.toHaveBeenCalled();
    });

    it('tổ không phải Phôi -> không mở transaction', async () => {
      prisma.floorQueueEntry.findUnique.mockResolvedValue({ ...phoi('RUNNING'), stage: 'HAN' });
      expect(await service.autoCompletePhoi(1n)).toEqual({ closed: false, nextPiCode: null });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('ensurePhoiQueued (máy cắt rảnh tự kéo lệnh, đợt C3)', () => {
    beforeEach(() => {
      prisma.productionInvoice.findUnique.mockResolvedValue({ code: 'PI-77' });
    });

    it('lệnh chưa có dòng hàng đợi Phôi -> thêm QUEUED cuối hàng, queuedById null', async () => {
      tx.floorQueueEntry.findUnique.mockResolvedValue(null);
      tx.floorQueueEntry.aggregate.mockResolvedValue({ _max: { position: 4 } });

      const added = await service.ensurePhoiQueued([77n, 77n]);

      expect(added).toEqual(['PI-77']);
      expect(tx.floorQueueEntry.create).toHaveBeenCalledTimes(1);
      expect(tx.floorQueueEntry.create).toHaveBeenCalledWith({
        data: {
          stage: 'PHOI',
          productionInvoiceId: 77n,
          workshopId: PHU_AN,
          position: 5,
          queuedById: null,
        },
      });
      expect(JSON.stringify((tx.$executeRaw.mock.calls as unknown[][])[0] ?? [])).toContain(
        `floor-queue:PHOI:${PHU_AN}`,
      );
    });

    it('3 lệnh, lệnh giữa lỗi -> lệnh cuối vẫn được xếp, rồi ném lỗi tổng hợp', async () => {
      prisma.productionInvoice.findUnique.mockImplementation(
        ({ where }: { where: { id: bigint } }) => {
          if (where.id === 2n) return Promise.reject(new Error('db'));
          return Promise.resolve({ code: `PI-${where.id}` });
        },
      );
      tx.floorQueueEntry.findUnique.mockResolvedValue(null);
      tx.floorQueueEntry.aggregate.mockResolvedValue({ _max: { position: 0 } });

      await expect(service.ensurePhoiQueued([1n, 2n, 3n])).rejects.toThrow('2');

      expect(tx.floorQueueEntry.create).toHaveBeenCalledTimes(2);
      const ids = (
        tx.floorQueueEntry.create.mock.calls as [{ data: { productionInvoiceId: bigint } }][]
      ).map((c) => c[0].data.productionInvoiceId);
      expect(ids).toEqual([1n, 3n]);
    });

    it('đã có dòng (bất kỳ trạng thái) -> bỏ qua', async () => {
      tx.floorQueueEntry.findUnique.mockResolvedValue({ id: 3n });
      expect(await service.ensurePhoiQueued([77n])).toEqual([]);
      expect(tx.floorQueueEntry.create).not.toHaveBeenCalled();
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

      await service.reopenLast('q', 'PHOI', '1');

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

      await service.reopenLast('q', 'HAN', '1');

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

      const err = await service.reopenLast('q', 'PHOI', '1').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as Error).message).toContain('PI-B đã có 3 lần báo');
      expect((err as Error).message).toContain('Bù lỗi');
      expect(tx.floorQueueEntry.update).not.toHaveBeenCalled();
    });

    it('chưa chuyển PI nào -> 409', async () => {
      tx.floorQueueEntry.findFirst.mockResolvedValueOnce(null);
      await expect(service.reopenLast('q', 'SON', '1')).rejects.toThrow(ConflictException);
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

    it('dòng mới mang xưởng của PI; vị trí = max trong CÙNG (tổ, xưởng) + 1; khoá theo (tổ, xưởng)', async () => {
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        { productionInvoiceId: 45n, workshopId: PHUOC_AN },
      ]);
      tx.floorQueueEntry.findUnique.mockResolvedValue(null);
      tx.floorQueueEntry.aggregate.mockResolvedValue({ _max: { position: 4 } });

      await service.enqueue('PHOI', '45', 'q');

      expect(tx.floorQueueEntry.aggregate).toHaveBeenCalledWith({
        where: { stage: 'PHOI', workshopId: PHUOC_AN },
        _max: { position: true },
      });
      expect(tx.floorQueueEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          stage: 'PHOI',
          productionInvoiceId: 45n,
          workshopId: PHUOC_AN,
          position: 5,
        }) as unknown,
      });
      expect(tx.$executeRaw).toHaveBeenCalled();
    });

    it('Sơn của Phước An vào hàng đợi Phú An (nơi sơn)', async () => {
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        { productionInvoiceId: 45n, workshopId: PHUOC_AN },
      ]);
      prisma.workshop.findMany.mockResolvedValue([{ id: PHUOC_AN, paintWorkshopId: PHU_AN }]);
      tx.floorQueueEntry.findUnique.mockResolvedValue(null);

      await service.enqueue('SON', '45', 'q');

      expect(tx.floorQueueEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ stage: 'SON', workshopId: PHU_AN }) as unknown,
      });
    });

    it('PI chưa có xưởng -> xưởng mặc định (xưởng của kho phoi-son-han)', async () => {
      tx.floorQueueEntry.findUnique.mockResolvedValue(null);
      await service.enqueue('HAN', '45', 'q');
      expect(tx.floorQueueEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ workshopId: PHU_AN }) as unknown,
      });
    });

    it('QLSX gắn xưởng khác xưởng hàng đợi của PI -> 403, không ghi', async () => {
      scopedTo(PHU_AN, 'Phú An');
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        { productionInvoiceId: 45n, workshopId: PHUOC_AN },
      ]);
      await expect(service.enqueue('PHOI', '45', 'q')).rejects.toThrow(ForbiddenException);
      expect(tx.floorQueueEntry.create).not.toHaveBeenCalled();
    });
  });

  describe('hàng đợi theo xưởng (đợt C1)', () => {
    it('advance: chỉ tác động hàng đợi của đúng xưởng (khoá + truy vấn theo xưởng)', async () => {
      tx.floorQueueEntry.findFirst
        .mockResolvedValueOnce({ id: 1n, status: 'RUNNING' })
        .mockResolvedValueOnce({ id: 2n, status: 'QUEUED' });

      await service.advance('PHOI', 'q', '2');

      expect(tx.floorQueueEntry.findFirst).toHaveBeenNthCalledWith(1, {
        where: { stage: 'PHOI', workshopId: PHUOC_AN, status: 'RUNNING' },
      });
      expect(tx.floorQueueEntry.findFirst).toHaveBeenNthCalledWith(2, {
        where: { stage: 'PHOI', workshopId: PHUOC_AN, status: 'QUEUED' },
        orderBy: { position: 'asc' },
      });
    });

    it('người không gắn xưởng thiếu workshopId -> 400 "Chọn xưởng" (advance và reopen), không mở transaction', async () => {
      await expect(service.advance('PHOI', 'q')).rejects.toThrow(
        new BadRequestException('Chọn xưởng'),
      );
      await expect(service.reopenLast('q', 'PHOI')).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('QLSX gắn xưởng: mặc định xưởng mình; gọi xưởng khác -> 403', async () => {
      scopedTo(PHU_AN, 'Phú An');
      tx.floorQueueEntry.findFirst.mockResolvedValue(null);
      await expect(service.advance('PHOI', 'q')).rejects.toThrow(ConflictException); // hàng đợi trống = đã chạy vào xưởng mình
      expect(tx.floorQueueEntry.findFirst).toHaveBeenCalledWith({
        where: { stage: 'PHOI', workshopId: PHU_AN, status: 'RUNNING' },
      });
      await expect(service.advance('PHOI', 'q', '2')).rejects.toThrow(ForbiddenException);
      await expect(service.reopenLast('q', 'PHOI', '2')).rejects.toThrow(ForbiddenException);
    });

    it('listQueue: QLSX gắn xưởng luôn lọc xưởng mình, truyền xưởng khác -> 403; không gắn xưởng không truyền = mọi xưởng', async () => {
      scopedTo(PHUOC_AN, 'Phước An');
      await service.listQueue('q', 'PHOI');
      expect(prisma.floorQueueEntry.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { stage: 'PHOI', workshopId: PHUOC_AN },
        }) as unknown,
      );
      await expect(service.listQueue('q', 'PHOI', '1')).rejects.toThrow(ForbiddenException);

      prisma.user.findUnique.mockResolvedValue({ workshopId: null, workshop: null });
      await service.listQueue('q', 'PHOI');
      expect(prisma.floorQueueEntry.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { stage: 'PHOI' } }) as unknown,
      );
      await service.listQueue('q', 'PHOI', '2');
      expect(prisma.floorQueueEntry.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { stage: 'PHOI', workshopId: 2n } }) as unknown,
      );
    });

    it('dòng trả về có workshopId + workshopName', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([
        {
          id: 1n,
          stage: 'PHOI',
          status: 'QUEUED',
          productionInvoiceId: 45n,
          workshopId: PHUOC_AN,
          workshop: { id: PHUOC_AN, name: 'Phước An' },
          position: 1,
          queuedAt: new Date(),
          startedAt: null,
          endedAt: null,
          productionInvoice: { id: 45n, code: 'PI-45' },
          startedBy: null,
          endedBy: null,
        },
      ]);
      const [e] = await service.listQueue('q', 'PHOI');
      expect(e).toMatchObject({ workshopId: '2', workshopName: 'Phước An' });
    });

    it('reorder: các dòng khác xưởng -> 400; QLSX xưởng khác -> 403; so khớp đúng QUEUED của (tổ, xưởng)', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([
        { id: 3n, stage: 'PHOI', workshopId: PHU_AN },
        { id: 2n, stage: 'PHOI', workshopId: PHUOC_AN },
      ]);
      await expect(service.reorder('q', 'PHOI', ['3', '2'])).rejects.toThrow(BadRequestException);

      const phuocAnRows = [
        { id: 3n, stage: 'PHOI', workshopId: PHUOC_AN },
        { id: 2n, stage: 'PHOI', workshopId: PHUOC_AN },
      ];
      prisma.floorQueueEntry.findMany.mockResolvedValue(phuocAnRows);
      scopedTo(PHU_AN, 'Phú An');
      await expect(service.reorder('q', 'PHOI', ['3', '2'])).rejects.toThrow(ForbiddenException);

      prisma.user.findUnique.mockResolvedValue({ workshopId: null, workshop: null });
      prisma.floorQueueEntry.findMany.mockResolvedValueOnce(phuocAnRows);
      prisma.floorQueueEntry.findMany.mockResolvedValue([]);
      tx.floorQueueEntry.findMany.mockResolvedValue([
        { id: 2n, position: 7 },
        { id: 3n, position: 8 },
      ]);
      await service.reorder('q', 'PHOI', ['3', '2']);
      expect(tx.floorQueueEntry.findMany).toHaveBeenCalledWith({
        where: { stage: 'PHOI', workshopId: PHUOC_AN, status: 'QUEUED' },
        select: { id: true, position: true },
      });
    });

    it('removeEntry: kiểm phạm vi theo xưởng của dòng', async () => {
      prisma.floorQueueEntry.findUnique.mockResolvedValue({
        id: 3n,
        stage: 'HAN',
        status: 'QUEUED',
        workshopId: PHUOC_AN,
      });
      scopedTo(PHU_AN, 'Phú An');
      await expect(service.removeEntry('q', '3')).rejects.toThrow(ForbiddenException);
      expect(tx.floorQueueEntry.deleteMany).not.toHaveBeenCalled();

      scopedTo(PHUOC_AN, 'Phước An');
      await service.removeEntry('q', '3');
      expect(tx.floorQueueEntry.deleteMany).toHaveBeenCalledWith({
        where: { id: 3n, status: 'QUEUED' },
      });
      expect(prisma.floorQueueEntry.delete).not.toHaveBeenCalled();
    });

    it('PH3 19/11: removeEntry xoá trong khoá hàng đợi; dòng vừa thành RUNNING (xoá có điều kiện ra 0) -> 409', async () => {
      prisma.floorQueueEntry.findUnique.mockResolvedValue({
        id: 3n,
        stage: 'HAN',
        status: 'QUEUED',
        workshopId: PHUOC_AN,
      });
      scopedTo(PHUOC_AN, 'Phước An');
      tx.floorQueueEntry.deleteMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.removeEntry('q', '3')).rejects.toThrow(/vừa bắt đầu chạy/);
      // khoá nghiệp vụ của đúng hàng đợi (tổ, xưởng) lấy trước khi xoá
      const lockSql = (tx.$executeRaw.mock.calls as unknown[][])
        .concat(tx.$queryRaw.mock.calls as unknown[][])
        .map((c) => c.slice(1).join('|'));
      expect(lockSql.join(' ')).toContain('floor-queue:HAN:');
    });

    describe('queueCandidates', () => {
      const pi = (id: bigint, code: string) => ({
        id,
        code,
        deadline: null,
        items: [{ productionOrder: { floorStage: 'ACTIVE' } }],
      });

      beforeEach(() => {
        prisma.productionInvoice.findMany.mockResolvedValue([pi(10n, 'PI-A'), pi(11n, 'PI-B')]);
        prisma.productionInvoiceItem.findMany.mockResolvedValue([
          { productionInvoiceId: 10n, workshopId: PHUOC_AN },
          { productionInvoiceId: 11n, workshopId: PHU_AN },
        ]);
        prisma.workshop.findMany.mockImplementation(
          ({ where }: { where: { id: { in: bigint[] } } }) =>
            Promise.resolve(
              where.id.in.map((id) => ({
                id,
                name: id === PHU_AN ? 'Phú An' : 'Phước An',
                paintWorkshopId: id === PHUOC_AN ? PHU_AN : null,
              })),
            ),
        );
      });

      it('không gắn xưởng + không truyền xưởng: mọi PI, kèm xưởng hàng đợi', async () => {
        const rows = await service.queueCandidates('q', 'PHOI');
        expect(rows.map((r) => [r.code, r.workshopId, r.workshopName])).toEqual([
          ['PI-A', '2', 'Phước An'],
          ['PI-B', '1', 'Phú An'],
        ]);
      });

      it('lọc theo xưởng; QLSX gắn xưởng lấy xưởng mình, truyền xưởng khác -> 403', async () => {
        const phuoc = await service.queueCandidates('q', 'PHOI', '2');
        expect(phuoc.map((r) => r.code)).toEqual(['PI-A']);

        scopedTo(PHU_AN, 'Phú An');
        const mine = await service.queueCandidates('q', 'PHOI');
        expect(mine.map((r) => r.code)).toEqual(['PI-B']);
        await expect(service.queueCandidates('q', 'PHOI', '2')).rejects.toThrow(ForbiddenException);
      });

      it('tổ Sơn: PI của Phước An thuộc hàng đợi Phú An', async () => {
        const son = await service.queueCandidates('q', 'SON', '1');
        expect(son.map((r) => r.code)).toEqual(['PI-A', 'PI-B']);
        expect(son.every((r) => r.workshopId === '1')).toBe(true);
      });
    });
  });

  it('reorder: danh sách gửi lên khác tập PI đang chờ -> 409 (người khác vừa sửa)', async () => {
    tx.floorQueueEntry.findMany.mockResolvedValue([
      { id: 2n, position: 2 },
      { id: 3n, position: 3 },
    ]);
    prisma.floorQueueEntry.findMany.mockResolvedValue([
      { id: 3n, stage: 'PHOI', workshopId: PHU_AN },
      { id: 2n, stage: 'PHOI', workshopId: PHU_AN },
    ]);
    await expect(service.reorder('q', 'PHOI', ['3', '2', '9'])).rejects.toThrow(ConflictException);
    prisma.floorQueueEntry.findMany.mockResolvedValue([
      { id: 3n, stage: 'PHOI', workshopId: PHU_AN },
    ]);
    await expect(service.reorder('q', 'PHOI', ['3'])).rejects.toThrow(ConflictException);
    prisma.floorQueueEntry.findMany.mockResolvedValueOnce([
      { id: 3n, stage: 'PHOI', workshopId: PHU_AN },
      { id: 2n, stage: 'PHOI', workshopId: PHU_AN },
    ]);
    prisma.floorQueueEntry.findMany.mockResolvedValue([]);
    await service.reorder('q', 'PHOI', ['3', '2']);
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
      workshopId: PHU_AN,
      workshop: { id: PHU_AN, name: 'Phú An' },
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

      const [e] = await service.listQueue('q', 'PHOI');

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

      const [e] = await service.listQueue('q', 'PHOI');

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

    it('P1: KCS ghi thiếu đã trừ khỏi done (done = thô - thiếu), lỗi trừ tiếp -> được tính = done - lỗi; "cần" gồm cả phần cắt lại', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running('PHOI')]);
      steelIssues.getPhoiProgressBatch.mockResolvedValue({
        45: [
          {
            steelBalance: { receivedBarCount: 12 },
            // thô 100, KCS ghi thiếu 10 -> done 90; lỗi 4 -> được tính 86; cần 100 + cắt lại 3 = 103
            segments: [
              seg({
                required: 103,
                baseRequired: 100,
                extraNeed: 3,
                done: 90,
                failed: 4,
                shortQty: 10,
              }),
            ],
            steps: [],
          },
        ],
      });

      const [e] = await service.listQueue('q', 'PHOI');

      expect(e.progress).toMatchObject({
        required: 103,
        reported: 86,
        passed: 86,
        failed: 4,
        percent: 83,
        complete: false,
        missing: { lines: 1 },
      });
    });

    it('Phôi: thiếu PI trong kết quả batch (PI lỗi) → progress null, không coi là xong', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running('PHOI')]);
      steelIssues.getPhoiProgressBatch.mockResolvedValue({});

      const [e] = await service.listQueue('q', 'PHOI');

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

      const [e] = await service.listQueue('q', 'PHOI');

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

      const [e] = await service.listQueue('q', 'HAN');

      expect(steelIssues.getPhoiProgressBatch).not.toHaveBeenCalled();
      expect(e.progress).toMatchObject({
        required: 60,
        reported: 60,
        percent: 100,
        complete: true,
        missing: { lines: 0, materialsNotReceived: 0 },
      });
    });

    it('Hàn: mảnh có failedQty (KCS chấm lỗi chưa bù) -> tiến độ / còn thiếu như cũ, chỉ thêm số Lỗi', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running('HAN')]);
      prisma.productionOrder.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 41n }]);
      // Cần 40, KCS chấm đợt 10 lỗi 4 (đạt 36), chưa bù.
      productionBatches.getBatchPlanBatch.mockResolvedValue({
        '41': {
          items: [
            {
              pieceId: '73',
              plannedQty: 40,
              passedQty: 36,
              failedQty: 4,
              awaitingQcQty: 0,
              openQty: 0,
            },
          ],
        },
      });

      const [e] = await service.listQueue('q', 'HAN');

      expect(e.progress).toMatchObject({
        required: 40,
        reported: 36,
        passed: 36,
        failed: 4,
        percent: 90,
        complete: false,
        missing: { pieces: 1 },
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

      const [e] = await service.listQueue('q', 'HAN');

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
      let list = await service.listQueue('q', 'PHOI');
      expect(list.filter((e) => e.canReopen).map((e) => e.id)).toEqual(['3']);

      prisma.floorReport.count.mockResolvedValue(2);
      list = await service.listQueue('q', 'PHOI');
      expect(list.some((e) => e.canReopen)).toBe(false);
    });

    it('lỗi khi tính tiến độ không làm hỏng danh sách (progress = null)', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running('PHOI')]);
      steelIssues.getPhoiProgressBatch.mockRejectedValue(new Error('boom'));

      const [e] = await service.listQueue('q', 'PHOI');

      expect(e.progress).toBeNull();
    });
  });

  describe('summary (số đỏ menu "Sản lượng xưởng": open / awaitingKcs / stale)', () => {
    const NOW = new Date('2026-11-18T12:00:00Z');
    const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
    const item = (
      stage: 'PHOI' | 'HAN' | 'SON',
      piId: bigint | null,
      over: Partial<KcsPendingItem> = {},
    ): KcsPendingItem => ({
      stage,
      productionInvoiceId: piId,
      kind: stage === 'PHOI' ? 'CUT' : 'PIECE_BATCH',
      state: 'OPEN',
      waitingSince: hoursAgo(1),
      blockedReason: null,
      ...over,
    });

    beforeEach(() => {
      listPending.mockReset();
      listPending.mockResolvedValue([]);
    });

    it('không có đợt nào -> 0 hết, đủ 3 tổ x 3 khoá', async () => {
      const r = await service.summary(undefined, NOW);

      expect(r).toEqual({
        PHOI: { open: 0, awaitingKcs: 0, stale: 0 },
        HAN: { open: 0, awaitingKcs: 0, stale: 0 },
        SON: { open: 0, awaitingKcs: 0, stale: 0 },
      });
      expect(listPending).toHaveBeenCalledWith(prisma);
    });

    it('đếm theo tổ: open (có sổ báo) / awaitingKcs / stale (mốc quá 4 giờ, cả đang mở lẫn đã chốt)', async () => {
      listPending.mockResolvedValue([
        item('PHOI', 45n), // cắt đang mở
        item('PHOI', 45n, { kind: 'STEP', waitingSince: hoursAgo(5) }), // công đoạn phụ mở, quá hạn
        item('PHOI', 45n, { kind: 'CUT', state: 'AWAITING_QC', waitingSince: hoursAgo(6) }),
        item('PHOI', 45n, { kind: 'PIECE_BATCH' }), // lô mảnh Phôi mở
        item('HAN', 45n, { state: 'AWAITING_QC' }),
        item('SON', 45n, { waitingSince: hoursAgo(4.5) }),
      ]);

      const r = await service.summary(undefined, NOW);

      expect(r).toEqual({
        PHOI: { open: 3, awaitingKcs: 1, stale: 2 },
        HAN: { open: 0, awaitingKcs: 1, stale: 0 },
        SON: { open: 1, awaitingKcs: 0, stale: 1 },
      });
    });

    it('pat / chân nhôm: không có sổ báo nên KHÔNG vào open; đã chốt thì vào awaitingKcs; vẫn tính stale', async () => {
      listPending.mockResolvedValue([
        item('PHOI', 45n, { kind: 'PIECE_STEP', waitingSince: hoursAgo(9) }),
        item('PHOI', 45n, { kind: 'MATERIAL_YIELD' }),
        item('PHOI', 45n, { kind: 'PIECE_STEP', state: 'AWAITING_QC' }),
        item('PHOI', 45n, { kind: 'MATERIAL_YIELD', state: 'AWAITING_QC' }),
      ]);

      const r = await service.summary(undefined, NOW);

      expect(r.PHOI).toEqual({ open: 0, awaitingKcs: 2, stale: 1 });
    });

    it('dòng xám (lệnh dừng / chưa gắn SKU) không đếm vào cả 3 số (AC16)', async () => {
      listPending.mockResolvedValue([
        item('PHOI', 45n, { blockedReason: 'LENH_DUNG', waitingSince: hoursAgo(10) }),
        item('PHOI', 45n, { blockedReason: 'CHUA_GAN_SKU', kind: 'STEP' }),
        item('PHOI', 45n, { blockedReason: 'LENH_DUNG', state: 'AWAITING_QC' }),
        item('PHOI', 45n),
      ]);

      const r = await service.summary(undefined, NOW);

      expect(r.PHOI).toEqual({ open: 1, awaitingKcs: 0, stale: 0 });
    });

    it('stale lấy mốc waitingSince: đúng 4 giờ chưa tính, quá 4 giờ mới tính', async () => {
      listPending.mockResolvedValue([
        item('HAN', 45n, { waitingSince: hoursAgo(4) }),
        item('HAN', 45n, { waitingSince: new Date(hoursAgo(4).getTime() - 1) }),
      ]);

      const r = await service.summary(undefined, NOW);

      expect(r.HAN.stale).toBe(1);
    });

    it('tài khoản không gắn xưởng: không lọc, không tra xưởng của PI', async () => {
      listPending.mockResolvedValue([item('PHOI', 45n), item('PHOI', 46n)]);

      const r = await service.summary('qlsx-chung', NOW);

      expect(r.PHOI.open).toBe(2);
      expect(prisma.productionInvoiceItem.findMany).not.toHaveBeenCalled();
    });

    it('X4 16/11: QLSX gắn xưởng chỉ đếm đợt của PI thuộc xưởng mình; PI chưa suy ra xưởng thì vẫn thấy', async () => {
      prisma.user.findUnique.mockResolvedValue({
        workshopId: 1n,
        workshop: { name: 'Xưởng 1', paintsFor: [] },
      });
      // PI 45 ở xưởng 1, PI 46 ở xưởng 2; PI 47 chưa có xưởng + không có xưởng mặc định.
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        { productionInvoiceId: 45n, workshopId: 1n },
        { productionInvoiceId: 46n, workshopId: 2n },
      ]);
      listPending.mockResolvedValue([
        item('PHOI', 45n),
        item('PHOI', 46n),
        item('PHOI', 46n, { kind: 'STEP' }),
        item('PHOI', 46n, { state: 'AWAITING_QC' }),
        item('PHOI', 45n, { state: 'AWAITING_QC', waitingSince: hoursAgo(8) }),
        item('HAN', 45n),
        item('HAN', 46n),
        item('SON', 45n),
      ]);

      const r = await service.summary('qlsx-xuong-1', NOW);

      expect(r).toEqual({
        PHOI: { open: 1, awaitingKcs: 1, stale: 1 },
        HAN: { open: 1, awaitingKcs: 0, stale: 0 },
        SON: { open: 1, awaitingKcs: 0, stale: 0 },
      });
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
