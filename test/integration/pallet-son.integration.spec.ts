import * as crypto from 'crypto';
import {
  IssueSlipLineKind,
  IssueSlipStatus,
  MfgStage,
  PalletStatus,
  ProductionBatchStatus,
  StockLedgerRefType,
  WarehouseKind,
  WorkstationKind,
} from '../../src/generated/prisma/client';
import type { AuthenticatedUser } from '../../src/common/interfaces/jwt-payload.interface';
import { FloorScanService } from '../../src/modules/floor/floor-scan.service';
import { IssueSlipsService } from '../../src/modules/issue-slips/issue-slips.service';
import { PalletsService } from '../../src/modules/pallets/pallets.service';
import {
  P1Harness,
  P1World,
  World,
  WorkshopRef,
  createHarness,
  expectNoServerFault,
  httpStatus,
  msg,
} from './p1-kcs.fixture';

/**
 * Pallet Sơn (24/11/2026 - docs THIET-KE-PALLET-SON-2026-11-24, chốt P1-P8) trên Postgres TEST thật:
 *  (a) xếp pallet: chặn tổng pallet chờ sơn vượt số Sơn còn báo được (kế hoạch; + số Sơn đã nhận khi bật giao nhận giữa tổ),
 *      pallet không trống thì không xếp, cảnh báo vượt sức chứa, gỡ lượt xếp;
 *  (b) công nhân Sơn quét pallet "Sơn xong" = 1 đợt Sơn qua recordProductionBatch (giữ chặn kế hoạch), không báo 2 lần,
 *      gửi lại cùng khoá không báo lần 2, cần điểm sơn;
 *  (c) báo thiếu: lý do bắt buộc, báo số nhỏ hơn + thông báo QLSX / kho Sơn;
 *  (d) xuất đan quét pallet: chỉ sửa giảm, pallet không lên 2 phiếu chờ ký (kể cả 2 phiếu lập cùng lúc), huỷ phiếu -> Sơn xong,
 *      xác nhận -> Trống + giữ lịch sử;
 *  (e) tắt công tắc: API pallet trả enabled false / 400, phiếu xuất đan thường như cũ.
 */
describe('Pallet Sơn (integration, real Postgres)', () => {
  let h: P1Harness;
  let w: P1World;
  let slips: IssueSlipsService;
  let pallets: PalletsService;
  let floor: FloorScanService;
  let ws: WorkshopRef;
  /** Kho Sơn dùng chung (như thật: 1 kho Sơn, xưởng không có kho Sơn riêng) - nơi sơn + nơi xuất đan cùng 1 kho. */
  let son: { id: bigint; code: string };
  let keeper: string;
  let worker: AuthenticatedUser;
  let sonPiece: bigint;
  let wsToken: string;
  let wsId: bigint;
  let pointId: bigint;
  const palletIds: bigint[] = [];
  const prevEnv = {
    pl: process.env.PALLET_SON_ENABLED,
    seg: process.env.SEGMENT_STOCK_ENABLED,
    sh: process.env.STAGE_HANDOVER_ENABLED,
  };
  const URL = 'https://res.cloudinary.com/demo/image/upload/phieu.jpg';
  let keySeq = 0;
  const key = (tag: string) => `pl-${tag}-${Date.now()}-${(keySeq += 1)}`;

  const setFlags = (pallet: boolean, handover = false) => {
    process.env.PALLET_SON_ENABLED = pallet ? 'true' : 'false';
    process.env.SEGMENT_STOCK_ENABLED = handover ? 'true' : 'false';
    process.env.STAGE_HANDOVER_ENABLED = handover ? 'true' : 'false';
  };

  beforeAll(async () => {
    h = await createHarness();
    slips = h.moduleRef.get(IssueSlipsService, { strict: false });
    pallets = h.moduleRef.get(PalletsService, { strict: false });
    floor = h.moduleRef.get(FloorScanService, { strict: false });
    w = new P1World(h, `pl-${Date.now()}`);
    await w.init();
    ws = await w.makeWorkshop('PL');
    const shared = await h.prisma.warehouse.findFirst({
      where: { kind: WarehouseKind.SON, deletedAt: null, isActive: true },
      orderBy: { id: 'asc' },
      select: { id: true, code: true },
    });
    if (shared) son = shared;
    else {
      son = await h.prisma.warehouse.create({
        data: { code: w.code('SONSHARED'), name: 'Kho Son chung test', kind: WarehouseKind.SON },
        select: { id: true, code: true },
      });
      w.ids.warehouses.push(son.id);
    }
    keeper = w.admin;
    // Mảnh qua Hàn + Sơn, có đan (không định mức đoạn) - cổng "Sơn đã nhận" theo mảnh Hàn giao (FRAME).
    const pc = await h.prisma.piece.create({
      data: {
        mfgProductId: w.mfgProductId,
        code: w.code('SONPL'),
        groupNumber: 1,
        pieceNumber: 998,
        name: 'Manh son pallet',
      },
    });
    w.ids.pieces.push(pc.id);
    sonPiece = pc.id;
    await h.prisma.bomPiece.create({
      data: {
        bomRevisionId: w.bomRevisionId,
        pieceId: pc.id,
        qtyPerUnit: 1,
        needsHan: true,
        needsSon: true,
        isWoven: true,
      },
    });
    wsToken = crypto.randomBytes(12).toString('base64url');
    wsId = (
      await h.prisma.workstation.create({
        data: {
          code: w.code('WSSON'),
          name: 'Diem son test',
          stage: MfgStage.SON,
          kind: WorkstationKind.PIECE,
          qrToken: wsToken,
          workshopId: ws.id,
        },
      })
    ).id;
    pointId = (
      await h.prisma.weavingPoint.create({
        data: { code: w.code('DAN'), fullName: 'Diem dan test' },
      })
    ).id;
    const wid = await w.makeUser('son');
    await h.prisma.user.update({ where: { id: wid }, data: { mfgRole: 'SON' } });
    worker = {
      id: wid,
      username: 'son',
      email: null,
      roles: [],
      permissions: [],
      mfgRole: 'SON',
      warehouseScope: null,
    };
    setFlags(true);
  });

  afterAll(async () => {
    const restore = (k: string, v: string | undefined) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    };
    restore('PALLET_SON_ENABLED', prevEnv.pl);
    restore('SEGMENT_STOCK_ENABLED', prevEnv.seg);
    restore('STAGE_HANDOVER_ENABLED', prevEnv.sh);
    if (h && w) {
      const p = h.prisma;
      const ids = palletIds;
      await p.pallet.updateMany({
        where: { id: { in: ids } },
        data: { currentLoadId: null, status: PalletStatus.EMPTY },
      });
      await p.palletLoad.deleteMany({ where: { palletId: { in: ids } } });
      await p.pallet.deleteMany({ where: { id: { in: ids } } });
      await p.issueSlipLine.deleteMany({ where: { slip: { createdById: { in: w.ids.users } } } });
      await p.issueSlip.deleteMany({ where: { createdById: { in: w.ids.users } } });
      await p.weavingIssue.deleteMany({ where: { productionOrderId: { in: w.ids.orders } } });
      await p.floorReportLine.deleteMany({ where: { floorReport: { workstationId: wsId } } });
      await p.floorReport.deleteMany({ where: { workstationId: wsId } });
      await p.workstation.deleteMany({ where: { id: wsId } });
      await p.$executeRaw`DELETE FROM "weaving_points" WHERE "id" = ${pointId}`;
      await w.cleanup();
    }
    if (h) await h.close();
  });

  beforeEach(() => setFlags(true));

  // ---------------------------------------------------------------------------------------------

  const newPi = (qty = 10) => w.newInvoice({ quantities: [qty], workshopId: ws.id });

  const err = <T>(p: Promise<T>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );

  const newPallet = async () => {
    const [p] = await pallets.create({ count: 1 }, son.code, keeper);
    palletIds.push(BigInt(p.id));
    return p;
  };

  const load = (palletId: string, world: World, qty: number) =>
    pallets.load(
      palletId,
      { productionOrderId: world.orderIds[0].toString(), pieceId: sonPiece.toString(), qty },
      son.code,
      keeper,
    );

  /** Khung Hàn đạt KCS -> lệnh hiện trong danh sách Sơn làm được ở điểm sơn. */
  const hanPassed = (world: World, qty = 10) =>
    w.seedPieceBatch(world, {
      pieceId: sonPiece,
      stage: MfgStage.HAN,
      qty,
      status: ProductionBatchStatus.QC_DONE,
      withReport: false,
    });

  const paint = (
    palletToken: string,
    dto: { qty?: number; shortReason?: string } = {},
    k = key('paint'),
  ) => floor.paintPallet(wsToken, palletToken, worker, dto, k);

  const palletRow = (id: string) =>
    h.prisma.pallet.findUniqueOrThrow({
      where: { id: BigInt(id) },
      include: { currentLoad: true },
    });

  const sonReported = async (world: World) =>
    (
      await h.prisma.productionBatch.aggregate({
        where: { productionOrderId: world.orderIds[0], pieceId: sonPiece, stage: MfgStage.SON },
        _sum: { reportedQty: true },
      })
    )._sum.reportedQty ?? 0;

  /** Giả lập KCS Sơn đạt hết (KCS không đổi gì - P8) + mảnh vào kho Sơn, để xuất đan được. */
  const passSonAndStock = async (world: World, qty: number) => {
    await h.prisma.productionBatch.updateMany({
      where: { productionOrderId: world.orderIds[0], pieceId: sonPiece, stage: MfgStage.SON },
      data: { status: ProductionBatchStatus.QC_DONE },
    });
    await h.ledger.postEntry({
      fromWarehouseId: w.supplierWhId,
      toWarehouseId: son.id,
      pieceId: sonPiece,
      qty,
      refType: StockLedgerRefType.OPENING_BALANCE,
      refId: `pl-open-${world.piId}`,
      idempotencyKey: key('stock'),
    });
  };

  const weavingSlip = (world: World, qty: number, ids: string[]) =>
    slips.create(
      {
        weavingPointId: pointId.toString(),
        lines: [
          {
            kind: IssueSlipLineKind.WEAVING_PIECE,
            productionOrderId: world.orderIds[0].toString(),
            pieceId: sonPiece.toString(),
            qty,
            palletIds: ids,
          },
        ],
      },
      keeper,
      son.code,
    );

  // ---------------------------------------------------------------------------------------------

  describe('(a) xếp pallet', () => {
    it('chặn tổng chờ sơn vượt kế hoạch; pallet không trống thì không xếp; cảnh báo sức chứa; gỡ lượt xếp', async () => {
      const world = await newPi(10);
      const [p1, p2, p3] = [await newPallet(), await newPallet(), await newPallet()];
      expect(p1.code).toMatch(/^PL-\d{3,}$/);
      expect(p1.status).toBe(PalletStatus.EMPTY);

      await pallets.setPieceCapacity({ pieceId: sonPiece.toString(), capacity: 5 });
      const r1 = await load(p1.id, world, 6);
      expect(r1.pallet.status).toBe(PalletStatus.LOADED);
      expect(r1.pallet.load).toMatchObject({ qty: 6, overCapacity: true });
      expect(r1.warning).toContain('vượt sức chứa 5');

      // còn 10 - 6 = 4
      expect(msg(await err(load(p2.id, world, 5)))).toContain('còn xếp được tối đa 4');
      expect(httpStatus(await err(load(p1.id, world, 1)))).toBe(409);
      const r2 = await load(p2.id, world, 4);
      expect(r2.warning).toBeNull();

      const opts = (await pallets.loadOptions(
        { productionInvoiceId: world.piId.toString() },
        son.code,
      )) as unknown as { rows: Array<Record<string, unknown>> };
      expect(opts.rows.find((r) => r.pieceId === sonPiece.toString())).toMatchObject({
        plannedQty: 10,
        receivedQty: null,
        reportedQty: 0,
        pendingQty: 10,
        loadedQty: 10,
        remainingQty: 0,
        capacity: 5,
      });
      expect(msg(await err(load(p3.id, world, 1)))).toContain('tối đa 0');

      // Gỡ lượt xếp nhầm: pallet về Trống, lịch sử giữ.
      const un = await pallets.unload(p2.id, son.code, keeper);
      expect(un.status).toBe(PalletStatus.EMPTY);
      const detail = await pallets.findOne(p2.id, son.code);
      expect(detail.history[0]).toMatchObject({ qty: 4, clearedReason: 'UNLOADED' });
      await load(p3.id, world, 4);

      // Danh sách + lọc
      const list = await pallets.list({ status: PalletStatus.LOADED }, son.code);
      expect(list.enabled).toBe(true);
      expect(list.pallets.map((p) => p.code)).toEqual(expect.arrayContaining([p1.code, p3.code]));
      expect(list.pallets.every((p) => p.status === PalletStatus.LOADED)).toBe(true);
      await pallets.setPieceCapacity({ pieceId: sonPiece.toString(), capacity: null });
    });

    it('bật giao nhận giữa tổ: không xếp quá số khung Sơn đã nhận', async () => {
      setFlags(true, true);
      const world = await newPi(10);
      // Kho Hàn đã giao 3 mảnh cho Sơn (phiếu XK đã xuất).
      await h.prisma.issueSlip.create({
        data: {
          code: w.code('XKT'),
          warehouseId: ws.hanWhId,
          createdById: keeper,
          status: IssueSlipStatus.ISSUED,
          lines: {
            create: [
              {
                kind: IssueSlipLineKind.FRAME_HANDOVER,
                productionOrderId: world.orderIds[0],
                pieceId: sonPiece,
                stage: MfgStage.SON,
                qty: 3,
              },
            ],
          },
        },
      });
      const p = await newPallet();
      expect(msg(await err(load(p.id, world, 4)))).toContain('Sơn đã nhận 3');
      const ok = await load(p.id, world, 3);
      expect(ok.pallet.load?.qty).toBe(3);
      const opts = (await pallets.loadOptions(
        { productionInvoiceId: world.piId.toString() },
        son.code,
      )) as unknown as { rows: Array<Record<string, unknown>> };
      expect(opts.rows.find((r) => r.pieceId === sonPiece.toString())).toMatchObject({
        receivedQty: 3,
        remainingQty: 0,
      });
    });
  });

  describe('(b) công nhân Sơn quét pallet', () => {
    it('"Sơn xong" = 1 đợt Sơn bình thường; không báo 2 lần; gửi lại cùng khoá không cộng thêm', async () => {
      const world = await newPi(10);
      await hanPassed(world);
      const p = await newPallet();
      await load(p.id, world, 6);
      const view = await floor.palletView(p.qrToken, worker);
      expect(view.pallet?.load).toMatchObject({ qty: 6, pieceName: 'Manh son pallet' });

      const k = key('once');
      const out = await paint(p.qrToken, {}, k);
      expect(out.short).toBe(false);
      expect(out.pallet?.status).toBe(PalletStatus.PAINTED);
      expect(out.productionBatch?.stage).toBe(MfgStage.SON);
      expect(await sonReported(world)).toBe(6);
      const row = await palletRow(p.id);
      expect(row.currentLoad).toMatchObject({ paintedQty: 6, paintedById: worker.id });
      expect(row.currentLoad?.productionBatchId?.toString()).toBe(out.productionBatch?.id);
      const report = await h.prisma.floorReport.findUniqueOrThrow({
        where: { id: row.currentLoad!.floorReportId! },
      });
      expect(report.workstationId).toBe(wsId);

      // gửi lại cùng khoá (mạng chập chờn) -> trả kết quả, không cộng
      await paint(p.qrToken, {}, k);
      expect(await sonReported(world)).toBe(6);
      // quét lại pallet đã sơn với khoá khác -> 409
      expect(httpStatus(await err(paint(p.qrToken)))).toBe(409);
      expect(await sonReported(world)).toBe(6);
    });

    it('báo qua pallet giữ chặn kế hoạch của báo Sơn (báo tay chen trước) - pallet vẫn Chờ sơn', async () => {
      const world = await newPi(10);
      await hanPassed(world);
      const p = await newPallet();
      await load(p.id, world, 4);
      // Công nhân khác báo tay 7 qua đường cũ (không theo pallet).
      await h.batches.recordProductionBatch(
        world.orderIds[0].toString(),
        { pieceId: sonPiece.toString(), qty: 7, stage: MfgStage.SON },
        w.workerB,
        'SON',
      );
      expect(msg(await err(paint(p.qrToken)))).toContain('báo được tối đa 3');
      expect((await palletRow(p.id)).status).toBe(PalletStatus.LOADED);
      expect(await sonReported(world)).toBe(7);
    });

    it('2 người quét cùng 1 pallet cùng lúc: đúng 1 lần báo', async () => {
      const world = await newPi(10);
      await hanPassed(world);
      const p = await newPallet();
      await load(p.id, world, 5);
      const out = await Promise.allSettled([paint(p.qrToken), paint(p.qrToken)]);
      const ok = out.filter((o) => o.status === 'fulfilled');
      expect(ok).toHaveLength(1);
      expectNoServerFault(
        out.map((o) =>
          o.status === 'fulfilled'
            ? { ok: true, waited: true, doneBeforeRelease: false }
            : { ok: false, error: o.reason as unknown, waited: true, doneBeforeRelease: false },
        ),
      );
      expect(await sonReported(world)).toBe(5);
    });

    it('mã máy không phải của tổ Sơn -> 403', async () => {
      const world = await newPi(10);
      await hanPassed(world);
      const p = await newPallet();
      await load(p.id, world, 2);
      const tok = crypto.randomBytes(12).toString('base64url');
      const other = await h.prisma.workstation.create({
        data: {
          code: w.code('WSCUT'),
          name: 'May khac',
          stage: MfgStage.HAN,
          kind: WorkstationKind.PIECE,
          qrToken: tok,
          workshopId: ws.id,
        },
      });
      try {
        const e = await err(floor.paintPallet(tok, p.qrToken, worker, {}, key('ws')));
        expect(httpStatus(e)).toBe(403);
        expect((await palletRow(p.id)).status).toBe(PalletStatus.LOADED);
      } finally {
        await h.prisma.workstation.delete({ where: { id: other.id } });
      }
    });
  });

  describe('(c) báo thiếu', () => {
    it('lý do bắt buộc; báo số nhỏ hơn; báo QLSX + kho Sơn', async () => {
      const world = await newPi(10);
      await hanPassed(world);
      const p = await newPallet();
      await load(p.id, world, 5);
      expect(msg(await err(paint(p.qrToken, { qty: 3 })))).toContain('lý do');
      expect(msg(await err(paint(p.qrToken, { qty: 6, shortReason: 'thua' })))).toContain(
        'chỉ có 5',
      );
      h.clearEmits();
      const out = await paint(p.qrToken, { qty: 3, shortReason: '2 mảnh rơi vỡ' });
      expect(out.short).toBe(true);
      expect(await sonReported(world)).toBe(3);
      const row = await palletRow(p.id);
      expect(row.currentLoad).toMatchObject({
        qty: 5,
        paintedQty: 3,
        shortReason: '2 mảnh rơi vỡ',
      });
      const emit = h.emitCalls().find((c) => c.type === 'PALLET_SHORT_REPORTED');
      expect(emit?.options.params).toMatchObject({
        palletCode: p.code,
        loadQty: 5,
        paintedQty: 3,
        warehouseCode: son.code,
      });
    });
  });

  describe('(d) xuất đan theo pallet', () => {
    it('chỉ sửa giảm; không lên 2 phiếu chờ ký; huỷ -> Sơn xong; xác nhận -> Trống + giữ lịch sử', async () => {
      const world = await newPi(10);
      await hanPassed(world);
      const p = await newPallet();
      await load(p.id, world, 6);
      await paint(p.qrToken);
      await passSonAndStock(world, 6);

      expect(msg(await err(weavingSlip(world, 7, [p.id])))).toContain('chỉ sửa giảm');
      const s1 = await weavingSlip(world, 5, [p.id]);
      expect(s1.lines[0]).toMatchObject({ qty: 5, palletCodes: [p.code] });
      expect((await palletRow(p.id)).status).toBe(PalletStatus.ON_SLIP);
      // pallet đã nằm trên phiếu chờ ký -> phiếu thứ 2 bị chặn
      const e2 = await err(weavingSlip(world, 1, [p.id]));
      expect(httpStatus(e2)).toBe(409);
      expect(msg(e2)).toContain(s1.code);

      // huỷ phiếu -> pallet về Sơn xong, quét lại được
      await slips.cancel(s1.id, 'in sai', keeper, son.code);
      const afterCancel = await palletRow(p.id);
      expect(afterCancel.status).toBe(PalletStatus.PAINTED);
      expect(afterCancel.currentLoad?.issueSlipLineId).toBeNull();

      const s2 = await weavingSlip(world, 6, [p.id]);
      await slips.confirm(s2.id, [URL], keeper, son.code, key('cf'));
      const done = await palletRow(p.id);
      expect(done.status).toBe(PalletStatus.EMPTY);
      expect(done.currentLoadId).toBeNull();
      const hist = await pallets.findOne(p.id, son.code);
      expect(hist.history[0]).toMatchObject({
        qty: 6,
        paintedQty: 6,
        clearedReason: 'ISSUED',
        slip: { code: s2.code, status: IssueSlipStatus.ISSUED },
      });
      expect(
        await h.prisma.weavingIssue.aggregate({
          where: { productionOrderId: world.orderIds[0], pieceId: sonPiece },
          _sum: { qty: true },
        }),
      ).toMatchObject({ _sum: { qty: 6 } });
      // Pallet dùng lại ngay
      const again = await load(p.id, world, 1);
      expect(again.pallet.status).toBe(PalletStatus.LOADED);
    });

    it('2 phiếu lập cùng lúc với cùng 1 pallet: đúng 1 phiếu', async () => {
      const world = await newPi(10);
      await hanPassed(world);
      const p = await newPallet();
      await load(p.id, world, 4);
      await paint(p.qrToken);
      await passSonAndStock(world, 8);
      const out = await Promise.allSettled([
        weavingSlip(world, 4, [p.id]),
        weavingSlip(world, 3, [p.id]),
      ]);
      expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      const bad = out.find((o) => o.status === 'rejected') as PromiseRejectedResult;
      expect(httpStatus(bad.reason)).toBeLessThan(500);
      expect(
        await h.prisma.palletLoad.count({
          where: { palletId: BigInt(p.id), issueSlipLineId: { not: null } },
        }),
      ).toBe(1);
    });

    it('pallet chưa sơn không xuất đan được', async () => {
      const world = await newPi(10);
      const p = await newPallet();
      await load(p.id, world, 2);
      expect(msg(await err(weavingSlip(world, 2, [p.id])))).toContain('Chờ sơn');
    });
  });

  describe('(e) tắt công tắc', () => {
    it('API pallet trả enabled false / 400; phiếu xuất đan có pallet bị chặn', async () => {
      const world = await newPi(10);
      const p = await newPallet();
      setFlags(false);
      expect(await pallets.list({}, son.code)).toMatchObject({ enabled: false, pallets: [] });
      expect(
        await pallets.loadOptions({ productionInvoiceId: world.piId.toString() }, son.code),
      ).toMatchObject({ enabled: false });
      expect(httpStatus(await err(pallets.create({ count: 1 }, son.code, keeper)))).toBe(400);
      expect(httpStatus(await err(load(p.id, world, 1)))).toBe(400);
      expect(await floor.palletView(p.qrToken, worker)).toMatchObject({ enabled: false });
      expect(httpStatus(await err(paint(p.qrToken)))).toBe(400);
      expect(msg(await err(weavingSlip(world, 1, [p.id])))).toContain('PALLET_SON_ENABLED');
      expect((await palletRow(p.id)).status).toBe(PalletStatus.EMPTY);
    });
  });
});
