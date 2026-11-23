import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  CutBundleStatus,
  FloorQueueStatus,
  MfgStage,
  ProcessStep,
  ProductionBatchStatus,
  ProductionInvoiceStatus,
} from '../../src/generated/prisma/client';
import { BUSINESS_ROLES } from '../../src/common/constants/roles.constant';
import { PAST } from './p1-kcs.fixture';
import { BhdCtx, QTY, createBhdCtx, phoiDoneAtOf, setPhoiDoneAt } from './bo-hang-doi.fixture';

/**
 * Bỏ hàng đợi xưởng (23/11/2026) - "xong Phôi" ghi vào production_invoices."phoiDoneAt", migration, tin nhắc. Postgres TEST thật.
 *  AC12 đủ số + KCS đạt hết -> lượt nền ghi phoiDoneAt; không FLOOR_PHOI_DONE / FLOOR_STAGE_COMPLETE; không tạo dòng hàng đợi
 *  AC13 còn đợt chờ KCS / còn công đoạn phụ thiếu -> chưa ghi
 *  AC14 chưa từng có dòng hàng đợi vẫn ghi
 *  AC17 migration: dòng hàng đợi PHOI DONE -> phoiDoneAt = endedAt; QUEUED / RUNNING / HAN DONE -> không ghi; chạy lại không đổi
 *  AC18 migration: đóng tin FLOOR_PHOI_DONE / FLOOR_STAGE_COMPLETE đang mở
 *  D1   migration: KHÔNG đụng workshops.paintWorkshopId (Sơn Phước An ở Phú An, chốt 23/11)
 *  D4   KCS_BATCH_STALE chỉ gửi KCS (không QLSX)
 * Phần "lệnh rời bảng chia máy cắt" (snapshot / guard) KHÔNG nằm ở đây - xem báo cáo.
 */
const MIGRATIONS_DIR = join(__dirname, '../../prisma/migrations');

/** Thư mục migration của việc này = thư mục nào nhắc tới cột phoiDoneAt (thiết kế D3). */
function findMigrationDir(): string | undefined {
  return readdirSync(MIGRATIONS_DIR)
    .filter((d) => d !== 'migration_lock.toml')
    .sort()
    .find((d) => {
      try {
        return readFileSync(join(MIGRATIONS_DIR, d, 'migration.sql'), 'utf8').includes(
          'phoiDoneAt',
        );
      } catch {
        return false;
      }
    });
}

/** Chỉ các câu ghi dữ liệu (UPDATE / INSERT): globalSetup đã áp ALTER / CREATE rồi, chạy lại sẽ báo "đã tồn tại". */
function dataStatementsOf(dir: string): string[] {
  return readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(ALTER|CREATE|DROP|COMMENT)\b/i.test(s));
}

describe('Bỏ hàng đợi: xong Phôi + migration + tin (integration, DB test thật)', () => {
  let c: BhdCtx;
  let revSeq = 230;
  let prevCutPull: string | undefined;
  let prevAlerts: string | undefined;

  beforeAll(async () => {
    prevCutPull = process.env.CUT_AUTO_PULL;
    prevAlerts = process.env.FLOOR_ALERTS;
    process.env.CUT_AUTO_PULL = 'off'; // lượt nền không kéo sắt trên DB test chung
    delete process.env.FLOOR_ALERTS; // bật nhắc nền (AC12-14 cần lượt nền chạy)
    c = await createBhdCtx('xp', { realEmit: true });
  }, 120_000);

  afterAll(async () => {
    if (prevCutPull === undefined) delete process.env.CUT_AUTO_PULL;
    else process.env.CUT_AUTO_PULL = prevCutPull;
    if (prevAlerts === undefined) delete process.env.FLOOR_ALERTS;
    else process.env.FLOOR_ALERTS = prevAlerts;
    if (c) await c.cleanup();
  });

  const noRemovedEmits = () => {
    const types = (c.emitSpy.mock.calls as Array<[string]>).map((x) => x[0]);
    expect(types).not.toContain('FLOOR_PHOI_DONE');
    expect(types).not.toContain('FLOOR_STAGE_COMPLETE');
  };

  /** Lệnh chỉ có 1 dòng sắt (cỡ 441, Cắt) hoặc (cỡ 355, Cắt + Uốn) + mảnh Phôi đã KCS đạt đủ -> chỉ phần sắt quyết định xong Phôi. */
  async function phoiWorld(opts: { uon?: boolean; cutStatus?: CutBundleStatus | null }) {
    revSeq += 1;
    const spec = opts.uon ? c.w.spec355 : c.w.spec441;
    const steps = opts.uon ? [ProcessStep.CAT, ProcessStep.UON] : [ProcessStep.CAT];
    const rev = await c.w.makeBomRevision(revSeq, [{ specId: spec, steps }]);
    const world = await c.w.newInvoice({
      quantities: [QTY],
      workshopId: c.w.ws.id,
      bomRevisionIds: [rev],
    });
    // mảnh Phôi của bản định mức đã KCS đạt đủ
    await c.w.seedPieceBatch(world, {
      pieceId: c.w.pieceCut,
      stage: MfgStage.PHOI,
      qty: QTY,
      status: ProductionBatchStatus.QC_DONE,
      withReport: false,
    });
    if (opts.cutStatus !== null) {
      const issue = await c.w.newIssue(world.piId);
      await c.w.seedCutBundle(issue, world, {
        segs: [{ specId: spec, qty: QTY }],
        status: opts.cutStatus ?? CutBundleStatus.QC_PASSED,
        withReport: false,
      });
    }
    return world;
  }

  // ===================================================================================
  it('AC12 + AC14: đủ số + KCS đạt hết, chưa từng có dòng hàng đợi -> lượt nền ghi phoiDoneAt; không tin FLOOR_PHOI_DONE / FLOOR_STAGE_COMPLETE; không tạo dòng hàng đợi; chạy lại không đổi mốc', async () => {
    const z = await phoiWorld({});
    expect(await phoiDoneAtOf(c.prisma, z.piId)).toBeNull();
    expect(await c.prisma.floorQueueEntry.count({ where: { productionInvoiceId: z.piId } })).toBe(
      0,
    );
    c.emitSpy.mockClear();

    const before = Date.now();
    await c.alerts.evaluate(new Date());
    const doneAt = await phoiDoneAtOf(c.prisma, z.piId);
    expect(doneAt).not.toBeNull();
    expect(doneAt!.getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(await c.prisma.floorQueueEntry.count({ where: { productionInvoiceId: z.piId } })).toBe(
      0,
    );
    noRemovedEmits();
    expect(
      await c.prisma.notification.count({
        where: {
          type: { in: ['FLOOR_PHOI_DONE', 'FLOOR_STAGE_COMPLETE'] },
          recipients: { some: { userId: { in: c.w.ids.users } } },
        },
      }),
    ).toBe(0);

    // chạy lại: mốc giữ nguyên (không ghi đè)
    await c.alerts.evaluate(new Date());
    expect((await phoiDoneAtOf(c.prisma, z.piId))!.getTime()).toBe(doneAt!.getTime());
    noRemovedEmits();
  });

  it('AC13: còn 1 đợt cắt chờ KCS chấm, hoặc còn công đoạn phụ (Uốn) chưa báo -> chưa ghi phoiDoneAt', async () => {
    const awaiting = await phoiWorld({ cutStatus: CutBundleStatus.AWAITING_QC });
    const noUon = await phoiWorld({ uon: true }); // Cắt đạt đủ nhưng chưa báo Uốn
    await c.alerts.evaluate(new Date());
    expect(await phoiDoneAtOf(c.prisma, awaiting.piId)).toBeNull();
    expect(await phoiDoneAtOf(c.prisma, noUon.piId)).toBeNull();
  });

  it('chưa có đợt cắt nào (không dòng chia, không đợt cắt) -> không ghi, kể cả khi mọi dòng khác đạt; lệnh đã DONE -> không ghi', async () => {
    const noCut = await phoiWorld({ cutStatus: null });
    const doneInv = await phoiWorld({});
    await c.prisma.productionInvoice.update({
      where: { id: doneInv.piId },
      data: { status: ProductionInvoiceStatus.DONE },
    });
    await c.alerts.evaluate(new Date());
    expect(await phoiDoneAtOf(c.prisma, noCut.piId)).toBeNull();
    expect(await phoiDoneAtOf(c.prisma, doneInv.piId)).toBeNull();
  });

  // ===================================================================================
  describe('migration (AC17, AC18, D1)', () => {
    const dir = findMigrationDir();

    it('có thư mục migration nhắc cột phoiDoneAt (D3), có câu đóng tin, KHÔNG có câu sửa bảng workshops', () => {
      expect(dir).toBeDefined();
      const sql = readFileSync(join(MIGRATIONS_DIR, dir!, 'migration.sql'), 'utf8');
      expect(sql).not.toMatch(/UPDATE\s+"workshops"/i);
      expect(sql).toMatch(/FLOOR_PHOI_DONE/);
      expect(sql).toMatch(/FLOOR_STAGE_COMPLETE/);
      expect(sql).toMatch(/floor_queue_entries/);
    });

    it('cột phoiDoneAt: TIMESTAMP(3) NULL, mặc định null', async () => {
      const cols = await c.prisma.$queryRawUnsafe<
        Array<{
          data_type: string;
          is_nullable: string;
          column_default: string | null;
          datetime_precision: number;
        }>
      >(
        `SELECT data_type, is_nullable, column_default, datetime_precision FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'production_invoices' AND column_name = 'phoiDoneAt'`,
      );
      expect(cols).toHaveLength(1);
      expect(cols[0].data_type).toBe('timestamp without time zone');
      expect(cols[0].is_nullable).toBe('YES');
      expect(cols[0].column_default).toBeNull();
      expect(cols[0].datetime_precision).toBe(3);
    });

    it('chạy NGUYÊN VĂN các câu UPDATE / INSERT: PHOI DONE -> phoiDoneAt = endedAt; PHOI QUEUED / RUNNING, HAN DONE -> không ghi; nơi sơn giữ nguyên; tin 2 loại đóng, tin loại khác giữ; chạy lại không đổi', async () => {
      expect(dir).toBeDefined();
      const ws = c.w.ws;
      const other = await c.w.makeWorkshop('MIGP');
      await c.prisma.workshop.update({ where: { id: ws.id }, data: { paintWorkshopId: other.id } });

      const endedAt = new Date('2026-11-20T03:00:00.000Z');
      const mkPi = async () => (await c.newPi(ws.id)).piId;
      const piDone = await mkPi();
      const piRunning = await mkPi();
      const piQueued = await mkPi();
      const piHanDone = await mkPi();
      const entry = (
        productionInvoiceId: bigint,
        stage: MfgStage,
        status: FloorQueueStatus,
        position: number,
      ) =>
        c.prisma.floorQueueEntry.create({
          data: {
            stage,
            productionInvoiceId,
            workshopId: ws.id,
            position,
            status,
            ...(status === FloorQueueStatus.DONE ? { startedAt: PAST(30), endedAt } : {}),
            ...(status === FloorQueueStatus.RUNNING ? { startedAt: PAST(2) } : {}),
          },
        });
      await entry(piDone, MfgStage.PHOI, FloorQueueStatus.DONE, 1);
      await entry(piRunning, MfgStage.PHOI, FloorQueueStatus.RUNNING, 2);
      await entry(piQueued, MfgStage.PHOI, FloorQueueStatus.QUEUED, 3);
      await entry(piHanDone, MfgStage.HAN, FloorQueueStatus.DONE, 1);
      for (const id of [piDone, piRunning, piQueued, piHanDone])
        await setPhoiDoneAt(c.prisma, id, null);

      const resolvedFixed = new Date('2026-11-10T03:00:00.000Z');
      const user = c.w.workerA;
      const mkNote = async (type: string, resolvedAt: Date | null) =>
        (
          await c.prisma.notification.create({
            data: {
              type,
              title: `bhd mig ${type}`,
              message: 'm',
              recipients: { create: [{ userId: user, resolvedAt }] },
            },
          })
        ).id;
      const nPhoiOpen = await mkNote('FLOOR_PHOI_DONE', null);
      const nStageOpen = await mkNote('FLOOR_STAGE_COMPLETE', null);
      const nStageClosed = await mkNote('FLOOR_STAGE_COMPLETE', resolvedFixed);
      const nOther = await mkNote('MATERIAL_ISSUE_TO_TEAM', null);
      const recipient = (id: string) =>
        c.prisma.notificationRecipient.findFirstOrThrow({
          where: { notificationId: id, userId: user },
        });

      const run = async () => {
        for (const sql of dataStatementsOf(dir!)) await c.prisma.$executeRawUnsafe(sql);
      };
      await run();

      expect((await phoiDoneAtOf(c.prisma, piDone))!.toISOString()).toBe(endedAt.toISOString());
      expect(await phoiDoneAtOf(c.prisma, piRunning)).toBeNull();
      expect(await phoiDoneAtOf(c.prisma, piQueued)).toBeNull();
      expect(await phoiDoneAtOf(c.prisma, piHanDone)).toBeNull();
      expect(
        (await c.prisma.workshop.findUniqueOrThrow({ where: { id: ws.id } })).paintWorkshopId,
      ).toBe(other.id);
      await c.prisma.workshop.update({ where: { id: ws.id }, data: { paintWorkshopId: null } }); // trả lại cho ca sau
      expect((await recipient(nPhoiOpen)).resolvedAt).not.toBeNull();
      expect((await recipient(nStageOpen)).resolvedAt).not.toBeNull();
      expect((await recipient(nStageClosed)).resolvedAt).toEqual(resolvedFixed); // không đóng lại dòng đã đóng
      expect((await recipient(nOther)).resolvedAt).toBeNull(); // loại tin khác không đụng
      expect(
        await c.prisma.notificationRecipient.count({
          where: {
            resolvedAt: null,
            notification: { type: { in: ['FLOOR_PHOI_DONE', 'FLOOR_STAGE_COMPLETE'] } },
          },
        }),
      ).toBe(0);
      // bảng hàng đợi giữ nguyên (không xoá dòng)
      expect(
        await c.prisma.floorQueueEntry.count({
          where: { productionInvoiceId: { in: [piDone, piRunning, piQueued, piHanDone] } },
        }),
      ).toBe(4);

      // chạy lại: không đổi gì
      await run();
      expect((await phoiDoneAtOf(c.prisma, piDone))!.toISOString()).toBe(endedAt.toISOString());
      expect(await phoiDoneAtOf(c.prisma, piRunning)).toBeNull();
      expect((await recipient(nStageClosed)).resolvedAt).toEqual(resolvedFixed);

      // lệnh đã có phoiDoneAt (từ dòng DONE) không bị lượt nền kéo về bảng chia / ghi lại
      await c.alerts.evaluate(new Date());
      expect((await phoiDoneAtOf(c.prisma, piDone))!.toISOString()).toBe(endedAt.toISOString());
      noRemovedEmits();
    });
  });

  // ===================================================================================
  describe('KCS_BATCH_STALE chỉ gửi KCS (D4, Q4-A)', () => {
    it('đợt Hàn chờ KCS quá 4 giờ: tin có người nhận là KCS (mọi xưởng), KHÔNG có QLSX (kể cả QLSX xưởng đó và QLSX không gắn xưởng)', async () => {
      const ws = await c.w.makeWorkshop('STL');
      const kcs = await c.w.makeUser('kcsx', { roles: [BUSINESS_ROLES.KCS_STAFF] });
      const qlsxWs = await c.w.makeUser('qx1', {
        workshopId: ws.id,
        roles: [BUSINESS_ROLES.PRODUCTION_MANAGER],
      });
      const qlsxFree = await c.w.makeUser('qx2', { roles: [BUSINESS_ROLES.PRODUCTION_MANAGER] });
      const world = await c.w.newInvoice({ quantities: [500], workshopId: ws.id });
      await c.w.seedPieceBatch(world, {
        pieceId: c.w.pieceHan,
        stage: MfgStage.HAN,
        qty: 10,
        status: ProductionBatchStatus.AWAITING_QC,
        reportAt: PAST(6),
      });

      await c.alerts.evaluate(new Date());

      const tins = await c.prisma.notification.findMany({
        where: { type: 'KCS_BATCH_STALE', entityId: `HAN:${ws.id}` },
        include: { recipients: true },
      });
      expect(tins).toHaveLength(1);
      const got = tins[0].recipients.map((r) => r.userId);
      expect(got).toContain(kcs);
      expect(got).not.toContain(qlsxWs);
      expect(got).not.toContain(qlsxFree);
    });
  });
});
