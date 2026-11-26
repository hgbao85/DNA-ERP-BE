import * as crypto from 'crypto';
import { ClsService } from 'nestjs-cls';
import {
  BomRevisionStatus,
  BookingStatus,
  LocationMovementKind,
  MfgStage,
  WarehouseKind,
  WorkstationKind,
} from '../../src/generated/prisma/client';
import type { AuthenticatedUser } from '../../src/common/interfaces/jwt-payload.interface';
import { BookingShipmentsService } from '../../src/modules/bookings/booking-shipments.service';
import { BookingsService } from '../../src/modules/bookings/bookings.service';
import { CkDgQrService } from '../../src/modules/ck-dg-qr/ck-dg-qr.service';
import { BookingLoadService } from '../../src/modules/vi-tri-kho/booking-load.service';
import { ViTriKhoService } from '../../src/modules/vi-tri-kho/vi-tri-kho.service';
import {
  P1Harness,
  P1World,
  createHarness,
  expectNoServerFault,
  lockSql,
  msg,
  oneWinner,
  raceWith,
} from './p1-kcs.fixture';

/**
 * Vị trí kho Thành phẩm + soạn hàng theo booking + load từng cont (25/11/2026 - docs THIET-KE-VI-TRI-KHO-LOAD-CONT, V1-V9) trên
 * Postgres TEST thật:
 *  (a) tắt công tắc: API mới enabled false / 400, báo đóng gói không cần ô, xuất booking như cũ (không cần cont);
 *  (b) V1 khai ô 1 / hàng loạt (bỏ qua ô đã có);
 *  (c) V2 báo đóng gói = cất vào ô (cùng transaction), thiếu ô / ô khác kho bị chặn, trần đóng gói cũ giữ nguyên;
 *  (d) V3 nhắc trộn bộ 3 khác; V9 cùng SKU khác PO là 2 dòng tồn;
 *  (e) V4 chuyển ô + lịch sử + khoá gửi lại; tồn thùng theo bộ 3 + tổng + còn phải đóng; huỷ lần báo đã chuyển đi bị chặn;
 *  (f) V6 lấy hàng: sai vị trí / sai mã / vượt số còn lấy bị chặn; trả về ô;
 *  (g) V7 đóng cont: thiếu số cont / seal / ảnh / hàng bị chặn, đóng 2 lần 409; huỷ booking khi đã có hàng trong cont 409;
 *  (h) xuất booking đi đường cũ: còn cont mở / lệch số bị chặn, khớp thì shippedQty = hàng trong cont;
 *  (i) tranh chấp: 2 lần lấy cùng ô cùng lúc không âm tồn; 2 lần chuyển ô cùng lúc.
 */
describe('Vị trí kho Thành phẩm + load cont (integration, real Postgres)', () => {
  let h: P1Harness;
  let w: P1World;
  let ck: CkDgQrService;
  let vtk: ViTriKhoService;
  let load: BookingLoadService;
  let shipments: BookingShipmentsService;
  let bookings: BookingsService;
  let tp: { id: bigint; code: string };
  let tp2: { id: bigint; code: string };
  let rev: bigint;
  let piece: bigint;
  let dgToken: string;
  const wsIds: bigint[] = [];
  let dgWorker: AuthenticatedUser;
  let keeper: string;
  let customerId: bigint;
  let salesOrderId: bigint;
  const soiIds: bigint[] = [];
  const bookingIds: bigint[] = [];
  const prev = { ck: process.env.CK_DG_QR_ENABLED, vtk: process.env.VI_TRI_KHO_ENABLED };
  const PHOTO = 'https://res.cloudinary.com/demo/image/upload/cont.jpg';
  let seq = 0;
  const key = (tag: string) => `vtk-${tag}-${Date.now()}-${(seq += 1)}`;
  const setFlag = (on: boolean) => {
    process.env.VI_TRI_KHO_ENABLED = on ? 'true' : 'false';
  };

  beforeAll(async () => {
    h = await createHarness();
    ck = h.moduleRef.get(CkDgQrService, { strict: false });
    vtk = h.moduleRef.get(ViTriKhoService, { strict: false });
    load = h.moduleRef.get(BookingLoadService, { strict: false });
    shipments = h.moduleRef.get(BookingShipmentsService, { strict: false });
    bookings = h.moduleRef.get(BookingsService, { strict: false });
    w = new P1World(h, `vtk-${Date.now()}`);
    await w.init();
    const mkWh = async (tag: string) => {
      const r = await h.prisma.warehouse.create({
        data: { code: w.code(tag), name: `Kho ${tag}`, kind: WarehouseKind.THANH_PHAM },
        select: { id: true, code: true },
      });
      w.ids.warehouses.push(r.id);
      return r;
    };
    tp = await mkWh('TP');
    tp2 = await mkWh('TP2');
    // Định mức 1 mảnh, 1 / bộ - "đã qua chuyền kiểm" ghi thẳng TransferCheckResult.
    rev = (
      await h.prisma.bomRevision.create({
        data: { mfgProductId: w.mfgProductId, revNo: 88, status: BomRevisionStatus.DRAFT },
      })
    ).id;
    w.extraBomRevisionIds.push(rev);
    const pc = await h.prisma.piece.create({
      data: {
        mfgProductId: w.mfgProductId,
        code: w.code('VTK'),
        groupNumber: 1,
        pieceNumber: 950,
        name: 'Manh VTK',
      },
    });
    w.ids.pieces.push(pc.id);
    piece = pc.id;
    await h.prisma.bomPiece.create({
      data: { bomRevisionId: rev, pieceId: piece, qtyPerUnit: 1, needsHan: false, isWoven: true },
    });
    dgToken = crypto.randomBytes(12).toString('base64url');
    const ws = await h.prisma.workstation.create({
      data: {
        code: w.code('DG'),
        name: 'khu dong goi',
        stage: MfgStage.DONG_GOI,
        kind: WorkstationKind.PACKING,
        qrToken: dgToken,
        warehouseId: tp.id,
      },
    });
    wsIds.push(ws.id);
    const dgId = await w.makeUser('dg');
    await h.prisma.user.update({ where: { id: dgId }, data: { mfgRole: 'DONG_GOI' } });
    dgWorker = {
      id: dgId,
      username: 'dg',
      email: null,
      roles: [],
      permissions: [],
      mfgRole: 'DONG_GOI',
      warehouseScope: null,
    };
    keeper = w.admin;
    customerId = (await h.prisma.customer.create({ data: { name: w.code('KH') } })).id;
    salesOrderId = (
      await h.prisma.salesOrder.create({
        data: {
          code: w.code('SO'),
          orderCode: w.code('PO'),
          customerId,
          orderDate: new Date(),
        },
      })
    ).id;
  });

  afterAll(async () => {
    process.env.CK_DG_QR_ENABLED = prev.ck ?? 'false';
    process.env.VI_TRI_KHO_ENABLED = prev.vtk ?? 'false';
    if (h && w) {
      const p = h.prisma;
      const items = { in: w.ids.items };
      await p.locationStockMovement.deleteMany({ where: { productionInvoiceItemId: items } });
      await p.bookingContainerLine.deleteMany({ where: { productionInvoiceItemId: items } });
      await p.bookingContainer.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await p.auditLog.deleteMany({
        where: { tableName: 'bookings', recordId: { in: bookingIds.map(String) } },
      });
      await p.bookingLine.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await p.booking.deleteMany({ where: { id: { in: bookingIds } } });
      await p.reservedSlipCode.deleteMany({ where: { createdById: keeper } });
      await p.locationStock.deleteMany({ where: { productionInvoiceItemId: items } });
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
      await p.transferCheckResult.deleteMany({ where: { productionInvoiceItemId: items } });
      await p.warehouseLocation.deleteMany({ where: { warehouseId: { in: [tp.id, tp2.id] } } });
      await p.workstation.deleteMany({ where: { id: { in: wsIds } } });
      await p.notification.deleteMany({
        where: { entityType: 'BOOKING', entityId: { in: bookingIds.map(String) } },
      });
      // Dòng đơn trỏ tới SKU của world: gỡ liên kết dòng lệnh -> xoá dòng đơn / đơn trước khi world xoá SKU.
      await p.productionInvoiceItem.updateMany({
        where: { id: items },
        data: { salesOrderId: null, salesOrderItemId: null },
      });
      await p.salesOrderItem.deleteMany({ where: { id: { in: soiIds } } });
      await p.salesOrder.deleteMany({ where: { id: salesOrderId } });
      await p.customer.deleteMany({ where: { id: customerId } });
      await w.cleanup();
    }
    if (h) await h.close();
  });

  beforeEach(() => {
    process.env.CK_DG_QR_ENABLED = 'true';
    setFlag(true);
  });

  // ---------------------------------------------------------------------------------------------

  /** Lệnh mới của kho TP test, gắn 1 dòng PO mới (bộ 3 riêng); `passed` bộ đã qua chuyền kiểm. */
  const newLenh = async (qty: number, passed = qty) => {
    const soi = await h.prisma.salesOrderItem.create({
      data: { salesOrderId, mfgProductId: w.mfgProductId, totalQty: qty },
    });
    soiIds.push(soi.id);
    const world = await w.newInvoice({ quantities: [qty], bomRevisionIds: [rev] });
    const itemId = world.itemIds[0];
    await h.prisma.productionInvoiceItem.update({
      where: { id: itemId },
      data: { warehouseCode: tp.code, salesOrderId, salesOrderItemId: soi.id },
    });
    if (passed > 0) {
      await h.prisma.transferCheckResult.create({
        data: {
          productionInvoiceItemId: itemId,
          pieceId: piece,
          checkedQty: passed,
          checkedById: keeper,
        },
      });
    }
    return { itemId, soiId: soi.id, piId: world.piId };
  };
  type Lenh = Awaited<ReturnType<typeof newLenh>>;

  const pack = (l: Lenh, qty: number, locationId?: string, k = key('dg')) =>
    ck.reportPacking(
      dgToken,
      dgWorker,
      { itemId: l.itemId.toString(), qty, ...(locationId ? { locationId } : {}) },
      k,
    );

  const err = <T>(p: Promise<T>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );

  const stockAt = async (locationId: string, l: Lenh) =>
    (
      await h.prisma.locationStock.findFirst({
        where: { locationId: BigInt(locationId), productionInvoiceItemId: l.itemId },
      })
    )?.qty ?? 0;

  /** Ô theo mã ở kho TP test. */
  const locs = new Map<string, { id: string; qrToken: string }>();
  const loc = (code: string) => {
    const x = locs.get(code);
    if (!x) throw new Error(`chưa khai ô ${code}`);
    return x;
  };

  const newBooking = async (lines: { l: Lenh; qty: number }[]) => {
    const b = await h.prisma.booking.create({
      data: {
        bookingNo: w.code(`BK${(seq += 1)}`),
        customerId,
        pod: 'LA',
        warehouseCode: tp.code,
        status: BookingStatus.CONFIRMED,
        createdById: keeper,
        confirmedAt: new Date(),
        confirmedById: keeper,
        lines: {
          create: lines.map((x) => ({
            productionInvoiceItemId: x.l.itemId,
            salesOrderItemId: x.l.soiId,
            qty: x.qty,
          })),
        },
      },
      include: { lines: { orderBy: { id: 'asc' } } },
    });
    bookingIds.push(b.id);
    return b;
  };

  const ship = async (bookingId: bigint, lines: { lineId: string; qty: number }[]) => {
    const { code } = await shipments.reserveSlipCode(keeper);
    return shipments.ship(
      bookingId.toString(),
      { slipCode: code, signedSlipUrls: [PHOTO], lines },
      keeper,
      tp.code,
      key('ship'),
    );
  };

  // ---------------------------------------------------------------------------------------------

  it('(a) tắt công tắc: API mới không chạy, báo đóng gói không cần ô, xuất booking như cũ', async () => {
    setFlag(false);
    expect(vtk.getConfig()).toEqual({ enabled: false });
    await expect(vtk.listLocations(tp.code)).resolves.toEqual({ enabled: false });
    await expect(vtk.stockByTriple(tp.code)).resolves.toEqual({ enabled: false });
    expect(msg(await err(vtk.createLocation({ zone: 'Z', aisle: 1, slot: 1 }, tp.code)))).toMatch(
      /VI_TRI_KHO_ENABLED/,
    );
    const l = await newLenh(4);
    const r = await pack(l, 2);
    expect(r.report.locationCode).toBeNull();
    expect(
      await h.prisma.locationStock.count({ where: { productionInvoiceItemId: l.itemId } }),
    ).toBe(0);
    const ctx = await ck.scanContext(dgToken, dgWorker, l.itemId.toString());
    expect(ctx.enabled && ctx.requireLocation).toBe(false);
    // Xuất booking không cần cont (đường cũ y nguyên).
    const b = await newBooking([{ l, qty: 2 }]);
    const shipped = await ship(b.id, [{ lineId: b.lines[0].id.toString(), qty: 2 }]);
    expect(shipped.status).toBe(BookingStatus.SHIPPED);
    expect(
      msg(
        await err(
          load.pick(
            b.id.toString(),
            {
              containerId: '1',
              bookingLineId: b.lines[0].id.toString(),
              locationToken: 'x',
              qty: 1,
            },
            keeper,
            tp.code,
            key('p'),
          ),
        ),
      ),
    ).toMatch(/VI_TRI_KHO_ENABLED/);
  });

  it('(b) V1: khai ô hàng loạt (bỏ qua ô đã có), khai 1 ô trùng 409, tem ô kho khác bị chặn', async () => {
    const r = await vtk.bulkCreate(
      { zone: 'a', aisleFrom: 1, aisleTo: 2, slotFrom: 1, slotTo: 3 },
      tp.code,
    );
    expect(r.created.map((c) => c.code)).toEqual([
      'A-01-01',
      'A-01-02',
      'A-01-03',
      'A-02-01',
      'A-02-02',
      'A-02-03',
    ]);
    expect(r.skipped).toEqual([]);
    const again = await vtk.bulkCreate(
      { zone: 'A', aisleFrom: 1, aisleTo: 1, slotFrom: 3, slotTo: 4 },
      tp.code,
    );
    expect(again.created.map((c) => c.code)).toEqual(['A-01-04']);
    expect(again.skipped).toEqual(['A-01-03']);
    expect(msg(await err(vtk.createLocation({ zone: 'A', aisle: 1, slot: 1 }, tp.code)))).toMatch(
      /đã có/,
    );
    const other = await vtk.createLocation({ zone: 'B', aisle: 1, slot: 1 }, tp2.code);
    locs.set('TP2-B-01-01', { id: other.id, qrToken: other.qrToken });
    const list = await vtk.listLocations(tp.code);
    if (!list.enabled) throw new Error('unreachable');
    for (const x of list.locations) locs.set(x.code, { id: x.id, qrToken: x.qrToken });
    expect(list.locations).toHaveLength(7);
    // Tem ô quét ở kho khác: chặn.
    expect(msg(await err(vtk.lookupByToken(other.qrToken, tp.code)))).toMatch(/thuộc/);
  });

  it('(c)(d) V2 báo đóng gói = cất vào ô, chặn thiếu ô / ô khác kho, trần cũ giữ; V3 nhắc trộn; V9 khác PO là dòng riêng; ô còn hàng không tắt được', async () => {
    const l1 = await newLenh(10, 6);
    const ctx = await ck.scanContext(dgToken, dgWorker, l1.itemId.toString());
    expect(ctx.enabled && ctx.requireLocation).toBe(true);
    expect(msg(await err(pack(l1, 2)))).toMatch(/Quét tem vị trí kho/);
    expect(msg(await err(pack(l1, 2, loc('TP2-B-01-01').id)))).toMatch(
      /không thuộc kho Thành phẩm/,
    );

    const k1 = key('p1');
    const r1 = await pack(l1, 4, loc('A-01-01').id, k1);
    expect(r1.mixWarning).toBeNull();
    expect(r1.report.locationCode).toBe('A-01-01');
    expect(await stockAt(loc('A-01-01').id, l1)).toBe(4);
    // Gửi lại cùng khoá: không cất 2 lần.
    expect((await pack(l1, 4, loc('A-01-01').id, k1)).replay).toBe(true);
    expect(await stockAt(loc('A-01-01').id, l1)).toBe(4);
    const row = await h.prisma.locationStock.findFirstOrThrow({
      where: { locationId: BigInt(loc('A-01-01').id), productionInvoiceItemId: l1.itemId },
    });
    expect(row).toMatchObject({ mfgProductId: w.mfgProductId, salesOrderItemId: l1.soiId });
    const mv = await h.prisma.locationStockMovement.findFirstOrThrow({
      where: { packingReportId: BigInt(r1.report.id) },
    });
    expect(mv).toMatchObject({ kind: LocationMovementKind.PUTAWAY, qty: 4 });
    // Trần cũ: mới qua chuyền kiểm 6 bộ -> không đóng thêm 3; tồn ô không đổi.
    expect(msg(await err(pack(l1, 3, loc('A-01-01').id)))).toMatch(/đã qua KCS chuyền kiểm/);
    expect(await stockAt(loc('A-01-01').id, l1)).toBe(4);

    // V9: cùng SKU, khác PO -> bộ 3 khác; cất vào ô đang có l1 -> nhắc trộn (không chặn).
    const l2 = await newLenh(5);
    const scan = await vtk.floorScan(
      loc('A-01-01').qrToken,
      dgWorker,
      dgToken,
      l2.itemId.toString(),
    );
    if (!scan.enabled) throw new Error('unreachable');
    expect(scan.mixWarning).toMatch(/đang có hàng khác/);
    const r2 = await pack(l2, 3, loc('A-01-01').id);
    expect(r2.mixWarning).toMatch(/Ô A-01-01 đang có hàng khác: lệnh .* \(4 bộ\)/);
    expect(await stockAt(loc('A-01-01').id, l2)).toBe(3);
    expect(
      await h.prisma.locationStock.count({ where: { locationId: BigInt(loc('A-01-01').id) } }),
    ).toBe(2);
    // Ô vẫn còn l1 nên cất tiếp l2 vẫn nhắc; ô chỉ có đúng bộ 3 đang cất (hoặc trống) thì không nhắc.
    expect((await pack(l2, 1, loc('A-01-01').id)).mixWarning).toMatch(/đang có hàng khác/);
    const solo = await pack(l2, 1, loc('A-01-03').id);
    expect(solo.mixWarning).toBeNull();
    // Ô còn hàng không tắt được.
    expect(msg(await err(vtk.setActive(loc('A-01-01').id, false, tp.code)))).toMatch(/còn 8 bộ/);
  });

  it('(e) V4 chuyển ô + lịch sử + gửi lại; tồn thùng theo bộ 3; huỷ lần báo đã chuyển đi bị chặn', async () => {
    const l = await newLenh(6);
    const p1 = await pack(l, 5, loc('A-02-01').id);
    const k = key('mv');
    const mv = await vtk.move(
      {
        fromToken: loc('A-02-01').qrToken,
        toToken: loc('A-02-02').qrToken,
        itemId: l.itemId.toString(),
        qty: 3,
      },
      keeper,
      tp.code,
      k,
    );
    expect(mv.replay).toBe(false);
    const again = await vtk.move(
      {
        fromToken: loc('A-02-01').qrToken,
        toToken: loc('A-02-02').qrToken,
        itemId: l.itemId.toString(),
        qty: 3,
      },
      keeper,
      tp.code,
      k,
    );
    expect(again).toMatchObject({ replay: true, movementId: mv.movementId });
    expect(await stockAt(loc('A-02-01').id, l)).toBe(2);
    expect(await stockAt(loc('A-02-02').id, l)).toBe(3);
    expect(
      msg(
        await err(
          vtk.move(
            {
              fromToken: loc('A-02-01').qrToken,
              toToken: loc('A-02-02').qrToken,
              itemId: l.itemId.toString(),
              qty: 3,
            },
            keeper,
            tp.code,
            key('mv'),
          ),
        ),
      ),
    ).toMatch(/chỉ có 2 bộ/);
    // Chuyển sang kho khác / cùng ô: chặn.
    expect(
      msg(
        await err(
          vtk.move(
            {
              fromToken: loc('A-02-01').qrToken,
              toToken: loc('TP2-B-01-01').qrToken,
              itemId: l.itemId.toString(),
              qty: 1,
            },
            keeper,
            tp.code,
            key('mv'),
          ),
        ),
      ),
    ).toMatch(/khác kho/);
    const hist = await vtk.movements({ locationId: loc('A-02-02').id }, tp.code);
    if (!hist.enabled) throw new Error('unreachable');
    expect(hist.movements[0]).toMatchObject({
      kind: 'MOVE',
      fromCode: 'A-02-01',
      toCode: 'A-02-02',
      qty: 3,
    });

    // Tồn thùng: dòng của l = 5 ở 2 ô, còn phải đóng 1; dòng tổng cộng đúng.
    const st = await vtk.stockByTriple(tp.code);
    if (!st.enabled) throw new Error('unreachable');
    const r = st.rows.find((x) => x.itemId === l.itemId.toString())!;
    expect(r).toMatchObject({ inStockQty: 5, toPackQty: 1, unplacedQty: 0, loadingQty: 0 });
    expect(r.locations.map((x) => [x.code, x.qty])).toEqual([
      ['A-02-01', 2],
      ['A-02-02', 3],
    ]);
    expect(st.total.inStockQty).toBe(st.rows.reduce((s, x) => s + x.inStockQty, 0));
    expect(r).not.toHaveProperty('shippedQty');

    // Huỷ lần báo 5 bộ: ô A-02-01 chỉ còn 2 -> chặn, không trả số đóng gói.
    expect(
      msg(await err(ck.cancelPackingReport(p1.report.id, { reason: 'đếm nhầm' }, { id: keeper }))),
    ).toMatch(/chỉ còn 2 bộ/);
    expect(
      await h.prisma.packagingRecord.count({ where: { productionInvoiceItemId: l.itemId } }),
    ).toBe(1);
    // Chuyển về đủ rồi huỷ được: ô về 0, có vết PUTAWAY_CANCEL.
    await vtk.move(
      {
        fromToken: loc('A-02-02').qrToken,
        toToken: loc('A-02-01').qrToken,
        itemId: l.itemId.toString(),
        qty: 3,
      },
      keeper,
      tp.code,
      key('mv'),
    );
    await ck.cancelPackingReport(p1.report.id, { reason: 'đếm nhầm' }, { id: keeper });
    expect(await stockAt(loc('A-02-01').id, l)).toBe(0);
    expect(
      await h.prisma.locationStockMovement.count({
        where: { productionInvoiceItemId: l.itemId, kind: LocationMovementKind.PUTAWAY_CANCEL },
      }),
    ).toBe(1);
    // Ô trống mới tắt được.
    await vtk.setActive(loc('A-02-01').id, false, tp.code);
    expect(msg(await err(pack(l, 1, loc('A-02-01').id)))).toMatch(/đang tắt/);
    await vtk.setActive(loc('A-02-01').id, true, tp.code);
  });

  it('(f)(g)(h) V6 lấy hàng sai ô / sai mã bị chặn, V7 đóng cont, xuất booking = hàng trong cont', async () => {
    const la = await newLenh(8);
    const lb = await newLenh(8);
    await pack(la, 3, loc('A-01-02').id);
    await pack(la, 4, loc('A-01-04').id);
    await pack(lb, 5, loc('A-02-03').id);
    const b = await newBooking([
      { l: la, qty: 6 },
      { l: lb, qty: 2 },
    ]);
    const [lineA, lineB] = b.lines;
    const list = await load.pickList(b.id.toString(), tp.code);
    if (!list.enabled) throw new Error('unreachable');
    const a = list.lines.find((x) => x.lineId === lineA.id.toString())!;
    // Gợi ý theo mã ô: A-01-02 lấy 3, A-01-04 lấy 3.
    expect(a.locations.map((x) => [x.code, x.suggestedQty])).toEqual([
      ['A-01-02', 3],
      ['A-01-04', 3],
    ]);
    expect(a.shortQty).toBe(0);

    const c1 = await load.createContainer(
      b.id.toString(),
      { containerNo: 'mscu1234567' },
      keeper,
      tp.code,
    );
    expect(c1.containerNo).toBe('MSCU1234567');
    const pick = (over: Partial<Parameters<BookingLoadService['pick']>[1]>, k = key('pick')) =>
      load.pick(
        b.id.toString(),
        {
          containerId: c1.id,
          bookingLineId: lineA.id.toString(),
          locationToken: loc('A-01-02').qrToken,
          expectedLocationId: loc('A-01-02').id,
          qty: 3,
          ...over,
        },
        keeper,
        tp.code,
        k,
      );
    // Sai vị trí: dòng gợi ý A-01-02 mà quét A-01-04.
    expect(msg(await err(pick({ locationToken: loc('A-01-04').qrToken })))).toMatch(/Sai vị trí/);
    // Sai mã: ô A-02-03 chỉ có hàng của lb.
    expect(
      msg(
        await err(pick({ locationToken: loc('A-02-03').qrToken, expectedLocationId: undefined })),
      ),
    ).toMatch(/Sai mã/);
    // Ô kho khác.
    expect(
      msg(
        await err(
          pick({ locationToken: loc('TP2-B-01-01').qrToken, expectedLocationId: undefined }),
        ),
      ),
    ).toMatch(/không phải kho đang làm/);
    expect(msg(await err(pick({ qty: 7 })))).toMatch(/còn phải lấy 6 bộ/);
    // Không ghi gì sau các lần sai.
    expect(await stockAt(loc('A-01-02').id, la)).toBe(3);

    const kPick = key('pick');
    await pick({}, kPick);
    expect((await pick({}, kPick)).replay).toBe(true);
    expect(await stockAt(loc('A-01-02').id, la)).toBe(0);
    await pick({
      locationToken: loc('A-01-04').qrToken,
      expectedLocationId: loc('A-01-04').id,
      qty: 3,
    });
    expect(await stockAt(loc('A-01-04').id, la)).toBe(1);
    // Trả 1 về ô A-01-02 (lấy nhầm) rồi lấy lại.
    await load.unpick(
      c1.id,
      { bookingLineId: lineA.id.toString(), locationToken: loc('A-01-02').qrToken, qty: 1 },
      keeper,
      tp.code,
      key('un'),
    );
    expect(await stockAt(loc('A-01-02').id, la)).toBe(1);
    await pick({ qty: 1 });

    // Tồn thùng: phần đang load hiện riêng, không có cột đã xuất.
    const st = await vtk.stockByTriple(tp.code);
    if (!st.enabled) throw new Error('unreachable');
    expect(st.rows.find((x) => x.itemId === la.itemId.toString())).toMatchObject({
      inStockQty: 1,
      loadingQty: 6,
      unplacedQty: 0,
    });

    // Cont 2 cho lb.
    const c2 = await load.createContainer(b.id.toString(), {}, keeper, tp.code);
    await load.pick(
      b.id.toString(),
      {
        containerId: c2.id,
        bookingLineId: lineB.id.toString(),
        locationToken: loc('A-02-03').qrToken,
        qty: 2,
      },
      keeper,
      tp.code,
      key('pick'),
    );

    // Huỷ booking khi đã có hàng trong cont: chặn.
    const cls = h.moduleRef.get(ClsService, { strict: false });
    const asKeeper = <T>(fn: () => Promise<T>) =>
      cls.run(() => {
        cls.set('userId', keeper);
        return fn();
      });
    expect(
      msg(await err(asKeeper(() => bookings.cancel(b.id.toString(), { reason: 'thử huỷ' })))),
    ).toMatch(/trả hàng về ô/);

    // V7: thiếu seal + ảnh.
    expect(msg(await err(load.closeContainer(c1.id, keeper, tp.code)))).toMatch(
      /nhập số seal, chụp ít nhất 1 ảnh load cont/,
    );
    await load.updateContainer(c1.id, { sealNo: 's-1', photoUrls: [PHOTO] }, tp.code);
    // Xuất khi còn cont mở: chặn.
    expect(
      msg(
        await err(
          ship(b.id, [
            { lineId: lineA.id.toString(), qty: 6 },
            { lineId: lineB.id.toString(), qty: 2 },
          ]),
        ),
      ),
    ).toMatch(/chưa đóng/);
    const closed = await load.closeContainer(c1.id, keeper, tp.code);
    expect(closed).toMatchObject({ status: 'LOADED', sealNo: 'S-1', totalQty: 6 });
    expect(msg(await err(load.closeContainer(c1.id, keeper, tp.code)))).toMatch(/đã đóng rồi/);
    expect(msg(await err(pick({ qty: 1 })))).toMatch(/Cont đã đóng/);
    await load.updateContainer(
      c2.id,
      { containerNo: 'TGHU7654321', sealNo: 'S2', photoUrls: [PHOTO] },
      tp.code,
    );
    await load.closeContainer(c2.id, keeper, tp.code);

    // Lệch số với hàng trong cont: chặn, không ghi gì.
    expect(
      msg(
        await err(
          ship(b.id, [
            { lineId: lineA.id.toString(), qty: 5 },
            { lineId: lineB.id.toString(), qty: 2 },
          ]),
        ),
      ),
    ).toMatch(/đã đóng cont 6 bộ, đang xuất 5 bộ/);
    const done = await ship(b.id, [
      { lineId: lineA.id.toString(), qty: 6 },
      { lineId: lineB.id.toString(), qty: 2 },
    ]);
    expect(done.status).toBe(BookingStatus.SHIPPED);
    const lines = await h.prisma.bookingLine.findMany({
      where: { bookingId: b.id },
      orderBy: { id: 'asc' },
    });
    expect(lines.map((x) => x.shippedQty)).toEqual([6, 2]);
    expect(
      (await h.prisma.salesOrderItem.findUniqueOrThrow({ where: { id: la.soiId } })).shippedQty,
    ).toBe(6);
    // Sau khi xuất: tồn thùng không còn phần đang load, hàng đã xuất không hiện cột riêng.
    const after = await vtk.stockByTriple(tp.code);
    if (!after.enabled) throw new Error('unreachable');
    expect(after.rows.find((x) => x.itemId === la.itemId.toString())).toMatchObject({
      inStockQty: 1,
      loadingQty: 0,
      unplacedQty: 0,
      toPackQty: 1,
    });
    // Booking đã xuất: không mở lại cont / lấy thêm.
    expect(msg(await err(load.reopenContainer(c1.id, tp.code)))).toMatch(/đã xuất/);
  });

  it('(i) tranh chấp: 2 lần lấy cùng ô cùng lúc không âm tồn; 2 lần chuyển ô cùng lúc', async () => {
    const l = await newLenh(6);
    await pack(l, 3, loc('A-01-03').id);
    const b = await newBooking([{ l, qty: 6 }]);
    const c = await load.createContainer(b.id.toString(), {}, keeper, tp.code);
    const pickOnce = () =>
      load.pick(
        b.id.toString(),
        {
          containerId: c.id,
          bookingLineId: b.lines[0].id.toString(),
          locationToken: loc('A-01-03').qrToken,
          qty: 2,
        },
        keeper,
        tp.code,
        key('race'),
      );
    const out = await raceWith(h.prisma, [lockSql(`vtk-triple:${l.itemId}`)], [pickOnce, pickOnce]);
    expectNoServerFault(out);
    const { loser } = oneWinner(out);
    expect(msg(loser.error)).toMatch(/chỉ có 1 bộ/);
    expect(await stockAt(loc('A-01-03').id, l)).toBe(1);
    expect(
      (
        await h.prisma.bookingContainerLine.findFirstOrThrow({
          where: { containerId: BigInt(c.id) },
        })
      ).qty,
    ).toBe(2);

    await pack(l, 3, loc('A-01-03').id);
    const moveOnce = () =>
      vtk.move(
        {
          fromToken: loc('A-01-03').qrToken,
          toToken: loc('A-02-02').qrToken,
          itemId: l.itemId.toString(),
          qty: 3,
        },
        keeper,
        tp.code,
        key('race-mv'),
      );
    const mvOut = await raceWith(
      h.prisma,
      [lockSql(`vtk-loc:${loc('A-01-03').id}`)],
      [moveOnce, moveOnce],
    );
    expectNoServerFault(mvOut);
    expect(msg(oneWinner(mvOut).loser.error)).toMatch(/chỉ có 1 bộ/);
    expect(await stockAt(loc('A-01-03').id, l)).toBe(1);
    expect(await stockAt(loc('A-02-02').id, l)).toBe(3);
  });
});
