import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  IssueSlipLineKind,
  IssueSlipStatus,
  MfgStage,
  ProductionBatchStatus,
  SteelIssueStatus,
  StockLedgerRefType,
} from '../../src/generated/prisma/client';
import { IssueSlipsService } from '../../src/modules/issue-slips/issue-slips.service';
import { SegmentStockService } from '../../src/modules/segment-stock/segment-stock.service';
import { HandoverKind } from '../../src/modules/stage-handover/dto/stage-handover.dto';
import { StageHandoverService } from '../../src/modules/stage-handover/stage-handover.service';
import {
  P1Harness,
  P1World,
  World,
  WorkshopRef,
  createHarness,
  expectNoServerFault,
  lockSql,
  msg,
  oneWinner,
  raceWith,
  rowLockSql,
} from './p1-kcs.fixture';

/**
 * Giao nhận giữa tổ (24/11/2026 - docs THIET-KE-GIAO-NHAN-GIUA-TO-2026-11-24) trên Postgres TEST thật:
 *  (a) phiếu XK giao đoạn: xác nhận chuyển đoạn + phần giữ của lệnh kho Phôi -> kho Hàn, gửi lại cùng khoá không chuyển lần 2;
 *  (b) không giao quá phần lệnh còn giữ + dư ở kho Phôi, kể cả 2 phiếu chờ ký;
 *  (c) Hàn chỉ báo trong số đã nhận, QLSX mở chặn được thêm nhưng không vượt kế hoạch; KCS chấm trừ đoạn ở kho Hàn;
 *  (d) Phôi báo cắt bị chặn khi vượt 102% sắt đã nhận (mở chặn mm được);
 *  (e) tắt công tắc = như cũ;
 *  (f) tranh chấp: 2 lần xác nhận cùng phiếu, 2 SKU cùng dùng 1 kho đoạn đã nhận, xác nhận phiếu chen giữa lúc báo.
 *  + mảnh Hàn -> Sơn (FRAME_HANDOVER) ở xưởng có kho Sơn.
 */
describe('Giao nhận giữa tổ (integration, real Postgres)', () => {
  let h: P1Harness;
  let w: P1World;
  let slips: IssueSlipsService;
  let handover: StageHandoverService;
  let segStock: SegmentStockService;
  let ws: WorkshopRef;
  let keeper: string;
  let framePiece: bigint;
  const prevEnv = {
    seg: process.env.SEGMENT_STOCK_ENABLED,
    sh: process.env.STAGE_HANDOVER_ENABLED,
  };
  const URL = 'https://res.cloudinary.com/demo/image/upload/phieu.jpg';
  let keySeq = 0;
  const key = (tag: string) => `gn-${tag}-${Date.now()}-${(keySeq += 1)}`;

  const setFlags = (on: boolean) => {
    process.env.SEGMENT_STOCK_ENABLED = 'true';
    process.env.STAGE_HANDOVER_ENABLED = on ? 'true' : 'false';
  };

  beforeAll(async () => {
    h = await createHarness();
    slips = h.moduleRef.get(IssueSlipsService, { strict: false });
    handover = h.moduleRef.get(StageHandoverService, { strict: false });
    segStock = h.moduleRef.get(SegmentStockService, { strict: false });
    w = new P1World(h, `gn-${Date.now()}`);
    await w.init();
    ws = await w.makeWorkshop('GN', { son: true });
    keeper = w.admin;
    // Mảnh qua cả Hàn và Sơn (không định mức đoạn) cho luồng giao mảnh Hàn -> Sơn.
    const pc = await h.prisma.piece.create({
      data: {
        mfgProductId: w.mfgProductId,
        code: w.code('FRAME'),
        groupNumber: 1,
        pieceNumber: 999,
        name: 'Manh khung',
      },
    });
    w.ids.pieces.push(pc.id);
    framePiece = pc.id;
    await h.prisma.bomPiece.create({
      data: {
        bomRevisionId: w.bomRevisionId,
        pieceId: pc.id,
        qtyPerUnit: 1,
        needsHan: true,
        needsSon: true,
      },
    });
    setFlags(true);
  });

  afterAll(async () => {
    const restore = (k: string, v: string | undefined) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    };
    restore('SEGMENT_STOCK_ENABLED', prevEnv.seg);
    restore('STAGE_HANDOVER_ENABLED', prevEnv.sh);
    if (h && w) {
      const mine = { slip: { createdById: { in: w.ids.users } } };
      await h.prisma.issueSlipLine.deleteMany({ where: mine });
      await h.prisma.issueSlip.deleteMany({ where: { createdById: { in: w.ids.users } } });
      await h.prisma.segmentReservationLog.deleteMany({
        where: { reservation: { productionInvoiceId: { in: w.ids.pis } } },
      });
      await w.cleanup();
    }
    if (h) await h.close();
  });

  beforeEach(() => setFlags(true));

  // ---------------------------------------------------------------------------------------------

  const newPi = (quantities: number[] = [10]) => w.newInvoice({ quantities, workshopId: ws.id });

  /** Đoạn KCS đạt của lệnh vào kho Phôi (phía cộng thật, giữ cho lệnh) - giao được ngay, không có bước nhận kho. */
  const seedPhoiOutput = async (world: World, qty: number) => {
    await h.prisma.$transaction((tx) =>
      segStock.syncOrderProduction(tx, {
        productionInvoiceId: world.piId,
        warehouseId: ws.phoiWhId,
        targets: [
          { segmentSpecId: w.specH1, segmentSteps: '', heldQty: qty, surplusQty: 0 },
          { segmentSpecId: w.specH2, segmentSteps: '', heldQty: qty, surplusQty: 0 },
        ],
        reason: 'TEST',
      }),
    );
  };

  const segLines = (world: World, qty: number, stage: MfgStage = MfgStage.HAN) =>
    [w.specH1, w.specH2].map((spec) => ({
      kind: IssueSlipLineKind.SEGMENT_HANDOVER,
      productionInvoiceId: world.piId.toString(),
      segmentSpecId: spec.toString(),
      segmentSteps: '',
      stage,
      qty,
    }));

  const createSegSlip = (world: World, qty: number) =>
    slips.create(
      { recipientName: 'To Han - A', lines: segLines(world, qty) },
      keeper,
      ws.phoiWhCode,
    );

  const confirm = (slipId: string, k = key('cf'), scope = ws.phoiWhCode) =>
    slips.confirm(slipId, [URL], keeper, scope, k);

  const quant = async (warehouseId: bigint, f: { segmentSpecId?: bigint; pieceId?: bigint }) =>
    (
      await h.prisma.stockQuant.aggregate({
        where: { warehouseId, ...f, ...(f.segmentSpecId ? { segmentSteps: '' } : {}) },
        _sum: { qty: true },
      })
    )._sum.qty?.toNumber() ?? 0;

  const held = async (world: World, warehouseId: bigint, segmentSpecId: bigint) => {
    const r = await h.prisma.segmentReservation.findFirst({
      where: { productionInvoiceId: world.piId, warehouseId, segmentSpecId, segmentSteps: '' },
    });
    return r ? r.reservedQty.toNumber() - r.consumedQty.toNumber() : 0;
  };

  const reportHan = (world: World, qty: number, user = w.workerA, orderIdx = 0) =>
    h.batches.recordProductionBatch(
      world.orderIds[orderIdx].toString(),
      { pieceId: w.pieceHan.toString(), qty, stage: MfgStage.HAN },
      user,
      'HAN',
    );

  const err = <T>(p: Promise<T>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );

  // ---------------------------------------------------------------------------------------------

  describe('(a) xác nhận phiếu giao đoạn', () => {
    it('chuyển tồn + phần giữ của lệnh kho Phôi -> kho Hàn; gửi lại cùng khoá không chuyển lần 2', async () => {
      const world = await newPi();
      // Kho dùng chung mọi ca trong file - so phần chênh.
      const base = {
        phoi: await quant(ws.phoiWhId, { segmentSpecId: w.specH1 }),
        han: await quant(ws.hanWhId, { segmentSpecId: w.specH1 }),
      };
      await seedPhoiOutput(world, 10);
      const slip = await createSegSlip(world, 6);
      expect(slip.status).toBe(IssueSlipStatus.DRAFT);
      expect(slip.lines.map((l) => l.unit)).toEqual(['đoạn', 'đoạn']);
      // Phiếu chờ ký: chưa trừ tồn.
      expect(await quant(ws.phoiWhId, { segmentSpecId: w.specH1 })).toBe(base.phoi + 10);

      const k = key('a');
      const done = await confirm(slip.id, k);
      expect(done.status).toBe(IssueSlipStatus.ISSUED);
      expect(await quant(ws.phoiWhId, { segmentSpecId: w.specH1 })).toBe(base.phoi + 4);
      expect(await quant(ws.hanWhId, { segmentSpecId: w.specH1 })).toBe(base.han + 6);
      for (const spec of [w.specH1, w.specH2]) {
        expect(await held(world, ws.phoiWhId, spec)).toBe(4);
        expect(await held(world, ws.hanWhId, spec)).toBe(6);
      }
      const ledgerCount = () =>
        h.prisma.stockLedger.count({
          where: {
            refType: StockLedgerRefType.SEGMENT_HANDOVER,
            refId: { in: done.lines.map((l) => l.id) },
          },
        });
      expect(await ledgerCount()).toBe(2);

      // Gửi lại cùng khoá: trả phiếu đã xuất, không ghi thêm.
      const again = await confirm(slip.id, k);
      expect(again.status).toBe(IssueSlipStatus.ISSUED);
      expect(await ledgerCount()).toBe(2);
      // Khoá khác: phiếu đã xuất -> 409.
      expect(await err(confirm(slip.id, key('a2')))).toBeInstanceOf(ConflictException);
      expect(await quant(ws.hanWhId, { segmentSpecId: w.specH1 })).toBe(6);
    });

    it('một phiếu gộp nhiều lệnh (mỗi dòng 1 lệnh)', async () => {
      const w1 = await newPi();
      const w2 = await newPi();
      await seedPhoiOutput(w1, 5);
      await seedPhoiOutput(w2, 5);
      const slip = await slips.create(
        { lines: [...segLines(w1, 2), ...segLines(w2, 3)] },
        keeper,
        ws.phoiWhCode,
      );
      await confirm(slip.id);
      expect(await held(w1, ws.hanWhId, w.specH1)).toBe(2);
      expect(await held(w2, ws.hanWhId, w.specH1)).toBe(3);
    });
  });

  describe('(b) không giao quá', () => {
    it('chưa có đoạn đạt KCS thì không giao được; thủ kho kho khác không lập được phiếu đoạn', async () => {
      const world = await newPi();
      const e1 = await err(createSegSlip(world, 1));
      expect(e1).toBeInstanceOf(BadRequestException);
      expect(msg(e1)).toContain('còn giao được 0');
      await seedPhoiOutput(world, 10);
      const e2 = await err(slips.create({ lines: segLines(world, 1) }, keeper, ws.hanWhCode));
      expect(msg(e2)).toContain(`bạn đang làm kho ${ws.hanWhCode}`);
    });

    it('vượt phần còn lại, và 2 phiếu chờ ký không cùng giữ 1 phần', async () => {
      const world = await newPi();
      await seedPhoiOutput(world, 8);
      const first = await createSegSlip(world, 5);
      await confirm(first.id);
      // Kho Phôi còn giữ cho lệnh 8 - 5 = 3.
      const e1 = await err(createSegSlip(world, 4));
      expect(e1).toBeInstanceOf(BadRequestException);
      expect(msg(e1)).toContain('còn giao được 3');
      await createSegSlip(world, 2); // chờ ký
      const e2 = await err(createSegSlip(world, 2));
      expect(msg(e2)).toContain('đang trên phiếu chờ ký 2');
      expect(msg(e2)).toContain('còn giao được 1');
      // Trùng dòng trong 1 phiếu -> 400.
      const e3 = await err(
        slips.create(
          { lines: [segLines(world, 1)[0], segLines(world, 1)[0]] },
          keeper,
          ws.phoiWhCode,
        ),
      );
      expect(msg(e3)).toContain('trùng');
    });
  });

  describe('(c) cổng báo Hàn theo đoạn đã nhận', () => {
    it('chặn vượt số đã nhận, mở chặn cho thêm, không vượt kế hoạch; KCS trừ đoạn ở kho Hàn', async () => {
      const world = await newPi([10]);
      await seedPhoiOutput(world, 10);
      await confirm((await createSegSlip(world, 6)).id);

      const e1 = await err(reportHan(world, 7));
      expect(e1).toBeInstanceOf(BadRequestException);
      expect(msg(e1)).toContain('đã nhận 6, đã làm 0, còn 6');
      expect(msg(e1)).toContain('báo QLSX mở chặn');
      const b = await reportHan(world, 6);

      // KCS chấm: đoạn trừ ở kho Hàn (không phải kho Phôi), mảnh Hàn đạt vào kho Hàn.
      await h.api.closeProductionBatch(b.id, w.kcsA);
      await h.api.reviewProductionBatch(b.id, { failedQty: 0 }, w.kcsA);
      const consume = await h.prisma.stockLedger.findMany({
        where: { refType: StockLedgerRefType.SEGMENT_CONSUME, refId: b.id },
        select: { fromWarehouseId: true, qty: true },
      });
      expect(consume).toHaveLength(2);
      expect(consume.every((c) => c.fromWarehouseId === ws.hanWhId)).toBe(true);
      expect(await held(world, ws.hanWhId, w.specH1)).toBe(0);
      expect(await held(world, ws.phoiWhId, w.specH1)).toBe(4);
      expect(await quant(ws.hanWhId, { pieceId: w.pieceHan })).toBe(6);
      expect(
        await h.prisma.segmentOverage.count({ where: { productionBatchId: BigInt(b.id) } }),
      ).toBe(0);

      expect(msg(await err(reportHan(world, 1)))).toContain('còn 0');
      // QLSX mở chặn 5 mảnh: báo thêm 3 được; kế hoạch còn 1 nên báo 2 nữa vẫn bị chặn theo kế hoạch.
      h.clearEmits();
      await handover.createOverride(
        {
          productionInvoiceId: world.piId.toString(),
          stage: MfgStage.HAN,
          productionOrderId: world.orderIds[0].toString(),
          pieceId: w.pieceHan.toString(),
          qty: 5,
          reason: 'Kho vắng người',
        },
        w.qlsx,
      );
      expect(h.emitCalls().map((c) => c.type)).toContain('STAGE_HANDOVER_OVERRIDE');
      await reportHan(world, 3);
      const e2 = await err(reportHan(world, 2));
      expect(msg(e2)).toContain('tối đa 1'); // câu của cổng kế hoạch
      expect(msg(e2)).toContain('cần 10 mảnh');

      // Bảng QLSX: mảnh còn kế hoạch 1, còn theo hàng đã nhận 2 -> không chặn; mở chặn hiện trong danh sách.
      const board = (await handover.getBoard(world.piId.toString())) as unknown as {
        stages: {
          stage: string;
          pieces: { pieceId: string; receivedLeft: number | null; effectiveMaxNow: number }[];
        }[];
        overrides: { qty: number; reason: string }[];
      };
      const han = board.stages.find((s) => s.stage === MfgStage.HAN)!;
      const row = han.pieces.find((p) => p.pieceId === w.pieceHan.toString())!;
      expect(row.receivedLeft).toBe(2);
      expect(row.effectiveMaxNow).toBe(1);
      expect(board.overrides).toEqual([
        expect.objectContaining({ qty: 5, reason: 'Kho vắng người' }),
      ]);
    });

    it('mở chặn chỉ QLSX lý do hợp lệ, không cho mảnh không qua tổ đó', async () => {
      const world = await newPi();
      const e = await err(
        handover.createOverride(
          {
            productionInvoiceId: world.piId.toString(),
            stage: MfgStage.SON,
            productionOrderId: world.orderIds[0].toString(),
            pieceId: w.pieceHan.toString(),
            qty: 1,
            reason: 'Thu',
          },
          w.qlsx,
        ),
      );
      expect(msg(e)).toContain('không qua tổ Sơn');
    });
  });

  describe('(d) Phôi báo cắt không vượt 102% sắt đã nhận', () => {
    const newSteel = async (world: World) =>
      (
        await h.prisma.steelIssue.create({
          data: {
            productionInvoiceId: world.piId,
            materialId: w.steelId,
            barLengthMm: 1000,
            barCount: 1,
            issuedById: w.admin,
            status: SteelIssueStatus.RECEIVED,
            receivedAt: new Date(),
            receivedById: w.workerA,
            receivedBarCount: 1,
          },
        })
      ).id;
    const cut = (world: World, issueId: bigint, qty: number) =>
      h.steel.recordCutBatch(
        issueId.toString(),
        {
          productionOrderId: world.orderIds[0].toString(),
          segments: [{ segmentSpecId: w.spec441.toString(), qty }],
        },
        w.workerA,
      );

    it('bật: cây 1000 mm cắt 2 đoạn 441 được, đoạn thứ 3 bị chặn; QLSX mở chặn mm thì qua', async () => {
      const world = await newPi();
      const issueId = await newSteel(world);
      await cut(world, issueId, 2);
      const e = await err(cut(world, issueId, 1));
      expect(e).toBeInstanceOf(BadRequestException);
      expect(msg(e)).toContain('vượt 2% sắt đã nhận');
      await handover.createOverride(
        {
          productionInvoiceId: world.piId.toString(),
          stage: MfgStage.PHOI,
          materialId: w.steelId.toString(),
          qty: 500,
          reason: 'Cây lẻ đã nhập lại kho',
        },
        w.qlsx,
      );
      await cut(world, issueId, 1);
    });

    it('(e) tắt: vẫn chỉ cảnh báo như cũ (cắt 3 đoạn được)', async () => {
      setFlags(false);
      const world = await newPi();
      const issueId = await newSteel(world);
      await cut(world, issueId, 3);
    });
  });

  describe('(e) tắt công tắc = như cũ', () => {
    it('Hàn báo không cần phiếu giao; phiếu giao đoạn bị từ chối rõ ràng; KCS trừ đoạn ở kho Phôi', async () => {
      const world = await newPi();
      await seedPhoiOutput(world, 10);
      setFlags(false);
      const e = await err(createSegSlip(world, 1));
      expect(e).toBeInstanceOf(BadRequestException);
      expect(msg(e)).toContain('Giao nhận giữa tổ chưa bật');
      const b = await reportHan(world, 7);
      await h.api.closeProductionBatch(b.id, w.kcsA);
      await h.api.reviewProductionBatch(b.id, { failedQty: 0 }, w.kcsA);
      const consume = await h.prisma.stockLedger.findMany({
        where: { refType: StockLedgerRefType.SEGMENT_CONSUME, refId: b.id },
        select: { fromWarehouseId: true },
      });
      expect(consume.length).toBeGreaterThan(0);
      expect(consume.every((c) => c.fromWarehouseId === ws.phoiWhId)).toBe(true);
    });
  });

  describe('(f) tranh chấp', () => {
    it('2 lần xác nhận cùng 1 phiếu (khoá khác nhau) -> 1 lần xuất, lần kia 409, đoạn chuyển đúng 1 lần', async () => {
      const world = await newPi();
      await seedPhoiOutput(world, 10);
      const slip = await createSegSlip(world, 4);
      const out = await raceWith(
        h.prisma,
        [rowLockSql('issue_slips', slip.id)],
        [() => confirm(slip.id, key('r1')), () => confirm(slip.id, key('r2'))],
      );
      expectNoServerFault(out);
      const { loser } = oneWinner(out);
      expect(loser.error).toBeInstanceOf(ConflictException);
      expect(await held(world, ws.hanWhId, w.specH1)).toBe(4);
      expect(await held(world, ws.phoiWhId, w.specH1)).toBe(6);
      expect(
        await h.prisma.stockLedger.count({
          where: {
            refType: StockLedgerRefType.SEGMENT_HANDOVER,
            refId: { in: slip.lines.map((l) => l.id) },
          },
        }),
      ).toBe(2);
    });

    it('2 SKU cùng dùng kho đoạn đã nhận của lệnh, báo cùng lúc vượt phần còn -> chỉ 1 qua', async () => {
      const world = await newPi([10, 10]);
      await seedPhoiOutput(world, 10);
      await confirm((await createSegSlip(world, 6)).id);
      const out = await raceWith(
        h.prisma,
        [lockSql(`stage-handover-cap:${world.piId}:${MfgStage.HAN}`)],
        [() => reportHan(world, 4, w.workerA, 0), () => reportHan(world, 4, w.workerB, 1)],
        { ordered: true },
      );
      expect(out.every((o) => o.waited)).toBe(true);
      expectNoServerFault(out);
      const { winner, loser } = oneWinner(out);
      expect(winner).toBe(out[0]);
      expect(loser.error).toBeInstanceOf(BadRequestException);
      expect(msg(loser.error)).toContain('còn 2');
    });

    it('xác nhận phiếu không chờ khoá cổng báo; lần báo đang chờ thấy hàng vừa nhận', async () => {
      const world = await newPi();
      await seedPhoiOutput(world, 10);
      const slip = await createSegSlip(world, 6);
      const out = await raceWith(
        h.prisma,
        [lockSql(`stage-handover-cap:${world.piId}:${MfgStage.HAN}`)],
        [() => reportHan(world, 5), () => confirm(slip.id)],
        { minWaiting: 1 },
      );
      expectNoServerFault(out);
      expect(out[1].ok).toBe(true);
      expect(out[1].doneBeforeRelease).toBe(true);
      expect(out[0].ok).toBe(true);
    });
  });

  describe('mảnh Hàn -> Sơn (FRAME_HANDOVER)', () => {
    it('Hàn đạt vào kho Hàn, thủ kho giao Sơn; Sơn báo trong số đã nhận; KCS Sơn không ghi mảnh lần 2', async () => {
      const world = await newPi([10]);
      const { batchId } = await w.seedPieceBatch(world, {
        pieceId: framePiece,
        stage: MfgStage.HAN,
        qty: 5,
        status: ProductionBatchStatus.QC_DONE,
      });
      await h.prisma.$transaction((tx) =>
        h.batches.postPieceOutputIfFinal(
          tx,
          {
            id: batchId,
            productionOrderId: world.orderIds[0],
            pieceId: framePiece,
            stage: MfgStage.HAN,
            qty: 5,
          },
          w.kcsA,
        ),
      );
      expect(await quant(ws.hanWhId, { pieceId: framePiece })).toBe(5);

      const frameLine = (qty: number) => ({
        kind: IssueSlipLineKind.FRAME_HANDOVER,
        productionOrderId: world.orderIds[0].toString(),
        pieceId: framePiece.toString(),
        qty,
      });
      // Mảnh Hàn đạt KCS đã ở kho Hàn - giao ngay, không quá tồn mảnh của kho.
      expect(
        msg(await err(slips.create({ lines: [frameLine(6)] }, keeper, ws.hanWhCode))),
      ).toContain('còn giao được 5');
      const slip = await slips.create({ lines: [frameLine(3)] }, keeper, ws.hanWhCode);
      expect(slip.lines[0].unit).toBe('mảnh');
      await confirm(slip.id, key('cf'), ws.hanWhCode);
      expect(await quant(ws.hanWhId, { pieceId: framePiece })).toBe(2);
      expect(await quant(ws.sonWhId!, { pieceId: framePiece })).toBe(3);

      const reportSon = (qty: number) =>
        h.batches.recordProductionBatch(
          world.orderIds[0].toString(),
          { pieceId: framePiece.toString(), qty, stage: MfgStage.SON },
          w.workerA,
          'SON',
        );
      expect(msg(await err(reportSon(4)))).toContain('đã nhận 3, đã làm 0, còn 3');
      const b = await reportSon(3);
      await h.api.closeProductionBatch(b.id, w.kcsA);
      await h.api.reviewProductionBatch(b.id, { failedQty: 0 }, w.kcsA);
      // KCS Sơn đạt: mảnh đã ở kho Sơn từ lúc giao - không FRAME_OUTPUT thứ 2.
      expect(await w.ledgerCount(StockLedgerRefType.FRAME_OUTPUT, b.id)).toBe(0);
      expect(await quant(ws.sonWhId!, { pieceId: framePiece })).toBe(3);

      // Kế hoạch giao của kho Hàn hiện đúng số.
      const plan = (await handover.getPlan(
        { kind: HandoverKind.FRAME, productionInvoiceId: world.piId.toString() },
        ws.hanWhCode,
      )) as unknown as {
        rows: { pieceId: string; passedQty: number; handedOverQty: number; availableQty: number }[];
      };
      const row = plan.rows.find((r) => r.pieceId === framePiece.toString())!;
      expect(row).toEqual(
        expect.objectContaining({ passedQty: 5, handedOverQty: 3, availableQty: 2 }),
      );
    });
  });

  it('kế hoạch giao đoạn của kho Phôi: đạt KCS / chờ ký / giao được', async () => {
    const world = await newPi();
    await seedPhoiOutput(world, 10);
    await createSegSlip(world, 2);
    const plan = (await handover.getPlan(
      { kind: HandoverKind.SEGMENT, productionInvoiceId: world.piId.toString() },
      ws.phoiWhCode,
    )) as unknown as {
      rows: {
        segmentSpecId: string;
        passedQty: number;
        draftQty: number;
        availableQty: number;
        stages: { stage: string; requiredQty: number }[];
      }[];
    };
    const r = plan.rows.find((x) => x.segmentSpecId === w.specH1.toString())!;
    expect(r).toEqual(
      expect.objectContaining({
        passedQty: 10,
        draftQty: 2,
        availableQty: 8,
      }),
    );
    expect(r.stages).toEqual([expect.objectContaining({ stage: MfgStage.HAN, requiredQty: 10 })]);
    const list = (await handover.getPlan(
      { kind: HandoverKind.SEGMENT },
      ws.phoiWhCode,
    )) as unknown as {
      pis: { productionInvoiceId: string }[];
    };
    expect(list.pis.map((p) => p.productionInvoiceId)).toContain(world.piId.toString());
  });
});
