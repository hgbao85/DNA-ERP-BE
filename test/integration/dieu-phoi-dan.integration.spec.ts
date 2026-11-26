import { ProdItemStageType, WeavingFollowUpPromiseStatus } from '../../src/generated/prisma/client';
import { vnDayKey } from '../../src/common/utils/floor-stats.util';
import { WeavingCoordinationService } from '../../src/modules/weaving-coordination/weaving-coordination.service';
import { WeavingFollowUpReminderService } from '../../src/modules/weaving-coordination/weaving-follow-up-reminder.service';
import { WeavingIssuesService } from '../../src/modules/weaving-issues/weaving-issues.service';
import { WeavingPointsService } from '../../src/modules/weaving-points/weaving-points.service';
import { P1Harness, P1World, World, createHarness, httpStatus, msg } from './p1-kcs.fixture';

/**
 * Điều phối đan (25/11/2026 - docs THIET-KE-DIEU-PHOI-DAN-2026-11-25, chốt Đ1-Đ4) trên Postgres TEST thật:
 *  (a) Đ1 bảng theo dõi: đã gửi (weaving_issues) / đã trả (nhập đan thật qua WeavingIssuesService.receive) / còn giữ / hạn = mốc
 *      "Nhập đan" của dòng PI / trạng thái + ô tổng; lọc theo điểm đan, trạng thái;
 *  (b) Đ2 ghi chú: nội dung bắt buộc, số hẹn > 0 và ≤ đang giữ, ngày không trước hôm nay, lời hẹn mới thay lời hẹn cũ;
 *  (c) nhắc: tới ngày hẹn chưa về đủ -> 1 tin cho người ghi, về đủ (kể từ lúc hẹn) -> đóng;
 *  (d) Đ3 điểm đan: bật công tắc chỉ Admin / Điều phối đan sửa; trùng tên không phân biệt hoa thường; không ngừng điểm đan còn giữ;
 *  (e) tắt công tắc: API mới trả enabled false / 400, quyền điểm đan như cũ.
 */
describe('Điều phối đan (integration, real Postgres)', () => {
  let h: P1Harness;
  let w: P1World;
  let coord: WeavingCoordinationService;
  let reminder: WeavingFollowUpReminderService;
  let weaving: WeavingIssuesService;
  let points: WeavingPointsService;
  let world: World;
  let coordinatorId: string;
  let pointA: bigint;
  let pointB: bigint;
  const createdPointIds: bigint[] = [];
  const prevFlag = process.env.DIEU_PHOI_DAN_ENABLED;
  let keySeq = 0;
  const key = (tag: string) => `dpd-${tag}-${Date.now()}-${(keySeq += 1)}`;

  const NOW = new Date('2026-11-25T03:00:00.000Z'); // 10:00 giờ VN
  const TODAY = vnDayKey(NOW);
  const setFlag = (on: boolean) => {
    process.env.DIEU_PHOI_DAN_ENABLED = on ? 'true' : 'false';
  };
  const coordinatorActor = () => ({ roles: ['WEAVING_COORDINATOR'], warehouseScope: null });
  const phuKienActor = { roles: ['WAREHOUSE_STAFF'], warehouseScope: 'vat-tu-tp' };

  const err = <T>(p: Promise<T>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );

  const issue = (orderId: bigint, pieceId: bigint, pointId: bigint, qty: number) =>
    h.prisma.weavingIssue.create({
      data: {
        productionOrderId: orderId,
        pieceId,
        weavingPointId: pointId,
        qty,
        issuedById: w.admin,
        idempotencyKey: key('iss'),
      },
    });

  const receive = (orderId: bigint, pieceId: bigint, pointId: bigint, qty: number) =>
    weaving.receive(
      orderId.toString(),
      { pieceId: pieceId.toString(), weavingPointId: pointId.toString(), qty },
      w.admin,
      null,
      key('rcv'),
    );

  const rowOf = async (pointId: bigint, orderId: bigint, pieceId: bigint, status?: 'DONE') => {
    const board = await coord.getBoard({ weavingPointId: pointId.toString(), status }, NOW);
    return board.rows.find((r) => r.key === `${pointId}:${orderId}:${pieceId}`);
  };

  beforeAll(async () => {
    h = await createHarness();
    coord = h.moduleRef.get(WeavingCoordinationService, { strict: false });
    reminder = h.moduleRef.get(WeavingFollowUpReminderService, { strict: false });
    weaving = h.moduleRef.get(WeavingIssuesService, { strict: false });
    points = h.moduleRef.get(WeavingPointsService, { strict: false });
    w = new P1World(h, `dpd-${Date.now()}`);
    await w.init();
    coordinatorId = await w.makeUser('dpd', { roles: ['WEAVING_COORDINATOR'] });
    pointA = (
      await h.prisma.weavingPoint.create({
        data: { code: w.code('DANA'), fullName: `Diem dan A ${w.sfx}` },
      })
    ).id;
    pointB = (
      await h.prisma.weavingPoint.create({
        data: { code: w.code('DANB'), fullName: `Diem dan B ${w.sfx}` },
      })
    ).id;
    createdPointIds.push(pointA, pointB);
    // 2 dòng PI: dòng 0 có mốc Nhập đan (hôm qua -> trễ), dòng 1 chưa đặt mốc.
    world = await w.newInvoice({ quantities: [20, 20] });
    await h.prisma.productionInvoiceItemStage.create({
      data: {
        productionInvoiceItemId: world.itemIds[0],
        stageType: ProdItemStageType.WEAVING,
        deadline: new Date('2026-11-24T05:00:00.000Z'),
      },
    });
  });

  afterAll(async () => {
    if (prevFlag === undefined) delete process.env.DIEU_PHOI_DAN_ENABLED;
    else process.env.DIEU_PHOI_DAN_ENABLED = prevFlag;
    if (h && w) {
      const p = h.prisma;
      const orderIn = { in: w.ids.orders };
      const fu = await p.weavingFollowUp.findMany({
        where: { productionOrderId: orderIn },
        select: { id: true },
      });
      await p.notification.deleteMany({
        where: {
          entityType: 'WEAVING_FOLLOW_UP',
          entityId: { in: fu.map((f) => f.id.toString()) },
        },
      });
      await p.weavingFollowUp.deleteMany({ where: { productionOrderId: orderIn } });
      await p.weavingReceipt.deleteMany({ where: { productionOrderId: orderIn } });
      await p.weavingIssue.deleteMany({ where: { productionOrderId: orderIn } });
      await p.notification.deleteMany({
        where: {
          entityType: 'WEAVING_ALLOCATION',
          entityId: { startsWith: `${world.orderIds[0]}:` },
        },
      });
      await p.productionInvoiceItemStage.deleteMany({
        where: { productionInvoiceItemId: { in: w.ids.items } },
      });
      await p.weavingPoint.deleteMany({ where: { id: { in: createdPointIds } } });
      await w.cleanup();
    }
    if (h) await h.close();
  });

  beforeEach(() => setFlag(true));

  // ---------------------------------------------------------------------------------------------

  it('(e) tắt công tắc: bảng / ghi chú trả enabled false, ghi chú mới 400, nhắc không làm gì', async () => {
    setFlag(false);
    expect(coord.getConfig()).toEqual({ enabled: false });
    const board = await coord.getBoard({}, NOW);
    expect(board).toMatchObject({ enabled: false, rows: [] });
    expect(await coord.listFollowUps({})).toEqual({ enabled: false, items: [] });
    const e = await err(
      coord.createFollowUp(
        {
          weavingPointId: pointA.toString(),
          productionOrderId: world.orderIds[0].toString(),
          pieceId: w.pieceHan.toString(),
          content: 'x',
        },
        coordinatorId,
        NOW,
      ),
    );
    expect(httpStatus(e)).toBe(400);
    expect(await reminder.syncAll(NOW)).toEqual({ reminded: 0, closed: 0 });
  });

  it('(a) Đ1: số đã gửi / đã trả / còn giữ / hạn / trạng thái + ô tổng + lọc', async () => {
    const [o0, o1] = world.orderIds;
    await issue(o0, w.pieceHan, pointA, 10);
    await issue(o0, w.pieceHan, pointA, 5);
    await receive(o0, w.pieceHan, pointA, 4);
    await issue(o1, w.pieceHan, pointA, 6);
    await issue(o0, w.piecePhoi, pointB, 3);
    await receive(o0, w.piecePhoi, pointB, 3);

    const late = await rowOf(pointA, o0, w.pieceHan);
    expect(late).toMatchObject({
      sent: 15,
      returned: 4,
      held: 11,
      dueDate: '2026-11-24',
      daysLeft: -1,
      status: 'LATE',
      latestPromise: null,
    });
    expect(await rowOf(pointA, o1, w.pieceHan)).toMatchObject({
      held: 6,
      dueDate: null,
      status: 'NO_DEADLINE',
    });
    // Đã trả đủ: không hiện mặc định, hiện khi lọc DONE.
    expect(await rowOf(pointB, o0, w.piecePhoi)).toBeUndefined();
    expect(await rowOf(pointB, o0, w.piecePhoi, 'DONE')).toMatchObject({ held: 0, status: 'DONE' });

    const board = await coord.getBoard({ weavingPointId: pointA.toString() }, NOW);
    expect(board.rows.map((r) => r.status)).toEqual(['LATE', 'NO_DEADLINE']);
    const pa = board.points.find((p) => p.id === pointA.toString());
    expect(pa).toMatchObject({ held: 17, openRows: 2, lateRows: 1 });
    expect(board.points.find((p) => p.id === pointB.toString())).toMatchObject({ held: 0 });
    // Ô tổng tính trên mọi điểm đan (DB test có thể có dữ liệu khác) - tối thiểu phần của test này.
    expect(board.tiles.piecesOut).toBeGreaterThanOrEqual(17);
    expect(board.tiles.overdueRows).toBeGreaterThanOrEqual(1);
    const lateOnly = await coord.getBoard(
      { weavingPointId: pointA.toString(), status: 'LATE' },
      NOW,
    );
    expect(lateOnly.rows).toHaveLength(1);
  });

  it('(b) Đ2: kiểm ghi chú - nội dung, chưa nhận, số hẹn ≤ đang giữ, ngày hẹn', async () => {
    const o0 = world.orderIds[0];
    const base = {
      weavingPointId: pointA.toString(),
      productionOrderId: o0.toString(),
      pieceId: w.pieceHan.toString(),
    };
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ ...base, content: '   ' }, /Nội dung/],
      [{ ...base, pieceId: w.pieceCut.toString(), content: 'x' }, /chưa nhận/],
      [
        { ...base, content: 'x', promisedQty: 12, promisedDate: TODAY },
        /vượt số điểm đan đang giữ \(11\)/,
      ],
      [{ ...base, content: 'x', promisedQty: 2 }, /cả số mảnh và ngày/],
      [{ ...base, content: 'x', promisedQty: 2, promisedDate: '2026-11-20' }, /trước hôm nay/],
    ];
    for (const [dto, re] of cases) {
      const e = await err(coord.createFollowUp(dto as never, coordinatorId, NOW));
      expect(httpStatus(e)).toBe(400);
      expect(msg(e)).toMatch(re);
    }
    expect(await h.prisma.weavingFollowUp.count({ where: { productionOrderId: o0 } })).toBe(0);

    const note = await coord.createFollowUp(
      { ...base, content: 'Gọi chị Lan, chưa nghe máy' },
      coordinatorId,
      NOW,
    );
    expect(note).toMatchObject({
      promiseStatus: 'NONE',
      promisedQty: null,
      heldAtCreate: 11,
      returnedAtCreate: 4,
    });
    expect(note.createdByName).toContain('P1');
  });

  it('(b)(c) lời hẹn: hiện trên bảng, hẹn mới thay hẹn cũ, tới ngày chưa đủ -> nhắc 1 lần, về đủ -> đóng', async () => {
    const o0 = world.orderIds[0];
    const base = {
      weavingPointId: pointA.toString(),
      productionOrderId: o0.toString(),
      pieceId: w.pieceHan.toString(),
    };
    const first = await coord.createFollowUp(
      { ...base, content: 'Hẹn thứ 6 trả 8', promisedQty: 8, promisedDate: '2026-11-28' },
      coordinatorId,
      NOW,
    );
    const second = await coord.createFollowUp(
      { ...base, content: 'Đổi: hôm nay trả 5', promisedQty: 5, promisedDate: TODAY },
      coordinatorId,
      NOW,
    );
    const old = await h.prisma.weavingFollowUp.findUniqueOrThrow({
      where: { id: BigInt(first.id) },
    });
    expect(old.promiseStatus).toBe(WeavingFollowUpPromiseStatus.SUPERSEDED);
    expect((await rowOf(pointA, o0, w.pieceHan))?.latestPromise).toMatchObject({
      followUpId: second.id,
      promisedQty: 5,
      promisedDate: TODAY,
      status: 'OPEN',
      returnedSince: 0,
    });
    const board = await coord.getBoard({}, NOW);
    expect(board.tiles.promisesDueToday).toBeGreaterThanOrEqual(1);
    const list = await coord.listFollowUps({ weavingPointId: pointA.toString() });
    expect(list.items.map((i) => i.id).slice(0, 3)).toEqual([
      second.id,
      first.id,
      expect.any(String),
    ]);

    // Hôm qua: chưa tới ngày hẹn -> không nhắc.
    h.clearEmits();
    await reminder.syncAll(new Date('2026-11-24T03:00:00.000Z'));
    expect(h.emitCalls().filter((c) => c.type === 'WEAVING_PROMISE_DUE')).toHaveLength(0);

    // Về 3 (< 5) rồi tới ngày hẹn -> nhắc đúng người ghi, 1 lần.
    await receive(o0, w.pieceHan, pointA, 3);
    await reminder.syncAll(NOW);
    await reminder.syncAll(NOW);
    const calls = h.emitCalls().filter((c) => c.type === 'WEAVING_PROMISE_DUE');
    expect(calls).toHaveLength(1);
    expect(calls[0].options).toMatchObject({
      entityId: second.id,
      params: { promisedQty: 5, returnedSince: 3, heldQty: 8, createdById: coordinatorId },
    });
    const reminded = await h.prisma.weavingFollowUp.findUniqueOrThrow({
      where: { id: BigInt(second.id) },
    });
    expect(reminded.promiseStatus).toBe(WeavingFollowUpPromiseStatus.REMINDED);
    expect(reminded.remindedAt).not.toBeNull();

    // Về thêm 2 -> đủ 5 kể từ lúc hẹn -> đóng (KEPT).
    await receive(o0, w.pieceHan, pointA, 2);
    expect(await reminder.syncAll(NOW)).toMatchObject({ closed: 1 });
    const kept = await h.prisma.weavingFollowUp.findUniqueOrThrow({
      where: { id: BigInt(second.id) },
    });
    expect(kept.promiseStatus).toBe(WeavingFollowUpPromiseStatus.KEPT);
    expect(kept.closedAt).not.toBeNull();
    expect((await rowOf(pointA, o0, w.pieceHan))?.held).toBe(6);
  });

  it('(d) Đ3: bật công tắc chỉ Admin / Điều phối đan sửa; tắt thì như cũ (kho Phụ kiện)', async () => {
    setFlag(false);
    const created = await points.create({ code: w.code('DANC') }, phuKienActor);
    createdPointIds.push(BigInt(created.id));
    expect(httpStatus(await err(points.create({ code: w.code('DAND') }, coordinatorActor())))).toBe(
      403,
    );

    setFlag(true);
    expect(httpStatus(await err(points.update(created.id, { phone: '0900' }, phuKienActor)))).toBe(
      403,
    );
    expect(httpStatus(await err(points.remove(created.id, phuKienActor)))).toBe(403);
    const updated = await points.update(
      created.id,
      { contactPerson: 'Anh Tư', phone: '0900', address: 'Phước An' },
      coordinatorActor(),
    );
    expect(updated).toMatchObject({ contactPerson: 'Anh Tư', phone: '0900', address: 'Phước An' });
  });

  it('(d) Đ3: trùng tên (không phân biệt hoa thường) bị chặn khi bật', async () => {
    const nameA = `Diem dan A ${w.sfx}`;
    const e = await err(
      points.create({ code: w.code('DANE'), fullName: nameA.toUpperCase() }, coordinatorActor()),
    );
    expect(httpStatus(e)).toBe(409);
    expect(msg(e)).toMatch(/Trùng tên/);
    const codeA = (await h.prisma.weavingPoint.findUniqueOrThrow({ where: { id: pointA } })).code;
    expect(
      httpStatus(await err(points.create({ code: codeA.toLowerCase() }, coordinatorActor()))),
    ).toBe(409);
    expect(
      httpStatus(
        await err(
          points.update(pointB.toString(), { fullName: nameA.toLowerCase() }, coordinatorActor()),
        ),
      ),
    ).toBe(409);
  });

  it('(d) Đ3: không ngừng được điểm đan còn giữ hàng; hết giữ thì ngừng được; tắt công tắc thì như cũ', async () => {
    const e = await err(points.update(pointA.toString(), { isActive: false }, coordinatorActor()));
    expect(httpStatus(e)).toBe(409);
    expect(msg(e)).toMatch(/còn giữ 12 mảnh/);
    expect(
      (await h.prisma.weavingPoint.findUniqueOrThrow({ where: { id: pointA } })).isActive,
    ).toBe(true);
    // Điểm B đã trả đủ -> ngừng được.
    const b = await points.update(pointB.toString(), { isActive: false }, coordinatorActor());
    expect(b.isActive).toBe(false);
    // Tắt công tắc: Admin ngừng điểm A vẫn được như cũ (không kiểm còn giữ).
    setFlag(false);
    const a = await points.update(
      pointA.toString(),
      { isActive: false },
      { roles: ['ADMIN'], warehouseScope: null },
    );
    expect(a.isActive).toBe(false);
  });
});
