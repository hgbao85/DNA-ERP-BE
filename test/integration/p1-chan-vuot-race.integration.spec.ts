import { BadRequestException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  MaterialYieldIssueStatus,
  MfgStage,
  ProcessStep,
  ProductionBatchStatus,
  FloorReportKind,
} from '../../src/generated/prisma/client';
import { IdempotencyKeyInUseException } from '../../src/common/utils/idempotency.util';
import { MaterialYieldRecipeProductionService } from '../../src/modules/material-yield-recipes/material-yield-recipe-production.service';
import {
  P1Harness,
  P1World,
  World,
  createHarness,
  expectNoServerFault,
  lockSql,
  msg,
  oneWinner,
  raceWith,
  withSegmentStock,
} from './p1-kcs.fixture';

/**
 * IT1 (P1, 18/11/2026) - CHẶN BÁO VƯỢT khi nhiều người cùng báo, trên Postgres TEST thật.
 * AC20 (Cắt, 2 lô sắt khác nhau của cùng PI), AC21 (Uốn: 2 người + ca "đã đủ"), AC22 (mảnh Hàn: 2 người,
 * báo qua QR đúng lúc create() của tài khoản thống kê, KCS chấm lỗi rồi báo bù).
 *
 * CĐ-4 (viết lại theo Câu 6, 19/11): pat / chân nhôm 2 lần báo sát số cần -> cả 2 thành công (được vượt), không mất lần nào.
 *
 * Mỗi ca tranh chấp: kết nối `pg` thứ hai giữ ĐÚNG khoá advisory của hợp đồng (chuỗi trùng từng ký tự với code), 2 lời gọi chạy,
 * khẳng định cả 2 đã CHỜ khoá thật (`waited`), rồi nhả. `ordered` ép thứ tự thắng theo hàng đợi khoá nên mỗi ca chạy đủ 2 thứ tự.
 * Câu lỗi theo hợp đồng v2 mục 11: "... lần này báo được tối đa N ..., bạn nhập M ... Số cần sai thì báo QLSX."
 */
describe('P1 IT1: chặn báo vượt khi nhiều người cùng báo (integration, real Postgres)', () => {
  let h: P1Harness;
  let w: P1World;

  beforeAll(async () => {
    h = await createHarness();
    w = new P1World(h, `it1-${Date.now()}`);
    await w.init();
  });

  afterAll(async () => {
    if (w) await w.cleanup();
    if (h) await h.close();
  });

  beforeEach(() => h.clearEmits());

  const sumCut = async (piId: bigint, specId: bigint): Promise<number> =>
    (
      await h.prisma.cutPatternSegment.aggregate({
        where: { segmentSpecId: specId, cutBundle: { steelIssue: { productionInvoiceId: piId } } },
        _sum: { qty: true },
      })
    )._sum.qty ?? 0;

  const sumStep = async (piId: bigint, step: ProcessStep): Promise<number> =>
    (
      await h.prisma.stepBatchSegment.aggregate({
        where: { stepBatch: { productionInvoiceId: piId, step } },
        _sum: { qty: true },
      })
    )._sum.qty ?? 0;

  const reportsOf = (piId: bigint, kind: FloorReportKind) =>
    h.prisma.floorReport.count({
      where: { productionInvoiceId: piId, kind, reversalOfId: null },
    });

  const cutReport = (
    issueId: bigint,
    orderId: bigint,
    specId: bigint,
    qty: number,
    userId: string,
  ) =>
    h.steel.recordCutBatch(
      issueId.toString(),
      {
        productionOrderId: orderId.toString(),
        segments: [{ segmentSpecId: specId.toString(), qty }],
      },
      userId,
    );

  const stepReport = (world: World, orderId: bigint, specId: bigint, qty: number, userId: string) =>
    h.steel.recordStepBatch(
      world.piId.toString(),
      {
        materialId: w.steelId.toString(),
        step: ProcessStep.UON,
        productionOrderId: orderId.toString(),
        segments: [{ segmentSpecId: specId.toString(), qty }],
      },
      userId,
    );

  // =====================================================================================
  // AC20 / CĐ-1: báo Cắt 2 người sát số cần
  // =====================================================================================
  describe('AC20: báo Cắt, 2 người từ 2 lô sắt khác nhau của cùng PI, còn 10 đoạn', () => {
    const capKey = (world: World, orderId: bigint) =>
      `cut-cap:${world.piId}:${w.steelId}:${orderId}`;

    it.each([
      ['A vào hàng đợi khoá trước', 0],
      ['B vào hàng đợi khoá trước', 1],
    ])(
      '%s: giữ cut-cap -> 2 backend chờ; đúng 1 lần qua, lần kia 400 "tối đa 2"; tổng đã báo = 8',
      async (_name, first) => {
        const world = await w.newInvoice({ quantities: [10] });
        const [order] = world.orderIds;
        const issueA = await w.newIssue(world.piId);
        const issueB = await w.newIssue(world.piId);
        const people = [
          () => cutReport(issueA, order, w.spec441, 8, w.workerA),
          () => cutReport(issueB, order, w.spec441, 8, w.workerB),
        ];
        const calls = first === 0 ? people : [people[1], people[0]];

        const out = await raceWith(h.prisma, [lockSql(capKey(world, order))], calls, {
          ordered: true,
        });

        expect(out.every((o) => o.waited)).toBe(true);
        expect(out.every((o) => !o.doneBeforeRelease)).toBe(true);
        expectNoServerFault(out);
        const { winner, loser } = oneWinner(out);
        expect(winner).toBe(out[0]); // khoá xếp hàng FIFO: lời gọi vào trước được trước
        expect(loser.error).toBeInstanceOf(BadRequestException);
        expect(msg(loser.error)).toContain('tối đa 2');
        expect(msg(loser.error)).toContain('Số cần sai thì báo QLSX.');
        expect(await sumCut(world.piId, w.spec441)).toBe(8);
        expect(await reportsOf(world.piId, FloorReportKind.CUT)).toBe(1);
      },
    );

    // 20/11/2026 (QA R7): chống trùng chạy TRƯỚC khoá cut-cap -> bản trùng song song nhận 409, không còn 400 "tối đa N".
    it('cùng khoá chống trùng, sát số cần (cần 10, gửi 8): giữ cut-cap -> 1 lần ghi, bản trùng 409 InUse; gửi lại trả đúng đợt cũ, tổng = 8', async () => {
      const world = await w.newInvoice({ quantities: [10] });
      const [order] = world.orderIds;
      const issue = await w.newIssue(world.piId);
      const key = randomUUID();
      const call = () =>
        h.steel.recordCutBatch(
          issue.toString(),
          {
            productionOrderId: order.toString(),
            segments: [{ segmentSpecId: w.spec441.toString(), qty: 8 }],
          },
          w.workerA,
          key,
        );

      const out = await raceWith(h.prisma, [lockSql(capKey(world, order))], [call, call], {
        ordered: true,
        minWaiting: 1, // chỉ bản đi trước chờ cut-cap; bản trùng bị try-lock chặn nên trả 409 ngay, không chờ
      });

      expect(out[0].waited).toBe(true);
      expect(out[0].doneBeforeRelease).toBe(false); // bản thắng bị cut-cap giữ tới khi nhả
      expect(out[1].doneBeforeRelease).toBe(true); // bản trùng không chờ khoá nghiệp vụ
      const { winner, loser } = oneWinner(out);
      expect(winner).toBe(out[0]);
      expect(loser.error).toBeInstanceOf(IdempotencyKeyInUseException);
      expect(loser.error).toBeInstanceOf(ConflictException);
      expect(msg(loser.error)).not.toContain('tối đa');
      expect(await sumCut(world.piId, w.spec441)).toBe(8);
      expect(await reportsOf(world.piId, FloorReportKind.CUT)).toBe(1);

      const again = await call();
      expect((again as { id: string }).id).toBe((winner.value as { id: string }).id);
      expect(await sumCut(world.piId, w.spec441)).toBe(8);
      expect(await reportsOf(world.piId, FloorReportKind.CUT)).toBe(1);
    });

    it('đối chứng: khác SKU thì không chờ nhau (chỉ lời gọi của SKU đang bị giữ khoá phải chờ), cả 2 qua', async () => {
      const world = await w.newInvoice({ quantities: [10, 10] });
      const [order1, order2] = world.orderIds;
      const issueA = await w.newIssue(world.piId);
      const issueB = await w.newIssue(world.piId);

      const out = await raceWith(
        h.prisma,
        [lockSql(capKey(world, order2))],
        [
          () => cutReport(issueA, order1, w.spec441, 8, w.workerA),
          () => cutReport(issueB, order2, w.spec441, 8, w.workerB),
        ],
        { minWaiting: 1 },
      );

      expect(out[0].doneBeforeRelease).toBe(true); // SKU 1 không bị khoá của SKU 2 chặn
      expect(out[1].doneBeforeRelease).toBe(false);
      expect(out[1].waited).toBe(true);
      expect(out.every((o) => o.ok)).toBe(true);
      expect(await sumCut(world.piId, w.spec441)).toBe(16);
    });

    it('khoá cut-cap gom MỌI người (2 người chờ), còn khoá cut-report của riêng A thì B không phải chờ', async () => {
      const world = await w.newInvoice({ quantities: [10] });
      const [order] = world.orderIds;
      const issueA = await w.newIssue(world.piId);
      const issueB = await w.newIssue(world.piId);

      const capOut = await raceWith(
        h.prisma,
        [lockSql(capKey(world, order))],
        [
          () => cutReport(issueA, order, w.spec441, 2, w.workerA),
          () => cutReport(issueB, order, w.spec441, 2, w.workerB),
        ],
      );
      expect(capOut.every((o) => o.waited && o.ok)).toBe(true);

      const reportOut = await raceWith(
        h.prisma,
        [lockSql(`cut-report:${issueA}:${order}:${w.workerA}`)],
        [() => cutReport(issueA, order, w.spec441, 2, w.workerB)],
        { minWaiting: 1 },
      );
      expect(reportOut[0].ok).toBe(true);
      expect(reportOut[0].doneBeforeRelease).toBe(true);
      expect(await sumCut(world.piId, w.spec441)).toBe(6);
    });
  });

  // =====================================================================================
  // AC21 / CĐ-2: Uốn
  // =====================================================================================
  describe('AC21: báo Uốn', () => {
    it.each([
      ['A vào hàng đợi khoá trước', 0],
      ['B vào hàng đợi khoá trước', 1],
    ])(
      '%s: còn 5, mỗi người báo Uốn 4, giữ step-batch -> đúng 1 lần qua, lần kia 400 "tối đa 1"',
      async (_name, first) => {
        const world = await w.newInvoice({ quantities: [5] });
        const [order] = world.orderIds;
        const issue = await w.newIssue(world.piId);
        await w.seedCutDone(issue, world, w.spec355, 5); // giới hạn vật lý không phải vế chặn
        const people = [
          () => stepReport(world, order, w.spec355, 4, w.workerA),
          () => stepReport(world, order, w.spec355, 4, w.workerB),
        ];
        const calls = first === 0 ? people : [people[1], people[0]];

        const out = await raceWith(
          h.prisma,
          [lockSql(`step-batch:${world.piId}:${w.steelId}:${ProcessStep.UON}:${order}`)],
          calls,
          { ordered: true },
        );

        expect(out.every((o) => o.waited)).toBe(true);
        expectNoServerFault(out);
        const { winner, loser } = oneWinner(out);
        expect(winner).toBe(out[0]);
        expect(loser.error).toBeInstanceOf(BadRequestException);
        expect(msg(loser.error)).toContain('tối đa 1');
        expect(await sumStep(world.piId, ProcessStep.UON)).toBe(4);
        expect(await reportsOf(world.piId, FloorReportKind.STEP)).toBe(1);
      },
    );

    // 20/11/2026 (QA R8): chống trùng chạy TRƯỚC khoá step-batch -> bản trùng song song nhận 409, không còn 400 "tối đa N".
    it('cùng khoá chống trùng, sát số cần (cần 5, báo Uốn 4 hai lần): giữ step-batch -> 1 lần ghi, bản trùng 409 InUse; gửi lại trả đúng đợt cũ, tổng = 4', async () => {
      const world = await w.newInvoice({ quantities: [5] });
      const [order] = world.orderIds;
      const issue = await w.newIssue(world.piId);
      await w.seedCutDone(issue, world, w.spec355, 5);
      const key = randomUUID();
      const call = () =>
        h.steel.recordStepBatch(
          world.piId.toString(),
          {
            materialId: w.steelId.toString(),
            step: ProcessStep.UON,
            productionOrderId: order.toString(),
            segments: [{ segmentSpecId: w.spec355.toString(), qty: 4 }],
          },
          w.workerA,
          key,
        );

      const out = await raceWith(
        h.prisma,
        [lockSql(`step-batch:${world.piId}:${w.steelId}:${ProcessStep.UON}:${order}`)],
        [call, call],
        { ordered: true, minWaiting: 1 },
      );

      expect(out[0].waited).toBe(true);
      expect(out[0].doneBeforeRelease).toBe(false);
      expect(out[1].doneBeforeRelease).toBe(true);
      const { winner, loser } = oneWinner(out);
      expect(winner).toBe(out[0]);
      expect(loser.error).toBeInstanceOf(IdempotencyKeyInUseException);
      expect(msg(loser.error)).not.toContain('tối đa');
      expect(await sumStep(world.piId, ProcessStep.UON)).toBe(4);
      expect(await reportsOf(world.piId, FloorReportKind.STEP)).toBe(1);

      const again = await call();
      expect((again as { id: string }).id).toBe((winner.value as { id: string }).id);
      expect(await sumStep(world.piId, ProcessStep.UON)).toBe(4);
      expect(await reportsOf(world.piId, FloorReportKind.STEP)).toBe(1);
    });

    it('đã đủ: cần Uốn 6, đã tính 6 -> báo thêm 1 bị 400 "cần Uốn 6 ... tối đa 0", không ghi gì', async () => {
      const world = await w.newInvoice({ quantities: [6] });
      const [order] = world.orderIds;
      const issue = await w.newIssue(world.piId);
      await w.seedCutDone(issue, world, w.spec355, 6);
      await w.seedStepDone(world, ProcessStep.UON, w.spec355, 6);
      const before = await sumStep(world.piId, ProcessStep.UON);

      const err = await stepReport(world, order, w.spec355, 1, w.workerA).then(
        () => null,
        (e: unknown) => e,
      );

      expect(err).toBeInstanceOf(BadRequestException);
      expect(msg(err)).toContain('cần Uốn 6');
      expect(msg(err)).toContain('tối đa 0');
      expect(msg(err)).toContain('bạn nhập 1');
      expect(msg(err)).toContain('Số cần sai thì báo QLSX.');
      expect(await sumStep(world.piId, ProcessStep.UON)).toBe(before);
      expect(await reportsOf(world.piId, FloorReportKind.STEP)).toBe(0);
    });
  });

  // =====================================================================================
  // AC22 / CĐ-3: mảnh Hàn / Phôi
  // =====================================================================================
  describe('AC22: báo mảnh', () => {
    const recordHan = (world: World, qty: number, userId: string) =>
      h.batches.recordProductionBatch(
        world.orderIds[0].toString(),
        { pieceId: w.pieceHan.toString(), qty, stage: MfgStage.HAN },
        userId,
        'HAN',
      );
    const sumBatches = async (world: World, pieceId: bigint, stage: MfgStage): Promise<number> =>
      (
        await h.prisma.productionBatch.aggregate({
          where: { productionOrderId: world.orderIds[0], pieceId, stage },
          _sum: { reportedQty: true },
        })
      )._sum.reportedQty ?? 0;

    it.each([
      ['A vào hàng đợi khoá trước', 0],
      ['B vào hàng đợi khoá trước', 1],
    ])(
      '%s: tổ Hàn còn 10, 2 người mỗi người báo 8 (QR), giữ production-batch-open -> chỉ 1 lần qua, lần kia "tối đa 2"',
      async (_name, first) => {
        const world = await w.newInvoice({ quantities: [10] });
        const people = [() => recordHan(world, 8, w.workerA), () => recordHan(world, 8, w.workerB)];
        const calls = first === 0 ? people : [people[1], people[0]];

        const out = await raceWith(
          h.prisma,
          [lockSql(`production-batch-open:${world.orderIds[0]}:${w.pieceHan}:${MfgStage.HAN}`)],
          calls,
          { ordered: true },
        );

        expect(out.every((o) => o.waited)).toBe(true);
        expectNoServerFault(out);
        const { winner, loser } = oneWinner(out);
        expect(winner).toBe(out[0]);
        expect(loser.error).toBeInstanceOf(BadRequestException);
        expect(msg(loser.error)).toContain('tối đa 2');
        expect(await sumBatches(world, w.pieceHan, MfgStage.HAN)).toBe(8);
      },
    );

    it.each([
      ['create() vào hàng đợi khoá trước', 0],
      ['báo QR vào hàng đợi khoá trước', 1],
    ])(
      '%s: create() của tài khoản thống kê Phôi và báo QR cùng báo 8 khi còn 10 -> create() CÓ lấy khoá production-batch-open (cả 2 chờ), chỉ 1 qua, overPlanWarning luôn null',
      async (_name, first) => {
        const world = await w.newInvoice({ quantities: [10] });
        const order = world.orderIds[0].toString();
        const viaCreate = () =>
          h.batches.create(
            order,
            { stage: MfgStage.PHOI, pieceId: w.piecePhoi.toString(), reportedQty: 8 },
            w.workerA,
            'PHOI',
            null,
          );
        const viaQr = () =>
          h.batches.recordProductionBatch(
            order,
            { pieceId: w.piecePhoi.toString(), qty: 8, stage: MfgStage.PHOI },
            w.workerB,
            'PHOI',
          );
        const calls = first === 0 ? [viaCreate, viaQr] : [viaQr, viaCreate];

        const out = await raceWith(
          h.prisma,
          [lockSql(`production-batch-open:${world.orderIds[0]}:${w.piecePhoi}:${MfgStage.PHOI}`)],
          calls,
          { ordered: true },
        );

        expect(out.every((o) => o.waited)).toBe(true); // create() cũng phải chờ = đã lấy khoá (MF3)
        expectNoServerFault(out);
        const { winner, loser } = oneWinner(out);
        expect(winner).toBe(out[0]);
        expect(loser.error).toBeInstanceOf(BadRequestException);
        expect(msg(loser.error)).toContain('tối đa 2');
        const value = winner.value as { overPlanWarning?: string | null };
        expect(value.overPlanWarning ?? null).toBeNull();
        expect(await sumBatches(world, w.piecePhoi, MfgStage.PHOI)).toBe(8);
      },
    );

    it('cần 24, đã báo 23 (đang chờ KCS): báo 2 bị "tối đa 1"; KCS chấm lỗi 12 -> báo 13 được, báo thêm 1 bị chặn', async () => {
      const world = await w.newInvoice({ quantities: [24] });
      const { batchId } = await w.seedPieceBatch(world, {
        pieceId: w.pieceHan,
        stage: MfgStage.HAN,
        qty: 23,
        status: ProductionBatchStatus.AWAITING_QC,
      });

      const tooMuch = await recordHan(world, 2, w.workerA).then(
        () => null,
        (e: unknown) => e,
      );
      expect(tooMuch).toBeInstanceOf(BadRequestException);
      expect(msg(tooMuch)).toContain('tối đa 1');

      // KCS ghi lỗi 12 (mảnh tính được = 11). Công tắc tồn đoạn bật: kho trống thì ghi sổ báo vượt, không chặn chấm.
      await withSegmentStock(true, () =>
        h.api.reviewProductionBatch(
          batchId.toString(),
          { defectReasonId: w.defectReasonId.toString(), failedQty: 12 },
          w.kcsA,
        ),
      );

      const ok = await recordHan(world, 13, w.workerA);
      expect((ok as { overPlanWarning?: string | null }).overPlanWarning ?? null).toBeNull();
      const blocked = await recordHan(world, 1, w.workerA).then(
        () => null,
        (e: unknown) => e,
      );
      expect(blocked).toBeInstanceOf(BadRequestException);
      expect(msg(blocked)).toContain('tối đa 0');
      expect(msg(blocked)).toContain('Số cần sai thì báo QLSX.');
    });
  });

  // =====================================================================================
  // AC23 / CĐ-4 (viết lại theo Câu 6, 19/11): pat / chân nhôm được báo vượt số cần
  // =====================================================================================
  describe('CĐ-4: pat / chân nhôm, 2 lần báo cùng lúc sát số cần (Câu 6: được vượt)', () => {
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

    it.each([
      ['A vào hàng đợi khoá trước', 0],
      ['B vào hàng đợi khoá trước', 1],
    ])(
      'pat %s: cần 30, đã tính 28, 2 người mỗi người báo Dập 2, giữ piece-step-batch -> cả 2 chờ, cả 2 thành công, tổng = 32 (không mất lần nào, 2 Idempotency-Key khác nhau)',
      async (_name, first) => {
        const world = await w.newInvoice({ quantities: [30] });
        await receivePat(world);
        await w.seedPieceStep(world, { step: ProcessStep.DAP, qty: 28 });
        const key = `it1-pat-${Date.now()}-${first}`;
        const rec = (userId: string, k: string) => () =>
          h.batches.recordPieceStepBatch(
            world.orderIds[0].toString(),
            { stage: MfgStage.PHOI, pieceId: w.piecePat.toString(), step: ProcessStep.DAP, qty: 2 },
            userId,
            'PHOI',
            k,
          );
        const people = [rec(w.workerA, `${key}-a`), rec(w.workerB, `${key}-b`)];
        const calls = first === 0 ? people : [people[1], people[0]];

        const out = await raceWith(
          h.prisma,
          [lockSql(`piece-step-batch:${world.orderIds[0]}:${w.piecePat}:${ProcessStep.DAP}`)],
          calls,
          { ordered: true },
        );

        expect(out.every((o) => o.waited)).toBe(true);
        expect(out.every((o) => !o.doneBeforeRelease)).toBe(true);
        expectNoServerFault(out);
        expect(out.map((o) => o.ok)).toEqual([true, true]);
        const rows = await h.prisma.pieceStepBatch.findMany({
          where: { productionOrderId: world.orderIds[0], step: ProcessStep.DAP },
        });
        expect(rows).toHaveLength(3); // 1 seed + 2 lần báo
        expect(rows.reduce((s, r) => s + r.qty, 0)).toBe(32);
        expect(new Set(rows.map((r) => r.idempotencyKey).filter(Boolean)).size).toBe(2);
      },
    );

    it('chân nhôm: cần 30 theo định mức, đã tính 28, 2 người cùng báo 2, giữ material-yield-step-batch -> cả 2 chờ, cả 2 thành công, tổng = 32', async () => {
      const rev = await w.makeBomRevision(31, [{ specId: w.spec441, steps: [ProcessStep.CAT] }]);
      await h.prisma.pieceMaterialItem.create({
        data: {
          bomRevisionId: rev,
          mfgProductId: w.mfgProductId,
          pieceId: w.pieceCut,
          materialId: w.aluOutId,
          qtyPerPiece: 1,
          includeInWeaving: true,
        },
      });
      const world = await w.newInvoice({ quantities: [30], bomRevisionIds: [rev] });
      await receiveAlu(world);
      await w.seedMaterialYield(world, { step: ProcessStep.CAT, qty: 28 });
      const myield = h.moduleRef.get(MaterialYieldRecipeProductionService, { strict: false });
      const rec = (userId: string) => () =>
        myield.recordStepBatch(
          world.piId.toString(),
          { recipeId: w.recipeId.toString(), step: ProcessStep.CAT, qty: 2 },
          userId,
          'PHOI',
        );

      const out = await raceWith(
        h.prisma,
        [lockSql(`material-yield-step-batch:${world.piId}:${w.recipeId}:${ProcessStep.CAT}`)],
        [rec(w.workerA), rec(w.workerB)],
        { ordered: true },
      );

      expect(out.every((o) => o.waited)).toBe(true);
      expectNoServerFault(out);
      expect(out.map((o) => o.ok)).toEqual([true, true]);
      const agg = await h.prisma.materialYieldStepBatch.aggregate({
        where: { productionInvoiceId: world.piId, step: ProcessStep.CAT },
        _sum: { qty: true },
        _count: true,
      });
      expect(agg._count).toBe(3);
      expect(agg._sum.qty).toBe(32);
    });
  });
});
