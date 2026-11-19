import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { TEST_DATABASE_URL } from '../test-db.constants';

/**
 * IT5 (P1, 18/11/2026) - 2 migration của gói KCS tự chuyển, trên Postgres TEST thật. AC44, AC45 (Câu 1 = B), AC58.
 *  20261118100000_kcs_short_scrap                      3 cột mới (mặc định 0) + CHECK không âm / scrapQty <= failedQty
 *  20261118100100_kcs_floor_report_view                KCS_STAFF có FLOOR_REPORT:VIEW (đúng 1 dòng, chạy lại không trùng) + đóng tin FLOOR_BATCH_STALE cũ
 *
 * Cách làm (theo p3-vat-tu-kiem-ke, mục A): globalSetup đã áp migration lên DB test; ở đây DỰNG LẠI dữ liệu "kiểu cũ" rồi TỰ chạy NGUYÊN VĂN
 * SQL đọc từ file thật (không chép câu SQL vào test). Quyết định 19/11 (Câu 1 = B): migration 20261118100200 đã bị xoá, lỗi công đoạn phụ cũ
 * giữ scrapQty = 0 (= làm lại), không có migration đổi dữ liệu cũ.
 *
 * KHÔNG import fixture hay service đang sửa: chỉ dùng PrismaClient + SQL thô. Câu UPDATE / INSERT chạy trên cả DB test chung nên mọi khẳng định
 * chỉ đặt trên dòng do chính test này tạo (trừ AC58: sau câu đóng tin không còn tin FLOOR_BATCH_STALE nào mở).
 */
const MIGRATIONS_DIR = join(__dirname, '../../prisma/migrations');
const DIR_SHORT_SCRAP = '20261118100000_kcs_short_scrap';
const DIR_FLOOR_VIEW = '20261118100100_kcs_floor_report_view';
const DIR_OLD_STEP_REMOVED = '20261118100200_kcs_old_step_failures_as_scrap';

/** Đọc file thật, bỏ dòng chú thích, tách từng câu. */
function statementsOf(dir: string): string[] {
  return readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

describe('P1 IT5: 2 migration KCS (integration, real Postgres)', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
  });
  const sfx = Date.now();

  const created = {
    userId: '' as string,
    materialId: null as bigint | null,
    specIds: [] as bigint[],
    invoiceId: null as bigint | null,
    steelIssueId: null as bigint | null,
    cutBundleId: null as bigint | null,
    stepBundleIds: [] as bigint[],
    reviewIds: [] as bigint[],
    notificationIds: [] as string[],
    roleId: null as string | null, // chỉ khi test tự tạo vai
    permissionId: null as string | null, // chỉ khi test tự tạo quyền
  };

  const run = async (dir: string): Promise<void> => {
    for (const sql of statementsOf(dir)) await prisma.$executeRawUnsafe(sql);
  };

  const errText = (e: unknown): string => {
    const x = e as { message?: string; code?: string; cause?: { message?: string } };
    return `${x.code ?? ''} ${x.message ?? ''} ${x.cause?.message ?? ''}`;
  };
  const rejects = async (sql: string): Promise<string> => {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (e) {
      return errText(e);
    }
    throw new Error(`Câu SQL lẽ ra phải bị CHECK chặn: ${sql}`);
  };

  // dữ liệu "kiểu cũ" (dựng trong beforeAll)
  let specA: bigint; // cỡ dùng cho Uốn / Cắt
  let specB: bigint;
  let reviewUon: bigint; // đợt Uốn: cỡ A lỗi 5 / scrap 0; cỡ B lỗi 3 / scrap 2 (đã có scrap)
  let reviewDap: bigint; // đợt Dập: lỗi 4 / scrap 0
  let reviewCut: bigint; // đợt Cắt: lỗi 3 / scrap 0

  const segRow = async (reviewId: bigint, specId: bigint) =>
    (
      await prisma.$queryRawUnsafe<
        Array<{ failedQty: number; shortQty: number; scrapQty: number }>
      >(
        `SELECT "failedQty", "shortQty", "scrapQty" FROM "qc_review_segments" WHERE "qcReviewId" = ${reviewId.toString()} AND "segmentSpecId" = ${specId.toString()}`,
      )
    )[0];

  const insertReview = async (leg: 'stepBundleId' | 'cutBundleId', id: bigint): Promise<bigint> => {
    const cols = leg === 'cutBundleId' ? `"steelIssueId", "cutBundleId"` : `"stepBundleId"`;
    const vals = leg === 'cutBundleId' ? `${created.steelIssueId}, ${id}` : `${id}`;
    const rows = await prisma.$queryRawUnsafe<Array<{ id: bigint }>>(
      `INSERT INTO "qc_reviews" (${cols}, "failedQty", "reviewedById") VALUES (${vals}, 0, '${created.userId}') RETURNING "id"`,
    );
    created.reviewIds.push(rows[0].id);
    return rows[0].id;
  };
  const insertSeg = (reviewId: bigint, specId: bigint, failed: number, scrap: number) =>
    prisma.$executeRawUnsafe(
      `INSERT INTO "qc_review_segments" ("qcReviewId", "segmentSpecId", "failedQty", "scrapQty") VALUES (${reviewId}, ${specId}, ${failed}, ${scrap})`,
    );

  beforeAll(async () => {
    created.userId = (
      await prisma.user.create({
        data: { username: `p1mig-${sfx}`, password: 'x', firstName: 'P1', lastName: 'Mig' },
      })
    ).id;
    created.materialId = (
      await prisma.material.create({
        data: { code: `P1MIG-${sfx}`, name: 'Sat test migration', unit: 'cay' },
      })
    ).id;
    for (const mm of [441, 355]) {
      const s = await prisma.segmentSpec.create({
        data: { materialId: created.materialId, cutLengthMm: mm },
      });
      created.specIds.push(s.id);
    }
    [specA, specB] = created.specIds;
    created.invoiceId = (
      await prisma.productionInvoice.create({ data: { code: `P1MIG-PI-${sfx}` } })
    ).id;
    created.steelIssueId = (
      await prisma.steelIssue.create({
        data: {
          productionInvoiceId: created.invoiceId,
          materialId: created.materialId,
          barLengthMm: 6000,
          barCount: 1,
          issuedById: created.userId,
        },
      })
    ).id;
    created.cutBundleId = (
      await prisma.cutBundle.create({
        data: {
          steelIssueId: created.steelIssueId,
          status: 'QC_PASSED',
          segments: { create: [{ segmentSpecId: specA, qty: 10 }] },
        },
      })
    ).id;
    for (const step of ['UON', 'DAP'] as const) {
      const sb = await prisma.stepBundle.create({
        data: {
          productionInvoiceId: created.invoiceId,
          materialId: created.materialId,
          step,
          status: 'QC_PASSED',
          submittedById: created.userId,
        },
      });
      created.stepBundleIds.push(sb.id);
    }
    // dữ liệu kiểu CŨ: qc_review của đợt Uốn lỗi 5 / scrap 0; Dập lỗi 4; Cắt lỗi 3; 1 dòng đã có scrap 2 / lỗi 3
    reviewUon = await insertReview('stepBundleId', created.stepBundleIds[0]);
    await insertSeg(reviewUon, specA, 5, 0);
    await insertSeg(reviewUon, specB, 3, 2);
    reviewDap = await insertReview('stepBundleId', created.stepBundleIds[1]);
    await insertSeg(reviewDap, specA, 4, 0);
    reviewCut = await insertReview('cutBundleId', created.cutBundleId);
    await insertSeg(reviewCut, specA, 3, 0);
  });

  afterAll(async () => {
    if (created.reviewIds.length > 0) {
      await prisma.qcReviewSegment.deleteMany({ where: { qcReviewId: { in: created.reviewIds } } });
      await prisma.qcReview.deleteMany({ where: { id: { in: created.reviewIds } } });
    }
    if (created.notificationIds.length > 0) {
      await prisma.notification.deleteMany({ where: { id: { in: created.notificationIds } } });
    }
    if (created.stepBundleIds.length > 0) {
      await prisma.stepBundle.deleteMany({ where: { id: { in: created.stepBundleIds } } });
    }
    if (created.cutBundleId) {
      await prisma.cutPatternSegment.deleteMany({ where: { cutBundleId: created.cutBundleId } });
      await prisma.cutBundle.deleteMany({ where: { id: created.cutBundleId } });
    }
    if (created.steelIssueId) {
      await prisma.steelIssue.deleteMany({ where: { id: created.steelIssueId } });
    }
    if (created.invoiceId) {
      await prisma.productionInvoice.deleteMany({ where: { id: created.invoiceId } });
    }
    if (created.specIds.length > 0) {
      await prisma.segmentSpec.deleteMany({ where: { id: { in: created.specIds } } });
    }
    if (created.materialId) await prisma.material.deleteMany({ where: { id: created.materialId } });
    // chỉ dọn vai / quyền do chính test tạo (vai thật của DB test giữ nguyên)
    if (created.roleId) await prisma.role.deleteMany({ where: { id: created.roleId } });
    if (created.permissionId) {
      await prisma.permission.deleteMany({ where: { id: created.permissionId } });
    }
    if (created.userId) await prisma.user.deleteMany({ where: { id: created.userId } });
    await prisma.$disconnect();
  });

  // =====================================================================================
  describe('thư mục migration', () => {
    it('đủ 2 thư mục, đứng sau migration mới nhất của P3 (20261118080000), đúng thứ tự; thư mục 20261118100200 KHÔNG còn (Câu 1 = B)', () => {
      const dirs = readdirSync(MIGRATIONS_DIR).sort();
      const idx = (d: string) => dirs.indexOf(d);
      for (const d of [DIR_SHORT_SCRAP, DIR_FLOOR_VIEW]) {
        expect(existsSync(join(MIGRATIONS_DIR, d, 'migration.sql'))).toBe(true);
      }
      const p3 = dirs.find((d) => d.startsWith('20261118080000_'));
      expect(p3).toBeDefined();
      expect(idx(DIR_SHORT_SCRAP)).toBeGreaterThan(idx(p3!));
      expect(idx(DIR_FLOOR_VIEW)).toBeGreaterThan(idx(DIR_SHORT_SCRAP));
      expect(existsSync(join(MIGRATIONS_DIR, DIR_OLD_STEP_REMOVED))).toBe(false);
      expect(dirs.some((d) => d.startsWith('20261118100200'))).toBe(false);
    });

    it('2 migration còn lại không nhắc tới 100200 và không có câu UPDATE đổi scrapQty của dữ liệu cũ', () => {
      for (const d of [DIR_SHORT_SCRAP, DIR_FLOOR_VIEW]) {
        const sql = readFileSync(join(MIGRATIONS_DIR, d, 'migration.sql'), 'utf8');
        expect(sql).not.toContain('kcs_old_step_failures_as_scrap');
        expect(sql).not.toContain('100200');
        expect(statementsOf(d).join(' ; ')).not.toMatch(/UPDATE\s+"?qc_review_segments"?/i);
      }
    });
  });

  // =====================================================================================
  // 20261118100000
  // =====================================================================================
  describe('20261118100000_kcs_short_scrap (AC44)', () => {
    it('3 cột mới kiểu INTEGER NOT NULL DEFAULT 0', async () => {
      const cols = await prisma.$queryRawUnsafe<
        Array<{
          table_name: string;
          column_name: string;
          data_type: string;
          is_nullable: string;
          column_default: string | null;
        }>
      >(
        `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND ((table_name = 'qc_reviews' AND column_name = 'shortQty')
             OR (table_name = 'qc_review_segments' AND column_name IN ('shortQty', 'scrapQty')))
         ORDER BY table_name, column_name`,
      );
      expect(cols.map((c) => `${c.table_name}.${c.column_name}`)).toEqual([
        'qc_review_segments.scrapQty',
        'qc_review_segments.shortQty',
        'qc_reviews.shortQty',
      ]);
      for (const c of cols) {
        expect(c.data_type).toBe('integer');
        expect(c.is_nullable).toBe('NO');
        expect(c.column_default).toBe('0');
      }
    });

    it('có CHECK cho shortQty / scrapQty ở cả 2 bảng', async () => {
      const defs = await prisma.$queryRawUnsafe<Array<{ conrelid: string; def: string }>>(
        `SELECT conrelid::regclass::text AS conrelid, pg_get_constraintdef(oid) AS def FROM pg_constraint
         WHERE contype = 'c' AND conrelid IN ('qc_reviews'::regclass, 'qc_review_segments'::regclass)`,
      );
      expect(
        defs.filter((d) => d.conrelid.includes('qc_reviews') && /shortQty/.test(d.def)),
      ).not.toHaveLength(0);
      expect(
        defs.some((d) => d.conrelid.includes('qc_review_segments') && /scrapQty/.test(d.def)),
      ).toBe(true);
      expect(
        defs.some((d) => d.conrelid.includes('qc_review_segments') && /shortQty/.test(d.def)),
      ).toBe(true);
    });

    it('CHECK chặn scrapQty > failedQty và số âm (mã 23514) ở cả 2 bảng; dòng đúng thì ghi được và mặc định 0', async () => {
      const review = await insertReview('stepBundleId', created.stepBundleIds[0]);
      const bad = [
        `INSERT INTO "qc_review_segments" ("qcReviewId", "segmentSpecId", "failedQty", "scrapQty") VALUES (${review}, ${specA}, 5, 6)`,
        `INSERT INTO "qc_review_segments" ("qcReviewId", "segmentSpecId", "failedQty", "shortQty") VALUES (${review}, ${specA}, 5, -1)`,
        `INSERT INTO "qc_review_segments" ("qcReviewId", "segmentSpecId", "failedQty", "scrapQty") VALUES (${review}, ${specA}, 5, -1)`,
        `INSERT INTO "qc_reviews" ("stepBundleId", "failedQty", "shortQty", "reviewedById") VALUES (${created.stepBundleIds[1]}, 0, -1, '${created.userId}')`,
      ];
      for (const sql of bad) expect(await rejects(sql)).toMatch(/23514|check constraint/i);

      await insertSeg(review, specA, 5, 5); // scrap = lỗi: được
      expect(await segRow(review, specA)).toEqual({ failedQty: 5, shortQty: 0, scrapQty: 5 });
      const dflt = await prisma.$queryRawUnsafe<Array<{ shortQty: number }>>(
        `SELECT "shortQty" FROM "qc_reviews" WHERE "id" = ${review}`,
      );
      expect(dflt[0].shortQty).toBe(0);
    });
  });

  // =====================================================================================
  // 20261118100100
  // =====================================================================================
  describe('20261118100100_kcs_floor_report_view (AC44, AC58)', () => {
    it('INSERT chèn đúng 1 dòng KCS_STAFF - FLOOR_REPORT:VIEW, chạy lại không trùng, quyền các vai khác không đổi; câu UPDATE trong CHÍNH file này đóng tin FLOOR_BATCH_STALE cũ', async () => {
      // vai KCS_STAFF + quyền FLOOR_REPORT:VIEW: dùng bản có sẵn, thiếu thì tự dựng (DB test có thể chưa seed)
      let role = await prisma.role.findUnique({ where: { name: 'KCS_STAFF' } });
      if (!role) {
        role = await prisma.role.create({ data: { name: 'KCS_STAFF' } });
        created.roleId = role.id;
      }
      let perm = await prisma.permission.findUnique({
        where: { module_action: { module: 'FLOOR_REPORT', action: 'VIEW' } },
      });
      if (!perm) {
        perm = await prisma.permission.create({ data: { module: 'FLOOR_REPORT', action: 'VIEW' } });
        created.permissionId = perm.id;
      }
      const roleId = role.id;
      // trạng thái "trước migration": chưa có dòng này (globalSetup có thể đã chèn rồi - bỏ ra, chạy lại SQL sẽ chèn lại)
      await prisma.rolePermission.deleteMany({ where: { roleId, permissionId: perm.id } });
      const others = () => prisma.rolePermission.count({ where: { roleId: { not: roleId } } });
      const othersBefore = await others();

      // 3 tin: FLOOR_BATCH_STALE đang mở, FLOOR_BATCH_STALE đã đóng từ trước (giờ cố định), loại khác đang mở
      const resolvedAtFixed = new Date('2026-11-10T03:00:00.000Z');
      const mk = async (type: string, resolvedAt: Date | null) => {
        const n = await prisma.notification.create({
          data: {
            type,
            title: `p1mig ${type}`,
            message: 'm',
            recipients: { create: [{ userId: created.userId, resolvedAt }] },
          },
        });
        created.notificationIds.push(n.id);
        return n.id;
      };
      const nStaleOpen = await mk('FLOOR_BATCH_STALE', null);
      const nStaleDone = await mk('FLOOR_BATCH_STALE', resolvedAtFixed);
      const nOther = await mk('MATERIAL_ISSUE_TO_TEAM', null);
      const recipient = (id: string) =>
        prisma.notificationRecipient.findFirstOrThrow({
          where: { notificationId: id, userId: created.userId },
        });

      const prevAlerts = process.env.FLOOR_ALERTS;
      process.env.FLOOR_ALERTS = 'off'; // AC58: đóng tin cũ không phụ thuộc công tắc nhắc nền
      try {
        await run(DIR_FLOOR_VIEW);
      } finally {
        if (prevAlerts === undefined) delete process.env.FLOOR_ALERTS;
        else process.env.FLOOR_ALERTS = prevAlerts;
      }

      expect(await prisma.rolePermission.count({ where: { roleId, permissionId: perm.id } })).toBe(
        1,
      );
      expect(await others()).toBe(othersBefore);
      expect((await recipient(nStaleOpen)).resolvedAt).not.toBeNull();
      expect((await recipient(nStaleDone)).resolvedAt).toEqual(resolvedAtFixed); // không đóng lại dòng đã đóng
      expect((await recipient(nOther)).resolvedAt).toBeNull(); // loại tin khác không đụng
      // AC58: không còn tin FLOOR_BATCH_STALE nào mở
      expect(
        await prisma.notificationRecipient.count({
          where: { resolvedAt: null, notification: { type: 'FLOOR_BATCH_STALE' } },
        }),
      ).toBe(0);

      // chạy lại: vẫn đúng 1 dòng, không đổi gì thêm
      await run(DIR_FLOOR_VIEW);
      expect(await prisma.rolePermission.count({ where: { roleId, permissionId: perm.id } })).toBe(
        1,
      );
      expect(await others()).toBe(othersBefore);
      expect((await recipient(nStaleDone)).resolvedAt).toEqual(resolvedAtFixed);
    });
  });

  // =====================================================================================
  // Câu 1 = B (19/11): không có migration đổi dữ liệu cũ
  // =====================================================================================
  describe('dữ liệu phiếu chấm công đoạn phụ cũ sau 100000 + 100100 (AC45, Câu 1 = B)', () => {
    it('lỗi công đoạn phụ cũ (stepBundleId, failedQty > 0) giữ scrapQty = 0 (= làm lại); dòng đã có scrap giữ nguyên; lỗi Cắt không đổi', async () => {
      const snapshot = async () =>
        Promise.all([
          segRow(reviewUon, specA),
          segRow(reviewUon, specB),
          segRow(reviewDap, specA),
          segRow(reviewCut, specA),
        ]);
      const expected = [
        { failedQty: 5, shortQty: 0, scrapQty: 0 },
        { failedQty: 3, shortQty: 0, scrapQty: 2 },
        { failedQty: 4, shortQty: 0, scrapQty: 0 },
        { failedQty: 3, shortQty: 0, scrapQty: 0 },
      ];
      expect(await snapshot()).toEqual(expected);

      // chạy NGUYÊN VĂN câu UPDATE / INSERT của 100100 (câu ADD COLUMN của 100000 đã áp bởi globalSetup, không chạy lại)
      await run(DIR_FLOOR_VIEW);

      expect(await snapshot()).toEqual(expected);
    });
  });
});
