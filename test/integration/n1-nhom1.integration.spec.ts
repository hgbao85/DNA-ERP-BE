import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import { Client } from 'pg';
import configuration from '../../src/config/configuration';
import { envValidationSchema } from '../../src/config/env.validation';
import { WorkshopScopeService } from '../../src/common/workshop-scope/workshop-scope.service';
import {
  CutAllocationLogAction,
  FloorQueueStatus,
  MfgStage,
  ProductionBatchStatus,
  ProductionInvoiceStatus,
  ProductionOrderFloorStage,
  SolverMachine,
  WarehouseKind,
} from '../../src/generated/prisma/client';
import { CutAllocationFollowUpService } from '../../src/modules/floor/cut-allocation-follow-up.service';
import { CutAllocationService } from '../../src/modules/floor/cut-allocation.service';
import { FloorAdminService } from '../../src/modules/floor/floor-admin.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { RecipientResolverService } from '../../src/modules/notifications/recipient-resolver.service';
import { ProductionBatchesService } from '../../src/modules/production-batches/production-batches.service';
import { CuttingProposalsService } from '../../src/modules/cutting-proposals/cutting-proposals.service';
import { ProductionInvoicesService } from '../../src/modules/production-invoices/production-invoices.service';
import { ConsumableMaterialPurchaseService } from '../../src/modules/production-invoices/consumable-material-purchase.service';
import { DeadlineChangesService } from '../../src/modules/production-invoices/deadline-changes/deadline-changes.service';
import { ItemDeadlineWriter } from '../../src/modules/production-invoices/item-deadline-writer.service';
import { MaterialYieldRecipePurchaseService } from '../../src/modules/production-invoices/material-yield-recipe-purchase.service';
import { PieceMaterialYieldPurchaseService } from '../../src/modules/production-invoices/piece-material-yield-purchase.service';
import { ProductionOrdersService } from '../../src/modules/production-orders/production-orders.service';
import { SegmentProductionService } from '../../src/modules/segment-stock/segment-production.service';
import { SegmentStockService } from '../../src/modules/segment-stock/segment-stock.service';
import { StockLedgerService } from '../../src/modules/stock/stock-ledger.service';
import { StockReservationsService } from '../../src/modules/stock/stock-reservations.service';
import { SteelIssuesService } from '../../src/modules/steel-issues/steel-issues.service';
import { CloudinaryService } from '../../src/modules/uploads/cloudinary.service';
import { PaintTransferReminderService } from '../../src/modules/warehouse-transfers/paint-transfer-reminder.service';
import { WarehouseTransfersService } from '../../src/modules/warehouse-transfers/warehouse-transfers.service';
import { WorkshopMoveService } from '../../src/modules/warehouse-transfers/workshop-move.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PRISMA_SERVICE, PrismaServiceType } from '../../src/prisma/prisma.service';
import { RealtimeService } from '../../src/realtime/realtime.service';
import { TEST_DATABASE_URL } from '../test-db.constants';
import { CutAllocationFixture } from './cut-allocation.fixture';

/**
 * Gói N1 nhóm 1 (18/11/2026), Postgres TEST thật (cổng 5433):
 *  1. "Chuyển lệnh tiếp" kèm expectedRunningPiId: 2 QLSX bấm cùng lúc / lệnh đang chạy vừa đổi -> 409, không đóng nhầm lệnh.
 *  2. Chia máy tay: lệnh chưa Bắt đầu bị chặn (400); lệnh đã Bắt đầu được xếp ĐÚNG 1 dòng hàng đợi Phôi dù chia 2 lần.
 *  3. Tắt máy cắt / đổi xưởng máy cắt xoá dòng chia của máy (cùng transaction, có nhật ký).
 *  4. Nhắc Kết thúc: đóng gói vừa đủ -> 1 tin, Kết thúc -> tin đóng.
 *  5. Tin chuyển mảnh sang Sơn (xưởng không có kho Sơn) tự đóng ở lượt nhắc nền khi lệnh DONE.
 *
 * Ghép dịch vụ như controller làm (chia tay = CutAllocationService.add + CutAllocationFollowUpService.afterAllocated, 'MANUAL').
 * Thông báo dùng NotificationsService THẬT ghi DB; chỉ bộ tính người nhận được thay bằng 1 người test (và realtime là mock).
 * Ca đồng thời: kết nối `pg` thứ hai giữ khoá advisory (đúng khoá service dùng) chưa commit, gọi service, đợi tới khi
 * thấy backend khác chờ khoá, rồi COMMIT (cùng cách cut-bundle-race). Dữ liệu tự dựng, hậu tố riêng, dọn ở afterAll.
 */
describe('N1 nhóm 1: hàng đợi, chia máy tay, nhắc Kết thúc, nhắc chuyển mảnh (integration, real Postgres)', () => {
  let prisma: PrismaServiceType;
  let admin: FloorAdminService;
  let alloc: CutAllocationService;
  let followUp: CutAllocationFollowUpService;
  let invoices: ProductionInvoicesService;
  let orders: ProductionOrdersService;
  let paint: PaintTransferReminderService;
  let fx: CutAllocationFixture;

  const sfx = Date.now();
  let qlsxId: string; // người nhận thông báo (do bộ tính người nhận giả trả về)
  const recipientCalls: unknown[] = [];
  const realtime = {
    publishEntityChanged: jest.fn(),
    publishNotificationCreated: jest.fn(),
    publishNotificationChanged: jest.fn(),
  };

  // dữ liệu ngoài fixture (ca 4, 5) - dọn riêng
  let ownProductId: bigint;
  let ownBomId: bigint;
  const own = {
    invoices: [] as bigint[],
    items: [] as bigint[],
    orders: [] as bigint[],
    workshops: [] as bigint[],
    warehouses: [] as bigint[],
    pieces: [] as bigint[],
  };
  const queueEntryPiIds: bigint[] = [];

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
      providers: [
        FloorAdminService,
        CutAllocationService,
        CutAllocationFollowUpService,
        ProductionInvoicesService,
        ProductionOrdersService,
        PaintTransferReminderService,
        WarehouseTransfersService,
        NotificationsService,
        WorkshopScopeService,
        { provide: SteelIssuesService, useValue: {} },
        { provide: ProductionBatchesService, useValue: {} },
        { provide: CuttingProposalsService, useValue: {} },
        { provide: PieceMaterialYieldPurchaseService, useValue: {} },
        { provide: ConsumableMaterialPurchaseService, useValue: {} },
        { provide: MaterialYieldRecipePurchaseService, useValue: {} },
        { provide: CloudinaryService, useValue: {} },
        { provide: ItemDeadlineWriter, useValue: {} },
        { provide: DeadlineChangesService, useValue: {} },
        { provide: WorkshopMoveService, useValue: {} },
        { provide: SegmentProductionService, useValue: {} },
        {
          provide: SegmentStockService,
          useValue: { releaseOrderHoldings: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: StockReservationsService,
          useValue: { releaseByProductionInvoice: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: StockLedgerService, useValue: {} },
        { provide: RealtimeService, useValue: realtime },
        {
          provide: RecipientResolverService,
          useValue: {
            resolve: jest.fn((criteria: unknown) => {
              recipientCalls.push(criteria);
              return Promise.resolve([qlsxId]);
            }),
            dropQlsxOfOtherWorkshops: jest.fn((ids: string[]) => Promise.resolve(ids)),
          },
        },
      ],
    }).compile();
    prisma = moduleRef.get(PRISMA_SERVICE);
    admin = moduleRef.get(FloorAdminService);
    alloc = moduleRef.get(CutAllocationService);
    followUp = moduleRef.get(CutAllocationFollowUpService);
    invoices = moduleRef.get(ProductionInvoicesService);
    orders = moduleRef.get(ProductionOrdersService);
    paint = moduleRef.get(PaintTransferReminderService);

    fx = new CutAllocationFixture(prisma, sfx);
    await fx.init();
    qlsxId = (
      await prisma.user.create({
        data: { username: `n1-qlsx-${sfx}`, password: 'x', firstName: 'N1', lastName: 'Q' },
      })
    ).id;
    ownProductId = (
      await prisma.mfgProduct.create({ data: { factoryCode: `N1-${sfx}`, name: 'SP N1' } })
    ).id;
    ownBomId = (
      await prisma.bomRevision.create({
        data: { mfgProductId: ownProductId, revNo: 1, status: 'DRAFT' },
      })
    ).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    const has = <T>(v: T | undefined | null): v is T => v !== undefined && v !== null;
    // thông báo: mọi tin của test này đều gửi cho đúng 1 người test
    if (has(qlsxId)) {
      const nIds = (
        await prisma.notificationRecipient.findMany({
          where: { userId: qlsxId },
          select: { notificationId: true },
        })
      ).map((r) => r.notificationId);
      await prisma.notificationRecipient.deleteMany({ where: { userId: qlsxId } });
      if (nIds.length > 0) await prisma.notification.deleteMany({ where: { id: { in: nIds } } });
    }
    if (own.orders.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { tableName: 'ProductionOrder', recordId: { in: own.orders.map(String) } },
      });
    }
    if (queueEntryPiIds.length > 0 || own.invoices.length > 0) {
      await prisma.floorQueueEntry.deleteMany({
        where: { productionInvoiceId: { in: [...queueEntryPiIds, ...own.invoices] } },
      });
    }
    if (own.items.length > 0) {
      await prisma.packagingRecord.deleteMany({
        where: { productionInvoiceItemId: { in: own.items } },
      });
    }
    if (own.orders.length > 0) {
      await prisma.productionBatch.deleteMany({
        where: { productionOrderId: { in: own.orders } },
      });
      await prisma.productionOrder.deleteMany({ where: { id: { in: own.orders } } });
    }
    if (own.items.length > 0) {
      await prisma.productionInvoiceItem.deleteMany({ where: { id: { in: own.items } } });
    }
    if (own.invoices.length > 0) {
      await prisma.productionInvoice.deleteMany({ where: { id: { in: own.invoices } } });
    }
    if (own.pieces.length > 0) {
      await prisma.stockQuant.deleteMany({ where: { pieceId: { in: own.pieces } } });
      await prisma.bomPiece.deleteMany({ where: { pieceId: { in: own.pieces } } });
      await prisma.piece.deleteMany({ where: { id: { in: own.pieces } } });
    }
    if (own.warehouses.length > 0) {
      await prisma.warehouse.deleteMany({ where: { id: { in: own.warehouses } } });
    }
    // queue entries của PI do fixture tạo phải xoá trước khi fixture xoá PI (đã làm ở trên)
    if (fx) await fx.cleanup();
    if (has(ownBomId)) await prisma.bomRevision.deleteMany({ where: { id: ownBomId } });
    if (has(ownProductId)) await prisma.mfgProduct.deleteMany({ where: { id: ownProductId } });
    if (own.workshops.length > 0) {
      await prisma.workshop.deleteMany({ where: { id: { in: own.workshops } } });
    }
    if (has(qlsxId)) await prisma.user.deleteMany({ where: { id: qlsxId } });
    await prisma.$disconnect();
  });

  // ---------- giữ khoá ở kết nối thứ hai ----------

  function dbUrl(): string {
    const u = new URL(TEST_DATABASE_URL);
    u.search = '';
    return u.toString();
  }

  interface Outcome {
    ok: boolean;
    value?: unknown;
    error?: unknown;
    waited: boolean;
  }

  /**
   * Kết nối riêng BEGIN + chạy `holdSql` (chưa commit) -> bắt đầu các `calls` (không await) -> poll tới khi thấy đủ
   * `calls.length` backend khác chờ khoá (<= 5 giây) -> COMMIT -> await từng call. `waited` = đã thấy chờ thật.
   */
  async function raceWith(
    holdSql: string[],
    calls: Array<() => Promise<unknown>>,
  ): Promise<Outcome[]> {
    const client = new Client({ connectionString: dbUrl() });
    await client.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      const holderPid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
        .rows[0].pid;
      for (const sql of holdSql) await client.query(sql);
      let settled = 0;
      const pending = calls.map((call) =>
        call().then(
          (value): Omit<Outcome, 'waited'> => {
            settled += 1;
            return { ok: true, value };
          },
          (error: unknown): Omit<Outcome, 'waited'> => {
            settled += 1;
            return { ok: false, error };
          },
        ),
      );
      let waited = false;
      const deadline = Date.now() + 5000;
      while (settled < calls.length && Date.now() < deadline) {
        const rows = await prisma.$queryRaw<{ n: bigint }[]>`
          SELECT count(*)::bigint AS n FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> ${holderPid}::int
            AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock'`;
        if (rows[0] && rows[0].n >= BigInt(calls.length)) {
          waited = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 25));
      }
      await client.query('COMMIT');
      committed = true;
      return (await Promise.all(pending)).map((o) => ({ ...o, waited }));
    } finally {
      if (!committed) await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  }

  const lockSql = (key: string) => `SELECT pg_advisory_xact_lock(hashtext('${key}')::bigint)`;
  const msg = (e: unknown): string => (e as { message: string }).message;

  // =====================================================================================
  // 1. Chuyển lệnh tiếp + expectedRunningPiId
  // =====================================================================================
  describe('1. advance (Chuyển lệnh tiếp) với expectedRunningPiId', () => {
    const STAGE = 'PHOI' as const;

    /** Xưởng mới + 3 lệnh: A đang chạy, B và C đang chờ (B đứng trước). */
    async function setupQueue(tag: string, running = true) {
      const ws = await fx.makeWorkshop(tag);
      const a = await fx.makeOrder(ws.workshopId, `${tag}a`);
      const b = await fx.makeOrder(ws.workshopId, `${tag}b`);
      const c = await fx.makeOrder(ws.workshopId, `${tag}c`);
      queueEntryPiIds.push(a, b, c);
      const mk = (pi: bigint, position: number, status: FloorQueueStatus) =>
        prisma.floorQueueEntry.create({
          data: {
            stage: MfgStage.PHOI,
            productionInvoiceId: pi,
            workshopId: ws.workshopId,
            position,
            status,
            startedAt: status === FloorQueueStatus.RUNNING ? new Date() : null,
          },
        });
      await mk(a, 1, running ? FloorQueueStatus.RUNNING : FloorQueueStatus.QUEUED);
      await mk(b, 2, FloorQueueStatus.QUEUED);
      await mk(c, 3, FloorQueueStatus.QUEUED);
      const statusOf = async () => {
        const rows = await prisma.floorQueueEntry.findMany({
          where: { workshopId: ws.workshopId, stage: MfgStage.PHOI },
        });
        const m = new Map(rows.map((r) => [r.productionInvoiceId.toString(), r.status]));
        return { a: m.get(a.toString()), b: m.get(b.toString()), c: m.get(c.toString()) };
      };
      return { ws, a, b, c, statusOf, wsId: ws.workshopId.toString() };
    }

    it('expected = lệnh đang chạy: chuyển bình thường (A xong, B chạy, C vẫn chờ)', async () => {
      const q = await setupQueue('ADV1');
      await admin.advance(STAGE, fx.userId, q.wsId, q.a.toString());
      expect(await q.statusOf()).toEqual({
        a: FloorQueueStatus.DONE,
        b: FloorQueueStatus.RUNNING,
        c: FloorQueueStatus.QUEUED,
      });
    });

    it('2 QLSX bấm cùng lúc (cùng expected = A): đúng 1 đạt, 1 bị 409 đúng câu; B chạy, C KHÔNG bị đóng nhầm', async () => {
      const q = await setupQueue('ADV2');
      const call = () => admin.advance(STAGE, fx.userId, q.wsId, q.a.toString());
      const out = await raceWith([lockSql(`floor-queue:${STAGE}:${q.wsId}`)], [call, call]);

      expect(out.every((o) => o.waited)).toBe(true);
      expect(out.filter((o) => o.ok)).toHaveLength(1);
      const failed = out.filter((o) => !o.ok);
      expect(failed).toHaveLength(1);
      expect(failed[0].error).toBeInstanceOf(ConflictException);
      expect(msg(failed[0].error)).toBe(
        'Lệnh đang chạy của tổ Phôi đã đổi (hệ thống có thể vừa tự chuyển) - tải lại màn rồi xem lại',
      );
      expect(await q.statusOf()).toEqual({
        a: FloorQueueStatus.DONE,
        b: FloorQueueStatus.RUNNING,
        c: FloorQueueStatus.QUEUED,
      });
    });

    it('lệnh đang chạy vừa đổi giữa lúc màn mở (hệ thống tự chuyển A -> B): bấm với expected = A bị 409, B vẫn chạy', async () => {
      const q = await setupQueue('ADV3');
      const swap = [
        lockSql(`floor-queue:${STAGE}:${q.wsId}`),
        `UPDATE "floor_queue_entries" SET "status" = 'DONE', "endedAt" = now() WHERE "productionInvoiceId" = ${q.a} AND "stage" = 'PHOI'`,
        `UPDATE "floor_queue_entries" SET "status" = 'RUNNING', "startedAt" = now() WHERE "productionInvoiceId" = ${q.b} AND "stage" = 'PHOI'`,
      ];
      const [out] = await raceWith(swap, [
        () => admin.advance(STAGE, fx.userId, q.wsId, q.a.toString()),
      ]);

      expect(out.waited).toBe(true);
      expect(out.ok).toBe(false);
      expect(out.error).toBeInstanceOf(ConflictException);
      expect(msg(out.error)).toContain('Lệnh đang chạy của tổ Phôi đã đổi');
      expect(await q.statusOf()).toEqual({
        a: FloorQueueStatus.DONE,
        b: FloorQueueStatus.RUNNING,
        c: FloorQueueStatus.QUEUED,
      });
    });

    it('expected = null: tổ đã có lệnh chạy -> 409, không đổi gì; tổ chưa chạy lệnh nào -> bắt đầu lệnh đầu hàng', async () => {
      const busy = await setupQueue('ADV4a');
      await expect(admin.advance(STAGE, fx.userId, busy.wsId, null)).rejects.toThrow(
        ConflictException,
      );
      expect(await busy.statusOf()).toEqual({
        a: FloorQueueStatus.RUNNING,
        b: FloorQueueStatus.QUEUED,
        c: FloorQueueStatus.QUEUED,
      });

      const idle = await setupQueue('ADV4b', false);
      await admin.advance(STAGE, fx.userId, idle.wsId, null);
      expect(await idle.statusOf()).toEqual({
        a: FloorQueueStatus.RUNNING,
        b: FloorQueueStatus.QUEUED,
        c: FloorQueueStatus.QUEUED,
      });
    });

    it('expected sai (id lệnh khác): 409; không gửi expected (undefined): không kiểm, như bản cũ', async () => {
      const q = await setupQueue('ADV5');
      await expect(admin.advance(STAGE, fx.userId, q.wsId, q.c.toString())).rejects.toThrow(
        ConflictException,
      );
      expect((await q.statusOf()).a).toBe(FloorQueueStatus.RUNNING);

      await admin.advance(STAGE, fx.userId, q.wsId);
      expect(await q.statusOf()).toEqual({
        a: FloorQueueStatus.DONE,
        b: FloorQueueStatus.RUNNING,
        c: FloorQueueStatus.QUEUED,
      });
    });

    it('lượt tự chuyển nền (autoCompletePhoi) và bấm tay cùng lúc: bấm tay mang expected cũ bị 409, không nhảy 2 lệnh', async () => {
      const q = await setupQueue('ADV6');
      const aEntry = await prisma.floorQueueEntry.findFirstOrThrow({
        where: { productionInvoiceId: q.a, stage: MfgStage.PHOI },
      });
      const out = await raceWith(
        [lockSql(`floor-queue:${STAGE}:${q.wsId}`)],
        [
          () => admin.autoCompletePhoi(aEntry.id),
          () => admin.advance(STAGE, fx.userId, q.wsId, q.a.toString()),
        ],
      );
      expect(out.every((o) => o.waited)).toBe(true);
      // autoCompletePhoi hoặc advance đứng trước đều được; kết quả cuối: đúng 1 lần chuyển (A xong, B chạy, C chờ)
      expect(await q.statusOf()).toEqual({
        a: FloorQueueStatus.DONE,
        b: FloorQueueStatus.RUNNING,
        c: FloorQueueStatus.QUEUED,
      });
    });
  });

  // =====================================================================================
  // 2 + 3. Chia máy tay, xếp hàng đợi Phôi, tắt máy
  // =====================================================================================
  describe('2. chia máy tay (cut-allocation/add + follow-up)', () => {
    const countPhoiEntries = (piId: bigint) =>
      prisma.floorQueueEntry.count({
        where: { stage: MfgStage.PHOI, productionInvoiceId: piId },
      });
    const openTinsOfPi = (piId: bigint) =>
      prisma.notification.findMany({
        where: {
          type: 'CUT_PULL_STEEL_TO_ISSUE',
          entityId: piId.toString(),
          recipients: { some: { resolvedAt: null } },
        },
      });
    const rowsOf = (piId: bigint) =>
      prisma.cutAllocation.findMany({ where: { productionInvoiceId: piId } });

    /** Giống controller: add rồi follow-up (MANUAL). */
    async function manualAdd(wsId: bigint, piId: bigint, materialId: bigint) {
      const r = await alloc.add(fx.userId, {
        workshopId: wsId.toString(),
        productionInvoiceId: piId.toString(),
        materialId: materialId.toString(),
      });
      await followUp.afterAllocated({
        workshopId: r.board.workshop.id,
        orders: r.allocated,
        source: 'MANUAL',
      });
      return r;
    }

    async function setupOrder(tag: string, floorStage: ProductionOrderFloorStage) {
      const ws = await fx.makeWorkshop(tag);
      const machineId = await fx.makeMachine(ws.workshopId, SolverMachine.tu_dong, tag);
      const materialId = await fx.makeMaterial(tag);
      const piId = await fx.makeOrder(ws.workshopId, tag);
      queueEntryPiIds.push(piId);
      await fx.makeProposal(piId, materialId, PATTERN_10, SolverMachine.tu_dong);
      await prisma.productionOrder.updateMany({
        where: { productionInvoiceItem: { productionInvoiceId: piId } },
        data: { floorStage },
      });
      return { ws, machineId, materialId, piId };
    }

    it('lệnh CHƯA Bắt đầu (PENDING) hoặc chỉ có SKU Tạm dừng: 400 đúng câu, không có dòng chia, không có hàng đợi, không tin', async () => {
      for (const stage of [ProductionOrderFloorStage.PENDING, ProductionOrderFloorStage.PAUSED]) {
        const s = await setupOrder(`NS${stage}`, stage);
        const err = await manualAdd(s.ws.workshopId, s.piId, s.materialId).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(BadRequestException);
        expect(msg(err)).toContain('chưa có SKU nào đang chạy ở xưởng này');
        expect(msg(err)).toContain('bấm Bắt đầu ở Tổng hợp lệnh SX rồi mới chia máy cắt');
        expect(await rowsOf(s.piId)).toHaveLength(0);
        expect(await countPhoiEntries(s.piId)).toBe(0);
        expect(await openTinsOfPi(s.piId)).toHaveLength(0);
      }
    });

    it('lệnh đã Bắt đầu: chia được, xếp ĐÚNG 1 dòng hàng đợi Phôi (cuối hàng, hệ thống thêm); chia lần 2 không thêm dòng, không báo thủ kho lại', async () => {
      const s = await setupOrder('ST1', ProductionOrderFloorStage.ACTIVE);
      await fx.reserve(s.piId, s.materialId, s.ws.warehouseId, 10);

      const first = await manualAdd(s.ws.workshopId, s.piId, s.materialId);
      expect(first.allocated.map((o) => o.productionInvoiceId)).toEqual([s.piId.toString()]);
      const rows1 = await rowsOf(s.piId);
      expect(rows1.length).toBeGreaterThan(0);
      expect(rows1.reduce((n, r) => n + r.barCount, 0)).toBe(10);
      expect(rows1.every((r) => r.isManual)).toBe(true);

      expect(await countPhoiEntries(s.piId)).toBe(1);
      const entry = await prisma.floorQueueEntry.findFirstOrThrow({
        where: { stage: MfgStage.PHOI, productionInvoiceId: s.piId },
      });
      expect(entry).toMatchObject({
        status: FloorQueueStatus.QUEUED,
        workshopId: s.ws.workshopId,
        queuedById: null,
      });
      const tins1 = await openTinsOfPi(s.piId);
      expect(tins1).toHaveLength(1);
      expect(tins1[0].message).toContain('QLSX vừa chia lệnh này cho máy cắt');
      expect(tins1[0].dedupeKey).toBe(`cut-pull-steel:${s.piId}`);

      // bấm chia lần 2: dựng lại y nguyên -> không thêm dòng chia, không thêm hàng đợi, không gộp / phát lại tin
      const second = await manualAdd(s.ws.workshopId, s.piId, s.materialId);
      expect(second.allocated).toEqual([]);
      expect((await rowsOf(s.piId)).map((r) => r.id).sort()).toEqual(rows1.map((r) => r.id).sort());
      expect(await countPhoiEntries(s.piId)).toBe(1);
      const tins2 = await openTinsOfPi(s.piId);
      expect(tins2.map((t) => t.id)).toEqual(tins1.map((t) => t.id));
    });

    it('bấm chia 2 lần CÙNG LÚC (khoá chia theo xưởng): vẫn đúng 1 dòng hàng đợi Phôi và 1 tin', async () => {
      const s = await setupOrder('ST2', ProductionOrderFloorStage.ACTIVE);
      await fx.reserve(s.piId, s.materialId, s.ws.warehouseId, 10);
      const call = () => manualAdd(s.ws.workshopId, s.piId, s.materialId);
      const out = await raceWith([lockSql(`cut-allocation:${s.ws.workshopId}`)], [call, call]);

      expect(out.every((o) => o.waited)).toBe(true);
      expect(out.every((o) => o.ok)).toBe(true);
      // tổng cây chia = 10 (không chia 2 lần thành 20)
      expect((await rowsOf(s.piId)).reduce((n, r) => n + r.barCount, 0)).toBe(10);
      expect(await countPhoiEntries(s.piId)).toBe(1);
      expect(await openTinsOfPi(s.piId)).toHaveLength(1);
    });

    it('lệnh ĐÃ nằm trong hàng đợi Phôi (đang chờ): chia tay không thêm dòng thứ hai, giữ nguyên dòng cũ', async () => {
      const s = await setupOrder('ST3', ProductionOrderFloorStage.ACTIVE);
      const existing = await prisma.floorQueueEntry.create({
        data: {
          stage: MfgStage.PHOI,
          productionInvoiceId: s.piId,
          workshopId: s.ws.workshopId,
          position: 7,
          status: FloorQueueStatus.QUEUED,
          queuedById: fx.userId,
        },
      });
      await manualAdd(s.ws.workshopId, s.piId, s.materialId);
      const entries = await prisma.floorQueueEntry.findMany({
        where: { stage: MfgStage.PHOI, productionInvoiceId: s.piId },
      });
      expect(entries.map((e) => [e.id, e.position, e.queuedById])).toEqual([
        [existing.id, 7, fx.userId],
      ]);
    });

    it('đối soát nền (queueMissingPhoi): lệnh có dòng chia mà thiếu hàng đợi Phôi được bổ sung đúng 1 dòng, gọi lại không thêm', async () => {
      const s = await setupOrder('ST4', ProductionOrderFloorStage.ACTIVE);
      await fx.reserve(s.piId, s.materialId, s.ws.warehouseId, 10);
      // chia thẳng qua service chia (không follow-up) = lệnh có dòng chia mà chưa có hàng đợi
      await alloc.add(fx.userId, {
        workshopId: s.ws.workshopId.toString(),
        productionInvoiceId: s.piId.toString(),
        materialId: s.materialId.toString(),
      });
      expect(await countPhoiEntries(s.piId)).toBe(0);

      const started = await alloc.startedAllocationPiIds(s.ws.workshopId);
      expect(started.map(String)).toEqual([s.piId.toString()]);
      await followUp.queueMissingPhoi(started);
      await followUp.queueMissingPhoi(started);
      expect(await countPhoiEntries(s.piId)).toBe(1);
    });

    it('3. tắt máy cắt: xoá dòng chia của máy đó (máy khác giữ nguyên) và ghi nhật ký REMOVE "Máy cắt bị tắt"', async () => {
      const s = await setupOrder('OFF1', ProductionOrderFloorStage.ACTIVE);
      const other = await fx.makeMachine(s.ws.workshopId, SolverMachine.tu_dong, 'OFF1b');
      await fx.reserve(s.piId, s.materialId, s.ws.warehouseId, 10);
      const { patternIds } = await prisma.cuttingProposalPattern
        .findMany({
          where: { line: { cuttingProposal: { productionInvoiceId: s.piId } } },
          select: { id: true },
        })
        .then((p) => ({ patternIds: p.map((x) => x.id) }));
      const proposalId = (
        await prisma.cuttingProposal.findFirstOrThrow({ where: { productionInvoiceId: s.piId } })
      ).id;
      const mkRow = (machine: bigint, bars: number, seq: number) =>
        prisma.cutAllocation.create({
          data: {
            workshopId: s.ws.workshopId,
            workstationId: machine,
            productionInvoiceId: s.piId,
            cuttingProposalId: proposalId,
            patternId: patternIds[0],
            machineClass: 'TU_DONG',
            barCount: bars,
            seq,
            isManual: true,
          },
        });
      await mkRow(s.machineId, 6, 1);
      await mkRow(s.machineId, 1, 2);
      await mkRow(other, 3, 3);

      const res = await admin.updateWorkstation(
        s.machineId.toString(),
        { isActive: false },
        fx.userId,
      );
      expect((res as { isActive: boolean }).isActive).toBe(false);

      const left = await rowsOf(s.piId);
      expect(left.map((r) => r.workstationId)).toEqual([other]);
      const logs = await prisma.cutAllocationLog.findMany({
        where: { workshopId: s.ws.workshopId, action: CutAllocationLogAction.REMOVE },
      });
      expect(logs).toHaveLength(2);
      expect(
        logs.every((l) => l.note === 'Máy cắt bị tắt' && l.fromWorkstationId === s.machineId),
      ).toBe(true);
      expect(logs.every((l) => l.createdById === fx.userId)).toBe(true);
      expect(logs.reduce((n, l) => n + l.barCount, 0)).toBe(7);

      // tắt lần nữa (đã tắt) không xoá thêm gì, không ghi thêm nhật ký
      await admin.updateWorkstation(s.machineId.toString(), { isActive: false }, fx.userId);
      expect(await rowsOf(s.piId)).toHaveLength(1);
      expect(
        await prisma.cutAllocationLog.count({
          where: { workshopId: s.ws.workshopId, action: CutAllocationLogAction.REMOVE },
        }),
      ).toBe(2);
    });

    it('3. đổi xưởng máy cắt: xoá dòng chia cũ, ghi nhật ký "Máy cắt đổi xưởng"; đổi tên thuần không xoá', async () => {
      const s = await setupOrder('MV1', ProductionOrderFloorStage.ACTIVE);
      const ws2 = await fx.makeWorkshop('MV2');
      await fx.reserve(s.piId, s.materialId, s.ws.warehouseId, 10);
      await alloc.add(fx.userId, {
        workshopId: s.ws.workshopId.toString(),
        productionInvoiceId: s.piId.toString(),
        materialId: s.materialId.toString(),
      });
      const before = await rowsOf(s.piId);
      expect(before.length).toBeGreaterThan(0);
      expect(before.every((r) => r.workstationId === s.machineId)).toBe(true);

      await admin.updateWorkstation(s.machineId.toString(), { name: 'Máy đổi tên' }, fx.userId);
      expect(await rowsOf(s.piId)).toHaveLength(before.length);

      await admin.updateWorkstation(
        s.machineId.toString(),
        { workshopId: ws2.workshopId.toString() },
        fx.userId,
      );
      expect(await rowsOf(s.piId)).toHaveLength(0);
      const logs = await prisma.cutAllocationLog.findMany({
        where: { workshopId: s.ws.workshopId, action: CutAllocationLogAction.REMOVE },
      });
      expect(logs).toHaveLength(before.length);
      expect(logs.every((l) => l.note === 'Máy cắt đổi xưởng')).toBe(true);
      expect(
        (await prisma.workstation.findUniqueOrThrow({ where: { id: s.machineId } })).workshopId,
      ).toBe(ws2.workshopId);
    });

    it('3. tắt máy cùng lúc với chia tay (cùng khoá theo xưởng): sau cùng KHÔNG còn dòng chia nào trên máy đã tắt', async () => {
      const s = await setupOrder('OFF2', ProductionOrderFloorStage.ACTIVE);
      const other = await fx.makeMachine(s.ws.workshopId, SolverMachine.tu_dong, 'OFF2b');
      await fx.reserve(s.piId, s.materialId, s.ws.warehouseId, 10);
      const out = await raceWith(
        [lockSql(`cut-allocation:${s.ws.workshopId}`)],
        [
          () => manualAdd(s.ws.workshopId, s.piId, s.materialId),
          () => admin.updateWorkstation(s.machineId.toString(), { isActive: false }, fx.userId),
        ],
      );
      expect(out.every((o) => o.waited)).toBe(true);
      expect(out.map((o) => o.ok)).toEqual([true, true]);
      const rows = await rowsOf(s.piId);
      expect(rows.some((r) => r.workstationId === s.machineId)).toBe(false);
      expect(rows.length === 0 || rows.every((r) => r.workstationId === other)).toBe(true);
      expect(
        (await prisma.workstation.findUniqueOrThrow({ where: { id: s.machineId } })).isActive,
      ).toBe(false);
    });
  });

  // =====================================================================================
  // 4. Nhắc Kết thúc (đóng gói đủ)
  // =====================================================================================
  describe('4. nhắc Kết thúc khi đóng gói đủ', () => {
    async function makeSku(opts: {
      pi: bigint;
      qty: number;
      floorStage?: ProductionOrderFloorStage;
      workshopId?: bigint | null;
    }) {
      const item = await prisma.productionInvoiceItem.create({
        data: {
          productionInvoiceId: opts.pi,
          mfgProductId: ownProductId,
          quantity: opts.qty,
          workshopId: opts.workshopId ?? null,
        },
      });
      own.items.push(item.id);
      const order = await prisma.productionOrder.create({
        data: {
          poNumber: `N1-PO-${sfx}-${item.id}`,
          productionInvoiceItemId: item.id,
          mfgProductId: ownProductId,
          bomRevisionId: ownBomId,
          quantity: opts.qty,
          floorStage: opts.floorStage ?? ProductionOrderFloorStage.ACTIVE,
        },
      });
      own.orders.push(order.id);
      return { itemId: item.id, orderId: order.id };
    }
    async function makePi(
      tag: string,
      status: ProductionInvoiceStatus = ProductionInvoiceStatus.PRODUCING,
    ) {
      const pi = await prisma.productionInvoice.create({
        data: { code: `N1-PI-${tag}-${sfx}`, status },
      });
      own.invoices.push(pi.id);
      return pi.id;
    }
    const readyTins = (itemId: bigint) =>
      prisma.notification.findMany({
        where: { type: 'PI_ITEM_READY_TO_FINISH', entityId: itemId.toString() },
        include: { recipients: true },
      });
    const openCount = async (itemId: bigint) =>
      (await readyTins(itemId)).filter((t) => t.recipients.some((r) => r.resolvedAt == null))
        .length;
    const pack = (pi: bigint, item: bigint, boxes: number) =>
      invoices.recordPackaging(pi.toString(), item.toString(), { boxesPacked: boxes }, qlsxId);

    it('đóng chưa đủ: không tin; đóng vừa đủ: đúng 1 tin (đúng người, đúng link); đóng thêm bị 400 và vẫn 1 tin; Kết thúc: tin đóng', async () => {
      const pi = await makePi('A');
      const { itemId, orderId } = await makeSku({ pi, qty: 5 });

      await pack(pi, itemId, 3);
      expect(await readyTins(itemId)).toHaveLength(0);

      await pack(pi, itemId, 2);
      const tins = await readyTins(itemId);
      expect(tins).toHaveLength(1);
      expect(tins[0]).toMatchObject({
        dedupeKey: `pi-item-ready-to-finish:${itemId}`,
        entityType: 'PRODUCTION_INVOICE_ITEM',
        category: 'ACTION_REQUIRED',
      });
      expect(tins[0].title).toContain('đã đóng gói đủ - bấm Kết thúc');
      expect(tins[0].recipients.map((r) => r.userId)).toEqual([qlsxId]);
      expect(tins[0].recipients[0].resolvedAt).toBeNull();
      expect(tins[0].link).toMatchObject({
        module: 'production',
        page: 'ke-hoach',
        params: { pi: pi.toString(), focus: `PRODUCTION_INVOICE_ITEM:${itemId}` },
      });
      // người nhận tính theo vai QLSX (tiêu chí gửi cho bộ tính người nhận)
      expect(
        recipientCalls.some(
          (c) => JSON.stringify(c) === JSON.stringify({ roles: ['PRODUCTION_MANAGER'] }),
        ),
      ).toBe(true);

      await expect(pack(pi, itemId, 1)).rejects.toThrow(BadRequestException);
      expect(await readyTins(itemId)).toHaveLength(1);
      expect(await openCount(itemId)).toBe(1);

      await orders.finishFloor(orderId.toString());
      expect(await openCount(itemId)).toBe(0);
      expect(await readyTins(itemId)).toHaveLength(1); // tin vẫn còn trong lịch sử, chỉ đóng
      expect(
        (await prisma.productionOrder.findUniqueOrThrow({ where: { id: orderId } })).floorStage,
      ).toBe(ProductionOrderFloorStage.FINISHED);
    });

    it('2 người đóng cùng lúc (2 + 3 = vừa đủ 5): đúng 1 tin', async () => {
      const pi = await makePi('B');
      const { itemId } = await makeSku({ pi, qty: 5 });
      const out = await raceWith(
        [lockSql(`packaging:${itemId}`)],
        [() => pack(pi, itemId, 2), () => pack(pi, itemId, 3)],
      );
      expect(out.every((o) => o.waited)).toBe(true);
      expect(out.every((o) => o.ok)).toBe(true);
      expect(await readyTins(itemId)).toHaveLength(1);
      expect(await openCount(itemId)).toBe(1);
    });

    it('2 người cùng đóng 3 khi còn 5: 1 đạt, 1 bị 400 vượt số còn đóng được; không có tin (mới đóng 3/5)', async () => {
      const pi = await makePi('C');
      const { itemId } = await makeSku({ pi, qty: 5 });
      const call = () => pack(pi, itemId, 3);
      const out = await raceWith([lockSql(`packaging:${itemId}`)], [call, call]);
      expect(out.filter((o) => o.ok)).toHaveLength(1);
      const bad = out.find((o) => !o.ok);
      expect(bad?.error).toBeInstanceOf(BadRequestException);
      expect(msg(bad?.error)).toContain('vượt quá số còn có thể đóng');
      expect(await readyTins(itemId)).toHaveLength(0);
    });

    it('SKU đã Kết thúc trước khi đóng nốt: không phát tin (lệnh còn SKU khác đang chạy nên vẫn ghi đóng gói được)', async () => {
      const pi = await makePi('D');
      await makeSku({ pi, qty: 1 }); // SKU ACTIVE khác giữ cổng "lệnh đang chạy"
      const done = await makeSku({ pi, qty: 2, floorStage: ProductionOrderFloorStage.FINISHED });
      await pack(pi, done.itemId, 2);
      expect(await readyTins(done.itemId)).toHaveLength(0);
    });
  });

  // =====================================================================================
  // 5. Tin chuyển mảnh sang Sơn tự đóng khi lệnh DONE
  // =====================================================================================
  describe('5. nhắc chuyển mảnh hàn xong sang kho Sơn (xưởng không có kho Sơn)', () => {
    async function setupWeld(tag: string, pieceQty: number, stockQty: number) {
      const ws = await fx.makeWorkshop(tag); // chỉ có kho Phôi -> workshopHasPaint = false
      const weld = await prisma.warehouse.create({
        data: {
          code: `N1-HAN-${tag}-${sfx}`,
          name: `Kho Hàn ${tag}`,
          kind: WarehouseKind.HAN,
          workshopId: ws.workshopId,
        },
      });
      own.warehouses.push(weld.id);
      const piece = await prisma.piece.create({
        data: {
          mfgProductId: ownProductId,
          code: `N1P${tag}`,
          groupNumber: 1,
          pieceNumber: 1,
          name: `Mảnh ${tag}`,
        },
      });
      own.pieces.push(piece.id);
      await prisma.bomPiece.create({
        data: {
          bomRevisionId: ownBomId,
          pieceId: piece.id,
          qtyPerUnit: 1,
          needsHan: true,
          needsSon: true,
        },
      });
      const pi = await prisma.productionInvoice.create({
        data: { code: `N1-PI-W${tag}-${sfx}`, status: ProductionInvoiceStatus.PRODUCING },
      });
      own.invoices.push(pi.id);
      const item = await prisma.productionInvoiceItem.create({
        data: {
          productionInvoiceId: pi.id,
          mfgProductId: ownProductId,
          quantity: pieceQty,
          workshopId: ws.workshopId,
        },
      });
      own.items.push(item.id);
      const order = await prisma.productionOrder.create({
        data: {
          poNumber: `N1-POW-${sfx}-${item.id}`,
          productionInvoiceItemId: item.id,
          mfgProductId: ownProductId,
          bomRevisionId: ownBomId,
          quantity: pieceQty,
          floorStage: ProductionOrderFloorStage.ACTIVE,
        },
      });
      own.orders.push(order.id);
      await prisma.productionBatch.create({
        data: {
          stage: MfgStage.HAN,
          productionOrderId: order.id,
          pieceId: piece.id,
          reportedQty: pieceQty,
          status: ProductionBatchStatus.QC_DONE,
          reportedById: qlsxId,
        },
      });
      const quant = await prisma.stockQuant.create({
        data: { warehouseId: weld.id, pieceId: piece.id, qty: stockQty },
      });
      return { ws, weld, piece, piId: pi.id, orderId: order.id, quantId: quant.id };
    }

    const paintTins = (piId: bigint) =>
      prisma.notification.findMany({
        where: { type: 'PIECES_TO_PAINT_PENDING', entityId: piId.toString() },
        include: { recipients: true },
      });
    const openPaint = async (piId: bigint) =>
      (await paintTins(piId)).filter((t) => t.recipients.some((r) => r.resolvedAt == null));

    it('số mảnh chờ = tồn thật ở kho Hàn: phát 1 tin; chạy nền lại không nhân đôi; số giảm giữ trạng thái đã đọc; số tăng hiện lại chưa đọc', async () => {
      const prevAlerts = process.env.FLOOR_ALERTS;
      delete process.env.FLOOR_ALERTS;
      try {
        const s = await setupWeld('P1', 6, 4); // lô Hàn đạt 6 nhưng kho Hàn chỉ còn 4 -> chờ chuyển 4
        const map = await paint.pendingByPi(s.piId);
        expect(map.get(s.piId.toString())?.pendingQty).toBe(4);

        await paint.syncAll();
        let tins = await openPaint(s.piId);
        expect(tins).toHaveLength(1);
        expect(tins[0]).toMatchObject({
          dedupeKey: `pieces-to-paint-pending:${s.piId}`,
          entityType: 'PRODUCTION_INVOICE',
          entityId: s.piId.toString(),
        });
        expect((tins[0].data as { pendingQty: number }).pendingQty).toBe(4);
        expect((tins[0].data as { weldWarehouseCodes: string[] }).weldWarehouseCodes).toEqual([
          s.weld.code,
        ]);
        expect(tins[0].title).toContain('4 mảnh hàn xong chờ chuyển sang');
        const tinId = tins[0].id;

        await paint.syncAll();
        expect((await openPaint(s.piId)).map((t) => t.id)).toEqual([tinId]);

        // người nhận đã đọc; số giảm 4 -> 2: cập nhật nội dung, KHÔNG đánh dấu chưa đọc lại
        await prisma.notificationRecipient.updateMany({
          where: { notificationId: tinId },
          data: { readAt: new Date() },
        });
        await prisma.stockQuant.update({ where: { id: s.quantId }, data: { qty: 2 } });
        await paint.syncAll();
        tins = await openPaint(s.piId);
        expect(tins.map((t) => t.id)).toEqual([tinId]);
        expect((tins[0].data as { pendingQty: number }).pendingQty).toBe(2);
        expect(tins[0].recipients[0].readAt).not.toBeNull();

        // số tăng 2 -> 5: gộp vào tin cũ và hiện lại chưa đọc
        await prisma.stockQuant.update({ where: { id: s.quantId }, data: { qty: 5 } });
        await paint.syncAll();
        tins = await openPaint(s.piId);
        expect(tins.map((t) => t.id)).toEqual([tinId]);
        expect((tins[0].data as { pendingQty: number }).pendingQty).toBe(5);
        expect(tins[0].recipients[0].readAt).toBeNull();
      } finally {
        if (prevAlerts === undefined) delete process.env.FLOOR_ALERTS;
        else process.env.FLOOR_ALERTS = prevAlerts;
      }
    });

    it('lệnh DONE (Kết thúc SKU cuối): lượt nhắc nền tự đóng tin; về 0 mảnh cũng đóng', async () => {
      const prevAlerts = process.env.FLOOR_ALERTS;
      delete process.env.FLOOR_ALERTS;
      try {
        const s = await setupWeld('P2', 3, 3);
        await paint.syncAll();
        expect(await openPaint(s.piId)).toHaveLength(1);

        // Kết thúc SKU duy nhất -> lệnh PRODUCING chuyển DONE (code thật của finishFloor)
        await orders.finishFloor(s.orderId.toString());
        expect(
          (await prisma.productionInvoice.findUniqueOrThrow({ where: { id: s.piId } })).status,
        ).toBe(ProductionInvoiceStatus.DONE);
        // chưa chạy nền: tin còn mở; chạy nền: tự đóng, không phát tin mới
        expect(await openPaint(s.piId)).toHaveLength(1);
        await paint.syncAll();
        expect(await openPaint(s.piId)).toHaveLength(0);
        expect(await paintTins(s.piId)).toHaveLength(1);
        await paint.syncAll();
        expect(await paintTins(s.piId)).toHaveLength(1);

        // lệnh khác: tồn mảnh về 0 (thủ kho đã chuyển hết) -> tin đóng
        const t = await setupWeld('P3', 2, 2);
        await paint.syncAll();
        expect(await openPaint(t.piId)).toHaveLength(1);
        await prisma.stockQuant.update({ where: { id: t.quantId }, data: { qty: 0 } });
        await paint.syncAll();
        expect(await openPaint(t.piId)).toHaveLength(0);
      } finally {
        if (prevAlerts === undefined) delete process.env.FLOOR_ALERTS;
        else process.env.FLOOR_ALERTS = prevAlerts;
      }
    });

    it('2 lượt nhắc cùng lúc cho 1 lệnh (khoá theo lệnh): vẫn chỉ 1 tin', async () => {
      const prevAlerts = process.env.FLOOR_ALERTS;
      delete process.env.FLOOR_ALERTS;
      try {
        const s = await setupWeld('P4', 2, 2);
        const call = () => paint.refreshForOrder(s.orderId.toString());
        const out = await raceWith([lockSql(`paint-pending:${s.piId}`)], [call, call]);
        expect(out.every((o) => o.waited)).toBe(true);
        expect(out.every((o) => o.ok)).toBe(true);
        expect(await paintTins(s.piId)).toHaveLength(1);
        expect(await openPaint(s.piId)).toHaveLength(1);
      } finally {
        if (prevAlerts === undefined) delete process.env.FLOOR_ALERTS;
        else process.env.FLOOR_ALERTS = prevAlerts;
      }
    });
  });
});
