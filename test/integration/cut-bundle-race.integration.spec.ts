import { ConflictException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import { Client } from 'pg';
import configuration from '../../src/config/configuration';
import { envValidationSchema } from '../../src/config/env.validation';
import {
  BomRevisionStatus,
  CutBundleStatus,
  FloorReportKind,
  ProcessStep,
  ProductionOrderFloorStage,
  SteelIssueStatus,
} from '../../src/generated/prisma/client';
import { RecordCutBatchDto } from '../../src/modules/steel-issues/dto/record-cut-batch.dto';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { StockLedgerService } from '../../src/modules/stock/stock-ledger.service';
import { StockReservationsService } from '../../src/modules/stock/stock-reservations.service';
import { SteelIssuesService } from '../../src/modules/steel-issues/steel-issues.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PRISMA_SERVICE, PrismaServiceType } from '../../src/prisma/prisma.service';
import { RealtimeService } from '../../src/realtime/realtime.service';
import { TEST_DATABASE_URL } from '../test-db.constants';

/**
 * Tranh chấp đợt cắt (CutBundle) trên Postgres TEST THẬT: báo cắt / gửi KCS / hoàn tác chạy ĐÚNG
 * lúc QLSX gửi KCS hoặc hủy hết đợt.
 *
 * Cách dựng xen kẽ chắc chắn (không dựa may rủi): mở kết nối `pg` RIÊNG, BEGIN, chạy SQL thô mô
 * phỏng "người kia" và CHƯA COMMIT (bản đọc ngoài transaction của service vẫn thấy trạng thái cũ).
 * Gọi hàm service (không await), poll pg_stat_activity tới khi có backend KHÁC chờ khoá (tối đa 5 giây; `waited`
 * báo có chờ thật hay không, các ca xen kẽ khẳng định waited === true), rồi COMMIT kết nối riêng và await
 * service. Kết quả cuối khẳng định trong DB.
 *
 * Dữ liệu tự dựng bằng Prisma, hậu tố riêng, dọn ở afterAll.
 */
describe('Tranh chấp đợt cắt (integration, real Postgres)', () => {
  let prisma: PrismaServiceType;
  let service: SteelIssuesService;
  const notifications = {
    emit: jest.fn<Promise<void>, [string, { entityId?: string }]>().mockResolvedValue(undefined),
  };
  const sfx = Date.now();

  let workerId: string;
  let otherUserId: string;
  let materialId: bigint;
  let mfgProductId: bigint;
  let bomRevisionId: bigint;
  let pieceId: bigint;
  let invoiceId: bigint;
  let itemId: bigint;
  let orderId: bigint;
  let itemId2: bigint;
  let orderId2: bigint;
  let spec1000: bigint;
  let spec1500: bigint;
  const issueIds: bigint[] = [];

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
        SteelIssuesService,
        { provide: StockLedgerService, useValue: {} },
        { provide: StockReservationsService, useValue: {} },
        { provide: NotificationsService, useValue: notifications },
        { provide: RealtimeService, useValue: { publishEntityChanged: jest.fn() } },
      ],
    }).compile();
    prisma = moduleRef.get(PRISMA_SERVICE);
    service = moduleRef.get(SteelIssuesService);

    workerId = (
      await prisma.user.create({
        data: { username: `cutrace-w-${sfx}`, password: 'x', firstName: 'Cut', lastName: 'W' },
      })
    ).id;
    otherUserId = (
      await prisma.user.create({
        data: { username: `cutrace-o-${sfx}`, password: 'x', firstName: 'Cut', lastName: 'O' },
      })
    ).id;
    materialId = (
      await prisma.material.create({
        data: { code: `CUTRACE-SAT-${sfx}`, name: 'Sắt test tranh chấp', unit: 'cây' },
      })
    ).id;
    mfgProductId = (
      await prisma.mfgProduct.create({
        data: { factoryCode: `CUTRACE-${sfx}`, name: 'SP tranh chấp' },
      })
    ).id;
    bomRevisionId = (
      await prisma.bomRevision.create({
        data: { mfgProductId, revNo: 1, status: BomRevisionStatus.DRAFT },
      })
    ).id;
    pieceId = (
      await prisma.piece.create({
        data: { mfgProductId, code: 'P1', groupNumber: 1, pieceNumber: 1, name: 'Mảnh test' },
      })
    ).id;
    spec1000 = (await prisma.segmentSpec.create({ data: { materialId, cutLengthMm: 1000 } })).id;
    spec1500 = (await prisma.segmentSpec.create({ data: { materialId, cutLengthMm: 1500 } })).id;
    for (const segmentSpecId of [spec1000, spec1500]) {
      await prisma.pieceBom.create({
        data: {
          bomRevisionId,
          mfgProductId,
          pieceId,
          segmentSpecId,
          qtyPerPiece: 1,
          processSteps: [ProcessStep.CAT],
        },
      });
    }
    invoiceId = (await prisma.productionInvoice.create({ data: { code: `CUTRACE-PI-${sfx}` } })).id;
    itemId = (
      await prisma.productionInvoiceItem.create({
        data: { productionInvoiceId: invoiceId, mfgProductId, quantity: 1 },
      })
    ).id;
    itemId2 = (
      await prisma.productionInvoiceItem.create({
        data: { productionInvoiceId: invoiceId, mfgProductId, quantity: 1 },
      })
    ).id;
    orderId = (
      await prisma.productionOrder.create({
        data: {
          poNumber: `CUTRACE-PO-${sfx}`,
          productionInvoiceItemId: itemId,
          mfgProductId,
          bomRevisionId,
          quantity: 1,
          floorStage: ProductionOrderFloorStage.ACTIVE,
        },
      })
    ).id;
    // SKU thứ 2 trong cùng PI (đơn sản xuất khác) - chỉ để làm dữ liệu gây nhiễu.
    orderId2 = (
      await prisma.productionOrder.create({
        data: {
          poNumber: `CUTRACE-PO2-${sfx}`,
          productionInvoiceItemId: itemId2,
          mfgProductId,
          bomRevisionId,
          quantity: 1,
          floorStage: ProductionOrderFloorStage.ACTIVE,
        },
      })
    ).id;
  });

  /**
   * Dọn dữ liệu: CHỈ xoá khi id đã có. Prisma coi `{ id: undefined }` là KHÔNG lọc -> deleteMany xoá
   * cả bảng của DB test chung; nên mỗi bước thiếu id (beforeAll hỏng giữa chừng) bị bỏ qua hẳn.
   */
  afterAll(async () => {
    if (!prisma) return;
    const has = <T>(v: T | undefined | null): v is T => v !== undefined && v !== null;
    const orderIds = [orderId, orderId2].filter(has);
    const itemIds = [itemId, itemId2].filter(has);
    const userIds = [workerId, otherUserId].filter(has);
    if (has(invoiceId)) {
      await prisma.floorReportLine.deleteMany({
        where: { floorReport: { productionInvoiceId: invoiceId } },
      });
      await prisma.floorReport.deleteMany({ where: { productionInvoiceId: invoiceId } });
    }
    if (issueIds.length > 0) {
      await prisma.cutPatternSegment.deleteMany({
        where: { cutBundle: { steelIssueId: { in: issueIds } } },
      });
      await prisma.cutBundle.deleteMany({ where: { steelIssueId: { in: issueIds } } });
      await prisma.steelIssue.deleteMany({ where: { id: { in: issueIds } } });
    }
    if (orderIds.length > 0) {
      await prisma.productionOrder.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (itemIds.length > 0) {
      await prisma.productionInvoiceItem.deleteMany({ where: { id: { in: itemIds } } });
    }
    if (has(invoiceId)) await prisma.productionInvoice.deleteMany({ where: { id: invoiceId } });
    if (has(bomRevisionId)) await prisma.pieceBom.deleteMany({ where: { bomRevisionId } });
    if (has(pieceId)) await prisma.piece.deleteMany({ where: { id: pieceId } });
    if (has(materialId)) await prisma.segmentSpec.deleteMany({ where: { materialId } });
    if (has(bomRevisionId)) await prisma.bomRevision.deleteMany({ where: { id: bomRevisionId } });
    if (has(mfgProductId)) await prisma.mfgProduct.deleteMany({ where: { id: mfgProductId } });
    if (has(materialId)) await prisma.material.deleteMany({ where: { id: materialId } });
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    notifications.emit.mockClear();
  });

  // ---------- dựng dữ liệu ----------

  /** Lô sắt đã nhận (RECEIVED) của PI test - mỗi kịch bản 1 lô riêng để không lẫn đợt. */
  async function makeIssue(): Promise<bigint> {
    const issue = await prisma.steelIssue.create({
      data: {
        productionInvoiceId: invoiceId,
        materialId,
        barLengthMm: 6000,
        barCount: 10,
        issuedById: otherUserId,
        status: SteelIssueStatus.RECEIVED,
        receivedAt: new Date(),
        receivedById: workerId,
        receivedBarCount: 10,
      },
    });
    issueIds.push(issue.id);
    return issue.id;
  }

  async function makeBundle(
    steelIssueId: bigint,
    opts: {
      openedById: string | null;
      status?: CutBundleStatus;
      segs: { specId: bigint; qty: number }[];
      withReport?: boolean;
      orderId?: bigint;
    },
  ): Promise<bigint> {
    const bundle = await prisma.cutBundle.create({
      data: {
        steelIssueId,
        productionOrderId: opts.orderId ?? orderId,
        openedById: opts.openedById,
        status: opts.status ?? CutBundleStatus.CUTTING,
        completedSteps: [ProcessStep.CAT],
        segments: { create: opts.segs.map((s) => ({ segmentSpecId: s.specId, qty: s.qty })) },
      },
    });
    if (opts.withReport) {
      await prisma.floorReport.create({
        data: {
          kind: FloorReportKind.CUT,
          reportedById: workerId,
          cutBundleId: bundle.id,
          productionInvoiceId: invoiceId,
          lines: {
            create: opts.segs.map((s) => ({ segmentSpecId: s.specId, qty: s.qty })),
          },
        },
      });
    }
    return bundle.id;
  }

  function dto(specId: bigint, qty: number): RecordCutBatchDto {
    return {
      productionOrderId: orderId.toString(),
      segments: [{ segmentSpecId: specId.toString(), qty }],
    };
  }

  async function segsOf(bundleId: bigint): Promise<Record<string, number>> {
    const rows = await prisma.cutPatternSegment.findMany({ where: { cutBundleId: bundleId } });
    return Object.fromEntries(rows.map((r) => [r.segmentSpecId.toString(), r.qty]));
  }

  async function bundlesOf(issueId: bigint, exclude: bigint[] = []) {
    return prisma.cutBundle.findMany({
      where: { steelIssueId: issueId, id: { notIn: exclude } },
      include: { segments: true, floorReports: true },
      orderBy: { id: 'asc' },
    });
  }

  // ---------- dữ liệu gây nhiễu cho câu chọn đợt ----------

  /**
   * Các đợt KHÔNG được chọn khi `workerId` báo cắt SKU 1000 của lô `issueId` (đơn `orderId`):
   * CUTTING của NGƯỜI KHÁC (cùng lô + SKU); CUTTING của cùng người ở LÔ KHÁC; CUTTING của cùng người
   * cùng lô nhưng SKU (đơn) khác; AWAITING_QC của cùng người cùng lô + SKU.
   * Trả id (để loại khỏi bundlesOf) và hàm khẳng định các đợt này không đổi gì.
   */
  async function seedNoise(issueId: bigint) {
    const otherIssueId = await makeIssue();
    const spec = [{ specId: spec1000, qty: 7 }];
    const ids = [
      await makeBundle(issueId, { openedById: otherUserId, segs: spec }),
      await makeBundle(otherIssueId, { openedById: workerId, segs: spec }),
      await makeBundle(issueId, { openedById: workerId, segs: spec, orderId: orderId2 }),
      await makeBundle(issueId, {
        openedById: workerId,
        status: CutBundleStatus.AWAITING_QC,
        segs: spec,
      }),
    ];
    const snapshot = async () =>
      (
        await prisma.cutBundle.findMany({
          where: { id: { in: ids } },
          include: { segments: true },
          orderBy: { id: 'asc' },
        })
      ).map((x) => ({
        id: x.id,
        status: x.status,
        openedById: x.openedById,
        orderId: x.productionOrderId,
        issueId: x.steelIssueId,
        segs: x.segments.map((g) => [g.segmentSpecId, g.qty]),
      }));
    const before = await snapshot();
    expect(before).toHaveLength(4);
    return {
      ids,
      expectUntouched: async () => {
        expect(await snapshot()).toEqual(before);
      },
    };
  }

  // ---------- giữ transaction thứ hai ----------

  function dbUrl(): string {
    const u = new URL(TEST_DATABASE_URL);
    u.search = '';
    return u.toString();
  }

  interface Outcome<T> {
    ok: boolean;
    value?: T;
    error?: unknown;
    /** true = đã THẤY đủ `minWaiters` phiên khác chờ khoá trước khi COMMIT (xen kẽ thật). */
    waited: boolean;
  }

  /**
   * Chạy `call` (hàm service) trong lúc kết nối riêng giữ `holdSql` chưa commit.
   * Thứ tự: BEGIN + holdSql -> gọi service (không await) -> poll chờ khoá <= 5s -> COMMIT -> await.
   * Chỉ đếm phiên cùng DB, khác kết nối giữ khoá, wait_event_type = 'Lock' (gồm advisory lock).
   * Caller khẳng định `waited === true` để test không lặng lẽ mất tác dụng khi code không chờ khoá.
   */
  async function raceWith<T>(
    holdSql: string[],
    call: () => Promise<T>,
    minWaiters = 1,
  ): Promise<Outcome<T>> {
    const client = new Client({ connectionString: dbUrl() });
    await client.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      const pidRes = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const holderPid = pidRes.rows[0].pid;
      for (const sql of holdSql) await client.query(sql);

      let settled = false;
      const pending = call().then(
        (value): Omit<Outcome<T>, 'waited'> => {
          settled = true;
          return { ok: true, value };
        },
        (error: unknown): Omit<Outcome<T>, 'waited'> => {
          settled = true;
          return { ok: false, error };
        },
      );

      let waited = false;
      const deadline = Date.now() + 5000;
      while (!settled && Date.now() < deadline) {
        const rows = await prisma.$queryRaw<{ n: bigint }[]>`
          SELECT count(*)::bigint AS n FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> ${holderPid}::int
            AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock'`;
        if (rows[0] && rows[0].n >= BigInt(minWaiters)) {
          waited = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 25));
      }

      await client.query('COMMIT');
      committed = true;
      return { ...(await pending), waited };
    } finally {
      if (!committed) await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  }

  const toKcsSql = (bundleId: bigint, completedAt = 'now()') =>
    `UPDATE "cut_bundles" SET "status" = 'AWAITING_QC', "completedAt" = ${completedAt} WHERE "id" = ${bundleId.toString()}`;
  const deleteBundleSql = (bundleId: bigint) => [
    `DELETE FROM "cut_pattern_segments" WHERE "cutBundleId" = ${bundleId.toString()}`,
    `DELETE FROM "cut_bundles" WHERE "id" = ${bundleId.toString()}`,
  ];

  // ---------- kịch bản lỗi tranh chấp ----------

  it('S1 báo cắt đúng lúc QLSX gửi KCS: đợt đã gửi KCS giữ nguyên, mở đợt CUTTING mới', async () => {
    const issueId = await makeIssue();
    const b = await makeBundle(issueId, {
      openedById: workerId,
      segs: [{ specId: spec1000, qty: 10 }],
    });
    const noise = await seedNoise(issueId);

    const out = await raceWith([toKcsSql(b)], () =>
      service.recordCutBatch(issueId.toString(), dto(spec1000, 5), workerId),
    );

    expect(out.waited).toBe(true);
    expect(out.error).toBeUndefined();
    expect(await segsOf(b)).toEqual({ [spec1000.toString()]: 10 });
    await noise.expectUntouched();
    const bundles = await bundlesOf(issueId, noise.ids);
    const old = bundles.find((x) => x.id === b)!;
    expect(old.status).toBe(CutBundleStatus.AWAITING_QC);
    expect(old.floorReports).toHaveLength(0);
    const fresh = bundles.filter((x) => x.id !== b);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].status).toBe(CutBundleStatus.CUTTING);
    expect(fresh[0].openedById).toBe(workerId);
    expect(fresh[0].segments.map((s) => [s.segmentSpecId, s.qty])).toEqual([[spec1000, 5]]);
    expect(fresh[0].floorReports).toHaveLength(1);
  }, 30000);

  it('S2 báo cắt đúng lúc QLSX hủy hết đợt: báo thành công vào đợt mới 5 đoạn', async () => {
    const issueId = await makeIssue();
    const b = await makeBundle(issueId, {
      openedById: workerId,
      segs: [{ specId: spec1000, qty: 10 }],
    });

    const out = await raceWith(deleteBundleSql(b), () =>
      service.recordCutBatch(issueId.toString(), dto(spec1000, 5), workerId),
    );

    expect(out.waited).toBe(true);
    expect(out.error).toBeUndefined();
    const bundles = await bundlesOf(issueId);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].id).not.toBe(b);
    expect(bundles[0].status).toBe(CutBundleStatus.CUTTING);
    expect(bundles[0].segments.map((s) => [s.segmentSpecId, s.qty])).toEqual([[spec1000, 5]]);
    expect(bundles[0].floorReports).toHaveLength(1);
  }, 30000);

  it('S3 gửi KCS đúng lúc đợt bị hủy hết: ConflictException, không lỗi khác', async () => {
    const issueId = await makeIssue();
    const b = await makeBundle(issueId, {
      openedById: workerId,
      segs: [{ specId: spec1000, qty: 10 }],
    });

    const out = await raceWith(deleteBundleSql(b), () => service.finishCutBundle(b.toString()));

    expect(out.waited).toBe(true);
    expect(out.ok).toBe(false);
    expect(out.error).toBeInstanceOf(ConflictException);
    expect(notifications.emit).not.toHaveBeenCalled();
    expect(await bundlesOf(issueId)).toHaveLength(0);
  }, 30000);

  it('S4 2 người cùng gửi KCS 1 đợt: người đến sau nhận ConflictException, giữ completedAt người trước, không thông báo lần 2', async () => {
    const issueId = await makeIssue();
    const b = await makeBundle(issueId, {
      openedById: workerId,
      segs: [{ specId: spec1000, qty: 10 }],
    });
    const t0 = new Date('2020-01-01T00:00:00.000Z');

    const out = await raceWith([toKcsSql(b, `'${t0.toISOString()}'`)], () =>
      service.finishCutBundle(b.toString()),
    );

    expect(out.waited).toBe(true);
    expect(out.ok).toBe(false);
    expect(out.error).toBeInstanceOf(ConflictException);
    const after = await prisma.cutBundle.findUniqueOrThrow({ where: { id: b } });
    expect(after.status).toBe(CutBundleStatus.AWAITING_QC);
    expect(after.completedAt?.toISOString()).toBe(t0.toISOString());
    const kcsCalls = notifications.emit.mock.calls.filter((c) => c[0] === 'CUT_BUNDLE_TO_KCS');
    expect(kcsCalls).toHaveLength(0);
  }, 30000);

  it('S5 hoàn tác đúng lúc gửi KCS: ConflictException, số đoạn của đợt không đổi', async () => {
    const issueId = await makeIssue();
    const b = await makeBundle(issueId, {
      openedById: workerId,
      segs: [{ specId: spec1000, qty: 10 }],
      withReport: true,
    });

    const out = await raceWith([toKcsSql(b)], () =>
      service.undoLastCutBatch(
        b.toString(),
        [{ segmentSpecId: spec1000.toString(), qty: 10 }],
        workerId,
      ),
    );

    expect(out.waited).toBe(true);
    expect(out.ok).toBe(false);
    expect(out.error).toBeInstanceOf(ConflictException);
    expect(await segsOf(b)).toEqual({ [spec1000.toString()]: 10 });
    const reversals = await prisma.floorReport.count({
      where: { productionInvoiceId: invoiceId, cutBundleId: b, reversalOfId: { not: null } },
    });
    expect(reversals).toBe(0);
  }, 30000);

  it('S6 cùng người báo 2 lần cùng lúc khi chưa có đợt mở: đúng 1 đợt CUTTING chứa tổng, 2 dòng sổ', async () => {
    const issueId = await makeIssue();
    // Đúng khoá advisory service dùng (lockBusinessKey): giữ chưa commit để cả 2 lần báo cùng xếp hàng.
    const lockSql = `SELECT pg_advisory_xact_lock(hashtext('cut-report:${issueId}:${orderId}:${workerId}')::bigint)`;

    const out = await raceWith(
      [lockSql],
      () =>
        Promise.allSettled([
          service.recordCutBatch(issueId.toString(), dto(spec1000, 3), workerId, `s6a-${sfx}`),
          service.recordCutBatch(issueId.toString(), dto(spec1000, 4), workerId, `s6b-${sfx}`),
        ]),
      2,
    );

    expect(out.waited).toBe(true);
    expect(out.value?.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const bundles = await bundlesOf(issueId);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].status).toBe(CutBundleStatus.CUTTING);
    expect(bundles[0].openedById).toBe(workerId);
    expect(bundles[0].segments.map((s) => [s.segmentSpecId, s.qty])).toEqual([[spec1000, 7]]);
    expect(bundles[0].floorReports).toHaveLength(2);
  }, 30000);

  it('S7 QLSX hủy một phần (đợt vẫn CUTTING) đúng lúc công nhân báo: cộng vào đúng đợt đó, không mở đợt mới', async () => {
    const issueId = await makeIssue();
    const b = await makeBundle(issueId, {
      openedById: workerId,
      segs: [
        { specId: spec1000, qty: 10 },
        { specId: spec1500, qty: 6 },
      ],
    });
    // Mô phỏng reverseCut hủy một phần: khoá dòng đợt (FOR UPDATE) rồi giảm 4 đoạn 1000, đợt còn đoạn.
    const holdSql = [
      `SELECT "id" FROM "cut_bundles" WHERE "id" = ${b.toString()} FOR UPDATE`,
      `UPDATE "cut_pattern_segments" SET "qty" = "qty" - 4 WHERE "cutBundleId" = ${b.toString()} AND "segmentSpecId" = ${spec1000.toString()}`,
    ];

    const out = await raceWith(holdSql, () =>
      service.recordCutBatch(issueId.toString(), dto(spec1000, 5), workerId),
    );

    expect(out.waited).toBe(true);
    expect(out.error).toBeUndefined();
    const bundles = await bundlesOf(issueId);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].id).toBe(b);
    expect(bundles[0].status).toBe(CutBundleStatus.CUTTING);
    expect(await segsOf(b)).toEqual({
      [spec1000.toString()]: 10 - 4 + 5,
      [spec1500.toString()]: 6,
    });
    expect(bundles[0].floorReports).toHaveLength(1);
  }, 30000);

  // ---------- hồi quy (xanh trước và sau khi sửa) ----------

  it('R1 báo 2 lần liên tiếp: cộng dồn vào CÙNG 1 đợt CUTTING', async () => {
    const issueId = await makeIssue();
    const noise = await seedNoise(issueId);
    await service.recordCutBatch(issueId.toString(), dto(spec1000, 3), workerId);
    await service.recordCutBatch(issueId.toString(), dto(spec1000, 4), workerId);

    await noise.expectUntouched();
    const bundles = await bundlesOf(issueId, noise.ids);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].status).toBe(CutBundleStatus.CUTTING);
    expect(bundles[0].openedById).toBe(workerId);
    expect(bundles[0].segments.map((s) => [s.segmentSpecId, s.qty])).toEqual([[spec1000, 7]]);
    expect(bundles[0].floorReports).toHaveLength(2);
  }, 30000);

  it('R2 đợt cũ chưa có người mở: người báo đầu tiên nhận đợt và số cộng vào', async () => {
    const issueId = await makeIssue();
    const b = await makeBundle(issueId, {
      openedById: null,
      segs: [{ specId: spec1000, qty: 10 }],
    });
    await service.recordCutBatch(issueId.toString(), dto(spec1000, 5), workerId);

    const bundles = await bundlesOf(issueId);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].id).toBe(b);
    expect(bundles[0].openedById).toBe(workerId);
    expect(await segsOf(b)).toEqual({ [spec1000.toString()]: 15 });
  }, 30000);

  it('R3 đợt đã AWAITING_QC (commit hẳn): lần báo sau mở đợt mới', async () => {
    const issueId = await makeIssue();
    const b = await makeBundle(issueId, {
      openedById: workerId,
      status: CutBundleStatus.AWAITING_QC,
      segs: [{ specId: spec1000, qty: 10 }],
    });
    await service.recordCutBatch(issueId.toString(), dto(spec1000, 5), workerId);

    const bundles = await bundlesOf(issueId);
    expect(bundles).toHaveLength(2);
    expect(await segsOf(b)).toEqual({ [spec1000.toString()]: 10 });
    const fresh = bundles.find((x) => x.id !== b)!;
    expect(fresh.status).toBe(CutBundleStatus.CUTTING);
    expect(fresh.segments.map((s) => [s.segmentSpecId, s.qty])).toEqual([[spec1000, 5]]);
  }, 30000);

  it('R4 báo cắt xong đợt CUTTING bình thường: AWAITING_QC + completedAt, thông báo KCS 1 lần', async () => {
    const issueId = await makeIssue();
    const b = await makeBundle(issueId, {
      openedById: workerId,
      segs: [{ specId: spec1000, qty: 10 }],
    });
    await service.finishCutBundle(b.toString());

    const after = await prisma.cutBundle.findUniqueOrThrow({ where: { id: b } });
    expect(after.status).toBe(CutBundleStatus.AWAITING_QC);
    expect(after.completedAt).not.toBeNull();
    const kcsCalls = notifications.emit.mock.calls.filter((c) => c[0] === 'CUT_BUNDLE_TO_KCS');
    expect(kcsCalls).toHaveLength(1);
    expect(kcsCalls[0][1]).toEqual(expect.objectContaining({ entityId: b.toString() }));
  }, 30000);

  it('R5 có đợt nhiễu (người khác / lô khác / SKU khác / AWAITING_QC): báo vào đúng đợt của mình, đợt nhiễu không đổi', async () => {
    const issueId = await makeIssue();
    const mine = await makeBundle(issueId, {
      openedById: workerId,
      segs: [{ specId: spec1000, qty: 10 }],
    });
    const noise = await seedNoise(issueId);

    await service.recordCutBatch(issueId.toString(), dto(spec1000, 5), workerId);

    expect(await segsOf(mine)).toEqual({ [spec1000.toString()]: 15 });
    await noise.expectUntouched();
    const bundles = await bundlesOf(issueId, noise.ids);
    expect(bundles.map((x) => x.id)).toEqual([mine]);
    expect(bundles[0].floorReports).toHaveLength(1);
  }, 30000);
});
