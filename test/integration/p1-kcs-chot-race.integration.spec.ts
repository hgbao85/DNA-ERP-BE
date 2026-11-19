import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  CutBundleStatus,
  FloorReportKind,
  MfgStage,
  PieceStepBundleStatus,
  ProcessStep,
  ProductionBatchStatus,
  ProductionOrderFloorStage,
  StockLedgerRefType,
} from '../../src/generated/prisma/client';
import {
  Outcome,
  P1Harness,
  P1World,
  World,
  createHarness,
  expectNoServerFault,
  lockSql,
  msg,
  oneWinner,
  raceWith,
  rowLockSql,
  withSegmentStock,
} from './p1-kcs.fixture';

/**
 * IT2 (P1, 18/11/2026) - KCS CHỐT đợt đúng lúc có việc khác, trên Postgres TEST thật.
 *  AC5  công nhân báo đúng lúc KCS chốt đợt của chính người đó (đợt cắt / nhóm Uốn / lô Hàn)
 *  AC6  2 KCS cùng chốt 1 đợt (5 loại: cắt, nhóm công đoạn, lô mảnh, pat, chân nhôm)
 *  AC7  KCS chốt nhóm Uốn đúng lúc QLSX hủy (4 thứ tự) + biến thể đợt cắt / lô Hàn; hủy hết -> 400, không có đợt rỗng
 *  AC9  KCS chốt pat / chân nhôm không phát MATERIAL_YIELD_STEP_BUNDLE_TO_KCS; "Gửi KCS" của tài khoản thống kê sau đó nhận câu chung
 *  AC11 lệnh không còn SKU đang chạy: chốt trả 409 câu floor-gate nhãn "chốt để chấm"
 *  AC42 ADMIN gán / sửa SKU đợt cắt đúng lúc báo cắt / QLSX hủy
 *  AC43 2 KCS cùng LƯU kết quả chấm 1 đợt (5 loại) -> 1 x 201, 1 x 409; đúng 1 qc_review
 *  AC54 KCS chốt đợt cắt A đúng lúc chấm đợt B cùng lô sắt -> steel_issues.status = AWAITING_QC
 *  MF7  chốt đợt vừa bị QLSX hủy hết -> 409 "vừa bị QLSX hủy hết số", không 404 / 500
 *
 * Mỗi ca khẳng định bên kia đã PHẢI CHỜ khoá thật (`waited`) và, khi cần, chạy cả 2 thứ tự thắng (`ordered`).
 * Chuỗi khoá advisory trùng từng ký tự với code (hợp đồng, mục "Chuỗi khoá trong code").
 */
describe('P1 IT2: KCS chốt / chấm đúng lúc có việc khác (integration, real Postgres)', () => {
  let h: P1Harness;
  let w: P1World;

  beforeAll(async () => {
    h = await createHarness();
    w = new P1World(h, `it2-${Date.now()}`);
    await w.init();
  });

  afterAll(async () => {
    if (w) await w.cleanup();
    if (h) await h.close();
  });

  beforeEach(() => h.clearEmits());

  const ORDERS = [
    ['chốt / gán vào hàng đợi khoá trước', 0],
    ['việc kia vào hàng đợi khoá trước', 1],
  ] as const;

  const cutReport = (issueId: bigint, world: World, qty: number, userId: string) =>
    h.steel.recordCutBatch(
      issueId.toString(),
      {
        productionOrderId: world.orderIds[0].toString(),
        segments: [{ segmentSpecId: w.spec441.toString(), qty }],
      },
      userId,
    );

  const stepReport = (world: World, qty: number, userId: string) =>
    h.steel.recordStepBatch(
      world.piId.toString(),
      {
        materialId: w.steelId.toString(),
        step: ProcessStep.UON,
        productionOrderId: world.orderIds[0].toString(),
        segments: [{ segmentSpecId: w.spec355.toString(), qty }],
      },
      userId,
    );

  const hanReport = (world: World, qty: number, userId: string) =>
    h.batches.recordProductionBatch(
      world.orderIds[0].toString(),
      { pieceId: w.pieceHan.toString(), qty, stage: MfgStage.HAN },
      userId,
      'HAN',
    );

  const closeUon = (world: World, workerId: string | null = w.workerA, actorId = w.kcsA) =>
    h.api.closeStepGroup(
      {
        productionInvoiceId: world.piId.toString(),
        materialId: w.steelId.toString(),
        step: ProcessStep.UON,
        productionOrderId: world.orderIds[0].toString(),
        workerId,
      },
      actorId,
    );

  const reverse = (reportId: bigint) => h.review.reverse(reportId.toString(), 'bao nham', w.qlsx);

  const errOf = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );

  /** Mọi lần báo CÒN HIỆU LỰC (chưa bị đảo) của PI trỏ đúng đợt đang có và tổng dòng báo = tổng số của đợt. */
  async function expectReportsMatchBundles(
    world: World,
    kind: FloorReportKind,
    expectedTotal: number,
  ): Promise<void> {
    const reports = await h.prisma.floorReport.findMany({
      where: {
        productionInvoiceId: world.piId,
        kind,
        reversalOfId: null,
        reversedBy: { is: null },
      },
      include: { lines: true },
    });
    expect(reports.reduce((s, r) => s + r.lines.reduce((t, l) => t + l.qty, 0), 0)).toBe(
      expectedTotal,
    );
    for (const r of reports) {
      const target = r.cutBundleId ?? r.stepBatchId ?? r.productionBatchId;
      expect(target).not.toBeNull();
    }
  }

  // =====================================================================================
  // AC5: công nhân báo đúng lúc KCS chốt đợt của chính người đó
  // =====================================================================================
  describe('AC5: báo đúng lúc KCS chốt đợt của chính người báo', () => {
    it.each(ORDERS)(
      'đợt cắt (%s): giữ FOR UPDATE dòng đợt -> close ∥ báo 30 cùng chờ; lần báo nằm trọn trong đợt đã chốt hoặc trong 1 đợt mở mới, tổng = tổng các lần báo',
      async (_n, closeFirst) => {
        const world = await w.newInvoice({ quantities: [200] });
        const issue = await w.newIssue(world.piId);
        const { bundleId } = await w.seedCutBundle(issue, world, {
          segs: [{ specId: w.spec441, qty: 40 }],
        });
        const close = () => h.api.closeCutBundle(bundleId.toString(), w.kcsA);
        const report = () => cutReport(issue, world, 30, w.workerA);

        const out = await raceWith(
          h.prisma,
          [rowLockSql('cut_bundles', bundleId)],
          closeFirst === 0 ? [close, report] : [report, close],
          { ordered: true },
        );

        expect(out.every((o) => o.waited && o.ok)).toBe(true);
        expectNoServerFault(out);
        const bundles = await h.prisma.cutBundle.findMany({
          where: { steelIssueId: issue },
          include: { segments: true },
          orderBy: { id: 'asc' },
        });
        const qtyOf = (b: (typeof bundles)[number]) => b.segments.reduce((s, x) => s + x.qty, 0);
        const closed = bundles.find((b) => b.id === bundleId)!;
        expect(closed.status).toBe(CutBundleStatus.AWAITING_QC);
        if (closeFirst === 0) {
          // chốt trước: đợt đã chốt giữ 40, lần báo 30 sang đợt mở mới
          expect(qtyOf(closed)).toBe(40);
          const open = bundles.filter((b) => b.id !== bundleId);
          expect(open).toHaveLength(1);
          expect(open[0].status).toBe(CutBundleStatus.CUTTING);
          expect(qtyOf(open[0])).toBe(30);
        } else {
          // báo trước: lần báo nằm trọn trong đợt đã chốt
          expect(bundles).toHaveLength(1);
          expect(qtyOf(closed)).toBe(70);
        }
        expect(bundles.reduce((s, b) => s + qtyOf(b), 0)).toBe(70);
        await expectReportsMatchBundles(world, FloorReportKind.CUT, 70);
      },
    );

    it.each([
      ['báo Uốn xong trước khi chốt (giữ step-bundle, close chờ)', 'bundle'],
      ['chốt xong trước khi báo Uốn (giữ step-batch, báo chờ)', 'batch'],
    ] as const)(
      'nhóm Uốn của 1 người: %s -> đợt gom đúng các lần báo đã có lúc chốt; Σ các đợt = Σ lần báo',
      async (_n, which) => {
        const world = await w.newInvoice({ quantities: [200] });
        const issue = await w.newIssue(world.piId);
        await w.seedCutDone(issue, world, w.spec355, 200);
        await w.seedStepBatch(world, {
          step: ProcessStep.UON,
          segs: [{ specId: w.spec355, qty: 80 }],
        });
        const key = (kind: 'step-bundle' | 'step-batch') =>
          `${kind}:${world.piId}:${w.steelId}:${ProcessStep.UON}:${world.orderIds[0]}`;

        const out = await raceWith(
          h.prisma,
          [lockSql(which === 'bundle' ? key('step-bundle') : key('step-batch'))],
          [() => closeUon(world), () => stepReport(world, 30, w.workerA)],
          { minWaiting: 1 },
        );

        expectNoServerFault(out);
        expect(out.every((o) => o.ok)).toBe(true);
        const waiter = which === 'bundle' ? out[0] : out[1];
        const other = which === 'bundle' ? out[1] : out[0];
        expect(waiter.waited).toBe(true);
        expect(waiter.doneBeforeRelease).toBe(false);
        expect(other.doneBeforeRelease).toBe(true); // bên kia KHÔNG dùng khoá này (không vòng chờ)

        const bundles = await h.prisma.stepBundle.findMany({
          where: { productionInvoiceId: world.piId },
          include: { batches: { include: { segments: true } } },
        });
        expect(bundles).toHaveLength(1);
        const inBundle = bundles[0].batches.reduce(
          (s, b) => s + b.segments.reduce((t, x) => t + x.qty, 0),
          0,
        );
        const loose = await h.prisma.stepBatch.findMany({
          where: { productionInvoiceId: world.piId, stepBundleId: null },
          include: { segments: true },
        });
        const looseQty = loose.reduce((s, b) => s + b.segments.reduce((t, x) => t + x.qty, 0), 0);
        if (which === 'bundle') {
          expect(inBundle).toBe(110);
          expect(looseQty).toBe(0);
        } else {
          expect(inBundle).toBe(80);
          expect(looseQty).toBe(30);
        }
        expect(inBundle + looseQty).toBe(110);
        await expectReportsMatchBundles(world, FloorReportKind.STEP, 110);
      },
    );

    it.each(ORDERS)(
      'lô Hàn (%s): giữ production-batch-open -> close ∥ báo 30 cùng chờ; báo sau chốt thì mở lô OPEN mới, báo trước chốt thì nằm trọn trong lô đã chốt',
      async (_n, closeFirst) => {
        const world = await w.newInvoice({ quantities: [200] });
        const { batchId } = await w.seedPieceBatch(world, {
          pieceId: w.pieceHan,
          stage: MfgStage.HAN,
          qty: 20,
        });
        const close = () => h.api.closeProductionBatch(batchId.toString(), w.kcsA);
        const report = () => hanReport(world, 30, w.workerA);

        const out = await raceWith(
          h.prisma,
          [lockSql(`production-batch-open:${world.orderIds[0]}:${w.pieceHan}:${MfgStage.HAN}`)],
          closeFirst === 0 ? [close, report] : [report, close],
          { ordered: true },
        );

        expect(out.every((o) => o.waited && o.ok)).toBe(true);
        expectNoServerFault(out);
        const rows = await h.prisma.productionBatch.findMany({
          where: { productionOrderId: world.orderIds[0], pieceId: w.pieceHan },
          orderBy: { id: 'asc' },
        });
        const sealed = rows.find((r) => r.id === batchId)!;
        expect(sealed.status).toBe(ProductionBatchStatus.AWAITING_QC);
        if (closeFirst === 0) {
          expect(sealed.reportedQty).toBe(20);
          const open = rows.filter((r) => r.id !== batchId);
          expect(open).toHaveLength(1);
          expect(open[0].status).toBe(ProductionBatchStatus.OPEN);
          expect(open[0].reportedQty).toBe(30);
        } else {
          expect(rows).toHaveLength(1);
          expect(sealed.reportedQty).toBe(50);
        }
        await expectReportsMatchBundles(world, FloorReportKind.PIECE, 50);
      },
    );
  });

  // =====================================================================================
  // 5 loại đợt dùng chung cho AC6 / AC43 / AC11
  // =====================================================================================
  interface Handle {
    world: World;
    /** SQL giữ khoá khi 2 lời gọi CHỐT cùng 1 đợt. */
    closeHold: string[];
    /** SQL giữ khoá khi 2 lời gọi CHẤM cùng 1 đợt (đã ở AWAITING_QC). */
    reviewHold: string[];
    close: (actorId: string) => Promise<unknown>;
    review: (actorId: string) => Promise<unknown>;
    /** Số đợt / lô mảnh hiện có của loại này. */
    bundleCount: () => Promise<number>;
    sealedAt: () => Promise<Date | null>;
    reviewCount: () => Promise<number>;
    loserClose: { status: 400 | 409; text: string };
  }

  type Kind = 'cut' | 'step' | 'han' | 'pat' | 'nhom';
  const KINDS: Kind[] = ['cut', 'step', 'han', 'pat', 'nhom'];

  async function build(
    kind: Kind,
    awaiting: boolean,
    floorStage: ProductionOrderFloorStage = ProductionOrderFloorStage.ACTIVE,
  ): Promise<Handle> {
    const world = await w.newInvoice({ quantities: [200], floorStage });
    const order = world.orderIds[0];
    const common = { world };
    if (kind === 'cut') {
      const issue = await w.newIssue(world.piId);
      const { bundleId } = await w.seedCutBundle(issue, world, {
        segs: [{ specId: w.spec441, qty: 40 }],
        status: awaiting ? CutBundleStatus.AWAITING_QC : CutBundleStatus.CUTTING,
      });
      return {
        ...common,
        closeHold: [rowLockSql('cut_bundles', bundleId)],
        reviewHold: [rowLockSql('cut_bundles', bundleId)],
        close: (a) => h.api.closeCutBundle(bundleId.toString(), a),
        review: (a) => h.api.reviewCutBundle(bundleId.toString(), { segments: [] }, a),
        bundleCount: () => h.prisma.cutBundle.count({ where: { steelIssueId: issue } }),
        sealedAt: async () =>
          (await h.prisma.cutBundle.findUniqueOrThrow({ where: { id: bundleId } })).completedAt,
        reviewCount: async () => (await w.qcReviews({ cutBundleId: bundleId })).length,
        loserClose: { status: 409, text: 'Đợt cắt này vừa được chốt để chấm - tải lại trang.' },
      };
    }
    if (kind === 'step') {
      let bundleId: bigint | null = null;
      if (awaiting) {
        bundleId = await w.seedStepBundle(world, { step: ProcessStep.UON });
      }
      await w.seedStepBatch(world, {
        step: ProcessStep.UON,
        segs: [{ specId: w.spec355, qty: 40 }],
        bundleId,
      });
      return {
        ...common,
        closeHold: [lockSql(`step-bundle:${world.piId}:${w.steelId}:${ProcessStep.UON}:${order}`)],
        reviewHold: bundleId ? [rowLockSql('step_bundles', bundleId)] : [],
        close: (a) => closeUon(world, w.workerA, a),
        review: (a) => h.api.reviewStepBundle(bundleId!.toString(), { segments: [] }, a),
        bundleCount: () =>
          h.prisma.stepBundle.count({ where: { productionInvoiceId: world.piId } }),
        sealedAt: async () =>
          (await h.prisma.stepBundle.findFirst({ where: { productionInvoiceId: world.piId } }))
            ?.submittedAt ?? null,
        reviewCount: async () =>
          bundleId ? (await w.qcReviews({ stepBundleId: bundleId })).length : 0,
        loserClose: { status: 400, text: 'không còn lần báo nào chưa chấm' },
      };
    }
    if (kind === 'han') {
      const { batchId } = await w.seedPieceBatch(world, {
        pieceId: w.pieceHan,
        stage: MfgStage.HAN,
        qty: 20,
        status: awaiting ? ProductionBatchStatus.AWAITING_QC : ProductionBatchStatus.OPEN,
      });
      return {
        ...common,
        closeHold: [lockSql(`production-batch-open:${order}:${w.pieceHan}:${MfgStage.HAN}`)],
        reviewHold: [rowLockSql('production_batches', batchId)],
        close: (a) => h.api.closeProductionBatch(batchId.toString(), a),
        review: (a) => h.api.reviewProductionBatch(batchId.toString(), { failedQty: 0 }, a),
        bundleCount: () =>
          h.prisma.productionBatch.count({
            where: { productionOrderId: order, pieceId: w.pieceHan },
          }),
        sealedAt: () => Promise.resolve(null),
        reviewCount: async () => (await w.qcReviews({ productionBatchId: batchId })).length,
        loserClose: { status: 409, text: 'Lô này vừa được chốt để chấm - tải lại trang.' },
      };
    }
    if (kind === 'pat') {
      const bundleId = await w.seedPieceStep(world, {
        step: ProcessStep.DAP,
        qty: 50,
        bundled: awaiting ? PieceStepBundleStatus.AWAITING_QC : undefined,
      });
      return {
        ...common,
        closeHold: [lockSql(`piece-step-bundle:${order}:${w.piecePat}:${ProcessStep.DAP}`)],
        reviewHold: bundleId ? [rowLockSql('piece_step_bundles', bundleId)] : [],
        close: (a) =>
          h.api.closePieceStepGroup(
            {
              productionOrderId: order.toString(),
              pieceId: w.piecePat.toString(),
              step: ProcessStep.DAP,
            },
            a,
          ),
        review: (a) => h.api.reviewPieceStep(bundleId!.toString(), { failedQty: 0 }, a),
        bundleCount: () => h.prisma.pieceStepBundle.count({ where: { productionOrderId: order } }),
        sealedAt: async () =>
          (await h.prisma.pieceStepBundle.findFirst({ where: { productionOrderId: order } }))
            ?.submittedAt ?? null,
        reviewCount: async () =>
          bundleId ? (await w.qcReviews({ pieceStepBundleId: bundleId })).length : 0,
        loserClose: { status: 400, text: 'không còn lần báo nào chưa chấm' },
      };
    }
    const bundleId = await w.seedMaterialYield(world, {
      step: ProcessStep.CAT,
      qty: 50,
      bundled: awaiting ? PieceStepBundleStatus.AWAITING_QC : undefined,
    });
    return {
      ...common,
      closeHold: [
        lockSql(`material-yield-step-bundle:${world.piId}:${w.recipeId}:${ProcessStep.CAT}`),
      ],
      reviewHold: bundleId ? [rowLockSql('material_yield_step_bundles', bundleId)] : [],
      close: (a) =>
        h.api.closeMaterialYieldGroup(
          {
            productionInvoiceId: world.piId.toString(),
            recipeId: w.recipeId.toString(),
            step: ProcessStep.CAT,
          },
          a,
        ),
      review: (a) => h.api.reviewMaterialYieldStep(bundleId!.toString(), { failedQty: 0 }, a),
      bundleCount: () =>
        h.prisma.materialYieldStepBundle.count({ where: { productionInvoiceId: world.piId } }),
      sealedAt: async () =>
        (
          await h.prisma.materialYieldStepBundle.findFirst({
            where: { productionInvoiceId: world.piId },
          })
        )?.submittedAt ?? null,
      reviewCount: async () =>
        bundleId ? (await w.qcReviews({ materialYieldStepBundleId: bundleId })).length : 0,
      loserClose: { status: 400, text: 'không còn lần báo nào chưa chấm' },
    };
  }

  // =====================================================================================
  // AC6: 2 KCS cùng chốt
  // =====================================================================================
  describe('AC6: 2 KCS cùng chốt 1 đợt', () => {
    it.each(KINDS)(
      '%s: 2 lời gọi close cùng chờ khoá; đúng 1 thành công, lời gọi kia lỗi lời thường (không chữ "gửi KCS"); giờ chốt không bị ghi đè; không sinh đợt thứ 2',
      async (kind) => {
        const hd = await build(kind, false);
        const before = await hd.bundleCount();

        const out = await raceWith(h.prisma, hd.closeHold, [
          () => hd.close(w.kcsA),
          () => hd.close(w.kcsB),
        ]);

        expect(out.every((o) => o.waited)).toBe(true);
        expectNoServerFault(out);
        const { loser } = oneWinner(out);
        expect((loser.error as { getStatus(): number }).getStatus()).toBe(hd.loserClose.status);
        expect(msg(loser.error)).toContain(hd.loserClose.text);
        expect(msg(loser.error)).toContain('tải lại trang');
        expect(msg(loser.error)).not.toMatch(/gửi KCS/i);
        // cut / han đã có sẵn 1 dòng; nhóm công đoạn, pat, chân nhôm sinh đúng 1 đợt
        expect(await hd.bundleCount()).toBe(kind === 'cut' || kind === 'han' ? before : before + 1);

        const sealed = await hd.sealedAt();
        const third = await errOf(hd.close(w.kcsB));
        expect(third).not.toBeNull();
        expect(await hd.sealedAt()).toEqual(sealed);
      },
    );
  });

  // =====================================================================================
  // AC43: 2 KCS cùng lưu kết quả
  // =====================================================================================
  describe('AC43: 2 KCS cùng LƯU kết quả chấm 1 đợt đã chốt', () => {
    it.each(KINDS)(
      '%s: giữ khoá dòng đợt -> 2 lời gọi cùng chờ; 1 x 201, 1 x 409 "Đợt này vừa được KCS khác chấm xong - tải lại trang."; đúng 1 qc_review',
      async (kind) => {
        const hd = await build(kind, true);
        const run = () =>
          raceWith(h.prisma, hd.reviewHold, [() => hd.review(w.kcsA), () => hd.review(w.kcsB)]);
        // lô mảnh: công tắc tồn đoạn bật, kho đủ đoạn -> trừ đoạn đúng 1 lần
        let out: Outcome[];
        if (kind === 'han') {
          await w.stockSegment(w.specH1, 100);
          await w.stockSegment(w.specH2, 100);
          out = await withSegmentStock(true, run);
        } else {
          out = await run();
        }

        expect(out.every((o) => o.waited)).toBe(true);
        expectNoServerFault(out);
        const { loser } = oneWinner(out);
        expect(loser.error).toBeInstanceOf(ConflictException);
        expect(msg(loser.error)).toContain('Đợt này vừa được KCS khác chấm xong - tải lại trang.');
        expect(await hd.reviewCount()).toBe(1);

        if (kind === 'han') {
          const batch = await h.prisma.productionBatch.findFirstOrThrow({
            where: { productionOrderId: hd.world.orderIds[0], pieceId: w.pieceHan },
          });
          // mỗi cỡ đoạn (2 cỡ) đúng 1 bút toán trừ đoạn cho lô này
          expect(await w.ledgerCount(StockLedgerRefType.SEGMENT_CONSUME, batch.id.toString())).toBe(
            2,
          );
        }
        if (kind === 'pat') {
          expect(
            await h.prisma.productionBatch.count({
              where: {
                productionOrderId: hd.world.orderIds[0],
                pieceId: w.piecePat,
                status: ProductionBatchStatus.QC_DONE,
              },
            }),
          ).toBe(1); // pat: 1 lô tự sinh
        }
        if (kind === 'nhom') {
          const bundle = await h.prisma.materialYieldStepBundle.findFirstOrThrow({
            where: { productionInvoiceId: hd.world.piId },
          });
          expect(
            await w.ledgerCount(
              StockLedgerRefType.MATERIAL_YIELD_RECIPE_OUTPUT,
              bundle.id.toString(),
            ),
          ).toBe(1);
        }
      },
    );
  });

  // =====================================================================================
  // AC11: lệnh không còn SKU đang chạy
  // =====================================================================================
  describe('AC11: chốt khi lệnh đã dừng', () => {
    it.each(KINDS)(
      '%s: lệnh PAUSED -> 409 câu floor-gate nhãn "chốt để chấm", đợt không đổi',
      async (kind) => {
        const hd = await build(kind, false, ProductionOrderFloorStage.PAUSED);
        const before = await hd.bundleCount();

        const err = await errOf(hd.close(w.kcsA));

        expect(err).toBeInstanceOf(ConflictException);
        expect(msg(err)).toContain('chưa có SKU nào được QLSX bấm "Bắt đầu"');
        expect(msg(err)).toContain('chưa/không thể chốt để chấm');
        expect(await hd.bundleCount()).toBe(before);
      },
    );
  });

  // =====================================================================================
  // AC7: chốt nhóm Uốn đúng lúc QLSX hủy
  // =====================================================================================
  describe('AC7: KCS chốt đúng lúc QLSX hủy', () => {
    /** Nhóm Uốn của A: lần 80 + lần 40 (đều có dòng sổ). */
    async function setupUon() {
      const world = await w.newInvoice({ quantities: [200] });
      const issue = await w.newIssue(world.piId);
      await w.seedCutDone(issue, world, w.spec355, 200);
      const b80 = await w.seedStepBatch(world, {
        step: ProcessStep.UON,
        segs: [{ specId: w.spec355, qty: 80 }],
      });
      const b40 = await w.seedStepBatch(world, {
        step: ProcessStep.UON,
        segs: [{ specId: w.spec355, qty: 40 }],
      });
      return { world, b80, b40 };
    }
    const bundleBatches = async (world: World) => {
      const bundles = await h.prisma.stepBundle.findMany({
        where: { productionInvoiceId: world.piId },
        include: { batches: { include: { segments: true } } },
      });
      return bundles.map((b) =>
        b.batches.reduce((s, x) => s + x.segments.reduce((t, y) => t + y.qty, 0), 0),
      );
    };

    it('(a) hủy commit trước: giữ step-bundle -> close chờ, QLSX hủy lần 40 (không cần khoá này, xong ngay); đợt chỉ gồm lần 80', async () => {
      const { world, b40 } = await setupUon();
      const out = await raceWith(
        h.prisma,
        [lockSql(`step-bundle:${world.piId}:${w.steelId}:${ProcessStep.UON}:${world.orderIds[0]}`)],
        [() => closeUon(world), () => reverse(b40.reportId!)],
        { minWaiting: 1 },
      );

      expect(out[0].waited).toBe(true);
      expect(out[1].doneBeforeRelease).toBe(true);
      expect(out.every((o) => o.ok)).toBe(true);
      expect(await bundleBatches(world)).toEqual([80]);
    });

    it('(b) chốt commit trước: giữ FOR UPDATE dòng lần 40 -> close chờ rồi hủy chờ sau; close lấy cả 2 lần, hủy nhận 409 câu AC15', async () => {
      const { world, b40 } = await setupUon();
      const out = await raceWith(
        h.prisma,
        [rowLockSql('step_batches', b40.batchId)],
        [() => closeUon(world), () => reverse(b40.reportId!)],
        { ordered: true },
      );

      expect(out.every((o) => o.waited)).toBe(true);
      expectNoServerFault(out);
      expect(out[0].ok).toBe(true);
      expect(out[1].error).toBeInstanceOf(ConflictException);
      expect(msg(out[1].error)).toContain('KCS đã bắt đầu chấm đợt này - không hủy được nữa');
      expect(await bundleBatches(world)).toEqual([120]);
    });

    it('(c) dòng lần 40 bị xoá đúng như reverseStep làm trong lúc close chờ ở FOR UPDATE: close vẫn thành công, đợt chỉ gồm lần 80', async () => {
      const { world, b40 } = await setupUon();
      const out = await raceWith(
        h.prisma,
        [rowLockSql('step_batches', b40.batchId)],
        [() => closeUon(world)],
        {
          beforeRelease: async (client) => {
            await client.query(
              `DELETE FROM "step_batch_segments" WHERE "stepBatchId" = ${b40.batchId.toString()}`,
            );
            await client.query(`DELETE FROM "step_batches" WHERE "id" = ${b40.batchId.toString()}`);
          },
        },
      );

      expect(out[0].waited).toBe(true);
      expect(out[0].ok).toBe(true);
      expect(await bundleBatches(world)).toEqual([80]);
    });

    it('(d) QLSX hủy cả 2 lần ngay trước khi chốt: close 400 "không còn lần báo nào chưa chấm", KHÔNG có step_bundle rỗng', async () => {
      const { world, b80, b40 } = await setupUon();
      await reverse(b80.reportId!);
      await reverse(b40.reportId!);

      const err = await errOf(closeUon(world));

      expect(err).toBeInstanceOf(BadRequestException);
      expect(msg(err)).toContain('không còn lần báo nào chưa chấm');
      expect(await h.prisma.stepBundle.count({ where: { productionInvoiceId: world.piId } })).toBe(
        0,
      );
    });

    it.each(ORDERS)(
      'biến thể đợt cắt (%s): close ∥ hủy 1 trong 2 lần báo; chốt trước thì hủy nhận 409 và đợt giữ 70, hủy trước thì đợt chốt còn 40',
      async (_n, closeFirst) => {
        const world = await w.newInvoice({ quantities: [200] });
        const issue = await w.newIssue(world.piId);
        const { bundleId } = await w.seedCutBundle(issue, world, {
          segs: [{ specId: w.spec441, qty: 40 }],
        });
        await cutReport(issue, world, 30, w.workerA);
        const second = await h.prisma.floorReport.findFirstOrThrow({
          where: { cutBundleId: bundleId, lines: { some: { qty: 30 } } },
        });
        const close = () => h.api.closeCutBundle(bundleId.toString(), w.kcsA);
        const cancel = () => reverse(second.id);

        const out = await raceWith(
          h.prisma,
          [rowLockSql('cut_bundles', bundleId)],
          closeFirst === 0 ? [close, cancel] : [cancel, close],
          { ordered: true },
        );

        expect(out.every((o) => o.waited)).toBe(true);
        expectNoServerFault(out);
        const seg = await h.prisma.cutPatternSegment.aggregate({
          where: { cutBundleId: bundleId },
          _sum: { qty: true },
        });
        if (closeFirst === 0) {
          expect(out[0].ok).toBe(true);
          expect(out[1].error).toBeInstanceOf(ConflictException);
          expect(msg(out[1].error)).toContain('KCS đã bắt đầu chấm đợt này - không hủy được nữa');
          expect(seg._sum.qty).toBe(70);
        } else {
          expect(out.every((o) => o.ok)).toBe(true);
          expect(seg._sum.qty).toBe(40);
        }
      },
    );

    it.each(ORDERS)(
      'biến thể lô Hàn (%s): close ∥ hủy 1 lần báo; chốt trước thì hủy nhận 409, hủy trước thì lô chốt còn 20',
      async (_n, closeFirst) => {
        const world = await w.newInvoice({ quantities: [200] });
        const { batchId } = await w.seedPieceBatch(world, {
          pieceId: w.pieceHan,
          stage: MfgStage.HAN,
          qty: 20,
        });
        await hanReport(world, 30, w.workerA);
        const second = await h.prisma.floorReport.findFirstOrThrow({
          where: { productionBatchId: batchId, lines: { some: { qty: 30 } } },
        });
        const close = () => h.api.closeProductionBatch(batchId.toString(), w.kcsA);
        const cancel = () => reverse(second.id);

        const out = await raceWith(
          h.prisma,
          [lockSql(`production-batch-open:${world.orderIds[0]}:${w.pieceHan}:${MfgStage.HAN}`)],
          closeFirst === 0 ? [close, cancel] : [cancel, close],
          { ordered: true },
        );

        expect(out.every((o) => o.waited)).toBe(true);
        expectNoServerFault(out);
        const batch = await h.prisma.productionBatch.findUniqueOrThrow({ where: { id: batchId } });
        expect(batch.status).toBe(ProductionBatchStatus.AWAITING_QC);
        if (closeFirst === 0) {
          expect(out[1].error).toBeInstanceOf(ConflictException);
          expect(msg(out[1].error)).toContain('KCS đã bắt đầu chấm đợt này - không hủy được nữa');
          expect(batch.reportedQty).toBe(50);
        } else {
          expect(out.every((o) => o.ok)).toBe(true);
          expect(batch.reportedQty).toBe(20);
        }
      },
    );
  });

  // =====================================================================================
  // MF7: chốt đợt vừa bị QLSX hủy hết
  // =====================================================================================
  describe('MF7: chốt đợt vừa bị QLSX hủy hết số', () => {
    it('đợt cắt (tuần tự): hủy hết rồi chốt -> 409 "vừa bị QLSX hủy hết số - không còn gì để chấm, tải lại trang.", không 404', async () => {
      const world = await w.newInvoice({ quantities: [200] });
      const issue = await w.newIssue(world.piId);
      const { bundleId, reportId } = await w.seedCutBundle(issue, world, {
        segs: [{ specId: w.spec441, qty: 40 }],
      });
      await reverse(reportId!);
      expect(await h.prisma.cutBundle.count({ where: { id: bundleId } })).toBe(0);

      const err = await errOf(h.api.closeCutBundle(bundleId.toString(), w.kcsA));

      expect(err).toBeInstanceOf(ConflictException);
      expect(msg(err)).toBe(
        'Đợt cắt này vừa bị QLSX hủy hết số - không còn gì để chấm, tải lại trang.',
      );
    });

    it('đợt cắt (xen kẽ): giữ FOR UPDATE dòng đợt -> hủy hết ∥ close cùng chờ; hủy trước rồi close nhận 409, không 404 / 500', async () => {
      const world = await w.newInvoice({ quantities: [200] });
      const issue = await w.newIssue(world.piId);
      const { bundleId, reportId } = await w.seedCutBundle(issue, world, {
        segs: [{ specId: w.spec441, qty: 40 }],
      });

      const out = await raceWith(
        h.prisma,
        [rowLockSql('cut_bundles', bundleId)],
        [() => reverse(reportId!), () => h.api.closeCutBundle(bundleId.toString(), w.kcsA)],
        { ordered: true },
      );

      expect(out.every((o) => o.waited)).toBe(true);
      expectNoServerFault(out);
      expect(out[0].ok).toBe(true);
      expect(out[1].error).toBeInstanceOf(ConflictException);
      expect(msg(out[1].error)).toContain('vừa bị QLSX hủy hết số');
    });

    it('lô Hàn (tuần tự): hủy hết rồi chốt -> 409 "Lô này vừa bị QLSX hủy hết số - không còn gì để chấm, tải lại trang."', async () => {
      const world = await w.newInvoice({ quantities: [200] });
      const { batchId, reportId } = await w.seedPieceBatch(world, {
        pieceId: w.pieceHan,
        stage: MfgStage.HAN,
        qty: 20,
      });
      await reverse(reportId!);

      const err = await errOf(h.api.closeProductionBatch(batchId.toString(), w.kcsA));

      expect(err).toBeInstanceOf(ConflictException);
      expect(msg(err)).toBe('Lô này vừa bị QLSX hủy hết số - không còn gì để chấm, tải lại trang.');
    });

    it('AC52 lô Hàn (xen kẽ): giữ FOR UPDATE dòng lô -> hủy hết ∥ close cùng chờ; hủy trước rồi close nhận 409 "vừa bị QLSX hủy hết số", không 404 / 500', async () => {
      const world = await w.newInvoice({ quantities: [200] });
      const { batchId, reportId } = await w.seedPieceBatch(world, {
        pieceId: w.pieceHan,
        stage: MfgStage.HAN,
        qty: 20,
      });

      const out = await raceWith(
        h.prisma,
        [rowLockSql('production_batches', batchId)],
        [() => reverse(reportId!), () => h.api.closeProductionBatch(batchId.toString(), w.kcsA)],
        { ordered: true },
      );

      expect(out.every((o) => o.waited)).toBe(true);
      expectNoServerFault(out);
      expect(out[0].ok).toBe(true);
      expect(out[1].error).toBeInstanceOf(ConflictException);
      expect(msg(out[1].error)).toBe(
        'Lô này vừa bị QLSX hủy hết số - không còn gì để chấm, tải lại trang.',
      );
      expect(await h.prisma.productionBatch.count({ where: { id: batchId } })).toBe(0);
    });

    it('AC52 lô Hàn đã bị xoá đúng lúc close đang chờ khoá khác (xoá bằng kết nối thứ hai): 409 "vừa bị QLSX hủy hết số"', async () => {
      const world = await w.newInvoice({ quantities: [200] });
      const { batchId } = await w.seedPieceBatch(world, {
        pieceId: w.pieceHan,
        stage: MfgStage.HAN,
        qty: 20,
        withReport: false,
      });

      const out = await raceWith(
        h.prisma,
        [lockSql(`production-batch-open:${world.orderIds[0]}:${w.pieceHan}:${MfgStage.HAN}`)],
        [() => h.api.closeProductionBatch(batchId.toString(), w.kcsA)],
        {
          beforeRelease: async (client) => {
            await client.query(
              `DELETE FROM "production_batches" WHERE "id" = ${batchId.toString()}`,
            );
          },
        },
      );

      expectNoServerFault(out);
      expect(out[0].error).toBeInstanceOf(ConflictException);
      expect(msg(out[0].error)).toContain('vừa bị QLSX hủy hết số');
    });
  });

  // =====================================================================================
  // AC9: pat / chân nhôm
  // =====================================================================================
  describe('AC9: KCS chốt pat / chân nhôm', () => {
    const COMMON_SENTENCE =
      'không còn lần báo nào chưa chấm (có thể vừa được chốt) - tải lại trang.';

    it('KCS chốt nhóm chân nhôm: không phát MATERIAL_YIELD_STEP_BUNDLE_TO_KCS; tài khoản thống kê bấm "Gửi KCS" sau đó nhận câu chung', async () => {
      const world = await w.newInvoice({ quantities: [200] });
      await w.seedMaterialYield(world, { step: ProcessStep.CAT, qty: 50 });

      const closed = await h.api.closeMaterialYieldGroup(
        {
          productionInvoiceId: world.piId.toString(),
          recipeId: w.recipeId.toString(),
          step: ProcessStep.CAT,
        },
        w.kcsA,
      );

      expect(closed.status).toBe('AWAITING_QC');
      expect(h.emitCalls().map((c) => c.type)).not.toContain('MATERIAL_YIELD_STEP_BUNDLE_TO_KCS');
      const err = await errOf(
        h.api.submitMaterialYieldStep(
          world.piId.toString(),
          { recipeId: w.recipeId.toString(), step: ProcessStep.CAT },
          w.workerA,
          'PHOI',
        ),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(msg(err)).toContain(COMMON_SENTENCE);
      expect(msg(err)).toMatch(/công đoạn/);
      expect(msg(err)).not.toContain('chưa có gì mới');
    });

    it('KCS chốt nhóm pat: tài khoản thống kê bấm "Gửi KCS" sau đó nhận câu chung "Pat <mã mảnh> công đoạn <công đoạn>: ..."', async () => {
      const world = await w.newInvoice({ quantities: [200] });
      await w.seedPieceStep(world, { step: ProcessStep.DAP, qty: 50 });

      await h.api.closePieceStepGroup(
        {
          productionOrderId: world.orderIds[0].toString(),
          pieceId: w.piecePat.toString(),
          step: ProcessStep.DAP,
        },
        w.kcsA,
      );

      const err = await errOf(
        h.api.submitPieceStep(
          world.orderIds[0].toString(),
          { pieceId: w.piecePat.toString(), step: ProcessStep.DAP },
          w.workerA,
          'PHOI',
        ),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(msg(err)).toMatch(/^Pat .+ công đoạn .+: /);
      expect(msg(err)).toContain(COMMON_SENTENCE);
      expect(msg(err)).not.toContain('chưa có gì mới');
    });

    it.each([
      ['chân nhôm', 'nhom', 0],
      ['chân nhôm', 'nhom', 1],
      ['pat', 'pat', 0],
      ['pat', 'pat', 1],
    ] as const)(
      'CĐ-9 %s: KCS "Chấm" ∥ thống kê "Gửi KCS" cùng chờ khoá nhóm; ai vào trước thì chốt, bên kia nhận 400 câu chung; đúng 1 đợt (thứ tự %s)',
      async (_label, kind, kcsFirst) => {
        const hd = await build(kind, false);
        const world = hd.world;
        const stat = () =>
          kind === 'nhom'
            ? h.api.submitMaterialYieldStep(
                world.piId.toString(),
                { recipeId: w.recipeId.toString(), step: ProcessStep.CAT },
                w.workerA,
                'PHOI',
              )
            : h.api.submitPieceStep(
                world.orderIds[0].toString(),
                { pieceId: w.piecePat.toString(), step: ProcessStep.DAP },
                w.workerA,
                'PHOI',
              );
        const kcs = () => hd.close(w.kcsA);

        const out = await raceWith(
          h.prisma,
          hd.closeHold,
          kcsFirst === 0 ? [kcs, stat] : [stat, kcs],
          {
            ordered: true,
          },
        );

        expect(out.every((o) => o.waited)).toBe(true);
        expectNoServerFault(out);
        const { loser } = oneWinner(out);
        expect(loser).toBe(out[1]);
        expect(loser.error).toBeInstanceOf(BadRequestException);
        expect(msg(loser.error)).toContain(COMMON_SENTENCE);
        expect(await hd.bundleCount()).toBe(1);
      },
    );
  });

  // =====================================================================================
  // AC54 / CĐ-17: roll-up trạng thái lô sắt
  // =====================================================================================
  describe('AC54: 2 đợt cùng lô sắt chốt / chấm cùng lúc', () => {
    it.each(ORDERS)(
      'KCS chốt đợt cắt A đúng lúc lưu kết quả đợt B (%s): giữ FOR UPDATE dòng steel_issues -> cả 2 chờ; trạng thái cuối của lô sắt = AWAITING_QC',
      async (_n, closeFirst) => {
        const world = await w.newInvoice({ quantities: [200] });
        const issue = await w.newIssue(world.piId);
        const a = await w.seedCutBundle(issue, world, {
          segs: [{ specId: w.spec441, qty: 40 }],
          openedById: w.workerA,
        });
        const b = await w.seedCutBundle(issue, world, {
          segs: [{ specId: w.spec441, qty: 30 }],
          openedById: w.workerB,
          status: CutBundleStatus.AWAITING_QC,
        });
        const close = () => h.api.closeCutBundle(a.bundleId.toString(), w.kcsA);
        const review = () => h.api.reviewCutBundle(b.bundleId.toString(), { segments: [] }, w.kcsB);

        const out = await raceWith(
          h.prisma,
          [rowLockSql('steel_issues', issue)],
          closeFirst === 0 ? [close, review] : [review, close],
          { ordered: true },
        );

        expect(out.every((o) => o.waited && o.ok)).toBe(true);
        expectNoServerFault(out);
        const issueRow = await h.prisma.steelIssue.findUniqueOrThrow({ where: { id: issue } });
        expect(issueRow.status).toBe('AWAITING_QC');
        const bundleA = await h.prisma.cutBundle.findUniqueOrThrow({ where: { id: a.bundleId } });
        const bundleB = await h.prisma.cutBundle.findUniqueOrThrow({ where: { id: b.bundleId } });
        expect(bundleA.status).toBe(CutBundleStatus.AWAITING_QC);
        expect(bundleB.status).toBe(CutBundleStatus.QC_PASSED);
      },
    );
  });

  // =====================================================================================
  // AC42: ADMIN gán / sửa SKU của đợt cắt
  // =====================================================================================
  describe('AC42: ADMIN gán / sửa SKU đợt cắt', () => {
    const auditCount = (bundleId: bigint) =>
      h.prisma.auditLog.count({ where: { tableName: 'CutBundle', recordId: bundleId.toString() } });

    it.each(ORDERS)(
      'gán đợt cũ 30 đoạn chưa gắn SKU cho SKU đích còn báo được 10 ∥ công nhân báo 10 (%s): giữ cut-cap SKU đích -> cả 2 chờ; chạy lần lượt: gán KHÔNG bị chặn vượt, báo vào sau thì bị chặn (tối đa 0), báo vào trước thì cả 2 qua và SKU đích vượt 20; có audit log',
      async (_n, assignFirst) => {
        const world = await w.newInvoice({ quantities: [10, 10] });
        const target = world.orderIds[1];
        const issue = await w.newIssue(world.piId);
        const old = await w.seedCutBundle(issue, world, {
          orderId: null,
          segs: [{ specId: w.spec441, qty: 30 }],
          openedById: w.workerB,
          withReport: false,
        });
        const assign = () =>
          h.steel.assignCutBundleOrder(old.bundleId.toString(), target.toString(), w.admin);
        const reportTen = () =>
          h.steel.recordCutBatch(
            issue.toString(),
            {
              productionOrderId: target.toString(),
              segments: [{ segmentSpecId: w.spec441.toString(), qty: 10 }],
            },
            w.workerA,
          );

        const out = await raceWith(
          h.prisma,
          [lockSql(`cut-cap:${world.piId}:${w.steelId}:${target}`)],
          assignFirst === 0 ? [assign, reportTen] : [reportTen, assign],
          { ordered: true },
        );

        expect(out.every((o) => o.waited)).toBe(true); // lệnh gán PHẢI lấy cut-cap
        expectNoServerFault(out);
        const total = await h.prisma.cutPatternSegment.aggregate({
          where: { segmentSpecId: w.spec441, cutBundle: { productionOrderId: target } },
          _sum: { qty: true },
        });
        if (assignFirst === 0) {
          // gán trước: SKU đích có 30 / cần 10 (gán không chặn vượt), lần báo 10 vào sau thấy đã đủ
          expect(out[0].ok).toBe(true);
          expect(out[1].error).toBeInstanceOf(BadRequestException);
          expect(msg(out[1].error)).toContain('tối đa 0');
          expect(total._sum.qty).toBe(30);
        } else {
          // báo trước: cả 2 thành công, SKU đích "đã đủ (vượt 20)"
          expect(out.every((o) => o.ok)).toBe(true);
          expect(total._sum.qty).toBe(40);
        }
        expect(await auditCount(old.bundleId)).toBeGreaterThanOrEqual(1);
        const more = await errOf(
          h.steel.recordCutBatch(
            issue.toString(),
            {
              productionOrderId: target.toString(),
              segments: [{ segmentSpecId: w.spec441.toString(), qty: 1 }],
            },
            w.workerA,
          ),
        );
        expect(more).toBeInstanceOf(BadRequestException);
        expect(msg(more)).toContain('tối đa 0');
      },
    );

    it('đợt vừa bị QLSX hủy hết lúc ADMIN đang chờ khoá: sửa SKU nhận 409 "vừa bị QLSX hủy hết", không phải "vừa được gắn SKU bởi người khác"', async () => {
      const world = await w.newInvoice({ quantities: [200, 200] });
      const [oldSku, newSku] = world.orderIds;
      const issue = await w.newIssue(world.piId);
      const { bundleId } = await w.seedCutBundle(issue, world, {
        segs: [{ specId: w.spec441, qty: 40 }],
        withReport: false,
      });
      // đợt bị xoá SAU khi ADMIN đã đọc đợt (ngoài transaction) và đang chờ cut-cap: dòng khoá FOR UPDATE trả rỗng
      const keys = [oldSku, newSku]
        .sort((x, y) => (x < y ? -1 : 1))
        .map((o) => lockSql(`cut-cap:${world.piId}:${w.steelId}:${o}`));

      const out = await raceWith(
        h.prisma,
        keys,
        [() => h.steel.assignCutBundleOrder(bundleId.toString(), newSku.toString(), w.admin, true)],
        {
          beforeRelease: async (client) => {
            await client.query(
              `DELETE FROM "cut_pattern_segments" WHERE "cutBundleId" = ${bundleId.toString()}`,
            );
            await client.query(`DELETE FROM "cut_bundles" WHERE "id" = ${bundleId.toString()}`);
          },
        },
      );

      expect(out[0].waited).toBe(true);
      expect(out[0].error).toBeInstanceOf(ConflictException);
      expect(msg(out[0].error)).toContain('vừa bị QLSX hủy hết');
      expect(msg(out[0].error)).not.toContain('vừa được gắn SKU bởi người khác');
    });

    it('cỡ không có trong định mức SKU mới: sửa SKU sang SKU không có cỡ 355 -> 400 "Cỡ đoạn 355mm không có trong định mức của SKU đã chọn", đợt giữ nguyên SKU cũ', async () => {
      const altRev = await w.makeBomRevision(42, [{ specId: w.spec441, steps: [ProcessStep.CAT] }]);
      const world = await w.newInvoice({
        quantities: [200, 200],
        bomRevisionIds: [w.bomRevisionId, altRev],
      });
      const issue = await w.newIssue(world.piId);
      const { bundleId } = await w.seedCutBundle(issue, world, {
        segs: [
          { specId: w.spec441, qty: 10 },
          { specId: w.spec355, qty: 10 },
        ],
      });

      const err = await errOf(
        h.steel.assignCutBundleOrder(
          bundleId.toString(),
          world.orderIds[1].toString(),
          w.admin,
          true,
        ),
      );

      expect(err).toBeInstanceOf(BadRequestException);
      expect(msg(err)).toBe('Cỡ đoạn 355mm không có trong định mức của SKU đã chọn');
      const bundle = await h.prisma.cutBundle.findUniqueOrThrow({ where: { id: bundleId } });
      expect(bundle.productionOrderId).toBe(world.orderIds[0]);
    });

    it('cỡ mới chen vào đợt lúc ADMIN đang chờ khoá: đợt chỉ có cỡ 441 lúc ADMIN đọc, người báo thêm cỡ 355 trong lúc chờ -> ADMIN đọc lại trong khoá và nhận 400 (không gán nhầm)', async () => {
      const altRev = await w.makeBomRevision(43, [{ specId: w.spec441, steps: [ProcessStep.CAT] }]);
      const world = await w.newInvoice({
        quantities: [200, 200],
        bomRevisionIds: [w.bomRevisionId, altRev],
      });
      const issue = await w.newIssue(world.piId);
      const { bundleId } = await w.seedCutBundle(issue, world, {
        segs: [{ specId: w.spec441, qty: 10 }],
        withReport: false,
      });
      const keys = [world.orderIds[0], world.orderIds[1]]
        .sort((x, y) => (x < y ? -1 : 1))
        .map((o) => lockSql(`cut-cap:${world.piId}:${w.steelId}:${o}`));

      const out = await raceWith(
        h.prisma,
        keys,
        [
          () =>
            h.steel.assignCutBundleOrder(
              bundleId.toString(),
              world.orderIds[1].toString(),
              w.admin,
              true,
            ),
        ],
        {
          beforeRelease: async (client) => {
            await client.query(
              `INSERT INTO "cut_pattern_segments" ("cutBundleId", "segmentSpecId", "qty") VALUES (${bundleId.toString()}, ${w.spec355.toString()}, 5)`,
            );
          },
        },
      );

      expect(out[0].waited).toBe(true);
      expect(out[0].error).toBeInstanceOf(BadRequestException);
      expect(msg(out[0].error)).toContain('Cỡ đoạn 355mm không có trong định mức');
      const bundle = await h.prisma.cutBundle.findUniqueOrThrow({ where: { id: bundleId } });
      expect(bundle.productionOrderId).toBe(world.orderIds[0]);
    });

    it('CĐ-13: ADMIN sửa SKU đợt CUTTING ∥ QLSX hủy 1 lần báo của đợt đó: không khoá chéo / 500; SKU mới nhận đúng số còn lại (40)', async () => {
      const world = await w.newInvoice({ quantities: [200, 200] });
      const [oldSku, newSku] = world.orderIds;
      const issue = await w.newIssue(world.piId);
      const { bundleId } = await w.seedCutBundle(issue, world, {
        segs: [{ specId: w.spec441, qty: 40 }],
      });
      await cutReport(issue, world, 30, w.workerA);
      const second = await h.prisma.floorReport.findFirstOrThrow({
        where: { cutBundleId: bundleId, lines: { some: { qty: 30 } } },
      });
      // cut-cap của 2 SKU, lấy theo id SKU tăng dần (đúng thứ tự khoá của hợp đồng)
      const keys = [oldSku, newSku]
        .sort((x, y) => (x < y ? -1 : 1))
        .map((o) => lockSql(`cut-cap:${world.piId}:${w.steelId}:${o}`));

      const out = await raceWith(
        h.prisma,
        keys,
        [
          () => h.steel.assignCutBundleOrder(bundleId.toString(), newSku.toString(), w.admin, true),
          () => reverse(second.id),
        ],
        { minWaiting: 1 },
      );

      expect(out[0].waited).toBe(true);
      expectNoServerFault(out);
      expect(out.every((o) => o.ok)).toBe(true);
      const bundle = await h.prisma.cutBundle.findUniqueOrThrow({
        where: { id: bundleId },
        include: { segments: true },
      });
      expect(bundle.productionOrderId).toBe(newSku);
      expect(bundle.segments.reduce((s, x) => s + x.qty, 0)).toBe(40);
    });
  });
});
