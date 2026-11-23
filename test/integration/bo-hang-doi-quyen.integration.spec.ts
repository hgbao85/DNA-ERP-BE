import request from 'supertest';
import { MfgRole, MfgStage } from '../../src/generated/prisma/client';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../src/common/constants/roles.constant';
import { BhdCtx, QTY, createBhdCtx, dataOf, setPhoiDoneAt } from './bo-hang-doi.fixture';

/**
 * Bỏ hàng đợi xưởng (23/11/2026) - route và quyền qua HTTP thật. Contract: thiết kế D4 + D5.
 *  AC32  /floor/queue* -> 404; POST /floor/reports/:id/reverse -> 403 câu rõ
 *  D5    GET /floor/stage-progress?stage=&workshopId=  và  GET /floor/stage-progress/:stage/:pi
 *        quyền: QLSX, ADMIN, BOSS; tài khoản tổ chỉ tổ mình; QLSX gắn xưởng chỉ xưởng mình
 *  AC33  KCS vẫn gọi được GET /floor/review
 * Giả định (xem báo cáo): KCS_STAFF không nằm trong "QLSX, ADMIN, BOSS, tài khoản tổ" nên bị 403 ở stage-progress.
 */
interface ProgressRow {
  productionInvoiceId: string;
  code: string;
  deadline: string | null;
  percent: number;
  missingPieces: number;
  complete: boolean;
  phoiDoneAt: string | null;
}

describe('Bỏ hàng đợi: route + quyền stage-progress (integration + HTTP, DB test thật)', () => {
  let c: BhdCtx;
  let wsA: Awaited<ReturnType<BhdCtx['w']['makeWorkshop']>>;
  let wsB: typeof wsA;
  let lA: Awaited<ReturnType<BhdCtx['newPi']>>; // xưởng A, Hàn thấy, chưa báo gì
  let lAfull: typeof lA; // xưởng A, Hàn báo đủ số (đạt)
  let lB: typeof lA; // xưởng B
  let lZ: typeof lA; // xưởng A, đã xong Phôi

  beforeAll(async () => {
    c = await createBhdCtx('quyen');
    wsA = await c.w.makeWorkshop('QA');
    wsB = await c.w.makeWorkshop('QB');
    await c.addUser('admin', DEFAULT_ROLES.ADMIN, null);
    await c.addUser('boss', BUSINESS_ROLES.BOSS, null);
    await c.addUser('qlsx', BUSINESS_ROLES.PRODUCTION_MANAGER, MfgRole.PRODUCTION_MANAGER);
    await c.addUser('qlsxA', BUSINESS_ROLES.PRODUCTION_MANAGER, MfgRole.PRODUCTION_MANAGER, wsA.id);
    await c.addUser('qlsxB', BUSINESS_ROLES.PRODUCTION_MANAGER, MfgRole.PRODUCTION_MANAGER, wsB.id);
    await c.addUser('kcs', BUSINESS_ROLES.KCS_STAFF, MfgRole.KCS);
    await c.addUser('phoiStaff', BUSINESS_ROLES.PHOI_STAFF, MfgRole.PHOI);
    await c.addUser('hanStaff', BUSINESS_ROLES.HAN_STAFF, MfgRole.HAN);
    await c.addUser('sonStaff', BUSINESS_ROLES.SON_STAFF, MfgRole.SON);

    lA = await c.newPi(wsA.id, { deadline: new Date('2026-12-20T00:00:00.000Z') });
    await c.seedPhoiPass(lA);
    lAfull = await c.newPi(wsA.id);
    await c.seedPhoiPass(lAfull);
    await c.seedHanPass(lAfull, { qty: QTY, both: true });
    lB = await c.newPi(wsB.id);
    await c.seedPhoiPass(lB);
    lZ = await c.newPi(wsA.id);
    await setPhoiDoneAt(c.prisma, lZ.piId, new Date());
  }, 120_000);

  afterAll(async () => {
    if (c) await c.cleanup();
  });

  const list = (who: Parameters<BhdCtx['call']>[0], stage: string, workshopId?: bigint) =>
    c.call(
      who,
      'get',
      `/floor/stage-progress?stage=${stage}${workshopId ? `&workshopId=${workshopId}` : ''}`,
    );
  const rowsOf = (res: { body: unknown }) => dataOf<ProgressRow[]>(res as never);
  const codes = (rows: ProgressRow[]) => rows.map((r) => r.code);

  // ===================================================================================
  describe('route hàng đợi đã bỏ (AC32, D4)', () => {
    const removed: Array<['get' | 'post' | 'delete', string, object?]> = [
      ['get', '/floor/queue?stage=HAN'],
      ['get', '/floor/queue/candidates?stage=HAN'],
      ['post', '/floor/queue', { stage: 'HAN', productionInvoiceId: '1' }],
      ['post', '/floor/queue/HAN/reorder', { entryIds: [] }],
      ['post', '/floor/queue/HAN/advance', {}],
      ['post', '/floor/queue/HAN/reopen', {}],
      ['get', '/floor/queue/HAN/detail/1'],
      ['delete', '/floor/queue/1'],
    ];
    it.each(['qlsx', 'admin'] as const)(
      'mọi route /floor/queue* -> 404 (token %s)',
      async (who) => {
        for (const [method, path, body] of removed) {
          const res = await c.call(who, method, path, body);
          expect({ path, status: res.status }).toEqual({ path, status: 404 });
        }
      },
    );

    it.each(['qlsx', 'admin', 'boss', 'kcs'] as const)(
      'POST /floor/reports/:id/reverse -> 403 câu rõ, không phải 404 / 500 (token %s)',
      async (who) => {
        const res = await c
          .call(who, 'post', '/floor/reports/999999999/reverse', { reason: 'nhập nhầm lệnh' })
          .expect(403);
        const message = (res.body as { message?: string | string[] }).message;
        expect(String(message ?? JSON.stringify(res.body)).length).toBeGreaterThan(10);
      },
    );
  });

  // ===================================================================================
  describe('GET /floor/stage-progress (D5)', () => {
    it('QLSX không gắn xưởng + workshopId: 200, mảng đủ trường; thấy lệnh xưởng đó, không thấy lệnh xưởng khác', async () => {
      const res = await list('qlsx', 'HAN', wsA.id).expect(200);
      const rows = rowsOf(res);
      expect(Array.isArray(rows)).toBe(true);
      expect(codes(rows)).toEqual(expect.arrayContaining([lA.code]));
      expect(codes(rows)).not.toContain(lB.code);
      const row = rows.find((r) => r.code === lA.code)!;
      expect(row).toMatchObject({
        productionInvoiceId: lA.piId.toString(),
        deadline: '2026-12-20T00:00:00.000Z',
        missingPieces: QTY * 2,
        complete: false,
        phoiDoneAt: null,
      });
      expect(typeof row.percent).toBe('number');
      // xưởng B
      const resB = await list('qlsx', 'HAN', wsB.id).expect(200);
      expect(codes(rowsOf(resB))).toContain(lB.code);
      expect(codes(rowsOf(resB))).not.toContain(lA.code);
    });

    it('lệnh Hàn đã báo đủ số vẫn nằm trong danh sách (trong 7 ngày gần nhất) với complete = true; lệnh xong Phôi hiện ở stage PHOI với phoiDoneAt', async () => {
      const han = rowsOf(await list('qlsx', 'HAN', wsA.id).expect(200));
      const full = han.find((r) => r.code === lAfull.code);
      expect(full).toBeDefined();
      expect(full!.complete).toBe(true);
      expect(full!.missingPieces).toBe(0);
      expect(full!.percent).toBe(100);

      const phoi = rowsOf(await list('qlsx', 'PHOI', wsA.id).expect(200));
      const z = phoi.find((r) => r.code === lZ.code);
      expect(z).toBeDefined();
      expect(z!.phoiDoneAt).not.toBeNull();
      expect(Number.isNaN(new Date(z!.phoiDoneAt!).getTime())).toBe(false);
    });

    it('productionInvoiceIds=<id>: trả đúng lệnh đó dù xong Phôi đã > 7 ngày (ngoài cửa sổ 7 ngày của danh sách thường)', async () => {
      const old = await c.newPi(wsA.id);
      await setPhoiDoneAt(c.prisma, old.piId, new Date(Date.now() - 10 * 24 * 3_600_000));
      const plain = rowsOf(await list('qlsx', 'PHOI', wsA.id).expect(200));
      expect(codes(plain)).not.toContain(old.code);
      const res = await c
        .call(
          'qlsx',
          'get',
          `/floor/stage-progress?stage=PHOI&workshopId=${wsA.id}&productionInvoiceIds=${old.piId}`,
        )
        .expect(200);
      const rows = rowsOf(res);
      expect(codes(rows)).toEqual([old.code]);
      expect(rows[0].phoiDoneAt).not.toBeNull();
      expect(new Date(rows[0].phoiDoneAt!).getTime()).toBeLessThan(Date.now() - 9 * 24 * 3_600_000);
    });

    it.each(['admin', 'boss'] as const)('%s: 200', async (who) => {
      const rows = rowsOf(await list(who, 'HAN', wsA.id).expect(200));
      expect(codes(rows)).toContain(lA.code);
    });

    it('QLSX gắn xưởng A: xem được xưởng mình (có hoặc không truyền workshopId); xưởng B thì bị chặn 403 hoặc không lộ lệnh nào của B', async () => {
      const own = await list('qlsxA', 'HAN', wsA.id).expect(200);
      expect(codes(rowsOf(own))).toContain(lA.code);
      const noParam = await list('qlsxA', 'HAN');
      if (noParam.status === 200) {
        expect(codes(rowsOf(noParam))).toContain(lA.code);
        expect(codes(rowsOf(noParam))).not.toContain(lB.code);
      } else {
        expect(noParam.status).toBe(400); // buộc truyền workshopId
      }
      const other = await list('qlsxA', 'HAN', wsB.id);
      if (other.status === 200) expect(codes(rowsOf(other))).not.toContain(lB.code);
      else expect(other.status).toBe(403);
    });

    it('tài khoản tổ chỉ xem tổ mình: Hàn xem HAN được (200), PHOI / SON -> 403; Sơn xem SON được, HAN -> 403; Phôi xem PHOI được, HAN -> 403', async () => {
      await list('hanStaff', 'HAN', wsA.id).expect(200);
      await list('hanStaff', 'PHOI', wsA.id).expect(403);
      await list('hanStaff', 'SON', wsA.id).expect(403);
      await list('sonStaff', 'SON', wsA.id).expect(200);
      await list('sonStaff', 'HAN', wsA.id).expect(403);
      await list('phoiStaff', 'PHOI', wsA.id).expect(200);
      await list('phoiStaff', 'HAN', wsA.id).expect(403);
    });

    it('KCS không có quyền xem (403); không đăng nhập -> 401; stage sai -> 400', async () => {
      await list('kcs', 'HAN', wsA.id).expect(403);
      await request(c.app.getHttpServer() as Parameters<typeof request>[0])
        .get(`/api/v1/floor/stage-progress?stage=HAN&workshopId=${wsA.id}`)
        .expect(401);
      await c.call('qlsx', 'get', '/floor/stage-progress?stage=XYZ').expect(400);
    });
  });

  // ===================================================================================
  describe('GET /floor/stage-progress/:stage/:productionInvoiceId (D5)', () => {
    const detail = (who: Parameters<BhdCtx['call']>[0], stage: string, pi: bigint) =>
      c.call(who, 'get', `/floor/stage-progress/${stage}/${pi}`);

    it('QLSX / Admin / Boss: 200, thân đúng dạng stageDetail (productionInvoiceId, piCode, stage, progress, orders, plans, phoi)', async () => {
      for (const who of ['qlsx', 'admin', 'boss'] as const) {
        const d = dataOf<{
          productionInvoiceId: string;
          piCode: string;
          stage: string;
          progress: { complete: boolean; required: number; percent: number };
          orders: unknown[];
          plans: Record<string, unknown>;
          phoi: unknown;
        }>(await detail(who, 'HAN', lA.piId).expect(200));
        expect(d.productionInvoiceId).toBe(lA.piId.toString());
        expect(d.piCode).toBe(lA.code);
        expect(d.stage).toBe('HAN');
        expect(d.progress.complete).toBe(false);
        expect(d.progress.required).toBe(QTY * 2);
        expect(d.orders).toHaveLength(1);
        expect(Object.keys(d.plans)).toEqual([lA.orderIds[0].toString()]);
        expect(d.phoi).toBeNull();
      }
      const full = dataOf<{ progress: { complete: boolean } }>(
        await detail('qlsx', 'HAN', lAfull.piId).expect(200),
      );
      expect(full.progress.complete).toBe(true);
    });

    it('tài khoản tổ: tổ mình 200, tổ khác 403; KCS 403; PI không tồn tại 404', async () => {
      await detail('hanStaff', 'HAN', lA.piId).expect(200);
      await detail('hanStaff', 'SON', lA.piId).expect(403);
      await detail('hanStaff', 'PHOI', lA.piId).expect(403);
      await detail('sonStaff', 'SON', lA.piId).expect(200);
      await detail('phoiStaff', 'PHOI', lA.piId).expect(200);
      await detail('kcs', 'HAN', lA.piId).expect(403);
      await detail('qlsx', 'HAN', 999999999n).expect(404);
    });

    it('QLSX gắn xưởng B không xem được chi tiết lệnh của xưởng A (403 hoặc 404); xưởng mình 200', async () => {
      await detail('qlsxB', 'HAN', lB.piId).expect(200);
      const res = await detail('qlsxB', 'HAN', lA.piId);
      expect([403, 404]).toContain(res.status);
      await detail('qlsxA', 'HAN', lA.piId).expect(200);
    });
  });

  // ===================================================================================
  it('AC33: KCS vẫn gọi được GET /floor/review của 3 tổ (200)', async () => {
    for (const stage of [MfgStage.PHOI, MfgStage.HAN, MfgStage.SON]) {
      await c.call('kcs', 'get', `/floor/review?stage=${stage}`).expect(200);
    }
  });
});
