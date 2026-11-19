import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import {
  CutBundleStatus,
  FloorQueueStatus,
  MaterialYieldIssueStatus,
  MfgStage,
  PieceStepBundleStatus,
  ProcessStep,
  ProductionBatchStatus,
  StepBundleStatus,
  StockLedgerRefType,
} from '../../src/generated/prisma/client';
import { FloorAdminService } from '../../src/modules/floor/floor-admin.service';
import { FloorStatsService } from '../../src/modules/floor/floor-stats.service';
import { MaterialYieldRecipeProductionService } from '../../src/modules/material-yield-recipes/material-yield-recipe-production.service';
import {
  P1Harness,
  P1World,
  PAST,
  World,
  createHarness,
  expectNoServerFault,
  lockSql,
  msg,
  raceWith,
  rowLockSql,
  withSegmentStock,
} from './p1-kcs.fixture';

/**
 * IT3 (P1, 18/11/2026) - KCS LƯU KẾT QUẢ chấm có thiếu, công tắc tồn đoạn bật, trên Postgres TEST thật.
 *  AC24  kho thiếu đoạn: Lưu / chốt / chấm đều không bị chặn; trừ đoạn LÚC CHẤM, ghi Sổ báo vượt đoạn, phát SEGMENT_OVERAGE_REPORTED
 *  AC35  lô Hàn 60 (mảnh ghép 2 cỡ), Thực có 56, lỗi 1: QC_DONE reportedQty 55; qc_reviews lỗi 1 / thiếu 4; trừ 56 mảnh lúc chấm; vào kho 55
 *  AC36  lô đã gửi KCS trước deploy (đã có bút toán trừ đoạn / sổ báo vượt, kể cả công tắc đổi giữa lúc gửi và lúc chấm): chấm không trừ lần 2
 *  AC37  pat / chân nhôm công đoạn cuối 50, thiếu 3, lỗi 1 -> 46; không có số 49 ở đâu
 *  AC40  chấm mảnh ghép 4 cỡ: có timeout 20 giây, đo ms trên DB local (không đo được DB ở xa)
 *  MF10  kế hoạch 100, 2 lô 60 cùng chờ chấm: chỉ lô chấm SAU ghi vượt 20 (không phải 40)
 *  CĐ-15 / CĐ-16  báo Hàn đúng lúc chấm; 2 lô chấm cùng lúc khi kho thiếu đoạn, kèm 1 lần báo mới
 *
 * Dữ liệu tự dựng (xem p1-kcs.fixture.ts), kho Phôi / Hàn riêng của xưởng thử nên bút toán nằm đúng kho đó.
 */
describe('P1 IT3: KCS chấm có thiếu, tồn đoạn bật (integration, real Postgres)', () => {
  let h: P1Harness;
  let w: P1World;

  beforeAll(async () => {
    h = await createHarness();
    w = new P1World(h, `it3-${Date.now()}`);
    await w.init();
  });

  afterAll(async () => {
    if (w) await w.cleanup();
    if (h) await h.close();
  });

  beforeEach(() => h.clearEmits());

  const errOf = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );

  const hanReport = (world: World, qty: number, userId: string) =>
    h.batches.recordProductionBatch(
      world.orderIds[0].toString(),
      { pieceId: w.pieceHan.toString(), qty, stage: MfgStage.HAN },
      userId,
      'HAN',
    );

  const consumeRows = (batchId: bigint) =>
    h.prisma.stockLedger.findMany({
      where: { refType: StockLedgerRefType.SEGMENT_CONSUME, refId: batchId.toString() },
      orderBy: { id: 'asc' },
    });

  const overageRows = (batchId: bigint) =>
    h.prisma.segmentOverage.findMany({
      where: { productionBatchId: batchId },
      orderBy: { segmentSpecId: 'asc' },
    });

  const batchOf = (id: bigint) => h.prisma.productionBatch.findUniqueOrThrow({ where: { id } });

  /** Dòng kế hoạch của 1 mảnh (đọc lỏng vì shortQty là trường mới). */
  async function planItem(world: World, stage: MfgStage, pieceId: bigint) {
    const plan = (await h.batches.getBatchPlan(world.orderIds[0].toString(), stage)) as unknown as {
      items: Array<{
        pieceId: string;
        passedQty: number;
        failedQty?: number;
        shortQty?: number;
      }>;
    };
    const item = plan.items.find((i) => i.pieceId === pieceId.toString());
    expect(item).toBeDefined();
    return item!;
  }

  // =====================================================================================
  // AC35
  // =====================================================================================
  describe('AC35: lô Hàn 60 mảnh ghép 2 cỡ, kho đủ đoạn, Thực có 56 + Không đạt 1', () => {
    it('QC_DONE reportedQty 55; lỗi 1 / thiếu 4 ghi riêng; trừ đoạn 56 mảnh LÚC CHẤM (không phải lúc chốt); vào kho Hàn 55; kế hoạch thể hiện đạt 55 / lỗi 1 / thiếu 4', async () => {
      const world = await w.newInvoice({ quantities: [100] });
      await w.stockSegment(w.specH1, 100);
      await w.stockSegment(w.specH2, 100);
      const { batchId } = await w.seedPieceBatch(world, {
        pieceId: w.pieceHan,
        stage: MfgStage.HAN,
        qty: 60,
        status: ProductionBatchStatus.AWAITING_QC,
      });
      expect(await consumeRows(batchId)).toHaveLength(0); // sau chốt chưa trừ đoạn (AC8)

      await withSegmentStock(true, () =>
        h.api.reviewProductionBatch(batchId.toString(), { failedQty: 1, shortQty: 4 }, w.kcsA),
      );

      const batch = await batchOf(batchId);
      expect(batch.status).toBe(ProductionBatchStatus.QC_DONE);
      expect(batch.reportedQty).toBe(55);
      const reviews = await w.qcReviews({ productionBatchId: batchId });
      expect(reviews).toHaveLength(1);
      expect(reviews[0].failedQty).toBe(1); // thiếu KHÔNG cộng vào failedQty
      expect(reviews[0].shortQty).toBe(4);

      const consumed = await consumeRows(batchId);
      expect(consumed).toHaveLength(2); // 1 bút toán cho mỗi cỡ đoạn
      for (const row of consumed) {
        expect(Number(row.qty)).toBe(56); // 60 - 4 thiếu = 56 mảnh x 1 đoạn / mảnh
        expect(row.idempotencyKey).toContain(`production-batch-segment-consume:${batchId}:`);
      }
      const output = await h.prisma.stockLedger.findMany({
        where: { refType: StockLedgerRefType.FRAME_OUTPUT, refId: batchId.toString() },
      });
      expect(output).toHaveLength(1);
      expect(Number(output[0].qty)).toBe(55); // Hàn là công đoạn cuối: vào kho 55
      expect(output[0].toWarehouseId).toBe(w.ws.hanWhId);

      const item = await planItem(world, MfgStage.HAN, w.pieceHan);
      expect(item.passedQty).toBe(55);
      expect(item.failedQty).toBe(1);
      expect(item.shortQty).toBe(4);
    });
  });

  // =====================================================================================
  // AC24
  // =====================================================================================
  describe('AC24: kho thiếu đoạn cho lô Hàn 60, công tắc bật', () => {
    it('Lưu, chốt, chấm (Thực có 60, lỗi 0) đều không bị chặn; trừ đoạn + Sổ báo vượt đoạn ghi lúc chấm; QLSX nhận SEGMENT_OVERAGE_REPORTED sau commit', async () => {
      const world = await w.newInvoice({ quantities: [100] });
      // kho Phôi của xưởng thử dùng chung giữa các ca: xoá tồn nhanh (stock_quants) các cỡ đoạn của mảnh Hàn
      // để ca không phụ thuộc tồn ca trước để lại. Bút toán sổ cái giữ nguyên, cleanup() xoá cuối bộ.
      await h.prisma.stockQuant.deleteMany({
        where: { segmentSpecId: { in: [w.specH1, w.specH2] } },
      });

      const saved = await withSegmentStock(true, () => hanReport(world, 60, w.workerA));
      expect((saved as { reportedQty: number }).reportedQty).toBe(60);
      const batchId = BigInt((saved as { id: string }).id);
      await withSegmentStock(true, () => h.api.closeProductionBatch(batchId.toString(), w.kcsA));
      expect(await overageRows(batchId)).toHaveLength(0); // chốt chưa ghi gì
      h.clearEmits();

      await withSegmentStock(true, () =>
        h.api.reviewProductionBatch(batchId.toString(), { failedQty: 0 }, w.kcsA),
      );

      expect((await batchOf(batchId)).reportedQty).toBe(60);
      const overages = await overageRows(batchId);
      expect(overages).toHaveLength(2); // 2 cỡ đoạn
      for (const o of overages) {
        expect(Number(o.neededQty)).toBe(60);
        expect(Number(o.shortageQty)).toBe(60);
      }
      expect(h.emitCalls().map((c) => c.type)).toContain('SEGMENT_OVERAGE_REPORTED');
    });
  });

  // =====================================================================================
  // AC36
  // =====================================================================================
  describe('AC36: lô đã gửi KCS trước deploy (đã trừ đoạn / đã có sổ báo vượt)', () => {
    type Legacy = 'new-key' | 'old-key' | 'overage-only';
    const LEGACY: Array<[string, Legacy]> = [
      ['bút toán kiểu mới (khoá có bộ công đoạn), công tắc bật cả lúc gửi', 'new-key'],
      [
        'công tắc TẮT lúc gửi: bút toán khoá cũ (không có bộ công đoạn), chấm lúc công tắc BẬT',
        'old-key',
      ],
      ['lúc gửi đã thiếu đoạn: chỉ có dòng Sổ báo vượt, không có bút toán', 'overage-only'],
    ];

    it.each(
      LEGACY.flatMap(([name, kind]) =>
        [
          [60, 0],
          [56, 4],
        ].map(([real, short]) => [name, kind, real, short] as const),
      ),
    )(
      '%s [%s]; Thực có %i (thiếu %i): số bút toán SEGMENT_CONSUME và số dòng Sổ báo vượt KHÔNG tăng',
      async (_name, kind, _real, short) => {
        const world = await w.newInvoice({ quantities: [100] });
        await w.stockSegment(w.specH1, 200);
        await w.stockSegment(w.specH2, 200);
        const { batchId } = await w.seedPieceBatch(world, {
          pieceId: w.pieceHan,
          stage: MfgStage.HAN,
          qty: 60,
          status: ProductionBatchStatus.AWAITING_QC,
        });
        for (const specId of [w.specH1, w.specH2]) {
          if (kind === 'overage-only') {
            await h.prisma.segmentOverage.create({
              data: {
                productionInvoiceId: world.piId,
                productionOrderId: world.orderIds[0],
                productionBatchId: batchId,
                pieceId: w.pieceHan,
                stage: MfgStage.HAN,
                warehouseId: w.ws.phoiWhId,
                segmentSpecId: specId,
                segmentSteps: '',
                neededQty: 60,
                takenQty: 0,
                shortageQty: 60,
              },
            });
            continue;
          }
          await h.ledger.postEntry({
            fromWarehouseId: w.ws.phoiWhId,
            toWarehouseId: w.productionWhId,
            segmentSpecId: specId,
            segmentSteps: '',
            qty: 60,
            refType: StockLedgerRefType.SEGMENT_CONSUME,
            refId: batchId.toString(),
            idempotencyKey:
              kind === 'new-key'
                ? `production-batch-segment-consume:${batchId}:${specId}:`
                : `production-batch-segment-consume:${batchId}:${specId}`,
          });
        }
        const consumedBefore = (await consumeRows(batchId)).length;
        const overagesBefore = (await overageRows(batchId)).length;

        await withSegmentStock(true, () =>
          h.api.reviewProductionBatch(
            batchId.toString(),
            { failedQty: 0, shortQty: short },
            w.kcsA,
          ),
        );

        expect((await consumeRows(batchId)).length).toBe(consumedBefore);
        expect((await overageRows(batchId)).length).toBe(overagesBefore);
        expect((await batchOf(batchId)).status).toBe(ProductionBatchStatus.QC_DONE);
        expect((await batchOf(batchId)).reportedQty).toBe(60 - short);
      },
    );
  });

  // =====================================================================================
  // AC37
  // =====================================================================================
  describe('AC37: pat / chân nhôm công đoạn cuối 50, Thực có 47, Không đạt 1 (thiếu 3)', () => {
    it('pat: tự sinh lô QC_DONE 46, mảnh vào kho Phôi 46, kế hoạch lỗi 1 / thiếu 3; không có số 49 ở đâu', async () => {
      const world = await w.newInvoice({ quantities: [50] });
      const bundleId = (await w.seedPieceStep(world, {
        step: ProcessStep.DAP,
        qty: 50,
        bundled: PieceStepBundleStatus.AWAITING_QC,
      }))!;

      await h.api.reviewPieceStep(bundleId.toString(), { failedQty: 1, shortQty: 3 }, w.kcsA);

      const reviews = await w.qcReviews({ pieceStepBundleId: bundleId });
      expect(reviews).toHaveLength(1);
      expect([reviews[0].failedQty, reviews[0].shortQty]).toEqual([1, 3]);
      const lots = await h.prisma.productionBatch.findMany({
        where: { productionOrderId: world.orderIds[0], pieceId: w.piecePat },
      });
      expect(lots).toHaveLength(1);
      expect(lots[0].status).toBe(ProductionBatchStatus.QC_DONE);
      expect(lots[0].reportedQty).toBe(46);
      const output = await h.prisma.stockLedger.findMany({
        where: { pieceId: w.piecePat, refType: StockLedgerRefType.FRAME_OUTPUT },
      });
      expect(output.map((o) => Number(o.qty))).toEqual([46]);
      expect(output[0].toWarehouseId).toBe(w.ws.phoiWhId);
      // không số 49 (= 50 - lỗi, quên trừ thiếu) ở bảng nào liên quan
      expect(lots.some((l) => l.reportedQty === 49)).toBe(false);
      expect(await h.prisma.stockLedger.count({ where: { pieceId: w.piecePat, qty: 49 } })).toBe(0);
      const item = await planItem(world, MfgStage.PHOI, w.piecePat);
      expect(item.failedQty).toBe(1); // chỉ cộng lỗi, không cộng thiếu
      expect(item.shortQty).toBe(3);
    });

    it('chân nhôm: bút toán MATERIAL_YIELD_RECIPE_OUTPUT 46; không có số 49', async () => {
      const world = await w.newInvoice({ quantities: [50] });
      const bundleId = (await w.seedMaterialYield(world, {
        step: ProcessStep.CAT,
        qty: 50,
        bundled: PieceStepBundleStatus.AWAITING_QC,
      }))!;

      await h.api.reviewMaterialYieldStep(
        bundleId.toString(),
        { failedQty: 1, shortQty: 3 },
        w.kcsA,
      );

      const reviews = await w.qcReviews({ materialYieldStepBundleId: bundleId });
      expect([reviews[0].failedQty, reviews[0].shortQty]).toEqual([1, 3]);
      const entries = await h.prisma.stockLedger.findMany({
        where: {
          refType: StockLedgerRefType.MATERIAL_YIELD_RECIPE_OUTPUT,
          refId: bundleId.toString(),
        },
      });
      expect(entries.map((e) => Number(e.qty))).toEqual([46]);
      expect(entries[0].toWarehouseId).toBe(w.outWhId);
      expect(await h.prisma.stockLedger.count({ where: { materialId: w.aluOutId, qty: 49 } })).toBe(
        0,
      );
    });
  });

  // =====================================================================================
  // AC40
  // =====================================================================================
  describe('AC40: chấm lô mảnh ghép 4 cỡ đoạn có thiếu (chỉ đo thời gian trên DB local)', () => {
    it('trả kết quả dưới 20 giây (giới hạn transaction), không P2028; ghi ms để đối chiếu', async () => {
      const world = await w.newInvoice({ quantities: [100] });
      for (const s of w.specM) await w.stockSegment(s, 50); // thiếu 10 mỗi cỡ -> có cả sổ báo vượt
      const { batchId } = await w.seedPieceBatch(world, {
        pieceId: w.pieceHan4,
        stage: MfgStage.HAN,
        qty: 60,
        status: ProductionBatchStatus.AWAITING_QC,
      });

      const started = Date.now();
      const err = await errOf(
        withSegmentStock(true, () =>
          h.api.reviewProductionBatch(batchId.toString(), { failedQty: 1, shortQty: 4 }, w.kcsA),
        ),
      );
      const ms = Date.now() - started;

      process.stdout.write(`[AC40] chấm lô mảnh ghép 4 cỡ trên DB local: ${ms} ms\n`);
      expect(err).toBeNull();
      expect(ms).toBeLessThan(20_000);
      expect((await consumeRows(batchId)).length).toBe(4);
      expect((await batchOf(batchId)).reportedQty).toBe(55);
    });
  });

  // =====================================================================================
  // MF10 (phản biện 10)
  // =====================================================================================
  describe('MF10: kế hoạch 100, 2 lô 60 cùng chờ chấm', () => {
    it('chấm lô 1 không ghi vượt; chấm lô 2 ghi vượt ĐÚNG 20 (tổng vượt của lệnh = 20, không phải 40)', async () => {
      const world = await w.newInvoice({ quantities: [100] });
      await w.stockSegment(w.specH1, 300);
      await w.stockSegment(w.specH2, 300);
      const first = await w.seedPieceBatch(world, {
        pieceId: w.pieceHan,
        stage: MfgStage.HAN,
        qty: 60,
        status: ProductionBatchStatus.AWAITING_QC,
        reportedById: w.workerA,
        reportAt: new Date(Date.now() - 60_000),
      });
      const second = await w.seedPieceBatch(world, {
        pieceId: w.pieceHan,
        stage: MfgStage.HAN,
        qty: 60,
        status: ProductionBatchStatus.AWAITING_QC,
        reportedById: w.workerB,
        reportAt: new Date(Date.now() - 30_000),
      });

      await withSegmentStock(true, async () => {
        await h.api.reviewProductionBatch(first.batchId.toString(), { failedQty: 0 }, w.kcsA);
        await h.api.reviewProductionBatch(second.batchId.toString(), { failedQty: 0 }, w.kcsA);
      });

      const overOf = async (batchId: bigint, specId: bigint) =>
        (await overageRows(batchId))
          .filter((o) => o.segmentSpecId === specId)
          .reduce((s, o) => s + o.overPieces, 0);
      expect(await overOf(first.batchId, w.specH1)).toBe(0);
      expect(await overOf(second.batchId, w.specH1)).toBe(20);
      const total = await h.prisma.segmentOverage.aggregate({
        where: { productionInvoiceId: world.piId, segmentSpecId: w.specH1 },
        _sum: { overPieces: true, extraQty: true },
      });
      expect(total._sum.overPieces).toBe(20);
      expect(Number(total._sum.extraQty)).toBe(20);
    });
  });

  // =====================================================================================
  // CĐ-15 / CĐ-16
  // =====================================================================================
  describe('đồng thời quanh lúc chấm', () => {
    it.each([
      ['chấm vào hàng đợi khoá trước', 0],
      ['báo bù vào hàng đợi khoá trước', 1],
    ] as const)(
      'CĐ-15 (%s): giữ production-batch-open -> chấm lô Hàn có lỗi ∥ báo Hàn 6 cùng chờ; cả 2 qua, không khoá chéo, tổng không vượt kế hoạch',
      async (_n, reviewFirst) => {
        const world = await w.newInvoice({ quantities: [100] });
        await w.stockSegment(w.specH1, 200);
        await w.stockSegment(w.specH2, 200);
        const { batchId } = await w.seedPieceBatch(world, {
          pieceId: w.pieceHan,
          stage: MfgStage.HAN,
          qty: 60,
          status: ProductionBatchStatus.AWAITING_QC,
        });
        const review = () =>
          h.api.reviewProductionBatch(batchId.toString(), { failedQty: 1, shortQty: 4 }, w.kcsA);
        const report = () => hanReport(world, 6, w.workerB);

        const out = await withSegmentStock(true, () =>
          raceWith(
            h.prisma,
            [lockSql(`production-batch-open:${world.orderIds[0]}:${w.pieceHan}:${MfgStage.HAN}`)],
            reviewFirst === 0 ? [review, report] : [report, review],
            { ordered: true },
          ),
        );

        expect(out.every((o) => o.waited && o.ok)).toBe(true);
        expectNoServerFault(out);
        const total = await h.prisma.productionBatch.aggregate({
          where: { productionOrderId: world.orderIds[0], pieceId: w.pieceHan },
          _sum: { reportedQty: true },
        });
        expect(total._sum.reportedQty).toBe(61); // 55 đã chấm + 6 vừa báo
        expect((await batchOf(batchId)).reportedQty).toBe(55);
      },
    );

    it('CĐ-16: 2 lô Hàn chấm cùng lúc khi kho thiếu đoạn, kèm 1 lần báo mới, trong lúc lượt chuyển đổi giữ khoá độc quyền: không khoá chéo; Sổ báo vượt đúng tổng, không trừ trùng', async () => {
      const world = await w.newInvoice({ quantities: [500] });
      await h.prisma.stockQuant.deleteMany({
        where: { segmentSpecId: { in: [w.specH1, w.specH2] } },
      });
      const b1 = await w.seedPieceBatch(world, {
        pieceId: w.pieceHan,
        stage: MfgStage.HAN,
        qty: 60,
        status: ProductionBatchStatus.AWAITING_QC,
        reportedById: w.workerA,
      });
      const b2 = await w.seedPieceBatch(world, {
        pieceId: w.pieceHan,
        stage: MfgStage.HAN,
        qty: 60,
        status: ProductionBatchStatus.AWAITING_QC,
        reportedById: w.workerB,
      });

      const out = await withSegmentStock(true, () =>
        raceWith(
          h.prisma,
          [lockSql('segment-legacy-conversion')],
          [
            () => h.api.reviewProductionBatch(b1.batchId.toString(), { failedQty: 0 }, w.kcsA),
            () => h.api.reviewProductionBatch(b2.batchId.toString(), { failedQty: 0 }, w.kcsB),
            () => hanReport(world, 6, w.workerA),
          ],
          { minWaiting: 2 },
        ),
      );

      expect(out[0].waited).toBe(true);
      expect(out[2].doneBeforeRelease).toBe(true); // lần báo không cần khoá chuyển đổi
      expectNoServerFault(out);
      expect(out.every((o) => o.ok)).toBe(true);
      const sum = await h.prisma.segmentOverage.aggregate({
        where: { productionInvoiceId: world.piId, segmentSpecId: w.specH1 },
        _sum: { shortageQty: true },
      });
      expect(Number(sum._sum.shortageQty)).toBe(120); // mỗi lô thiếu 60, không trừ trùng
      for (const b of [b1.batchId, b2.batchId]) {
        expect((await overageRows(b)).filter((o) => o.segmentSpecId === w.specH1)).toHaveLength(1);
      }
    });
  });

  // =====================================================================================
  // Sau Đợt 3: KCS ghi thiếu / bỏ / làm lại ở cỡ sắt (Cắt, Uốn, Dập)
  // =====================================================================================
  describe('KCS ghi thiếu / bỏ / làm lại ở cỡ sắt', () => {
    const cutRec = (
      issue: bigint,
      world: World,
      spec: bigint,
      qty: number,
      userId: string = w.workerA,
    ) =>
      h.steel.recordCutBatch(
        issue.toString(),
        {
          productionOrderId: world.orderIds[0].toString(),
          segments: [{ segmentSpecId: spec.toString(), qty }],
        },
        userId,
      );

    const stepRec = (
      world: World,
      step: ProcessStep,
      spec: bigint,
      qty: number,
      userId: string = w.workerA,
      key?: string,
    ) =>
      h.steel.recordStepBatch(
        world.piId.toString(),
        {
          materialId: w.steelId.toString(),
          step,
          productionOrderId: world.orderIds[0].toString(),
          segments: [{ segmentSpecId: spec.toString(), qty }],
        },
        userId,
        key,
      );

    /** Dòng tiến độ (phoi-progress) của 1 cỡ ở Cắt hoặc 1 công đoạn phụ. */
    async function prog(world: World, step: ProcessStep, spec: bigint) {
      const items =
        step === ProcessStep.CAT
          ? await h.steel.getPhoiProgress(world.piId.toString())
          : await h.steel.getStepProgress(world.piId.toString(), step);
      const item = items.find((i) => i.materialId === w.steelId.toString());
      expect(item).toBeDefined();
      const seg = item!.segments.find((x) => x.segmentSpecId === spec.toString());
      expect(seg).toBeDefined();
      return seg!;
    }

    /** Đợt công đoạn phụ chờ KCS (AWAITING_QC) có 1 lần báo `qty` của cỡ `spec`; trả id đợt. */
    async function awaitingStep(world: World, step: ProcessStep, spec: bigint, qty: number) {
      const bundleId = await w.seedStepBundle(world, {
        step,
        status: StepBundleStatus.AWAITING_QC,
      });
      await w.seedStepBatch(world, {
        step,
        segs: [{ specId: spec, qty }],
        bundleId,
        withReport: false,
      });
      return bundleId;
    }

    const qcTexts = (type: string) =>
      h
        .emitCalls()
        .filter((c) => c.type === type)
        .map((c) => (c.options.params ?? {}) as Record<string, string | undefined>);

    const reverse = (reportId: bigint) => h.review.reverse(reportId.toString(), 'bao nham', w.qlsx);

    // ---------------------------------------------------------------------------------
    it('AC27: chấm Cắt (115 / 120): lỗi 3 + thiếu 5 -> qc_reviews 3 / 5, done -5, failed +3, reportedQty giữ, còn báo được +8, đạt KCS của A = 112, tin QC_FAILED có câu thiếu', async () => {
      const world = await w.newInvoice({ quantities: [200] });
      const issue = await w.newIssue(world.piId);
      const reporter = await w.makeUser('ac27'); // người báo riêng để báo cáo đạt KCS không lẫn ca khác
      const { bundleId } = await w.seedCutBundle(issue, world, {
        segs: [{ specId: w.spec441, qty: 120 }],
        status: CutBundleStatus.AWAITING_QC,
        openedById: reporter,
      });
      const before = await prog(world, ProcessStep.CAT, w.spec441);
      expect(before.done).toBe(120);
      expect(before.maxNow).toBe(80);
      h.clearEmits();

      const res = await h.api.reviewCutBundle(
        bundleId.toString(),
        {
          segments: [{ segmentSpecId: w.spec441.toString(), failedQty: 3, shortQty: 5 }],
          reason: 'test',
        },
        w.kcsA,
      );

      expect(res.failedQty).toBe(3);
      expect(res.shortQty).toBe(5);
      const reviews = await w.qcReviews({ cutBundleId: bundleId });
      expect(reviews).toHaveLength(1);
      expect(reviews[0].failedQty).toBe(3);
      expect(reviews[0].shortQty).toBe(5);
      const segs = await h.prisma.qcReviewSegment.findMany({
        where: { qcReview: { cutBundleId: bundleId } },
      });
      expect(segs).toHaveLength(1);
      expect([segs[0].failedQty, segs[0].shortQty, segs[0].scrapQty]).toEqual([3, 5, 0]);

      const after = await prog(world, ProcessStep.CAT, w.spec441);
      expect(after.done).toBe(115); // đã báo - thiếu (gồm lỗi)
      expect(after.failed).toBe(3);
      expect(after.reportedQty).toBe(120); // số thô không đổi
      expect(after.maxNow).toBe(88); // 80 + 8 (lỗi 3 + thiếu 5 đều phải làm bù)

      const stats = await h.moduleRef
        .get(FloorStatsService, { strict: false })
        .getStats({ groupBy: 'day', workerId: reporter } as never);
      const mine = stats.rows.filter((r) => r.workerId === reporter);
      expect(mine.reduce((sum, r) => sum + r.passed, 0)).toBe(112); // 120 - 3 - 5
      expect(mine.reduce((sum, r) => sum + r.failed, 0)).toBe(3); // thiếu không tính lỗi

      const failed = qcTexts('QC_FAILED');
      expect(failed).toHaveLength(1);
      const text = `${failed[0].detail ?? ''} ${failed[0].todo ?? ''}`;
      expect(text).toContain('3 đoạn 441mm lỗi');
      expect(text).toContain('KCS ghi thiếu 5 đoạn so với số báo');
      expect(text).toContain('không cần làm bù');
    });

    // ---------------------------------------------------------------------------------
    it('AC30: Uốn chấm lỗi 8 (bỏ 5, làm lại 3): cần Cắt 25, báo cắt 5 qua / 6 chặn; Uốn bù 3 qua ngay, thêm khi chưa cắt bị "báo cắt thêm"; cắt 5 xong Uốn 5 qua; tin tách Bỏ / Làm lại', async () => {
      const world = await w.newInvoice({ quantities: [20] });
      const issue = await w.newIssue(world.piId);
      await w.seedCutDone(issue, world, w.spec355, 20);
      const bundleId = await awaitingStep(world, ProcessStep.UON, w.spec355, 20);
      h.clearEmits();

      await h.api.reviewStepBundle(
        bundleId.toString(),
        { segments: [{ segmentSpecId: w.spec355.toString(), failedQty: 8, scrapQty: 5 }] },
        w.kcsA,
      );

      const seg = await h.prisma.qcReviewSegment.findMany({
        where: { qcReview: { stepBundleId: bundleId } },
      });
      expect([seg[0].failedQty, seg[0].scrapQty, seg[0].shortQty]).toEqual([8, 5, 0]);
      const cut = await prog(world, ProcessStep.CAT, w.spec355);
      expect([cut.baseRequired, cut.extraNeed, cut.required, cut.maxNow]).toEqual([20, 5, 25, 5]);
      const bend = await prog(world, ProcessStep.UON, w.spec355);
      expect(bend.required).toBe(20);
      expect(bend.maxNow).toBe(3); // còn 8 theo số cần nhưng vật lý chỉ còn 3 đoạn làm lại

      const failed = qcTexts('QC_FAILED');
      expect(failed).toHaveLength(1);
      expect(String(failed[0].todo)).toContain('Bỏ 5 đoạn 355mm');
      expect(String(failed[0].todo)).toContain('Làm lại 3 đoạn 355mm');

      const six = await cutRec(issue, world, w.spec355, 6).then(
        () => null,
        (e: unknown) => e,
      );
      expect(six).toBeInstanceOf(BadRequestException);
      expect(msg(six)).toContain('tối đa 5');

      await stepRec(world, ProcessStep.UON, w.spec355, 3); // Uốn bù 3 qua ngay, không cần cắt
      const more = await stepRec(world, ProcessStep.UON, w.spec355, 1).then(
        () => null,
        (e: unknown) => e,
      );
      expect(more).toBeInstanceOf(BadRequestException);
      expect(msg(more)).toContain('báo cắt thêm 1 đoạn 355mm');

      await cutRec(issue, world, w.spec355, 5);
      await stepRec(world, ProcessStep.UON, w.spec355, 5); // cắt 5 xong Uốn 5 qua
      expect((await prog(world, ProcessStep.UON, w.spec355)).maxNow).toBe(0);
    });

    // ---------------------------------------------------------------------------------
    it('AC31: cỡ Cắt -> Uốn -> Dập, Dập bỏ 4: cần Cắt 24 / Uốn 24 / Dập 20, Dập đã tính 16; cỡ khác không nhận phần cộng; Uốn / Dập bù chỉ qua sau khi cắt 4; báo Dập trước Uốn vẫn được', async () => {
      const spec777 = (
        await h.prisma.segmentSpec.create({ data: { materialId: w.steelId, cutLengthMm: 777 } })
      ).id;
      const spec460 = (
        await h.prisma.segmentSpec.create({ data: { materialId: w.steelId, cutLengthMm: 460 } })
      ).id;
      w.ids.specs.push(spec777, spec460);
      const rev = await w.makeBomRevision(31, [
        { specId: spec777, steps: [ProcessStep.CAT, ProcessStep.UON, ProcessStep.DAP] },
        { specId: spec460, steps: [ProcessStep.CAT] },
      ]);
      const world = await w.newInvoice({ quantities: [20], bomRevisionIds: [rev] });
      const issue = await w.newIssue(world.piId);
      await w.seedCutDone(issue, world, spec777, 20);
      await w.seedStepDone(world, ProcessStep.UON, spec777, 20);
      const dapBundle = await awaitingStep(world, ProcessStep.DAP, spec777, 20);

      await h.api.reviewStepBundle(
        dapBundle.toString(),
        { segments: [{ segmentSpecId: spec777.toString(), failedQty: 4, scrapQty: 4 }] },
        w.kcsA,
      );

      expect((await prog(world, ProcessStep.CAT, spec777)).required).toBe(24);
      expect((await prog(world, ProcessStep.UON, spec777)).required).toBe(24);
      const dap = await prog(world, ProcessStep.DAP, spec777);
      expect(dap.required).toBe(20); // Dập không đổi số cần
      expect(dap.done - dap.failed).toBe(16); // đã tính 16
      expect((await prog(world, ProcessStep.CAT, spec460)).required).toBe(20); // cỡ trơn không nhận phần cộng

      for (const step of [ProcessStep.UON, ProcessStep.DAP]) {
        const err = await stepRec(world, step, spec777, 4).then(
          () => null,
          (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(BadRequestException); // chưa cắt bù thì chưa có đoạn để làm
        expect(msg(err)).toContain('tối đa 0');
      }
      await cutRec(issue, world, spec777, 4);
      await stepRec(world, ProcessStep.DAP, spec777, 4); // Dập TRƯỚC Uốn vẫn qua (không ràng buộc thứ tự công đoạn)
      await stepRec(world, ProcessStep.UON, spec777, 4);
      expect((await prog(world, ProcessStep.UON, spec777)).maxNow).toBe(0);
    });

    // ---------------------------------------------------------------------------------
    it.each([
      ['hủy lần báo cắt 5 (cắt còn 15 < Uốn đã dùng 17)', 5, true],
      ['hủy lần báo cắt 3 (cắt còn 17 = Uốn đã dùng 17)', 3, false],
    ])(
      'AC33 (X3): Uốn bị KCS cho làm lại 3 nên đã dùng 17; %s',
      async (_name, openQty, blocked) => {
        const world = await w.newInvoice({ quantities: [20] });
        const issue = await w.newIssue(world.piId);
        await w.seedCutDone(issue, world, w.spec355, 20 - openQty);
        const { bundleId, reportId } = await w.seedCutBundle(issue, world, {
          segs: [{ specId: w.spec355, qty: openQty }],
        });
        const uon = await awaitingStep(world, ProcessStep.UON, w.spec355, 20);
        await h.api.reviewStepBundle(
          uon.toString(),
          { segments: [{ segmentSpecId: w.spec355.toString(), failedQty: 3, scrapQty: 0 }] },
          w.kcsA,
        );
        expect((await prog(world, ProcessStep.UON, w.spec355)).physicalLeft).toBe(3); // cắt 20 - dùng 17

        const err = await reverse(reportId!).then(
          () => null,
          (e: unknown) => e,
        );

        if (blocked) {
          expect(err).toBeInstanceOf(BadRequestException);
          expect(msg(err)).toContain('chỉ còn 15 đoạn đã cắt');
          expect(msg(err)).toContain('17 đoạn đã báo Uốn');
          expect(await h.prisma.cutBundle.count({ where: { id: bundleId } })).toBe(1);
        } else {
          expect(err).toBeNull();
          expect(await h.prisma.cutBundle.count({ where: { id: bundleId } })).toBe(0);
        }
      },
    );

    // ---------------------------------------------------------------------------------
    it('AC34: Uốn đã báo 20, KCS chấm đợt cắt của A thiếu 5 (không lỗi): lưu được + notes[] khớp số tiến độ; Uốn thêm bị "KCS ghi thiếu 5 đoạn cắt"; hủy lần báo cắt khác bị X3; báo cắt thêm 5 thì Uốn mở lại', async () => {
      const world = await w.newInvoice({ quantities: [25] });
      const issue = await w.newIssue(world.piId);
      await w.seedCutDone(issue, world, w.spec355, 8);
      const { bundleId } = await w.seedCutBundle(issue, world, {
        segs: [{ specId: w.spec355, qty: 12 }],
        status: CutBundleStatus.AWAITING_QC,
      });
      const other = await w.seedCutBundle(issue, world, {
        segs: [{ specId: w.spec355, qty: 2 }],
        openedById: w.workerB,
      });
      await w.seedStepDone(world, ProcessStep.UON, w.spec355, 20);
      h.clearEmits();

      const res = await h.api.reviewCutBundle(
        bundleId.toString(),
        { segments: [{ segmentSpecId: w.spec355.toString(), failedQty: 0, shortQty: 5 }] },
        w.kcsA,
      );

      expect(res.shortQty).toBe(5);
      const bend = await prog(world, ProcessStep.UON, w.spec355);
      expect(bend.physicalLeft).toBe(-3); // cắt thực có 22 - 5 = 17, Uốn đã dùng 20
      expect(res.notes).toHaveLength(1);
      expect(res.notes![0]).toBe(
        'Uốn cỡ 355mm đã báo nhiều hơn số đoạn cắt thực có (17) 3 đoạn - Uốn sẽ bị chặn tới khi cắt thêm hoặc KCS Uốn ghi thiếu',
      );
      const passed = qcTexts('QC_PASSED');
      expect(passed).toHaveLength(1);
      expect(String(passed[0].note)).toContain('KCS ghi thiếu 5 đoạn');
      expect(String(passed[0].note)).toContain('đã báo nhiều hơn số đoạn cắt thực có');

      const blockedStep = await stepRec(world, ProcessStep.UON, w.spec355, 1).then(
        () => null,
        (e: unknown) => e,
      );
      expect(blockedStep).toBeInstanceOf(BadRequestException);
      expect(msg(blockedStep)).toContain('KCS ghi thiếu 5 đoạn cắt');

      const x3 = await reverse(other.reportId!).then(
        () => null,
        (e: unknown) => e,
      );
      expect(x3).toBeInstanceOf(BadRequestException);
      expect(msg(x3)).toContain('Hủy số cắt này làm cỡ 355mm');

      await cutRec(issue, world, w.spec355, 5);
      await stepRec(world, ProcessStep.UON, w.spec355, 1); // đã mở lại
    });

    // ---------------------------------------------------------------------------------
    it('AC38: công tắc tồn đoạn bật: sau khi chấm Uốn (bỏ 5, làm lại 3) và đợt cắt thiếu 2, tồn đoạn của lệnh = cắt đạt (22 - 5 - 2 = 15) với 12 đoạn đủ Uốn; không có đoạn dư ảo', async () => {
      const world = await w.newInvoice({ quantities: [20] });
      const issue = await w.newIssue(world.piId);
      await w.seedCutDone(issue, world, w.spec355, 20);
      const c2 = await w.seedCutBundle(issue, world, {
        segs: [{ specId: w.spec355, qty: 2 }],
        status: CutBundleStatus.AWAITING_QC,
      });
      const uon = await awaitingStep(world, ProcessStep.UON, w.spec355, 20);

      await withSegmentStock(true, async () => {
        await h.api.reviewStepBundle(
          uon.toString(),
          { segments: [{ segmentSpecId: w.spec355.toString(), failedQty: 8, scrapQty: 5 }] },
          w.kcsA,
        );
        await h.api.reviewCutBundle(
          c2.bundleId.toString(),
          { segments: [{ segmentSpecId: w.spec355.toString(), failedQty: 0, shortQty: 2 }] },
          w.kcsA,
        );
      });

      const rows = await h.prisma.segmentProduction.findMany({
        where: { productionInvoiceId: world.piId, segmentSpecId: w.spec355 },
      });
      const held = rows.reduce((sum, r) => sum + Number(r.heldQty), 0);
      const surplus = rows.reduce((sum, r) => sum + Number(r.surplusQty), 0);
      // Cắt đạt = 22 - 2 thiếu - 5 bỏ = 15; đủ Uốn = 20 - 8 = 12; 3 đoạn làm lại còn là đoạn trơn chờ Uốn lại.
      expect(held).toBe(12);
      expect(held + surplus).toBeLessThanOrEqual(15);
    });

    // ---------------------------------------------------------------------------------
    it('AC39: lệnh có Uốn bỏ 5 chưa cắt lại KHÔNG tự đóng Phôi; cắt 5, Uốn bù 5, KCS đạt xong thì checkPhoiDone đóng dòng hàng đợi', async () => {
      const lean = await w.makeBomRevision(39, [
        { specId: w.spec355, steps: [ProcessStep.CAT, ProcessStep.UON] },
      ]);
      const world = await w.newInvoice({ quantities: [20], bomRevisionIds: [lean] });
      const issue = await w.newIssue(world.piId);
      const entry = await h.prisma.floorQueueEntry.create({
        data: {
          stage: MfgStage.PHOI,
          productionInvoiceId: world.piId,
          workshopId: w.ws.id,
          position: 1,
          status: FloorQueueStatus.RUNNING,
          startedAt: new Date(),
        },
      });
      const admin = h.moduleRef.get(FloorAdminService, { strict: false });
      const checkPhoiDone = () =>
        (
          h.alerts as unknown as {
            checkPhoiDone(e: {
              id: bigint;
              workshopId: bigint;
              productionInvoiceId: bigint;
              productionInvoice: { code: string };
            }): Promise<void>;
          }
        ).checkPhoiDone({
          id: entry.id,
          workshopId: w.ws.id,
          productionInvoiceId: world.piId,
          productionInvoice: { code: world.code },
        });
      const statusOf = async () =>
        (await h.prisma.floorQueueEntry.findUniqueOrThrow({ where: { id: entry.id } })).status;

      // dòng mảnh Phôi của bản định mức đã KCS đạt đủ: chỉ còn phần sắt (Cắt / Uốn) quyết định tự đóng
      await w.seedPieceBatch(world, {
        pieceId: w.pieceCut,
        stage: MfgStage.PHOI,
        qty: 20,
        status: ProductionBatchStatus.QC_DONE,
        withReport: false,
      });
      await w.seedCutDone(issue, world, w.spec355, 20);
      const uon = await awaitingStep(world, ProcessStep.UON, w.spec355, 20);
      await h.api.reviewStepBundle(
        uon.toString(),
        { segments: [{ segmentSpecId: w.spec355.toString(), failedQty: 5, scrapQty: 5 }] },
        w.kcsA,
      );
      const open = await admin.computeProgress(MfgStage.PHOI, world.piId);
      expect(open.complete).toBe(false);
      await checkPhoiDone();
      expect(await statusOf()).toBe(FloorQueueStatus.RUNNING);

      // cắt bù 5 -> KCS chốt + chấm đạt; Uốn bù 5 -> KCS chốt + chấm đạt
      await cutRec(issue, world, w.spec355, 5);
      const cutBundle = await h.prisma.cutBundle.findFirstOrThrow({
        where: { steelIssueId: issue, status: CutBundleStatus.CUTTING },
      });
      await h.api.closeCutBundle(cutBundle.id.toString(), w.kcsA);
      await h.api.reviewCutBundle(cutBundle.id.toString(), { segments: [] }, w.kcsA);
      await checkPhoiDone();
      expect(await statusOf()).toBe(FloorQueueStatus.RUNNING); // Uốn bù chưa báo

      await stepRec(world, ProcessStep.UON, w.spec355, 5);
      const group = await h.api.closeStepGroup(
        {
          productionInvoiceId: world.piId.toString(),
          materialId: w.steelId.toString(),
          step: ProcessStep.UON,
          productionOrderId: world.orderIds[0].toString(),
          workerId: w.workerA,
        },
        w.kcsA,
      );
      await h.api.reviewStepBundle(group.id, { segments: [] }, w.kcsA);

      const done = await admin.computeProgress(MfgStage.PHOI, world.piId);
      expect(done.complete).toBe(true);
      await checkPhoiDone();
      expect(await statusOf()).toBe(FloorQueueStatus.DONE);
    });
  });

  // =====================================================================================
  // AC23 / AC53 / AC12 / ca pat
  // =====================================================================================
  describe('Báo vượt pat / chân nhôm (được phép), gửi lại khoá, dữ liệu cũ, pat đúng lúc KCS chốt', () => {
    const myield = () => h.moduleRef.get(MaterialYieldRecipeProductionService, { strict: false });

    const receivePat = (world: World) =>
      h.prisma.materialYieldIssue.create({
        data: {
          productionOrderId: world.orderIds[0],
          materialId: w.plateId,
          issuedQty: 1000,
          receivedQty: 1000,
          status: MaterialYieldIssueStatus.RECEIVED,
          issuedById: w.admin,
          receivedAt: new Date(),
          receivedById: w.workerA,
        },
      });

    const receiveAlu = (world: World) =>
      h.prisma.materialYieldRecipeIssue.create({
        data: {
          productionInvoiceId: world.piId,
          recipeId: w.recipeId,
          issuedQty: 1000,
          receivedQty: 1000,
          status: MaterialYieldIssueStatus.RECEIVED,
          issuedById: w.admin,
          receivedAt: new Date(),
          receivedById: w.workerA,
        },
      });

    const patRec = (world: World, step: ProcessStep, qty: number, userId: string = w.workerA) =>
      h.batches.recordPieceStepBatch(
        world.orderIds[0].toString(),
        { stage: MfgStage.PHOI, pieceId: w.piecePat.toString(), step, qty },
        userId,
        'PHOI',
      );

    const closePat = (world: World) =>
      h.api.closePieceStepGroup(
        {
          productionOrderId: world.orderIds[0].toString(),
          pieceId: w.piecePat.toString(),
          step: ProcessStep.CAT,
        },
        w.kcsA,
      );

    const stepUon = (world: World, qty: number, key: string) =>
      h.steel.recordStepBatch(
        world.piId.toString(),
        {
          materialId: w.steelId.toString(),
          step: ProcessStep.UON,
          productionOrderId: world.orderIds[0].toString(),
          segments: [{ segmentSpecId: w.spec355.toString(), qty }],
        },
        w.workerA,
        key,
      );

    // Quyết định 19/11 (Câu 6, AC23 viết lại): pat + chân nhôm ĐƯỢC báo vượt số cần (kể cả số cần 0): 201, chỉ ghi log "Báo vượt".
    const overLogs = () => {
      const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      return {
        lines: (): string[] =>
          spy.mock.calls.map((c) => String(c[0])).filter((t) => t.includes('Báo vượt')),
        restore: () => spy.mockRestore(),
      };
    };

    it('AC23 pat (Câu 6): cần 30 đã tính 30 -> báo thêm 1 Dập vẫn tạo được + có dòng log "Báo vượt pat"; báo Cắt 31 (cần 30) cũng tạo được', async () => {
      const world = await w.newInvoice({ quantities: [30] });
      await receivePat(world);
      await w.seedPieceStep(world, { step: ProcessStep.DAP, qty: 30 });
      const logs = overLogs();
      try {
        const over = await patRec(world, ProcessStep.DAP, 1);
        expect(over.qty).toBe(1);
        expect(logs.lines().filter((t) => t.includes('Báo vượt pat'))).toHaveLength(1);
        expect(logs.lines()[0]).toContain('cần 30, đã tính 30, nhập 1');

        await patRec(world, ProcessStep.CAT, 31); // trước đây bị chặn "tối đa 30"
        expect(logs.lines()).toHaveLength(2);
        await patRec(world, ProcessStep.CAT, 30); // đã vượt: vẫn tạo được
        expect(
          await h.prisma.pieceStepBatch.count({ where: { productionOrderId: world.orderIds[0] } }),
        ).toBe(4); // 1 seed + 3 lần báo
        expect(
          (
            await h.prisma.pieceStepBatch.aggregate({
              where: { productionOrderId: world.orderIds[0], step: ProcessStep.CAT },
              _sum: { qty: true },
            })
          )._sum.qty,
        ).toBe(61);
      } finally {
        logs.restore();
      }
    });

    it('AC23 pat (Câu 6): luật khác vẫn giữ - chưa nhận vật tư thì vẫn 400; công đoạn không có trong định mức vẫn 400', async () => {
      const noReceive = await w.newInvoice({ quantities: [30] }); // KHÔNG receivePat
      const e1 = await errOf(patRec(noReceive, ProcessStep.DAP, 1));
      expect(e1).toBeInstanceOf(BadRequestException);
      expect(msg(e1)).toContain('chưa được xác nhận nhận từ kho');

      const world = await w.newInvoice({ quantities: [30] });
      await receivePat(world);
      const e2 = await errOf(patRec(world, ProcessStep.UON, 1));
      expect(e2).toBeInstanceOf(BadRequestException);
      expect(msg(e2)).toContain('không có công đoạn');
      expect(
        await h.prisma.pieceStepBatch.count({
          where: { productionOrderId: { in: [noReceive.orderIds[0], world.orderIds[0]] } },
        }),
      ).toBe(0);
    });

    it('AC23 chân nhôm (Câu 6): cần 30 theo định mức, đã tính 30 -> báo thêm 5 vẫn tạo được + log "Báo vượt chân nhôm"; lệnh KHÔNG có định mức chân nhôm (số cần 0) báo 1 cũng tạo được', async () => {
      const needRev = await w.makeBomRevision(23, [
        { specId: w.spec441, steps: [ProcessStep.CAT] },
      ]);
      await h.prisma.pieceMaterialItem.create({
        data: {
          bomRevisionId: needRev,
          mfgProductId: w.mfgProductId,
          pieceId: w.pieceCut,
          materialId: w.aluOutId,
          qtyPerPiece: 1,
          includeInWeaving: true,
        },
      });
      const withNeed = await w.newInvoice({ quantities: [30], bomRevisionIds: [needRev] });
      await receiveAlu(withNeed);
      await w.seedMaterialYield(withNeed, { step: ProcessStep.CAT, qty: 30 });
      const noNeedRev = await w.makeBomRevision(24, [
        { specId: w.spec441, steps: [ProcessStep.CAT] },
      ]);
      const noNeed = await w.newInvoice({ quantities: [30], bomRevisionIds: [noNeedRev] });
      await receiveAlu(noNeed);

      const logs = overLogs();
      try {
        await myield().recordStepBatch(
          withNeed.piId.toString(),
          { recipeId: w.recipeId.toString(), step: ProcessStep.CAT, qty: 5 },
          w.workerA,
          'PHOI',
        );
        expect(logs.lines().filter((t) => t.includes('Báo vượt chân nhôm'))).toHaveLength(1);
        expect(logs.lines()[0]).toContain('cần 30');
        expect(logs.lines()[0]).toContain('đã tính 30');
        expect(logs.lines()[0]).toContain('nhập 5');

        await myield().recordStepBatch(
          noNeed.piId.toString(),
          { recipeId: w.recipeId.toString(), step: ProcessStep.CAT, qty: 1 },
          w.workerA,
          'PHOI',
        );
        expect(logs.lines()).toHaveLength(2);
        expect(
          await h.prisma.materialYieldStepBatch.count({
            where: { productionInvoiceId: { in: [withNeed.piId, noNeed.piId] } },
          }),
        ).toBe(3); // 1 seed + 2 lần báo
      } finally {
        logs.restore();
      }
    });

    it('AC53: báo Uốn có Idempotency-Key, QLSX hủy hết lần báo, gửi lại ĐÚNG khoá -> 409 câu lời thường (không 500 / P2002, không ghi lại lần 2); khoá mới thì báo được', async () => {
      const world = await w.newInvoice({ quantities: [20] });
      const issue = await w.newIssue(world.piId);
      await w.seedCutDone(issue, world, w.spec355, 20);
      const key = `p1-ac53-${Date.now()}`;
      const first = await stepUon(world, 5, key);
      const report = await h.prisma.floorReport.findFirstOrThrow({
        where: { stepBatchId: BigInt(first.id) },
      });
      await h.review.reverse(report.id.toString(), 'bao nham', w.qlsx);
      expect(await h.prisma.stepBatch.count({ where: { productionInvoiceId: world.piId } })).toBe(
        0,
      );

      const again = await errOf(stepUon(world, 5, key));

      expect(again).toBeInstanceOf(ConflictException);
      expect(msg(again)).toBe(
        'Lần báo này đã ghi nhận trước đó và đã bị QLSX hủy - xem lý do ở "Sản lượng của tôi", cần thì báo lại',
      );
      expect(await h.prisma.stepBatch.count({ where: { productionInvoiceId: world.piId } })).toBe(
        0,
      );
      await stepUon(world, 5, `${key}-moi`);
      expect(await h.prisma.stepBatch.count({ where: { productionInvoiceId: world.piId } })).toBe(
        1,
      );
    });

    it('AC12: PI 2 SKU, còn lần báo Uốn cũ chưa gắn SKU: danh sách ghi CHUA_GAN_SKU, close 409 "Dữ liệu cũ chưa gắn SKU - chưa chấm được, báo IT.", không vào số đỏ / số chờ quá 4 giờ', async () => {
      const admin = h.moduleRef.get(FloorAdminService, { strict: false });
      const before = await admin.summary();
      const world = await w.newInvoice({ quantities: [50, 50] });
      await w.seedStepBatch(world, {
        step: ProcessStep.UON,
        segs: [{ specId: w.spec355, qty: 10 }],
        orderId: null,
        createdAt: PAST(6),
      });

      const list = await h.review.listOpen('PHOI', world.piId.toString(), undefined, false);
      const group = list.stepGroups.find((g) => g.order === null);
      expect(group).toBeDefined();
      expect(group!.blockedReason).toBe('CHUA_GAN_SKU');

      const err = await errOf(
        h.api.closeStepGroup(
          {
            productionInvoiceId: world.piId.toString(),
            materialId: w.steelId.toString(),
            step: ProcessStep.UON,
            productionOrderId: null,
            workerId: w.workerA,
          },
          w.kcsA,
        ),
      );
      expect(err).toBeInstanceOf(ConflictException);
      expect(msg(err)).toBe('Dữ liệu cũ chưa gắn SKU - chưa chấm được, báo IT.');
      expect(await h.prisma.stepBundle.count({ where: { productionInvoiceId: world.piId } })).toBe(
        0,
      );
      const after = await admin.summary();
      expect(after).toEqual(before); // open / awaitingKcs / stale không đổi (dòng bị chặn không đếm)
    });

    it('PI 1 SKU: lần báo Uốn cũ chưa gắn SKU gộp vào nhóm của SKU duy nhất (không bị chặn), close qua', async () => {
      const world = await w.newInvoice({ quantities: [50] });
      await w.seedStepBatch(world, {
        step: ProcessStep.UON,
        segs: [{ specId: w.spec355, qty: 10 }],
        orderId: null,
      });
      const list = await h.review.listOpen('PHOI', world.piId.toString(), undefined, false);
      const groups = list.stepGroups.filter(
        (g) => g.pi.productionInvoiceId === world.piId.toString(),
      );
      expect(groups).toHaveLength(1);
      expect(groups[0].blockedReason).toBeNull();
      const bundle = await h.api.closeStepGroup(
        {
          productionInvoiceId: world.piId.toString(),
          materialId: w.steelId.toString(),
          step: ProcessStep.UON,
          productionOrderId: null,
          workerId: w.workerA,
        },
        w.kcsA,
      );
      expect(bundle.status).toBe(StepBundleStatus.AWAITING_QC);
    });

    describe('pat: báo pat đúng lúc KCS chốt nhóm pat (khoá piece-step-batch khác khoá piece-step-bundle)', () => {
      it('(a) giữ piece-step-bundle: close chờ, báo pat KHÔNG bị chặn (khoá khác) và xong trước; sau nhả, đợt gom đủ 25, không dòng nào mồ côi', async () => {
        const world = await w.newInvoice({ quantities: [100] });
        await receivePat(world);
        await w.seedPieceStep(world, { step: ProcessStep.CAT, qty: 20 });

        const out = await raceWith(
          h.prisma,
          [lockSql(`piece-step-bundle:${world.orderIds[0]}:${w.piecePat}:${ProcessStep.CAT}`)],
          [() => closePat(world), () => patRec(world, ProcessStep.CAT, 5, w.workerB)],
          { minWaiting: 1 },
        );

        expectNoServerFault(out);
        expect(out[0].waited).toBe(true);
        expect(out[0].doneBeforeRelease).toBe(false);
        expect(out[1].doneBeforeRelease).toBe(true); // khoá khác nhau nên báo pat không phải chờ
        expect(out.every((o) => o.ok)).toBe(true);
        const bundles = await h.prisma.pieceStepBundle.findMany({
          where: { productionOrderId: world.orderIds[0] },
        });
        expect(bundles).toHaveLength(1);
        const rows = await h.prisma.pieceStepBatch.findMany({
          where: { productionOrderId: world.orderIds[0] },
        });
        expect(rows.reduce((sum, r) => sum + r.qty, 0)).toBe(25); // không mất số
        expect(bundles[0].qty).toBe(25);
        expect(rows.every((r) => r.pieceStepBundleId === bundles[0].id)).toBe(true);
      });

      it('(b) giữ FOR UPDATE dòng pat cũ: close đã đọc và kẹt ở bước gom (đang giữ khoá dòng lệnh) nên báo pat mới phải chờ sau; sau nhả, đợt chỉ gom 20 cũ, dòng 5 mới KHÔNG bị nhét vào đợt đã chốt và còn nguyên cho nhóm sau', async () => {
        const world = await w.newInvoice({ quantities: [100] });
        await receivePat(world);
        await w.seedPieceStep(world, { step: ProcessStep.CAT, qty: 20 });
        const old = await h.prisma.pieceStepBatch.findFirstOrThrow({
          where: { productionOrderId: world.orderIds[0] },
        });

        const out = await raceWith(
          h.prisma,
          [rowLockSql('piece_step_batches', old.id)],
          [() => closePat(world), () => patRec(world, ProcessStep.CAT, 5, w.workerB)],
          { ordered: true },
        );

        expectNoServerFault(out);
        // báo pat chờ khoá dòng lệnh (FOR UPDATE production_orders, cuối thứ tự khoá) mà close đang giữ
        expect(out.every((o) => o.waited && !o.doneBeforeRelease)).toBe(true);
        expect(out.every((o) => o.ok)).toBe(true);
        const bundles = await h.prisma.pieceStepBundle.findMany({
          where: { productionOrderId: world.orderIds[0] },
        });
        expect(bundles).toHaveLength(1);
        expect(bundles[0].qty).toBe(20);
        const rows = await h.prisma.pieceStepBatch.findMany({
          where: { productionOrderId: world.orderIds[0] },
          orderBy: { id: 'asc' },
        });
        expect(rows.map((r) => [r.qty, r.pieceStepBundleId])).toEqual([
          [20, bundles[0].id],
          [5, null], // dòng mới chưa gom: thành nhóm sau, không mất số
        ]);
        const next = await closePat(world);
        expect(next.status).toBe(PieceStepBundleStatus.AWAITING_QC);
        const all = await h.prisma.pieceStepBundle.findMany({
          where: { productionOrderId: world.orderIds[0] },
        });
        expect(all.map((b) => b.qty).sort((a, b) => a - b)).toEqual([5, 20]);
      });
    });
  });
});
