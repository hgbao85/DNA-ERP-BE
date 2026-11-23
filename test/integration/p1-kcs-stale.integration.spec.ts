import {
  MfgStage,
  ProductionBatchStatus,
  ProductionOrderFloorStage,
} from '../../src/generated/prisma/client';
import { BUSINESS_ROLES } from '../../src/common/constants/roles.constant';
import { PAST, P1Harness, P1World, WorkshopRef, createHarness } from './p1-kcs.fixture';

/**
 * IT4 (P1, 18/11/2026) - AC18: tin "đợt chờ KCS chấm quá 4 giờ" (KCS_BATCH_STALE) theo (tổ, xưởng), trên Postgres TEST thật.
 * Dùng NotificationsService + RecipientResolverService THẬT (ghi tin xuống DB), người nhận là tài khoản có vai thật do test tạo.
 *
 * Phủ: tiêu đề / khoá / người nhận (mọi KCS, QLSX xưởng đó, QLSX không gắn xưởng; QLSX xưởng khác KHÔNG nhận); tin FLOOR_BATCH_STALE cũ
 * được đóng; thêm đợt quá hạn thì đổi số trên chính tin đó; chấm hết thì tin đóng; cùng tổ 2 xưởng (xưởng B hết đợt quá hạn thì tin của
 * xưởng A KHÔNG bị đóng và không tạo tin mới); đợt chưa tới 4 giờ và đợt của lệnh đang dừng không tính; FLOOR_ALERTS=off không xếp lượt.
 * KCS_BATCH_STALE KHÔNG có `alternatives` trong link (MF1).
 */
describe('P1 IT4: tin KCS_BATCH_STALE theo tổ x xưởng (integration, real Postgres)', () => {
  let h: P1Harness;
  let w: P1World;
  let prevCutPull: string | undefined;
  let prevAlerts: string | undefined;

  beforeAll(async () => {
    h = await createHarness({ realEmit: true });
    w = new P1World(h, `it4-${Date.now()}`);
    await w.init();
    prevCutPull = process.env.CUT_AUTO_PULL;
    prevAlerts = process.env.FLOOR_ALERTS;
    process.env.CUT_AUTO_PULL = 'off'; // lượt nền không kéo sắt trên DB test chung
    delete process.env.FLOOR_ALERTS;
  });

  afterAll(async () => {
    if (prevCutPull === undefined) delete process.env.CUT_AUTO_PULL;
    else process.env.CUT_AUTO_PULL = prevCutPull;
    if (prevAlerts === undefined) delete process.env.FLOOR_ALERTS;
    else process.env.FLOOR_ALERTS = prevAlerts;
    if (w) await w.cleanup();
    if (h) await h.close();
  });

  const KCS = BUSINESS_ROLES.KCS_STAFF;
  const QLSX = BUSINESS_ROLES.PRODUCTION_MANAGER;

  /** 1 đợt Hàn chưa chấm của xưởng `ws`, lần báo đầu cách đây `hoursAgo` giờ. */
  async function staleBatch(
    ws: WorkshopRef,
    opts: {
      hoursAgo: number;
      status?: ProductionBatchStatus;
      floorStage?: ProductionOrderFloorStage;
    },
  ) {
    const world = await w.newInvoice({
      quantities: [500],
      workshopId: ws.id,
      floorStage: opts.floorStage,
    });
    const at = PAST(opts.hoursAgo);
    const { batchId } = await w.seedPieceBatch(world, {
      pieceId: w.pieceHan,
      stage: MfgStage.HAN,
      qty: 10,
      status: opts.status ?? ProductionBatchStatus.OPEN,
      reportAt: at,
    });
    return { world, batchId };
  }

  const tinsOf = async (ws: WorkshopRef, type = 'KCS_BATCH_STALE', stage = 'HAN') =>
    h.prisma.notification.findMany({
      where: { type, entityId: `${stage}:${ws.id}` },
      include: { recipients: true },
      orderBy: { createdAt: 'asc' },
    });

  const openTins = async (ws: WorkshopRef, type = 'KCS_BATCH_STALE', stage = 'HAN') =>
    (await tinsOf(ws, type, stage)).filter((t) => t.recipients.some((r) => r.resolvedAt == null));

  const recipientsOf = (tin: { recipients: Array<{ userId: string }> }) =>
    tin.recipients.map((r) => r.userId);

  const countOf = (tin: { data: unknown }) => (tin.data as { count: number }).count;

  // =====================================================================================
  it('xưởng A có 2 đợt Hàn quá 4 giờ (1 đang mở, 1 đã chốt): 1 tin đúng tiêu đề / khoá / link / người nhận; tin FLOOR_BATCH_STALE cũ được đóng; thêm đợt thì đổi số trên chính tin đó; chấm hết thì tin đóng', async () => {
    const phuAn = await w.makeWorkshop('PA');
    const phuocAn = await w.makeWorkshop('PHA');
    const kcsOther = await w.makeUser('kcso', { workshopId: phuocAn.id, roles: [KCS] });
    const qlsxPhuAn = await w.makeUser('qpa', { workshopId: phuAn.id, roles: [QLSX] });
    const qlsxPhuocAn = await w.makeUser('qpha', { workshopId: phuocAn.id, roles: [QLSX] });
    const qlsxFree = await w.makeUser('qfree', { roles: [QLSX] });
    const open1 = await staleBatch(phuAn, { hoursAgo: 5 });
    const awaiting = await staleBatch(phuAn, {
      hoursAgo: 6,
      status: ProductionBatchStatus.AWAITING_QC,
    });
    await staleBatch(phuAn, { hoursAgo: 1 }); // chưa tới 4 giờ: không tính
    await staleBatch(phuAn, { hoursAgo: 9, floorStage: ProductionOrderFloorStage.PAUSED }); // lệnh dừng: không tính
    // tin FLOOR_BATCH_STALE cũ (kiểu N1) đang mở cho QLSX xưởng A
    const old = await h.prisma.notification.create({
      data: {
        type: 'FLOOR_BATCH_STALE',
        category: 'ACTION_REQUIRED',
        severity: 'WARNING',
        entityType: 'FLOOR_STAGE',
        entityId: `HAN:${phuAn.id}`,
        dedupeKey: `FLOOR_BATCH_STALE:HAN:${phuAn.id}`,
        title: 'Tổ Hàn: 2 đợt chờ gửi KCS quá 4 giờ',
        message: 'cu',
        link: { module: 'production', page: 'san-luong-xuong' },
        recipients: { create: [{ userId: qlsxPhuAn }] },
      },
    });

    await h.alerts.evaluate(new Date());

    const tins = await tinsOf(phuAn);
    expect(tins).toHaveLength(1);
    const tin = tins[0];
    expect(tin.dedupeKey).toBe(`KCS_BATCH_STALE:HAN:${phuAn.id}`);
    expect(tin.entityType).toBe('FLOOR_STAGE');
    expect(tin.category).toBe('ACTION_REQUIRED');
    expect(tin.title).toBe(`Tổ Hàn · ${phuAn.name}: 2 đợt chờ KCS chấm quá 4 giờ`);
    expect(tin.message).toContain('KCS chưa chấm quá 4 giờ');
    expect(tin.data).toMatchObject({
      stage: 'HAN',
      count: 2,
      hours: 4,
      workshopId: String(phuAn.id),
    });
    const link = tin.link as { module: string; page: string; alternatives?: unknown };
    expect(link).toMatchObject({ module: 'production', page: 'kcs-han' });
    expect(link.alternatives).toBeUndefined(); // MF1: không có alternatives
    // người nhận (23/11/2026, bỏ hàng đợi - Q4 A): chỉ KCS (kể cả KCS gắn xưởng khác); QLSX không còn nhận
    const got = recipientsOf(tin);
    expect(got).toEqual(expect.arrayContaining([kcsOther]));
    for (const q of [qlsxPhuAn, qlsxPhuocAn, qlsxFree]) expect(got).not.toContain(q);
    // xưởng B không có đợt quá hạn: không có tin
    expect(await tinsOf(phuocAn)).toHaveLength(0);
    // tin cũ được đóng
    const oldRecipients = await h.prisma.notificationRecipient.findMany({
      where: { notificationId: old.id },
    });
    expect(oldRecipients.every((r) => r.resolvedAt != null)).toBe(true);
    expect(await openTins(phuAn, 'FLOOR_BATCH_STALE')).toHaveLength(0);

    // chạy lại: không tạo tin mới
    await h.alerts.evaluate(new Date());
    expect((await tinsOf(phuAn)).map((t) => t.id)).toEqual([tin.id]);

    // thêm 1 đợt quá hạn: chính tin đó đổi số thành 3, không tạo tin mới
    await staleBatch(phuAn, { hoursAgo: 7 });
    await h.alerts.evaluate(new Date());
    const after = await tinsOf(phuAn);
    expect(after.map((t) => t.id)).toEqual([tin.id]);
    expect(countOf(after[0])).toBe(3);
    expect(after[0].title).toContain('3 đợt chờ KCS chấm quá 4 giờ');

    // KCS chấm hết: tin tự đóng ở lượt quét kế
    await h.prisma.productionBatch.updateMany({
      where: { productionOrder: { productionInvoiceItem: { workshopId: phuAn.id } } },
      data: { status: ProductionBatchStatus.QC_DONE },
    });
    await h.alerts.evaluate(new Date());
    expect(await openTins(phuAn)).toHaveLength(0);
    expect((await tinsOf(phuAn)).map((t) => t.id)).toEqual([tin.id]); // đóng, không tạo tin mới
    expect(open1.batchId).not.toEqual(awaiting.batchId);
  });

  it('cùng tổ 2 xưởng: xưởng B hết đợt quá hạn thì tin của xưởng A KHÔNG bị đóng và không tạo tin mới', async () => {
    const wsA = await w.makeWorkshop('XA');
    const wsB = await w.makeWorkshop('XB');
    await w.makeUser('qa', { workshopId: wsA.id, roles: [QLSX] });
    await w.makeUser('qb', { workshopId: wsB.id, roles: [QLSX] });
    await w.makeUser('kcs2', { roles: [KCS] });
    await staleBatch(wsA, { hoursAgo: 5 });
    const b = await staleBatch(wsB, { hoursAgo: 5 });

    await h.alerts.evaluate(new Date());
    const tinA = await openTins(wsA);
    const tinB = await openTins(wsB);
    expect(tinA).toHaveLength(1);
    expect(tinB).toHaveLength(1);
    expect(tinA[0].id).not.toBe(tinB[0].id);

    // xưởng B chấm hết
    await h.prisma.productionBatch.update({
      where: { id: b.batchId },
      data: { status: ProductionBatchStatus.QC_DONE },
    });
    await h.alerts.evaluate(new Date());

    expect(await openTins(wsB)).toHaveLength(0); // tin B đóng
    const stillA = await openTins(wsA);
    expect(stillA.map((t) => t.id)).toEqual([tinA[0].id]); // tin A giữ nguyên, vẫn mở
    expect(countOf(stillA[0])).toBe(1);
    expect(await tinsOf(wsA)).toHaveLength(1); // không tạo tin mới cho A
    expect(await tinsOf(wsB)).toHaveLength(1);
  });

  it('chưa tới 4 giờ (3 giờ 58 phút) thì không có tin; quá 4 giờ (4 giờ 01 phút) thì có', async () => {
    const ws = await w.makeWorkshop('GI');
    await w.makeUser('kcs3', { roles: [KCS] });
    const world = await w.newInvoice({ quantities: [500], workshopId: ws.id });
    await w.seedPieceBatch(world, {
      pieceId: w.pieceHan,
      stage: MfgStage.HAN,
      qty: 10,
      reportAt: new Date(Date.now() - (3 * 60 + 58) * 60_000),
    });
    await h.alerts.evaluate(new Date());
    expect(await tinsOf(ws)).toHaveLength(0);

    await h.prisma.floorReport.updateMany({
      where: { productionInvoiceId: world.piId },
      data: { createdAt: new Date(Date.now() - (4 * 60 + 1) * 60_000) },
    });
    await h.alerts.evaluate(new Date());
    expect(await openTins(ws)).toHaveLength(1);
  });

  it('FLOOR_ALERTS=off: yêu cầu chạy lượt nền không xếp lượt nào (công tắc tắt hẳn nhắc nền)', () => {
    const prev = process.env.FLOOR_ALERTS;
    process.env.FLOOR_ALERTS = 'off';
    try {
      h.alerts.requestEvaluate({ urgent: true });
      expect((h.alerts as unknown as { debounce: unknown }).debounce).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.FLOOR_ALERTS;
      else process.env.FLOOR_ALERTS = prev;
    }
  });
});
