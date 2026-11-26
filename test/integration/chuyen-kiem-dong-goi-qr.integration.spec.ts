import * as crypto from 'crypto';
import {
  BomRevisionStatus,
  MfgStage,
  TransferCheckBatchStatus,
  WarehouseKind,
  WorkstationKind,
} from '../../src/generated/prisma/client';
import type { AuthenticatedUser } from '../../src/common/interfaces/jwt-payload.interface';
import { CkDgQrService } from '../../src/modules/ck-dg-qr/ck-dg-qr.service';
import { FloorAdminService } from '../../src/modules/floor/floor-admin.service';
import { PackagingIssuesService } from '../../src/modules/packaging-issues/packaging-issues.service';
import { ProductionInvoicesService } from '../../src/modules/production-invoices/production-invoices.service';
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
} from './p1-kcs.fixture';

/**
 * Chuyền kiểm + Đóng gói bằng quét QR (24/11/2026 - docs THIET-KE-CHUYEN-KIEM-DONG-GOI-QR, chốt C1-C4, D1-D4) trên Postgres
 * TEST thật:
 *  (a) tắt công tắc: API mới enabled false / 400, nhập tay đóng gói như cũ (không chặn theo chuyền kiểm), không tạo điểm / tổ mới;
 *  (b) C3: đạt + lỗi không vượt Hiện có − (đã kiểm + chờ KCS + đã bỏ); nhập tay cũng thấy phần chờ KCS; khoá gửi lại;
 *  (c) C2: KCS chuyền kiểm chấm -> ghi TransferCheckResult (+ lỗi, ảnh) mà trần xuất vật tư đóng gói / listTransferCheckPieces đọc
 *      được; làm lại trả lại "còn kiểm", bỏ thì không; chấm 2 lần 409;
 *  (d) D2: đóng gói chặn theo số bộ đã qua KCS chuyền kiểm (đồng bộ mảnh) và số lượng lệnh; khoá gửi lại;
 *  (e) D4: thủ kho huỷ lần báo đóng gói (trả số, có vết + nhật ký), huỷ 2 lần 409;
 *  (f) tranh chấp: 2 lần báo chuyền kiểm / đóng gói cùng lúc không vượt trần.
 */
describe('Chuyền kiểm + Đóng gói QR (integration, real Postgres)', () => {
  let h: P1Harness;
  let w: P1World;
  let ck: CkDgQrService;
  let pis: ProductionInvoicesService;
  let packagingIssues: PackagingIssuesService;
  let floorAdmin: FloorAdminService;
  let tp: { id: bigint; code: string };
  let rev: bigint;
  let pieceA: bigint; // mảnh đan, 1 / bộ
  let pieceB: bigint; // mảnh đan, 2 / bộ
  let pointId: bigint;
  let ckToken: string;
  let dgToken: string;
  const wsIds: bigint[] = [];
  let ckWorker: AuthenticatedUser;
  let dgWorker: AuthenticatedUser;
  let kcs: string;
  let keeper: string;
  const prevFlag = process.env.CK_DG_QR_ENABLED;
  const PHOTO = 'https://res.cloudinary.com/demo/image/upload/loi.jpg';
  let seq = 0;
  const key = (tag: string) => `ckdg-${tag}-${Date.now()}-${(seq += 1)}`;
  const setFlag = (on: boolean) => {
    process.env.CK_DG_QR_ENABLED = on ? 'true' : 'false';
  };

  const worker = (id: string, mfgRole: string): AuthenticatedUser => ({
    id,
    username: mfgRole.toLowerCase(),
    email: null,
    roles: [],
    permissions: [],
    mfgRole,
    warehouseScope: null,
  });

  beforeAll(async () => {
    h = await createHarness();
    ck = h.moduleRef.get(CkDgQrService, { strict: false });
    pis = h.moduleRef.get(ProductionInvoicesService, { strict: false });
    packagingIssues = h.moduleRef.get(PackagingIssuesService, { strict: false });
    floorAdmin = h.moduleRef.get(FloorAdminService, { strict: false });
    w = new P1World(h, `ckdg-${Date.now()}`);
    await w.init();
    tp = await h.prisma.warehouse.create({
      data: { code: w.code('TP'), name: 'Kho TP test', kind: WarehouseKind.THANH_PHAM },
      select: { id: true, code: true },
    });
    w.ids.warehouses.push(tp.id);
    // Định mức riêng: 2 mảnh đan (Hiện có = Σ nhập đan về), mảnh B 2 cái / bộ.
    rev = (
      await h.prisma.bomRevision.create({
        data: { mfgProductId: w.mfgProductId, revNo: 77, status: BomRevisionStatus.DRAFT },
      })
    ).id;
    w.extraBomRevisionIds.push(rev);
    const piece = async (tag: string, qtyPerUnit: number) => {
      const pc = await h.prisma.piece.create({
        data: {
          mfgProductId: w.mfgProductId,
          code: w.code(tag),
          groupNumber: 1,
          pieceNumber: 900 + qtyPerUnit,
          name: `Manh ${tag}`,
        },
      });
      w.ids.pieces.push(pc.id);
      await h.prisma.bomPiece.create({
        data: { bomRevisionId: rev, pieceId: pc.id, qtyPerUnit, needsHan: false, isWoven: true },
      });
      return pc.id;
    };
    pieceA = await piece('CKA', 1);
    pieceB = await piece('CKB', 2);
    pointId = (
      await h.prisma.weavingPoint.create({ data: { code: w.code('DAN'), fullName: 'Diem dan' } })
    ).id;
    const mkWs = async (kind: WorkstationKind, stage: MfgStage) => {
      const token = crypto.randomBytes(12).toString('base64url');
      const row = await h.prisma.workstation.create({
        data: {
          code: w.code(kind === WorkstationKind.PACKING ? 'DG' : 'CK'),
          name: 'diem test',
          stage,
          kind,
          qrToken: token,
          warehouseId: tp.id,
        },
      });
      wsIds.push(row.id);
      return token;
    };
    ckToken = await mkWs(WorkstationKind.TRANSFER_CHECK, MfgStage.CHUYEN_KIEM);
    dgToken = await mkWs(WorkstationKind.PACKING, MfgStage.DONG_GOI);
    const mkUser = async (tag: string, mfgRole: 'CHUYEN_KIEM' | 'DONG_GOI' | 'KCS_CHUYEN_KIEM') => {
      const id = await w.makeUser(tag);
      await h.prisma.user.update({ where: { id }, data: { mfgRole } });
      return id;
    };
    ckWorker = worker(await mkUser('ck', 'CHUYEN_KIEM'), 'CHUYEN_KIEM');
    dgWorker = worker(await mkUser('dg', 'DONG_GOI'), 'DONG_GOI');
    kcs = await mkUser('kcsck', 'KCS_CHUYEN_KIEM');
    keeper = w.admin;
  });

  afterAll(async () => {
    if (prevFlag === undefined) delete process.env.CK_DG_QR_ENABLED;
    else process.env.CK_DG_QR_ENABLED = prevFlag;
    if (h && w) {
      const p = h.prisma;
      const items = { in: w.ids.items };
      const reports = await p.packingReport.findMany({
        where: { productionInvoiceItemId: items },
        select: { id: true },
      });
      await p.auditLog.deleteMany({
        where: {
          tableName: 'PackingReport',
          recordId: { in: reports.map((r) => r.id.toString()) },
        },
      });
      await p.packingReport.deleteMany({ where: { productionInvoiceItemId: items } });
      await p.packagingRecord.deleteMany({ where: { productionInvoiceItemId: items } });
      await p.transferCheckBatch.deleteMany({ where: { productionInvoiceItemId: items } });
      await p.transferCheckDefect.deleteMany({
        where: { transferCheckResult: { productionInvoiceItemId: items } },
      });
      await p.transferCheckResult.deleteMany({ where: { productionInvoiceItemId: items } });
      await p.weavingReceipt.deleteMany({ where: { productionOrderId: { in: w.ids.orders } } });
      await p.workstation.deleteMany({ where: { id: { in: wsIds } } });
      await p.$executeRaw`DELETE FROM "weaving_points" WHERE "id" = ${pointId}`;
      await w.cleanup();
    }
    if (h) await h.close();
  });

  beforeEach(() => setFlag(true));

  // ---------------------------------------------------------------------------------------------

  /** Lệnh mới của kho TP test, `ready` = số đã nhập đan về theo mảnh. */
  const newLenh = async (qty: number, ready: { a: number; b: number }): Promise<World> => {
    const world = await w.newInvoice({ quantities: [qty], bomRevisionIds: [rev] });
    await h.prisma.productionInvoiceItem.update({
      where: { id: world.itemIds[0] },
      data: { warehouseCode: tp.code },
    });
    const receipts = [
      { pieceId: pieceA, qty: ready.a },
      { pieceId: pieceB, qty: ready.b },
    ].filter((r) => r.qty > 0);
    for (const r of receipts) {
      await h.prisma.weavingReceipt.create({
        data: {
          productionOrderId: world.orderIds[0],
          pieceId: r.pieceId,
          weavingPointId: pointId,
          qty: r.qty,
          receivedById: keeper,
        },
      });
    }
    return world;
  };

  const itemOf = (world: World) => world.itemIds[0].toString();

  const reportCk = (world: World, piece: bigint, passedQty: number, defectQty = 0, k = key('ck')) =>
    ck.reportTransferCheck(
      ckToken,
      ckWorker,
      {
        itemId: itemOf(world),
        pieceId: piece.toString(),
        passedQty,
        defectQty,
        ...(defectQty > 0
          ? { defectReasonId: w.defectReasonId.toString(), photoUrls: [PHOTO] }
          : {}),
      },
      k,
    );

  const grade = (batchId: string, passedQty: number, reworkQty = 0, scrapQty = 0, reason = false) =>
    ck.gradeBatch(
      batchId,
      {
        passedQty,
        reworkQty,
        scrapQty,
        ...(reason ? { defectReasonId: w.defectReasonId.toString(), photoUrl: PHOTO } : {}),
      },
      kcs,
    );

  const pack = (world: World, qty: number, k = key('dg')) =>
    ck.reportPacking(dgToken, dgWorker, { itemId: itemOf(world), qty }, k);

  const pieceRow = async (world: World, piece: bigint) => {
    const rows = await ck.transferCheckDetail(world.itemIds[0]);
    return rows.find((r) => r.pieceId === piece.toString())!;
  };

  const sumPacked = async (world: World) =>
    (
      await h.prisma.packagingRecord.aggregate({
        where: { productionInvoiceItemId: world.itemIds[0] },
        _sum: { boxesPacked: true },
      })
    )._sum.boxesPacked ?? 0;

  const err = <T>(p: Promise<T>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );

  // ---------------------------------------------------------------------------------------------

  it('(a) tắt công tắc: API mới không chạy, nhập tay đóng gói như cũ, không tạo điểm / tổ mới', async () => {
    setFlag(false);
    const world = await newLenh(5, { a: 0, b: 0 });
    await expect(ck.scanContext(ckToken, ckWorker)).resolves.toEqual({ enabled: false });
    expect(msg(await err(reportCk(world, pieceA, 1)))).toMatch(/CK_DG_QR_ENABLED/);
    expect(msg(await err(pack(world, 1)))).toMatch(/CK_DG_QR_ENABLED/);
    // Nhập tay cũ: chưa ai chuyền kiểm vẫn đóng được (quyết định 12/08 khi công tắc tắt).
    const res = await pis.recordPackaging(
      world.piId.toString(),
      itemOf(world),
      { boxesPacked: 2 },
      keeper,
    );
    expect(res.packedQty).toBe(2);
    expect(
      msg(
        await err(
          floorAdmin.createWorkstation({
            code: w.code('X'),
            stage: MfgStage.CHUYEN_KIEM,
            kind: WorkstationKind.TRANSFER_CHECK,
            warehouseId: tp.id.toString(),
          }),
        ),
      ),
    ).toMatch(/CK_DG_QR_ENABLED/);
    expect(
      msg(
        await err(
          floorAdmin.createWorker({
            username: w.code('ckx').toLowerCase(),
            firstName: 'A',
            lastName: 'B',
            stage: 'CHUYEN_KIEM',
          }),
        ),
      ),
    ).toMatch(/CK_DG_QR_ENABLED/);
    // Bật công tắc: nhập tay cũng chặn theo số bộ đã qua chuyền kiểm (0).
    setFlag(true);
    expect(
      msg(
        await err(
          pis.recordPackaging(world.piId.toString(), itemOf(world), { boxesPacked: 1 }, keeper),
        ),
      ),
    ).toMatch(/đã qua KCS chuyền kiểm/);
  });

  it('bật công tắc: QLSX tạo điểm chuyền kiểm (bắt buộc kho Thành phẩm)', async () => {
    expect(
      msg(
        await err(
          floorAdmin.createWorkstation({
            code: w.code('Y'),
            stage: MfgStage.CHUYEN_KIEM,
            kind: WorkstationKind.TRANSFER_CHECK,
          }),
        ),
      ),
    ).toMatch(/kho Thành phẩm/);
    expect(
      msg(
        await err(
          floorAdmin.createWorkstation({
            code: w.code('Y'),
            stage: MfgStage.DONG_GOI,
            kind: WorkstationKind.TRANSFER_CHECK,
            warehouseId: tp.id.toString(),
          }),
        ),
      ),
    ).toMatch(/Điểm chuyền kiểm/);
    const created = await floorAdmin.createWorkstation({
      code: w.code('Z'),
      stage: MfgStage.CHUYEN_KIEM,
      kind: WorkstationKind.TRANSFER_CHECK,
      warehouseId: tp.id.toString(),
    });
    wsIds.push(BigInt(created.id));
    expect(created).toMatchObject({ warehouseCode: tp.code, kind: 'TRANSFER_CHECK' });
  });

  it('(b)(c) chặn Hiện có, KCS chấm ghi TransferCheckResult, làm lại / bỏ, trần xuất vật tư đóng gói thấy', async () => {
    const world = await newLenh(10, { a: 6, b: 12 });
    const ctx = await ck.scanContext(ckToken, ckWorker, itemOf(world));
    expect(ctx.enabled).toBe(true);
    if (!ctx.enabled) throw new Error('unreachable');
    expect(ctx.items.map((i) => i.itemId)).toContain(itemOf(world));
    expect(ctx.pieces?.find((p) => p.pieceId === pieceA.toString())?.availableQty).toBe(6);
    expect(ctx.defectReasons.length).toBeGreaterThan(0);

    // Lỗi phải có nguyên nhân + ảnh.
    expect(
      msg(
        await err(
          ck.reportTransferCheck(
            ckToken,
            ckWorker,
            { itemId: itemOf(world), pieceId: pieceA.toString(), passedQty: 1, defectQty: 1 },
            key('noreason'),
          ),
        ),
      ),
    ).toMatch(/nguyên nhân/);

    const k1 = key('b1');
    const b1 = await reportCk(world, pieceA, 4, 1, k1);
    expect(b1.replay).toBe(false);
    // Gửi lại cùng khoá: không báo lần 2.
    const again = await reportCk(world, pieceA, 4, 1, k1);
    expect(again).toMatchObject({ replay: true, batch: { id: b1.batch.id } });
    // Còn 1 (6 − 5 chờ KCS).
    expect(msg(await err(reportCk(world, pieceA, 2)))).toMatch(/vượt số còn kiểm được \(1\)/);
    // Nhập tay (kho) cũng thấy phần chờ KCS.
    expect(
      msg(
        await err(
          pis.recordTransferCheck(
            world.piId.toString(),
            itemOf(world),
            { pieceId: pieceA.toString(), checkedQty: 2 },
            keeper,
          ),
        ),
      ),
    ).toMatch(/vượt quá số hiện có \(1\)/);
    const b2 = await reportCk(world, pieceA, 1);

    // Chưa chấm: chưa tính "đã qua chuyền kiểm".
    expect(
      (await pis.listTransferCheckPieces(world.piId.toString(), itemOf(world))).find(
        (p) => p.pieceId === pieceA.toString(),
      )?.checkedQty,
    ).toBe(0);

    // KCS: đạt 3 (báo đạt 4 -> lỗi thêm 1 cần nguyên nhân), làm lại 1, bỏ 1.
    expect(msg(await err(grade(b1.batch.id, 3, 1, 1)))).toMatch(/nguyên nhân/);
    expect(msg(await err(grade(b1.batch.id, 5, 0, 0)))).toMatch(/không được vượt/);
    const graded = await grade(b1.batch.id, 3, 1, 1, true);
    expect(graded).toMatchObject({
      status: TransferCheckBatchStatus.KCS_DONE,
      kcs: { passedQty: 3, reworkQty: 1, scrapQty: 1 },
    });
    expect(msg(await err(grade(b1.batch.id, 3, 1, 1, true)))).toMatch(/đã được KCS/);

    const tcr = await h.prisma.transferCheckResult.findUniqueOrThrow({
      where: { id: BigInt(graded.kcs!.transferCheckResultId!) },
      include: { defects: true },
    });
    expect(tcr.checkedQty).toBe(3);
    expect(tcr.checkedById).toBe(kcs);
    // 1 lỗi công nhân báo (kèm ảnh) + 1 lỗi KCS chấm thêm.
    expect(tcr.defects).toHaveLength(2);
    expect(tcr.defects.filter((d) => d.imageUrl === PHOTO)).toHaveLength(2);

    // Còn kiểm: 6 − đã kiểm 3 − chờ KCS 1 (b2) − bỏ 1 = 1 (phần làm lại trả về).
    expect(await pieceRow(world, pieceA)).toMatchObject({
      checkedQty: 3,
      pendingQty: 1,
      scrapQty: 1,
      availableQty: 1,
    });
    // Màn kho đọc như cũ.
    const legacy = await pis.listTransferCheckPieces(world.piId.toString(), itemOf(world));
    expect(legacy.find((p) => p.pieceId === pieceA.toString())).toMatchObject({
      checkedQty: 3,
      defectCount: 2,
    });

    // Trần xuất vật tư đóng gói (D3 không đổi) đọc "đã qua chuyền kiểm" từ đúng bảng cũ: mảnh B chưa kiểm -> 0 bộ.
    const resolve = (
      packagingIssues as unknown as {
        resolveCheckedUnits: (c: unknown, r: bigint, i: bigint) => Promise<number>;
      }
    ).resolveCheckedUnits.bind(packagingIssues);
    expect(await resolve(h.prisma, rev, world.itemIds[0])).toBe(0);
    const bB = await reportCk(world, pieceB, 8);
    await grade(bB.batch.id, 8, 0, 0);
    // min(3 / 1, 8 / 2) = 3 bộ.
    expect(await resolve(h.prisma, rev, world.itemIds[0])).toBe(3);
    await grade(b2.batch.id, 1);

    // KCS thấy số đợt chờ = 0 của lệnh này.
    const open = await ck.listBatches({ status: 'AWAITING_KCS', itemId: itemOf(world) });
    expect(open.batches).toHaveLength(0);
  });

  it('(d)(e) đóng gói chặn theo bộ đã qua KCS chuyền kiểm + số lượng lệnh, huỷ lần báo', async () => {
    const world = await newLenh(3, { a: 10, b: 20 });
    // Mới qua chuyền kiểm 2 bộ (A 2, B 4).
    await grade((await reportCk(world, pieceA, 5)).batch.id, 2, 3, 0, true);
    await grade((await reportCk(world, pieceB, 4)).batch.id, 4);
    const ctx = await ck.scanContext(dgToken, dgWorker, itemOf(world));
    if (!ctx.enabled) throw new Error('unreachable');
    expect(ctx.packing).toMatchObject({
      totalQty: 3,
      setsPassed: 2,
      packedQty: 0,
      availableQty: 2,
    });

    const k1 = key('p1');
    const p1 = await pack(world, 2, k1);
    expect((await pack(world, 2, k1)).replay).toBe(true);
    expect(await sumPacked(world)).toBe(2);
    expect(msg(await err(pack(world, 1)))).toMatch(/đã qua KCS chuyền kiểm/);

    // Qua thêm chuyền kiểm đủ 5 bộ (> số lượng lệnh 3): trần số lượng lệnh.
    await grade((await reportCk(world, pieceA, 3)).batch.id, 3);
    await grade((await reportCk(world, pieceB, 6)).batch.id, 6);
    expect(msg(await err(pack(world, 2)))).toMatch(/vượt quá số còn có thể đóng/);
    const p2 = await pack(world, 1);
    expect(await sumPacked(world)).toBe(3);

    // Thủ kho huỷ lần báo 2 bộ: trả số, có vết + nhật ký; huỷ 2 lần 409.
    const cancelled = await ck.cancelPackingReport(
      p1.report.id,
      { reason: 'Đếm nhầm thùng' },
      { id: keeper, warehouseScope: tp.code },
    );
    expect(cancelled).toMatchObject({ cancelled: true, cancelReason: 'Đếm nhầm thùng' });
    expect(await sumPacked(world)).toBe(1);
    expect(
      await h.prisma.auditLog.count({
        where: { tableName: 'PackingReport', recordId: p1.report.id },
      }),
    ).toBe(1);
    expect(
      msg(await err(ck.cancelPackingReport(p1.report.id, { reason: 'lần 2' }, { id: keeper }))),
    ).toMatch(/đã bị huỷ/);
    expect(h.emitCalls().some((c) => c.type === 'PACKING_REPORT_CANCELLED')).toBe(true);
    // Huỷ xong đóng lại được.
    await pack(world, 2);
    expect(await sumPacked(world)).toBe(3);
    const list = await ck.listPackingReports({ itemId: itemOf(world) });
    expect(list.reports.map((r) => r.id)).toEqual(
      expect.arrayContaining([p1.report.id, p2.report.id]),
    );
  });

  it('(f) tranh chấp: 2 lần báo chuyền kiểm / đóng gói cùng lúc không vượt trần', async () => {
    const world = await newLenh(4, { a: 4, b: 8 });
    const ckKey = `transfer-check:${world.itemIds[0]}:${pieceA}`;
    const out = await raceWith(
      h.prisma,
      [lockSql(ckKey)],
      [() => reportCk(world, pieceA, 3), () => reportCk(world, pieceA, 3)],
    );
    expectNoServerFault(out);
    const { loser } = oneWinner(out);
    expect(msg(loser.error)).toMatch(/vượt số còn kiểm được \(1\)/);

    // Cho qua chuyền kiểm 3 bộ rồi 2 người đóng 2 bộ cùng lúc.
    const open = await ck.listBatches({ status: 'AWAITING_KCS', itemId: itemOf(world) });
    await grade(open.batches[0].id, 3);
    await grade((await reportCk(world, pieceB, 6)).batch.id, 6);
    const pkOut = await raceWith(
      h.prisma,
      [lockSql(`packaging:${world.itemIds[0]}`)],
      [() => pack(world, 2), () => pack(world, 2)],
    );
    expectNoServerFault(pkOut);
    const pk = oneWinner(pkOut);
    expect(msg(pk.loser.error)).toMatch(/đã qua KCS chuyền kiểm/);
    expect(await sumPacked(world)).toBe(2);
  });
});
