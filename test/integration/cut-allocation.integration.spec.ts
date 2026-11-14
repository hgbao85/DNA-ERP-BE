import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import configuration from '../../src/config/configuration';
import { envValidationSchema } from '../../src/config/env.validation';
import {
  CutAllocationLogAction,
  CuttingProposalStatus,
  FloorReportKind,
  SolverMachine,
} from '../../src/generated/prisma/client';
import { WorkshopScopeService } from '../../src/common/workshop-scope/workshop-scope.service';
import { CutAllocationService } from '../../src/modules/floor/cut-allocation.service';
import { CutMachineStatsService } from '../../src/modules/floor/cut-machine-stats.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PRISMA_SERVICE, PrismaServiceType } from '../../src/prisma/prisma.service';
import { CutAllocationFixture } from './cut-allocation.fixture';

/**
 * Chia máy cắt trên Postgres TEST (docker-compose.test.yml, cổng 5433): máy rảnh tự kéo lệnh,
 * giữ chỗ ở kho xưởng khác, khoảng thiếu sắt chưa xuất, đo năng suất máy cắt.
 * Dữ liệu tự tạo có hậu tố riêng và dọn ở afterAll. Gọi THẬT các service (không mock thông báo vì
 * 2 service này không dùng thông báo / realtime).
 */
describe('Chia máy cắt + đo năng suất (integration, real Postgres)', () => {
  let prisma: PrismaServiceType;
  let alloc: CutAllocationService;
  let stats: CutMachineStatsService;
  let fx: CutAllocationFixture;

  const PATTERN_10 = [{ barCount: 10, segments: [{ cutLengthMm: 1000, countPerBar: 5 }] }];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [configuration],
          validationSchema: envValidationSchema,
        }),
        ClsModule.forRoot({ global: true }),
        PrismaModule,
      ],
      providers: [CutAllocationService, CutMachineStatsService, WorkshopScopeService],
    }).compile();
    prisma = moduleRef.get(PRISMA_SERVICE);
    alloc = moduleRef.get(CutAllocationService);
    stats = moduleRef.get(CutMachineStatsService);
    fx = new CutAllocationFixture(prisma, Date.now());
    await fx.init();
  });

  afterAll(async () => {
    if (!prisma) return;
    await fx.cleanup();
    await prisma.$disconnect();
  });

  it('a) máy rảnh kéo lệnh đủ sắt nhờ giữ chỗ ở kho Phôi của xưởng, nối cuối, ghi nhật ký', async () => {
    const a = await fx.makeWorkshop('A1');
    const machineId = await fx.makeMachine(a.workshopId, SolverMachine.tu_dong, 'A1');
    const materialId = await fx.makeMaterial('A1');
    const piId = await fx.makeOrder(a.workshopId, 'A1');
    const { patternIds } = await fx.makeProposal(
      piId,
      materialId,
      PATTERN_10,
      SolverMachine.tu_dong,
    );
    await fx.reserve(piId, materialId, a.warehouseId, 10);

    // Dòng cũ (phương án SUPERSEDED) còn nằm trên máy với seq 5: dòng mới phải nối sau nó.
    const old = await fx.makeProposal(
      piId,
      materialId,
      PATTERN_10,
      SolverMachine.tu_dong,
      CuttingProposalStatus.SUPERSEDED,
    );
    await prisma.cutAllocation.create({
      data: {
        workshopId: a.workshopId,
        workstationId: machineId,
        productionInvoiceId: piId,
        cuttingProposalId: old.proposalId,
        patternId: old.patternIds[0],
        machineClass: 'TU_DONG',
        barCount: 3,
        seq: 5,
      },
    });

    const result = await alloc.autoPull(a.workshopId, [machineId.toString()]);

    expect(result).not.toBeNull();
    expect(result!.machines.map((m) => m.id)).toEqual([machineId.toString()]);
    expect(result!.orders).toHaveLength(1);
    const order = result!.orders[0];
    expect(order.productionInvoiceId).toBe(piId.toString());
    expect(order.lines[0].bars).toBe(10);
    expect(order.steelGaps).toHaveLength(1);
    expect(order.steelGaps[0]).toMatchObject({
      materialId: materialId.toString(),
      requiredBars: 10,
      issuedBars: 0,
      missingBars: 10,
      warehouseCodes: [a.warehouseCode],
    });

    const pulled = await prisma.cutAllocation.findMany({
      where: { patternId: patternIds[0] },
    });
    expect(pulled).toHaveLength(1);
    expect(pulled[0]).toMatchObject({
      workstationId: machineId,
      barCount: 10,
      seq: 6,
      isManual: false,
    });
    const logs = await prisma.cutAllocationLog.findMany({
      where: { workshopId: a.workshopId, action: CutAllocationLogAction.AUTO_PULL },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ barCount: 10, toWorkstationId: machineId, createdById: null });

    const progress = await alloc.machineProgressByWorkshop(a.workshopId);
    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({ workstationId: machineId.toString(), totalBars: 10 });
  });

  it('b) giữ chỗ ở kho Phôi xưởng KHÁC: không kéo, lệnh nằm ở "waiting" của bảng', async () => {
    const a = await fx.makeWorkshop('B1');
    const other = await fx.makeWorkshop('B2');
    const machineId = await fx.makeMachine(a.workshopId, SolverMachine.tu_dong, 'B1');
    const materialId = await fx.makeMaterial('B1');
    const piId = await fx.makeOrder(a.workshopId, 'B1');
    await fx.makeProposal(piId, materialId, PATTERN_10, SolverMachine.tu_dong);
    await fx.reserve(piId, materialId, other.warehouseId, 10);

    const result = await alloc.autoPull(a.workshopId, [machineId.toString()]);
    expect(result).toBeNull();
    expect(await prisma.cutAllocation.count({ where: { workshopId: a.workshopId } })).toBe(0);

    const board = await alloc.getBoard(fx.userId, a.workshopId.toString());
    expect(board.rows).toHaveLength(0);
    expect(board.unallocated).toHaveLength(0);
    expect(board.waiting).toHaveLength(1);
    expect(board.waiting[0]).toMatchObject({
      productionInvoiceId: piId.toString(),
      materialId: materialId.toString(),
      requiredBars: 10,
      availableBars: 0,
      shortBars: 10,
    });
  });

  it('c) steelGapsByPi: chưa xuất đủ còn khoảng thiếu, xuất đủ số cần thì hết', async () => {
    const a = await fx.makeWorkshop('C1');
    const machineId = await fx.makeMachine(a.workshopId, SolverMachine.tu_dong, 'C1');
    const materialId = await fx.makeMaterial('C1');
    const piId = await fx.makeOrder(a.workshopId, 'C1');
    const { proposalId, patternIds } = await fx.makeProposal(
      piId,
      materialId,
      PATTERN_10,
      SolverMachine.tu_dong,
    );
    await fx.reserve(piId, materialId, a.warehouseId, 10);
    await prisma.cutAllocation.create({
      data: {
        workshopId: a.workshopId,
        workstationId: machineId,
        productionInvoiceId: piId,
        cuttingProposalId: proposalId,
        patternId: patternIds[0],
        machineClass: 'TU_DONG',
        barCount: 10,
        seq: 1,
      },
    });

    const none = await alloc.steelGapsByPi(a.workshopId);
    expect(none.get(piId.toString())).toEqual([
      expect.objectContaining({
        requiredBars: 10,
        issuedBars: 0,
        missingBars: 10,
        warehouseCodes: [a.warehouseCode],
      }),
    ]);

    await fx.issueSteel(piId, materialId, 4);
    const partial = await alloc.steelGapsByPi(a.workshopId);
    expect(partial.get(piId.toString())?.[0]).toMatchObject({ issuedBars: 4, missingBars: 6 });

    await fx.issueSteel(piId, materialId, 6);
    const full = await alloc.steelGapsByPi(a.workshopId);
    expect(full.has(piId.toString())).toBe(false);
  });

  it('d) C4: báo cắt 1 máy trong 1 ngày có nghỉ trưa -> đúng số cây quy đổi và cây/giờ', async () => {
    const ws = await fx.makeWorkshop('D1');
    const machineId = await fx.makeMachine(ws.workshopId, SolverMachine.laser, 'D1');
    const materialId = await fx.makeMaterial('D1');
    const piId = await fx.makeOrder(ws.workshopId, 'D1');
    await fx.makeProposal(piId, materialId, PATTERN_10, SolverMachine.laser); // cây 6000 mm
    const specId = await fx.segmentSpecId(materialId, 1000);

    // Giờ VN 08:00, 09:00, 11:00, 14:00 ngày 2026-11-10 (UTC+7). Mỗi lần báo 600 đoạn.
    const vn = (h: number) => new Date(Date.UTC(2026, 10, 10, h - 7, 0, 0));
    for (const hour of [8, 9, 11, 14]) {
      await prisma.floorReport.create({
        data: {
          kind: FloorReportKind.CUT,
          reportedById: fx.userId,
          workstationId: machineId,
          productionInvoiceId: piId,
          createdAt: vn(hour),
          lines: { create: [{ segmentSpecId: specId, qty: 600 }] },
        },
      });
    }

    const cfg = await prisma.systemConfig.findUnique({ where: { id: 1 } });
    const blade = Number(cfg?.solverBladeWidthMm ?? 1);
    const trim = Number(cfg?.solverTrimStartMm ?? 10);
    const perReport = (600 * (1000 + blade)) / (6000 - trim);
    const round1 = (n: number) => Math.round(n * 10) / 10;

    const res = await stats.getStats(fx.userId, {
      workshopId: ws.workshopId.toString(),
      from: '2026-11-10',
      to: '2026-11-10',
    });

    expect(res.days).toHaveLength(1);
    const day = res.days[0];
    expect(day).toMatchObject({
      machineId: machineId.toString(),
      day: '2026-11-10',
      reports: 4,
      segments: 2400,
      bars: round1(perReport * 4),
      // Lần báo đầu ngày chỉ đánh dấu; 09:00 -> 11:00 = 120, 11:00 -> 14:00 = 180 - 90 nghỉ trưa = 90.
      rateBars: round1(perReport * 3),
      rateMinutes: 60 + 120 + 90,
      barsPerHour: round1((perReport * 3) / (270 / 60)),
    });
    expect(res.byMachine).toHaveLength(1);
    expect(res.byMachine[0]).toMatchObject({
      machineId: machineId.toString(),
      daysWithData: 1,
      totalBars: round1(perReport * 4),
      barsPerHour: day.barsPerHour,
    });
  });
});
