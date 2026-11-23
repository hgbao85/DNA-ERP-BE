import { ForbiddenException } from '@nestjs/common';
import { MfgStage } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import type { WorkshopScopeService } from '../../common/workshop-scope/workshop-scope.service';
import type { PrismaServiceType } from '../../prisma/prisma.service';
import type { ProductionBatchesService } from '../production-batches/production-batches.service';
import type { SteelIssuesService } from '../steel-issues/steel-issues.service';
import type { CutAllocationService } from './cut-allocation.service';
import type { FloorAdminService } from './floor-admin.service';
import { compareStagePi, FloorStageService, missingPiecesOf } from './floor-stage.service';

const PHU_AN = 1n;
const PHUOC_AN = 2n;

const user = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'u1',
  username: 'u1',
  email: null,
  roles: ['PRODUCTION_MANAGER'],
  permissions: [],
  mfgRole: null,
  warehouseScope: null,
  ...over,
});

const pi = (
  id: bigint,
  code: string,
  deadline: string | null = null,
  phoiDoneAt: string | null = null,
) => ({
  id,
  code,
  deadline: deadline ? new Date(deadline) : null,
  phoiDoneAt: phoiDoneAt ? new Date(phoiDoneAt) : null,
});

const batch = (piId: bigint) => ({
  productionOrder: { productionInvoiceItem: { productionInvoiceId: piId } },
});

/** Kế hoạch mảnh 1 lệnh: cần `planned`, đạt `passed`. */
const plan = (planned: number, passed: number) => ({
  items: [{ plannedQty: planned, passedQty: passed, awaitingQcQty: 0, openQty: 0 }],
});

describe('FloorStageService', () => {
  let prisma: {
    productionInvoice: { findMany: jest.Mock };
    productionInvoiceItem: { findMany: jest.Mock };
    productionBatch: { findMany: jest.Mock };
    productionOrder: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
    workshop: { findMany: jest.Mock };
    warehouse: { findUnique: jest.Mock };
  };
  let steelIssues: { getPhoiProgressBatch: jest.Mock };
  let productionBatches: { getBatchPlanBatch: jest.Mock };
  let cutAllocation: { getWorkshopAllocationPis: jest.Mock };
  let scope: { getScope: jest.Mock; assertCanManage: jest.Mock };
  let admin: { stageDetail: jest.Mock };
  let service: FloorStageService;
  /** Xưởng của từng lệnh (mock productionInvoiceItem). */
  let wsOfPi: Record<string, bigint>;

  beforeEach(() => {
    wsOfPi = { '45': PHU_AN, '46': PHU_AN, '47': PHUOC_AN };
    prisma = {
      productionInvoice: { findMany: jest.fn().mockResolvedValue([]) },
      productionInvoiceItem: {
        findMany: jest
          .fn()
          .mockImplementation(({ where }: { where: { productionInvoiceId: { in: bigint[] } } }) =>
            Promise.resolve(
              where.productionInvoiceId.in
                .filter((id) => wsOfPi[id.toString()] != null)
                .map((id) => ({ productionInvoiceId: id, workshopId: wsOfPi[id.toString()] })),
            ),
          ),
      },
      productionBatch: { findMany: jest.fn().mockResolvedValue([]) },
      productionOrder: { findMany: jest.fn().mockResolvedValue([]) },
      // Điều kiện upstream của Hàn gộp ở DB (1 truy vấn, trả id lệnh có đợt đã chấm đạt > 0).
      $queryRaw: jest.fn().mockResolvedValue([]),
      workshop: { findMany: jest.fn().mockResolvedValue([{ id: PHU_AN }, { id: PHUOC_AN }]) },
      warehouse: { findUnique: jest.fn().mockResolvedValue({ workshopId: PHU_AN }) },
    };
    steelIssues = { getPhoiProgressBatch: jest.fn().mockResolvedValue({}) };
    productionBatches = { getBatchPlanBatch: jest.fn().mockResolvedValue({}) };
    cutAllocation = { getWorkshopAllocationPis: jest.fn().mockResolvedValue([]) };
    scope = {
      getScope: jest.fn().mockResolvedValue({ workshopId: null, workshopName: null }),
      assertCanManage: jest.fn(),
    };
    admin = { stageDetail: jest.fn().mockResolvedValue({ piCode: 'PI-45' }) };
    service = new FloorStageService(
      prisma as unknown as PrismaServiceType,
      steelIssues as unknown as SteelIssuesService,
      productionBatches as unknown as ProductionBatchesService,
      cutAllocation as unknown as CutAllocationService,
      scope as unknown as WorkshopScopeService,
      admin as unknown as FloorAdminService,
    );
  });

  /** Lệnh `piId` (SKU `piId * 10`) có kế hoạch mảnh Hàn / Sơn cần / đạt như cho. */
  const withPlan = (m: Record<string, [number, number]>) => {
    prisma.productionOrder.findMany.mockResolvedValue(
      Object.keys(m).map((piId) => ({
        id: BigInt(piId) * 10n,
        productionInvoiceItem: { productionInvoiceId: BigInt(piId) },
      })),
    );
    productionBatches.getBatchPlanBatch.mockResolvedValue(
      Object.fromEntries(
        Object.entries(m).map(([piId, [planned, passed]]) => [
          String(BigInt(piId) * 10n),
          plan(planned, passed),
        ]),
      ),
    );
  };

  describe('hàm thuần', () => {
    it('compareStagePi: hạn giao tăng dần (không hạn thì cuối), rồi mã lệnh', () => {
      const rows = [
        { code: 'PI-3', deadline: null },
        { code: 'PI-2', deadline: new Date('2026-12-05') },
        { code: 'PI-9', deadline: new Date('2026-12-01') },
        { code: 'PI-1', deadline: new Date('2026-12-05') },
      ];
      expect([...rows].sort(compareStagePi).map((r) => r.code)).toEqual([
        'PI-9',
        'PI-1',
        'PI-2',
        'PI-3',
      ]);
    });

    it('missingPiecesOf = cần - đã báo, không âm', () => {
      expect(missingPiecesOf({ required: 20, reported: 6 })).toBe(14);
      expect(missingPiecesOf({ required: 5, reported: 8 })).toBe(0);
    });
  });

  describe('listReportablePis - tập lệnh Hàn / Sơn (D2)', () => {
    it('Hàn: chỉ lấy lệnh chưa DONE / CANCELLED có SKU ACTIVE (điều kiện 1-2 nằm trong truy vấn)', async () => {
      await service.listReportablePis(MfgStage.HAN, PHU_AN);
      const arg = (prisma.productionInvoice.findMany.mock.calls as unknown[][])[0][0] as {
        where: Record<string, unknown>;
      };
      expect(arg.where).toEqual({
        status: { notIn: ['DONE', 'CANCELLED'] },
        items: { some: { productionOrder: { floorStage: 'ACTIVE' } } },
      });
    });

    it('Hàn: lệnh có mảnh Phôi đạt KCS hiện; lệnh chưa có thì không; thứ tự hạn giao rồi mã', async () => {
      prisma.productionInvoice.findMany.mockResolvedValue([
        pi(45n, 'PI-45', '2026-12-10'),
        pi(46n, 'PI-46', '2026-12-01'),
      ]);
      // chỉ 46 có mảnh Phôi tự báo đạt
      prisma.productionBatch.findMany.mockImplementation(
        ({ where }: { where: { stage: string; status?: string } }) =>
          Promise.resolve(where.stage === 'PHOI' && where.status === 'QC_DONE' ? [batch(46n)] : []),
      );
      withPlan({ '46': [10, 4] });

      const out = await service.listReportablePis(MfgStage.HAN, PHU_AN);

      expect(out).toEqual([
        {
          productionInvoiceId: 46n,
          code: 'PI-46',
          deadline: new Date('2026-12-01'),
          missingPieces: 6,
        },
      ]);
    });

    it('Hàn: lệnh có đợt đã chấm đạt > 0 (truy vấn gộp ở DB, không tải dòng) hiện; lệnh khác không', async () => {
      prisma.productionInvoice.findMany.mockResolvedValue([pi(45n, 'PI-45'), pi(46n, 'PI-46')]);
      prisma.$queryRaw.mockResolvedValue([{ id: 45n }]);
      withPlan({ '45': [10, 0] });

      const out = await service.listReportablePis(MfgStage.HAN, PHU_AN);

      expect(out.map((p) => p.code)).toEqual(['PI-45']);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('Sơn: không chạy truy vấn đợt Phôi (chỉ cần khung Hàn đạt)', async () => {
      prisma.productionInvoice.findMany.mockResolvedValue([pi(45n, 'PI-45')]);
      await service.listReportablePis(MfgStage.SON, PHU_AN);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('Hàn: lệnh cũ tổ đã từng báo (có ProductionBatch HAN) vẫn hiện dù không có dữ liệu Phôi đạt', async () => {
      prisma.productionInvoice.findMany.mockResolvedValue([pi(45n, 'PI-45')]);
      prisma.productionBatch.findMany.mockImplementation(
        ({ where }: { where: { stage: string; status?: string } }) =>
          Promise.resolve(where.stage === 'HAN' && where.status === undefined ? [batch(45n)] : []),
      );
      withPlan({ '45': [10, 3] });

      const out = await service.listReportablePis(MfgStage.HAN, PHU_AN);

      expect(out.map((p) => p.code)).toEqual(['PI-45']);
    });

    it('Sơn: cần khung Hàn đạt KCS (ProductionBatch HAN QC_DONE); mảnh Phôi đạt KHÔNG đủ', async () => {
      prisma.productionInvoice.findMany.mockResolvedValue([pi(45n, 'PI-45'), pi(46n, 'PI-46')]);
      prisma.productionBatch.findMany.mockImplementation(
        ({ where }: { where: { stage: string; status?: string } }) => {
          if (where.status === 'QC_DONE') {
            return Promise.resolve(where.stage === 'HAN' ? [batch(45n)] : [batch(46n)]);
          }
          return Promise.resolve([]);
        },
      );
      withPlan({ '45': [8, 0] });

      const out = await service.listReportablePis(MfgStage.SON, PHU_AN);

      expect(out.map((p) => p.code)).toEqual(['PI-45']);
    });

    it('xưởng không sơn nhờ: Sơn = xưởng của lệnh', async () => {
      prisma.productionInvoice.findMany.mockResolvedValue([pi(45n, 'PI-45'), pi(47n, 'PI-47')]);
      prisma.productionBatch.findMany.mockResolvedValue([batch(45n), batch(47n)]);
      withPlan({ '45': [8, 0], '47': [8, 0] });

      const phuAn = await service.listReportablePis(MfgStage.SON, PHU_AN);
      const phuocAn = await service.listReportablePis(MfgStage.SON, PHUOC_AN);

      expect(phuAn.map((p) => p.code)).toEqual(['PI-45']);
      expect(phuocAn.map((p) => p.code)).toEqual(['PI-47']);
    });

    it('Sơn theo NƠI SƠN (chốt 23/11): Phước An sơn ở Phú An -> lệnh Phước An hiện ở máy Sơn Phú An, không ở Phước An; Hàn vẫn theo xưởng của lệnh', async () => {
      prisma.workshop.findMany.mockResolvedValue([
        { id: PHU_AN, paintWorkshopId: null },
        { id: PHUOC_AN, paintWorkshopId: PHU_AN },
      ]);
      prisma.productionInvoice.findMany.mockResolvedValue([pi(45n, 'PI-45'), pi(47n, 'PI-47')]);
      prisma.productionBatch.findMany.mockResolvedValue([batch(45n), batch(47n)]);
      withPlan({ '45': [8, 0], '47': [8, 0] });

      const sonPhuAn = await service.listReportablePis(MfgStage.SON, PHU_AN);
      const sonPhuocAn = await service.listReportablePis(MfgStage.SON, PHUOC_AN);
      const hanPhuocAn = await service.listReportablePis(MfgStage.HAN, PHUOC_AN);

      expect(sonPhuAn.map((p) => p.code)).toEqual(['PI-45', 'PI-47']);
      expect(sonPhuocAn).toEqual([]);
      expect(hanPhuocAn.map((p) => p.code)).toEqual(['PI-47']);
    });

    it('tổ đã báo đủ số (complete) thì ẩn; KCS chấm lỗi làm tụt thì hiện lại', async () => {
      prisma.productionInvoice.findMany.mockResolvedValue([pi(45n, 'PI-45')]);
      prisma.productionBatch.findMany.mockResolvedValue([batch(45n)]);
      withPlan({ '45': [10, 10] });
      expect(await service.listReportablePis(MfgStage.HAN, PHU_AN)).toEqual([]);

      withPlan({ '45': [10, 8] }); // KCS chấm lỗi 2
      const again = await service.listReportablePis(MfgStage.HAN, PHU_AN);
      expect(again.map((p) => [p.code, p.missingPieces])).toEqual([['PI-45', 2]]);
    });

    it('onlyPiIds: truy vấn lệnh giới hạn đúng các id được hỏi', async () => {
      await service.listReportablePis(MfgStage.HAN, PHU_AN, [45n]);
      const arg = (prisma.productionInvoice.findMany.mock.calls as unknown[][])[0][0] as {
        where: { id: unknown };
      };
      expect(arg.where.id).toEqual({ in: [45n] });
    });
  });

  describe('quyền xem sản lượng theo lệnh', () => {
    it('QLSX / BOSS / ADMIN xem được mọi tổ', async () => {
      for (const role of ['PRODUCTION_MANAGER', 'BOSS', 'ADMIN']) {
        await expect(service.listProgress(user({ roles: [role] }), 'PHOI')).resolves.toBeDefined();
      }
    });

    it('KCS_STAFF -> 403', async () => {
      await expect(service.listProgress(user({ roles: ['KCS_STAFF'] }), 'HAN')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('tài khoản tổ chỉ xem tổ mình', async () => {
      const han = user({ roles: ['FLOOR_WORKER'], mfgRole: 'HAN' });
      await expect(service.listProgress(han, 'HAN')).resolves.toBeDefined();
      await expect(service.listProgress(han, 'SON')).rejects.toThrow(ForbiddenException);
      await expect(service.detail(han, 'PHOI', '45')).rejects.toThrow(ForbiddenException);
    });

    it('QLSX gắn xưởng: không kèm workshopId thì lọc xưởng mình; xưởng khác -> hỏi assertCanManage (403)', async () => {
      scope.getScope.mockResolvedValue({ workshopId: PHU_AN, workshopName: 'Phú An' });
      prisma.productionInvoice.findMany.mockResolvedValue([pi(45n, 'PI-45'), pi(47n, 'PI-47')]);
      prisma.productionBatch.findMany.mockResolvedValue([batch(45n), batch(47n)]);
      withPlan({ '45': [10, 2], '47': [10, 2] });

      const rows = await service.listProgress(user(), 'HAN');
      expect(rows.map((r) => r.code)).toEqual(['PI-45']);

      scope.assertCanManage.mockImplementation(() => {
        throw new ForbiddenException('xưởng khác');
      });
      await expect(service.listProgress(user(), 'HAN', '2')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listProgress - nội dung', () => {
    it('Hàn: trả percent / missingPieces / complete / phoiDoneAt (chuỗi ISO) theo hạn giao', async () => {
      prisma.productionInvoice.findMany.mockResolvedValue([
        pi(46n, 'PI-46', '2026-12-09'),
        pi(45n, 'PI-45', '2026-12-01', '2026-11-20T01:00:00Z'),
      ]);
      prisma.productionBatch.findMany.mockResolvedValue([batch(45n), batch(46n)]);
      withPlan({ '45': [10, 5], '46': [10, 10] });

      const rows = await service.listProgress(user(), 'HAN', '1');

      expect(rows).toEqual([
        {
          productionInvoiceId: '45',
          code: 'PI-45',
          deadline: '2026-12-01T00:00:00.000Z',
          percent: 50,
          missingPieces: 5,
          complete: false,
          phoiDoneAt: '2026-11-20T01:00:00.000Z',
        },
        {
          productionInvoiceId: '46',
          code: 'PI-46',
          deadline: '2026-12-09T00:00:00.000Z',
          percent: 100,
          missingPieces: 0,
          complete: true,
          phoiDoneAt: null,
        },
      ]);
    });

    it('Phôi không kèm workshopId: gom lệnh trong bảng chia của MỌI xưởng + lệnh xong Phôi 7 ngày gần nhất', async () => {
      cutAllocation.getWorkshopAllocationPis.mockImplementation((w: bigint) =>
        Promise.resolve(w === PHU_AN ? [{ productionInvoiceId: '45', code: 'PI-45' }] : []),
      );
      prisma.productionInvoice.findMany.mockImplementation(
        ({ where }: { where: { phoiDoneAt?: unknown; id?: unknown } }) =>
          Promise.resolve(
            where.phoiDoneAt
              ? [pi(46n, 'PI-46', null, '2026-11-22T00:00:00Z')]
              : [pi(45n, 'PI-45')],
          ),
      );
      steelIssues.getPhoiProgressBatch.mockResolvedValue({ '45': [], '46': [] });

      const rows = await service.listProgress(
        user(),
        'PHOI',
        undefined,
        new Date('2026-11-23T00:00:00Z'),
      );

      expect(cutAllocation.getWorkshopAllocationPis).toHaveBeenCalledTimes(2);
      expect(rows.map((r) => r.code).sort()).toEqual(['PI-45', 'PI-46']);
      expect(rows.find((r) => r.code === 'PI-46')?.phoiDoneAt).toBe('2026-11-22T00:00:00.000Z');
    });
  });

  describe('listProgress - productionInvoiceIds (V3)', () => {
    it('trả đúng các lệnh được hỏi, kể cả lệnh cũ ngoài cửa sổ 7 ngày, không dựng phạm vi mặc định', async () => {
      prisma.productionInvoice.findMany.mockResolvedValue([
        pi(45n, 'PI-45', null, '2026-01-05T00:00:00Z'),
      ]);
      withPlan({ '45': [10, 10] });

      const rows = await service.listProgress(user(), 'HAN', undefined, undefined, '45,45');

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        productionInvoiceId: '45',
        complete: true,
        phoiDoneAt: '2026-01-05T00:00:00.000Z',
      });
      const arg = (prisma.productionInvoice.findMany.mock.calls as unknown[][])[0][0] as {
        where: unknown;
      };
      expect(arg.where).toEqual({ id: { in: [45n] } });
      expect(prisma.productionBatch.findMany).not.toHaveBeenCalled();
    });

    it('vẫn lọc xưởng: QLSX gắn xưởng không thấy lệnh xưởng khác', async () => {
      scope.getScope.mockResolvedValue({ workshopId: PHU_AN, workshopName: 'Phú An' });
      prisma.productionInvoice.findMany.mockResolvedValue([pi(45n, 'PI-45'), pi(47n, 'PI-47')]);
      withPlan({ '45': [10, 1], '47': [10, 1] });
      const rows = await service.listProgress(user(), 'HAN', undefined, undefined, '45,47');
      expect(rows.map((r) => r.code)).toEqual(['PI-45']);
    });

    it('vẫn qua kiểm quyền: KCS -> 403', async () => {
      await expect(
        service.listProgress(user({ roles: ['KCS_STAFF'] }), 'HAN', undefined, undefined, '45'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('detail', () => {
    it('trả đúng thân của FloorAdminService.stageDetail', async () => {
      await expect(service.detail(user(), 'HAN', '45')).resolves.toEqual({ piCode: 'PI-45' });
      expect(admin.stageDetail).toHaveBeenCalledWith('HAN', '45');
    });

    it('QLSX gắn xưởng xem lệnh xưởng khác -> hỏi assertCanManage', async () => {
      scope.getScope.mockResolvedValue({ workshopId: PHU_AN, workshopName: 'Phú An' });
      scope.assertCanManage.mockImplementation(() => {
        throw new ForbiddenException('xưởng khác');
      });
      await expect(service.detail(user(), 'HAN', '47')).rejects.toThrow(ForbiddenException);
      expect(scope.assertCanManage).toHaveBeenCalledWith(expect.anything(), [PHUOC_AN], 'lệnh này');
      expect(admin.stageDetail).not.toHaveBeenCalled();
    });

    it('Sơn: QLSX Phú An xem lệnh Phước An sơn nhờ ở Phú An -> kiểm theo nơi sơn (Phú An)', async () => {
      prisma.workshop.findMany.mockResolvedValue([
        { id: PHU_AN, paintWorkshopId: null },
        { id: PHUOC_AN, paintWorkshopId: PHU_AN },
      ]);
      scope.getScope.mockResolvedValue({ workshopId: PHU_AN, workshopName: 'Phú An' });
      await service.detail(user(), 'SON', '47');
      expect(scope.assertCanManage).toHaveBeenCalledWith(expect.anything(), [PHU_AN], 'lệnh này');
      expect(admin.stageDetail).toHaveBeenCalledWith('SON', '47');
    });
  });
});
