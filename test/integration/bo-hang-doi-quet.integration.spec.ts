import {
  CutBundleStatus,
  MfgRole,
  MfgStage,
  ProductionBatchStatus,
  ProductionOrderFloorStage,
} from '../../src/generated/prisma/client';
import { BUSINESS_ROLES } from '../../src/common/constants/roles.constant';
import { BhdCtx, QTY, StagePi, createBhdCtx, dataOf } from './bo-hang-doi.fixture';

/**
 * Bỏ hàng đợi xưởng (23/11/2026) - màn quét Hàn / Sơn qua HTTP thật, DB test thật. Contract: thiết kế D2 + D5.
 *  AC1  Phôi đạt KCS + SKU ACTIVE -> Hàn thấy lệnh (không cần QLSX xếp)
 *  AC2  Phôi chỉ đợt mở / chờ chấm / chấm lỗi hết -> không thấy, báo -> 409 đúng câu D5
 *  AC3  xưởng khác -> không thấy, báo -> 409
 *  AC4  nhiều lệnh theo hạn giao tăng dần; runningPi null, reworkPis []
 *  AC5  SKU tạm dừng / kết thúc / chưa bắt đầu, lệnh DONE -> không thấy
 *  AC6  báo đủ -> ẩn; KCS chấm lỗi -> hiện lại, báo tối đa phần thiếu
 *  AC7  Sơn: khung Hàn đạt KCS; chưa có -> không thấy
 *  AC8  Sơn theo nơi sơn (chốt 23/11: Phước An sơn ở Phú An)
 *  AC9  lệnh Hàn đã từng báo (không có Phôi đạt) vẫn hiện
 *  AC34 đổi xưởng: không queueMoves, lệnh sang xưởng mới
 * Phôi: stagePis = [] (AC11 phần Phôi giữ allocationPis).
 */
const MSG_409_HAN =
  'Lệnh này chưa làm được ở tổ Hàn của xưởng này (chưa có mảnh Phôi đạt KCS, hoặc đã đủ số / đã kết thúc). Tải lại màn để xem lệnh làm được.';
const MSG_409_SON =
  'Lệnh này chưa làm được ở tổ Sơn của xưởng này (chưa có khung Hàn đạt KCS, hoặc đã đủ số / đã kết thúc). Tải lại màn để xem lệnh làm được.';

describe('Bỏ hàng đợi: màn quét Hàn / Sơn (integration + HTTP, DB test thật)', () => {
  let c: BhdCtx;
  let seq = 0;

  beforeAll(async () => {
    c = await createBhdCtx('quet');
    await c.addUser('hanWorker', BUSINESS_ROLES.FLOOR_WORKER, MfgRole.HAN);
    await c.addUser('sonWorker', BUSINESS_ROLES.FLOOR_WORKER, MfgRole.SON);
    await c.addUser('phoiWorker', BUSINESS_ROLES.FLOOR_WORKER, MfgRole.PHOI);
  }, 120_000);

  afterAll(async () => {
    if (c) await c.cleanup();
  });

  /** Xưởng riêng mỗi ca: máy Hàn + máy Sơn + máy mảnh Phôi. */
  async function shop(tag: string) {
    seq += 1;
    const ws = await c.w.makeWorkshop(`${tag}${seq}`);
    return {
      ws,
      han: await c.makeStation(ws.id, MfgStage.HAN),
      son: await c.makeStation(ws.id, MfgStage.SON),
      phoi: await c.makeStation(ws.id, MfgStage.PHOI),
    };
  }

  const stagePis = async (who: 'hanWorker' | 'sonWorker' | 'phoiWorker', token: string) => {
    const res = await c.call(who, 'get', `/floor/scan/${token}`).expect(200);
    const data = dataOf<{
      stagePis: StagePi[];
      runningPi: unknown;
      reworkPis: unknown[];
    }>(res);
    return data;
  };
  const codesOf = (pis: StagePi[]) => pis.map((p) => p.code);

  const reportHan = (
    token: string,
    world: { piId: bigint; orderIds: bigint[] },
    qty = 1,
    pieceId = c.w.pieceHan,
  ) =>
    c.call(
      'hanWorker',
      'post',
      `/floor/scan/${token}/reports`,
      {
        productionInvoiceId: world.piId.toString(),
        productionOrderId: world.orderIds[0].toString(),
        pieceId: pieceId.toString(),
        qty,
      },
      { 'Idempotency-Key': `bhd-${Date.now()}-${Math.random()}` },
    );

  // ===================================================================================
  it('AC1: lệnh có Phôi đạt KCS + SKU ACTIVE -> Hàn thấy (đủ trường D5, missingPieces = số mảnh Hàn còn thiếu); runningPi null, reworkPis []', async () => {
    const s = await shop('A1');
    const deadline = new Date('2026-12-15T00:00:00.000Z');
    const l = await c.newPi(s.ws.id, { deadline });
    await c.seedPhoiPass(l, 6);

    const data = await stagePis('hanWorker', s.han.token);
    expect(data.runningPi).toBeNull();
    expect(data.reworkPis).toEqual([]);
    expect(data.stagePis).toHaveLength(1);
    expect(data.stagePis[0]).toMatchObject({
      productionInvoiceId: l.piId.toString(),
      code: l.code,
      deadline: deadline.toISOString(),
      missingPieces: QTY * 2, // pieceHan + pieceHan4, mỗi mảnh cần QTY, chưa báo gì
    });
    // báo vào lệnh này được (không cần ai xếp)
    await reportHan(s.han.token, l, 1).expect(201);
  });

  it('AC2: Phôi chỉ có đợt đang mở / chờ chấm / chấm lỗi hết (đạt 0) -> không hiện; báo vào lệnh đó 409 đúng câu D5', async () => {
    const s = await shop('A2');
    const open = await c.newPi(s.ws.id);
    const awaiting = await c.newPi(s.ws.id);
    const allFailed = await c.newPi(s.ws.id);
    const mk = async (
      world: typeof open,
      status: CutBundleStatus,
    ): Promise<{ bundleId: bigint; issueId: bigint }> => {
      const issueId = await c.w.newIssue(world.piId);
      const { bundleId } = await c.w.seedCutBundle(issueId, world, {
        segs: [{ specId: c.w.spec441, qty: 6 }],
        status,
        withReport: false,
      });
      return { bundleId, issueId };
    };
    await mk(open, CutBundleStatus.CUTTING);
    await mk(awaiting, CutBundleStatus.AWAITING_QC);
    const failed = await mk(allFailed, CutBundleStatus.QC_PASSED);
    await c.prisma.qcReview.create({
      data: {
        steelIssueId: failed.issueId,
        cutBundleId: failed.bundleId,
        failedQty: 6,
        reviewedById: c.w.kcsA,
        segments: { create: [{ segmentSpecId: c.w.spec441, failedQty: 6 }] },
      },
    });

    const data = await stagePis('hanWorker', s.han.token);
    expect(codesOf(data.stagePis)).toEqual([]);
    for (const world of [open, awaiting, allFailed]) {
      const res = await reportHan(s.han.token, world, 1).expect(409);
      expect(JSON.stringify(res.body)).toContain(MSG_409_HAN);
      expect(JSON.stringify(res.body)).not.toContain('Chuyển PI tiếp');
    }
    // ghi chú: chưa có lô Hàn nào được tạo cho các lệnh bị chặn
    expect(
      await c.prisma.productionBatch.count({
        where: {
          productionOrderId: { in: [open, awaiting, allFailed].flatMap((x) => x.orderIds) },
        },
      }),
    ).toBe(0);
  });

  it('AC3: lệnh của xưởng B có Phôi đạt: máy Hàn xưởng A không thấy, báo -> 409; máy Hàn xưởng B thấy', async () => {
    const a = await shop('A3');
    const b = await shop('B3');
    const n = await c.newPi(b.ws.id);
    await c.seedPhoiPass(n);

    expect(codesOf((await stagePis('hanWorker', a.han.token)).stagePis)).toEqual([]);
    const res = await reportHan(a.han.token, n, 1).expect(409);
    expect(JSON.stringify(res.body)).toContain(MSG_409_HAN);
    expect(codesOf((await stagePis('hanWorker', b.han.token)).stagePis)).toEqual([n.code]);
  });

  it('AC4: 3 lệnh làm được -> hiện đủ 3 theo hạn giao tăng dần; 1 lệnh thì chỉ 1 phần tử', async () => {
    const s = await shop('A4');
    const late = await c.newPi(s.ws.id, { deadline: new Date('2026-12-30T00:00:00.000Z') });
    const early = await c.newPi(s.ws.id, { deadline: new Date('2026-12-01T00:00:00.000Z') });
    const mid = await c.newPi(s.ws.id, { deadline: new Date('2026-12-10T00:00:00.000Z') });
    for (const w of [late, early, mid]) await c.seedPhoiPass(w);

    const data = await stagePis('hanWorker', s.han.token);
    expect(codesOf(data.stagePis)).toEqual([early.code, mid.code, late.code]);
    expect(data.runningPi).toBeNull();
    expect(data.reworkPis).toEqual([]);

    // cùng hạn giao: theo mã lệnh tăng dần
    const t = await shop('A4b');
    const x = await c.newPi(t.ws.id, { deadline: new Date('2026-12-05T00:00:00.000Z') });
    const y = await c.newPi(t.ws.id, { deadline: new Date('2026-12-05T00:00:00.000Z') });
    await c.seedPhoiPass(x);
    await c.seedPhoiPass(y);
    const same = await stagePis('hanWorker', t.han.token);
    expect(codesOf(same.stagePis)).toEqual([x.code, y.code].sort());
  });

  it('AC5: SKU tạm dừng / kết thúc / chưa bắt đầu, lệnh DONE -> không hiện, báo 409; chỉ cần 1 SKU ACTIVE là hiện', async () => {
    const s = await shop('A5');
    const paused = await c.newPi(s.ws.id, { floorStage: ProductionOrderFloorStage.PAUSED });
    const finished = await c.newPi(s.ws.id, { floorStage: ProductionOrderFloorStage.FINISHED });
    const pending = await c.newPi(s.ws.id, { floorStage: ProductionOrderFloorStage.PENDING });
    const done = await c.newPi(s.ws.id);
    const ok = await c.newPi(s.ws.id);
    for (const w of [paused, finished, pending, done, ok]) await c.seedPhoiPass(w);
    await c.prisma.productionInvoice.update({ where: { id: done.piId }, data: { status: 'DONE' } });

    const data = await stagePis('hanWorker', s.han.token);
    expect(codesOf(data.stagePis)).toEqual([ok.code]);
    for (const w of [paused, finished, pending, done]) {
      await reportHan(s.han.token, w, 1).expect(409);
    }
  });

  it('AC6 (Q3-A): báo đủ số -> lệnh ẩn; KCS chấm lỗi 2 mảnh -> lệnh hiện lại, còn thiếu 2, báo 3 bị chặn, báo 2 được', async () => {
    const s = await shop('A6');
    const l = await c.newPi(s.ws.id);
    await c.seedPhoiPass(l);
    const [batchHan] = await c.seedHanPass(l, { qty: QTY, both: true }); // 2 mảnh Hàn đạt đủ số
    expect(codesOf((await stagePis('hanWorker', s.han.token)).stagePis)).toEqual([]); // đủ số: ẩn
    await reportHan(s.han.token, l, 1).expect(409);

    // KCS chấm lại: lô pieceHan đạt 8, lỗi 2 (reportedQty đã bị KCS ghi đè = số đạt)
    await c.prisma.productionBatch.update({ where: { id: batchHan }, data: { reportedQty: 8 } });
    await c.prisma.qcReview.create({
      data: { productionBatchId: batchHan, failedQty: 2, reviewedById: c.w.kcsA },
    });
    const back = await stagePis('hanWorker', s.han.token);
    expect(codesOf(back.stagePis)).toEqual([l.code]);
    expect(back.stagePis[0].missingPieces).toBe(2);

    const tooMany = await reportHan(s.han.token, l, 3);
    expect(tooMany.status).toBeGreaterThanOrEqual(400);
    expect(tooMany.status).toBeLessThan(500);
    await reportHan(s.han.token, l, 2).expect(201);
    // báo đủ phần lỗi -> lệnh lại ẩn
    expect(codesOf((await stagePis('hanWorker', s.han.token)).stagePis)).toEqual([]);
  });

  it('AC9: lệnh Hàn đã từng báo (có ProductionBatch HAN) nhưng không có Phôi đạt: vẫn hiện tới khi đủ số / SKU kết thúc', async () => {
    const s = await shop('A9');
    const old = await c.newPi(s.ws.id);
    await c.w.seedPieceBatch(old, {
      pieceId: c.w.pieceHan,
      stage: MfgStage.HAN,
      qty: 3,
      status: ProductionBatchStatus.AWAITING_QC,
      withReport: false,
    });
    const never = await c.newPi(s.ws.id); // không Phôi, chưa từng báo: không hiện
    const data = await stagePis('hanWorker', s.han.token);
    expect(codesOf(data.stagePis)).toEqual([old.code]);
    expect(codesOf(data.stagePis)).not.toContain(never.code);
    // SKU kết thúc -> hết hiện
    await c.prisma.productionOrder.updateMany({
      where: { id: { in: old.orderIds } },
      data: { floorStage: ProductionOrderFloorStage.FINISHED },
    });
    expect(codesOf((await stagePis('hanWorker', s.han.token)).stagePis)).toEqual([]);
  });

  it('AC7: Sơn thấy lệnh khi có lô Hàn KCS đạt > 0; lệnh chưa có lô Hàn đạt (kể cả có Phôi đạt) không thấy, báo 409 đúng câu Sơn', async () => {
    const s = await shop('A7');
    const withHan = await c.newPi(s.ws.id);
    const onlyPhoi = await c.newPi(s.ws.id);
    const hanOpen = await c.newPi(s.ws.id);
    await c.seedPhoiPass(onlyPhoi);
    await c.seedHanPass(withHan, { qty: 4, both: false });
    await c.w.seedPieceBatch(hanOpen, {
      pieceId: c.w.pieceHan,
      stage: MfgStage.HAN,
      qty: 4,
      status: ProductionBatchStatus.AWAITING_QC,
      withReport: false,
    });

    const data = await stagePis('sonWorker', s.son.token);
    expect(codesOf(data.stagePis)).toEqual([withHan.code]);
    expect(data.runningPi).toBeNull();
    expect(data.reworkPis).toEqual([]);
    const res = await c
      .call(
        'sonWorker',
        'post',
        `/floor/scan/${s.son.token}/reports`,
        {
          productionInvoiceId: onlyPhoi.piId.toString(),
          productionOrderId: onlyPhoi.orderIds[0].toString(),
          pieceId: c.w.pieceHan.toString(),
          qty: 1,
        },
        { 'Idempotency-Key': `bhd-son-${Date.now()}` },
      )
      .expect(409);
    expect(JSON.stringify(res.body)).toContain(MSG_409_SON);
  });

  it('AC8 (chốt 23/11: Phước An chỉ có Phôi + Hàn, Sơn ở Phú An): Sơn theo NƠI SƠN. Lệnh Phước An (khung Hàn đạt) hiện ở máy Sơn Phú An cùng lệnh Phú An; xưởng không sơn nhờ thì Sơn = xưởng của lệnh', async () => {
    const phuAn = await shop('PA');
    const phuocAn = await shop('PHA');
    const rieng = await shop('RIENG');
    await c.prisma.workshop.update({
      where: { id: phuocAn.ws.id },
      data: { paintWorkshopId: phuAn.ws.id },
    });
    const p = await c.newPi(phuocAn.ws.id);
    const q = await c.newPi(phuAn.ws.id);
    const r = await c.newPi(rieng.ws.id);
    await c.seedHanPass(p, { qty: 4, both: false });
    await c.seedHanPass(q, { qty: 4, both: false });
    await c.seedHanPass(r, { qty: 4, both: false });
    expect(codesOf((await stagePis('sonWorker', phuAn.son.token)).stagePis).sort()).toEqual(
      [p.code, q.code].sort(),
    );
    expect(codesOf((await stagePis('sonWorker', phuocAn.son.token)).stagePis)).toEqual([]);
    expect(codesOf((await stagePis('sonWorker', rieng.son.token)).stagePis)).toEqual([r.code]);
    // Hàn vẫn theo xưởng của lệnh
    await c.seedPhoiPass(p);
    expect(codesOf((await stagePis('hanWorker', phuocAn.han.token)).stagePis)).toContain(p.code);
    expect(codesOf((await stagePis('hanWorker', phuAn.han.token)).stagePis)).not.toContain(p.code);
  });

  it('Phôi: máy mảnh Phôi / máy cắt trả stagePis = [] (Phôi giữ allocationPis); công nhân Hàn không quét được mã Sơn (403)', async () => {
    const s = await shop('A11');
    const l = await c.newPi(s.ws.id);
    await c.seedPhoiPass(l);
    const phoi = await stagePis('phoiWorker', s.phoi.token);
    expect(phoi.stagePis).toEqual([]);
    expect(phoi.runningPi).toBeNull();
    expect(phoi.reworkPis).toEqual([]);
    expect(
      dataOf<{ allocationPis: unknown[] }>(
        await c.call('phoiWorker', 'get', `/floor/scan/${s.phoi.token}`).expect(200),
      ).allocationPis,
    ).toEqual([]); // chưa có dòng chia nào
    await c.call('hanWorker', 'get', `/floor/scan/${s.son.token}`).expect(403);
  });

  it('báo lặp: cùng Idempotency-Key gửi 2 lần chỉ ghi 1 lô', async () => {
    const s = await shop('IDEM');
    const l = await c.newPi(s.ws.id);
    await c.seedPhoiPass(l);
    const key = `bhd-idem-${Date.now()}`;
    const body = {
      productionInvoiceId: l.piId.toString(),
      productionOrderId: l.orderIds[0].toString(),
      pieceId: c.w.pieceHan.toString(),
      qty: 2,
    };
    await c
      .call('hanWorker', 'post', `/floor/scan/${s.han.token}/reports`, body, {
        'Idempotency-Key': key,
      })
      .expect(201);
    const again = await c.call('hanWorker', 'post', `/floor/scan/${s.han.token}/reports`, body, {
      'Idempotency-Key': key,
    });
    expect(again.status).toBeLessThan(300);
    const rows = await c.prisma.productionBatch.findMany({
      where: { productionOrderId: l.orderIds[0], stage: MfgStage.HAN, pieceId: c.w.pieceHan },
    });
    expect(rows.reduce((n, r) => n + Number(r.reportedQty), 0)).toBe(2);
    // thiếu header -> 400
    await c.call('hanWorker', 'post', `/floor/scan/${s.han.token}/reports`, body).expect(400);
  });

  it('AC34: KHSX đổi xưởng lệnh đã duyệt -> thành công; tin PI_WORKSHOP_CHANGED không còn queueMoves; hàng đợi cũ không bị dời; Hàn xưởng mới thấy lệnh, xưởng cũ không', async () => {
    const oldS = await shop('OLD');
    const newS = await shop('NEW');
    const l = await c.newPi(oldS.ws.id);
    await c.prisma.productionInvoiceItem.updateMany({
      where: { id: { in: l.itemIds } },
      data: { prodApprovalStatus: 'APPROVED' },
    });
    // một dòng hàng đợi cũ còn mở (dữ liệu trước deploy): không được dời theo xưởng mới
    const legacy = await c.prisma.floorQueueEntry.create({
      data: {
        stage: MfgStage.HAN,
        productionInvoiceId: l.piId,
        workshopId: oldS.ws.id,
        position: 1,
        status: 'QUEUED',
      },
    });
    const planner = await c.addUser('qlsx', BUSINESS_ROLES.PRODUCTION_PLANNER, null); // KHSX
    expect(planner).toBeTruthy();
    c.emitSpy.mockClear();

    const changed = await c.call('qlsx', 'patch', `/production-invoices/${l.piId}/workshop`, {
      workshopId: newS.ws.id.toString(),
      reason: 'Đổi xưởng theo kế hoạch (test bỏ hàng đợi)',
    });
    expect({ status: changed.status, body: changed.body as unknown }).toMatchObject({
      status: 200,
    });

    const emits = (c.emitSpy.mock.calls as Array<[string, unknown]>).filter(
      (x) => x[0] === 'PI_WORKSHOP_CHANGED',
    );
    expect(emits).toHaveLength(1);
    const params = (emits[0][1] as { params: Record<string, unknown> }).params;
    expect(params.queueMoves).toBeUndefined();
    expect(JSON.stringify(params)).not.toContain('Hàng đợi tổ');
    const after = await c.prisma.floorQueueEntry.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(after.workshopId).toBe(oldS.ws.id);

    // SAU khi đổi xưởng mới có Phôi đạt (xuất sắt rồi thì luật cũ không cho đổi xưởng)
    await c.seedPhoiPass(l);
    expect(codesOf((await stagePis('hanWorker', newS.han.token)).stagePis)).toEqual([l.code]);
    expect(codesOf((await stagePis('hanWorker', oldS.han.token)).stagePis)).toEqual([]);
  });
});
