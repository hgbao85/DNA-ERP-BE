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
    productionInvoice: { findUnique: jest.Mock; findMany: jest.Mock; updateMany: jest.Mock };
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
      productionInvoice: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
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

    it('21/11: không gửi tên gọi -> tên = mã (màn bỏ ô Tên gọi)', async () => {
      await service.createWorkstation({
        code: ' khoan-pa ',
        stage: 'PHOI',
        kind: 'STEP',
        processStep: 'DUC_LO',
      });
      const call = (prisma.workstation.create.mock.calls as unknown[][]).at(-1)![0] as {
        data: { code: string; name: string };
      };
      expect(call.data).toMatchObject({ code: 'KHOAN-PA', name: 'KHOAN-PA' });
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

    // 21/11/2026: đổi mã ngắn (QLSX / Admin) - tên gọi đổi theo mã; mã trùng -> 409.
    it('sửa: đổi mã -> mã viết hoa, tên = mã; không đổi qrToken', async () => {
      prisma.workstation.findUnique.mockResolvedValue({
        id: 1n,
        kind: 'STEP',
        workshopId: 1n,
        isActive: true,
      });
      await service.updateWorkstation('1', { code: ' dap-pa ' });
      const call = (prisma.workstation.update.mock.calls as unknown[][]).at(-1)![0] as {
        data: Record<string, unknown>;
      };
      expect(call.data).toMatchObject({ code: 'DAP-PA', name: 'DAP-PA' });
      expect(call.data).not.toHaveProperty('qrToken');
    });

    it('sửa: đổi sang mã máy khác đang dùng -> 409 câu rõ', async () => {
      prisma.workstation.findUnique.mockResolvedValue({
        id: 1n,
        kind: 'STEP',
        workshopId: 1n,
        isActive: true,
      });
      prisma.workstation.update.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
      );
      await expect(service.updateWorkstation('1', { code: 'laser' })).rejects.toThrow(
        'Mã điểm làm việc LASER đã có',
      );
    });

    it('sửa: đổi mã máy cắt đang hoạt động không xoá dòng chia (chỉ tắt / đổi xưởng mới xoá)', async () => {
      prisma.workstation.findUnique.mockResolvedValue({
        id: 1n,
        kind: 'CUT',
        workshopId: 1n,
        isActive: true,
      });
      await service.updateWorkstation('1', { code: 'LASER-PA' });
      expect(tx.cutAllocation.findMany).not.toHaveBeenCalled();
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

  describe('autoCompletePhoi (xong Phôi ghi phoiDoneAt, 23/11/2026)', () => {
    it('ghi phoiDoneAt chỉ khi còn trống (UPDATE có điều kiện) và trả true khi vừa ghi', async () => {
      const now = new Date('2026-11-23T03:00:00Z');
      await expect(service.autoCompletePhoi(45n, now)).resolves.toBe(true);
      expect(prisma.productionInvoice.updateMany).toHaveBeenCalledWith({
        where: { id: 45n, phoiDoneAt: null },
        data: { phoiDoneAt: now },
      });
    });

    it('lệnh đã có phoiDoneAt (gọi chồng) -> không ghi đè, trả false', async () => {
      prisma.productionInvoice.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.autoCompletePhoi(45n)).resolves.toBe(false);
    });
  });

  describe('computeProgress - tiến độ tổ trên 1 lệnh', () => {
    it('Phôi: mỗi cỡ đoạn chặn trần ở số cần - báo vượt cỡ này không che cỡ khác còn thiếu', async () => {
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

      const e = { progress: await service.computeProgress('PHOI', 45n) };

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

      const e = { progress: await service.computeProgress('PHOI', 45n) };

      expect(e.progress).toMatchObject({
        required: 250,
        reported: 96,
        passed: 96,
        failed: 4,
        percent: 38,
        complete: false,
        missing: { lines: 3, materialsNotReceived: 1 },
      });
      expect(e.progress.breakdown.map((b) => [b.step, b.required, b.reported])).toEqual([
        ['CAT', 150, 96],
        ['UON', 100, 0],
      ]);
    });

    it('P1: KCS ghi thiếu đã trừ khỏi done (done = thô - thiếu), lỗi trừ tiếp -> được tính = done - lỗi; "cần" gồm cả phần cắt lại', async () => {
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

      const e = { progress: await service.computeProgress('PHOI', 45n) };

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

    it('Phôi: mảnh Phôi + vật tư thành phẩm vào công đoạn PIECE', async () => {
      prisma.productionOrder.findMany.mockResolvedValueOnce([{ id: 41n }]);
      productionBatches.getBatchPlanBatch.mockResolvedValue({
        '41': {
          items: [{ plannedQty: 10, passedQty: 4, awaitingQcQty: 3, openQty: 3 }],
          materialYieldItems: [{ plannedQty: 10, passedQty: 5, awaitingQcQty: 0 }],
        },
      });

      const e = { progress: await service.computeProgress('PHOI', 45n) };

      expect(productionBatches.getBatchPlanBatch).toHaveBeenCalledWith(['41'], 'PHOI');
      expect(e.progress.breakdown).toEqual([
        expect.objectContaining({ step: 'PIECE', required: 20, reported: 15, percent: 75 }),
      ]);
    });

    it('Hàn: tính cả đợt chưa gửi KCS; đủ số thì complete', async () => {
      prisma.productionOrder.findMany.mockResolvedValueOnce([{ id: 41n }]); // các SKU của PI
      productionBatches.getBatchPlanBatch.mockResolvedValue({
        '41': {
          items: [{ pieceId: '73', plannedQty: 60, passedQty: 40, awaitingQcQty: 10, openQty: 20 }],
        },
      });

      const e = { progress: await service.computeProgress('HAN', 45n) };

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
      prisma.productionOrder.findMany.mockResolvedValueOnce([{ id: 41n }]);
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

      const e = { progress: await service.computeProgress('HAN', 45n) };

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
      prisma.productionOrder.findMany.mockResolvedValueOnce([{ id: 41n }]);
      productionBatches.getBatchPlanBatch.mockResolvedValue({
        '41': { items: [{ plannedQty: 1000, passedQty: 999, awaitingQcQty: 0, openQty: 0 }] },
      });

      const e = { progress: await service.computeProgress('HAN', 45n) };

      expect(e.progress).toMatchObject({ percent: 99, complete: false });
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
