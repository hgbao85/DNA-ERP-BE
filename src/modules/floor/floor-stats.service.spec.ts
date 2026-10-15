// `jest.Mock#mock.calls` và `where` truyền cho Prisma được jest gõ `any` -> chạm no-unsafe-*; cùng lý do auth.service.spec.ts.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { BadRequestException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { FloorStatsService } from './floor-stats.service';

/** "Báo cáo sản lượng đạt KCS" (2026-10-15, mục 36): đạt/lỗi KCS đã chốt theo ngày/tháng/năm giờ VN. */
describe('FloorStatsService.getStats', () => {
  let prisma: {
    qcReview: { findMany: jest.Mock };
    cutPatternSegment: { findMany: jest.Mock };
    stepBatchSegment: { findMany: jest.Mock };
    productionBatch: { findMany: jest.Mock };
  };
  let service: FloorStatsService;

  // KCS duyệt lúc 00:30 sáng 15/10 giờ VN = 17:30 UTC ngày 14/10 - phải rơi vào ngày 15, không phải 14.
  const T_1510_0030_VN = new Date('2026-10-14T17:30:00Z');
  const T_1510_1000_VN = new Date('2026-10-15T03:00:00Z');
  const T_1610_0900_VN = new Date('2026-10-16T02:00:00Z');
  const T_0911_VN = new Date('2026-09-11T03:00:00Z');

  const user = (id: string, last: string, first: string) => ({
    id,
    lastName: last,
    firstName: first,
    username: id,
  });
  const an = user('u-an', 'Nguyễn', 'An');
  const binh = user('u-binh', 'Trần', 'Bình');
  const spec = (id: number, mm: string, mat = 'Sắt phi 4') => ({
    segmentSpecId: BigInt(id),
    segmentSpec: { cutLengthMm: { toString: () => mm }, material: { name: mat } },
  });

  const cutReview = (
    at: Date,
    openedBy: ReturnType<typeof user> | null,
    segs: { id: number; mm: string; qty: number }[],
    failed: { id: number; failedQty: number }[] = [],
  ) => ({
    reviewedAt: at,
    segments: failed.map((f) => ({ segmentSpecId: BigInt(f.id), failedQty: f.failedQty })),
    cutBundle: {
      openedById: openedBy?.id ?? null,
      openedBy: openedBy
        ? {
            firstName: openedBy.firstName,
            lastName: openedBy.lastName,
            username: openedBy.username,
          }
        : null,
      segments: segs.map((s) => ({ ...spec(s.id, s.mm), qty: s.qty })),
    },
  });

  const batchReview = (
    at: Date,
    stage: string,
    passed: number,
    failedQty: number,
    piece: string,
    by = an,
  ) => ({
    reviewedAt: at,
    failedQty,
    productionBatch: {
      stage,
      reportedQty: passed,
      reportedById: by.id,
      reportedBy: { firstName: by.firstName, lastName: by.lastName, username: by.username },
      piece: { name: piece },
    },
  });

  /** qcReview.findMany trả theo nhánh đang hỏi (cắt / công đoạn phụ / lô Hàn-Sơn). */
  const reviews = (r: { cut?: unknown[]; step?: unknown[]; batch?: unknown[] }) =>
    prisma.qcReview.findMany.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        where.cutBundleId
          ? (r.cut ?? [])
          : where.stepBundleId
            ? (r.step ?? [])
            : where.productionBatchId
              ? (r.batch ?? [])
              : [],
      ),
    );

  beforeEach(() => {
    prisma = {
      qcReview: { findMany: jest.fn().mockResolvedValue([]) },
      cutPatternSegment: { findMany: jest.fn().mockResolvedValue([]) },
      stepBatchSegment: { findMany: jest.fn().mockResolvedValue([]) },
      productionBatch: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new FloorStatsService(prisma as unknown as PrismaServiceType);
  });

  describe('đạt / lỗi theo từng nhánh', () => {
    it('Cắt: đạt = đã cắt − lỗi theo cỡ (dòng xếp cỡ nhỏ đến lớn theo số), ngày tính theo giờ VN (00:30 sáng 15/10 thuộc ngày 15)', async () => {
      reviews({
        cut: [
          cutReview(
            T_1510_0030_VN,
            an,
            [
              { id: 1, mm: '185', qty: 20 },
              { id: 2, mm: '60', qty: 100 },
            ],
            [{ id: 1, failedQty: 2 }],
          ),
        ],
      });
      const r = await service.getStats({ from: '2026-10-14', to: '2026-10-16' });
      expect(r.rows).toEqual([
        {
          bucket: '2026-10-15',
          op: 'CAT',
          workerId: 'u-an',
          workerName: 'Nguyễn An',
          label: '60mm · Sắt phi 4',
          passed: 100,
          failed: 0,
        },
        {
          bucket: '2026-10-15',
          op: 'CAT',
          workerId: 'u-an',
          workerName: 'Nguyễn An',
          label: '185mm · Sắt phi 4',
          passed: 18,
          failed: 2,
        },
      ]);
      expect(r.buckets).toEqual(['2026-10-14', '2026-10-15', '2026-10-16']);
    });

    it('2 đợt cùng ngày, cùng người, cùng cỡ gộp thành 1 dòng; khác người tách dòng', async () => {
      reviews({
        cut: [
          cutReview(T_1510_1000_VN, an, [{ id: 1, mm: '185', qty: 10 }], [{ id: 1, failedQty: 1 }]),
          cutReview(T_1510_1000_VN, an, [{ id: 1, mm: '185', qty: 5 }]),
          cutReview(T_1510_1000_VN, binh, [{ id: 1, mm: '185', qty: 7 }]),
        ],
      });
      const r = await service.getStats({ from: '2026-10-15', to: '2026-10-15' });
      expect(r.rows).toHaveLength(2);
      const byWorker = Object.fromEntries(r.rows.map((x) => [x.workerId, x]));
      expect(byWorker['u-an']).toMatchObject({ passed: 14, failed: 1 });
      expect(byWorker['u-binh']).toMatchObject({ passed: 7, failed: 0 });
    });

    it('Công đoạn phụ: cộng mọi đợt báo trong bundle theo cỡ rồi trừ lỗi; không có người (đợt cũ/gom nhiều người) -> workerId null', async () => {
      reviews({
        step: [
          {
            reviewedAt: T_1510_1000_VN,
            segments: [{ segmentSpecId: 1n, failedQty: 1 }],
            stepBundle: {
              step: 'UON',
              reportedById: null,
              reportedBy: null,
              batches: [
                { segments: [{ ...spec(1, '185'), qty: 10 }] },
                {
                  segments: [
                    { ...spec(1, '185'), qty: 5 },
                    { ...spec(2, '60'), qty: 3 },
                  ],
                },
              ],
            },
          },
        ],
      });
      const r = await service.getStats({ from: '2026-10-15', to: '2026-10-15' });
      expect(r.rows).toEqual([
        {
          bucket: '2026-10-15',
          op: 'UON',
          workerId: null,
          workerName: null,
          label: '60mm · Sắt phi 4',
          passed: 3,
          failed: 0,
        },
        {
          bucket: '2026-10-15',
          op: 'UON',
          workerId: null,
          workerName: null,
          label: '185mm · Sắt phi 4',
          passed: 14,
          failed: 1,
        },
      ]);
    });

    it('Hàn/Sơn: reportedQty đã là phần ĐẠT (KCS ghi đè), lỗi lấy từ failedQty của lần duyệt; tách theo tổ', async () => {
      reviews({
        batch: [
          batchReview(T_1510_1000_VN, 'HAN', 40, 3, 'Mê ngồi'),
          batchReview(T_1510_1000_VN, 'SON', 25, 0, 'Mê ngồi', binh),
        ],
      });
      const r = await service.getStats({ from: '2026-10-15', to: '2026-10-15' });
      expect(r.rows).toEqual([
        {
          bucket: '2026-10-15',
          op: 'HAN',
          workerId: 'u-an',
          workerName: 'Nguyễn An',
          label: 'Mê ngồi',
          passed: 40,
          failed: 3,
        },
        {
          bucket: '2026-10-15',
          op: 'SON',
          workerId: 'u-binh',
          workerName: 'Trần Bình',
          label: 'Mê ngồi',
          passed: 25,
          failed: 0,
        },
      ]);
    });

    it('lô thuộc tổ ngoài sàn (vd DAN) bị bỏ, không lọt vào báo cáo', async () => {
      reviews({ batch: [batchReview(T_1510_1000_VN, 'DAN', 9, 0, 'Khung')] });
      const r = await service.getStats({ from: '2026-10-15', to: '2026-10-15' });
      expect(r.rows).toEqual([]);
    });
  });

  describe('gom theo ngày / tháng / năm', () => {
    const data = () =>
      reviews({
        batch: [
          batchReview(T_0911_VN, 'HAN', 10, 0, 'Mê ngồi'),
          batchReview(T_1510_1000_VN, 'HAN', 20, 1, 'Mê ngồi'),
          batchReview(T_1610_0900_VN, 'HAN', 30, 2, 'Mê ngồi'),
        ],
      });

    it('theo ngày: mỗi ngày một dòng, buckets đủ cả ngày không có số', async () => {
      data();
      const r = await service.getStats({ from: '2026-10-15', to: '2026-10-17', groupBy: 'day' });
      expect(r.rows.map((x) => [x.bucket, x.passed])).toEqual([
        ['2026-09-11', 10],
        ['2026-10-15', 20],
        ['2026-10-16', 30],
      ]);
      expect(r.buckets).toEqual(['2026-10-15', '2026-10-16', '2026-10-17']);
    });

    it('theo tháng: 15 và 16/10 gộp một dòng "2026-10"', async () => {
      data();
      const r = await service.getStats({ from: '2026-09-01', to: '2026-10-31', groupBy: 'month' });
      expect(r.rows.map((x) => [x.bucket, x.passed, x.failed])).toEqual([
        ['2026-09', 10, 0],
        ['2026-10', 50, 3],
      ]);
      expect(r.buckets).toEqual(['2026-09', '2026-10']);
    });

    it('theo năm: gộp cả năm', async () => {
      data();
      const r = await service.getStats({ from: '2026-01-01', to: '2026-12-31', groupBy: 'year' });
      expect(r.rows.map((x) => [x.bucket, x.passed, x.failed])).toEqual([['2026', 60, 3]]);
    });
  });

  describe('lọc theo tổ / công nhân và khoảng thời gian', () => {
    it('khoảng ngày đổi sang mốc giờ VN: từ 00:00 ngày from đến hết ngày to', async () => {
      await service.getStats({ from: '2026-10-15', to: '2026-10-16' });
      const where = prisma.qcReview.findMany.mock.calls[0][0].where;
      expect((where.reviewedAt.gte as Date).toISOString()).toBe('2026-10-14T17:00:00.000Z');
      expect((where.reviewedAt.lt as Date).toISOString()).toBe('2026-10-16T17:00:00.000Z');
    });

    it('tổ HAN: không hỏi nhánh cắt/công đoạn phụ, chỉ lô Hàn', async () => {
      await service.getStats({ from: '2026-10-15', to: '2026-10-15', stage: 'HAN' });
      expect(prisma.qcReview.findMany).toHaveBeenCalledTimes(1);
      const where = prisma.qcReview.findMany.mock.calls[0][0].where;
      expect(where.productionBatchId).toEqual({ not: null });
      expect(where.productionBatch.stage).toEqual({ in: ['HAN'] });
      expect(prisma.cutPatternSegment.findMany).not.toHaveBeenCalled();
      expect(prisma.stepBatchSegment.findMany).not.toHaveBeenCalled();
    });

    it('tổ PHOI: hỏi cắt + công đoạn phụ + lô mảnh của Phôi', async () => {
      await service.getStats({ from: '2026-10-15', to: '2026-10-15', stage: 'PHOI' });
      expect(prisma.qcReview.findMany).toHaveBeenCalledTimes(3);
      const batchWhere = prisma.qcReview.findMany.mock.calls
        .map((c) => c[0].where)
        .find((w) => w.productionBatchId);
      expect(batchWhere.productionBatch.stage).toEqual({ in: ['PHOI'] });
    });

    it('lọc 1 công nhân: điều kiện người làm gắn vào cả 3 nhánh', async () => {
      await service.getStats({ from: '2026-10-15', to: '2026-10-15', workerId: 'u-an' });
      const wheres = prisma.qcReview.findMany.mock.calls.map((c) => c[0].where);
      expect(wheres.find((w) => w.cutBundleId).cutBundle).toEqual({ openedById: 'u-an' });
      expect(wheres.find((w) => w.stepBundleId).stepBundle).toEqual({ reportedById: 'u-an' });
      expect(wheres.find((w) => w.productionBatchId).productionBatch.reportedById).toBe('u-an');
    });

    it('mặc định: hôm nay là `to`, mùng 1 của tháng đó là `from`, theo ngày', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-15T03:00:00Z'));
      try {
        const r = await service.getStats({});
        expect(r.range).toEqual({
          from: '2026-10-01',
          to: '2026-10-15',
          groupBy: 'day',
          timezone: 'Asia/Ho_Chi_Minh',
        });
        expect(r.buckets).toHaveLength(15);
      } finally {
        jest.useRealTimers();
      }
    });

    it('mặc định lúc 00:30 sáng giờ VN (vẫn là ngày hôm trước theo UTC): hôm nay theo giờ VN', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-31T17:30:00Z')); // = 01/11 00:30 giờ VN
      try {
        const r = await service.getStats({});
        expect(r.range.to).toBe('2026-11-01');
        expect(r.range.from).toBe('2026-11-01');
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('kiểm tra đầu vào', () => {
    it('ngày không có thật -> 400', async () => {
      await expect(service.getStats({ from: '2026-02-30', to: '2026-03-01' })).rejects.toThrow(
        BadRequestException,
      );
    });
    it('from sau to -> 400', async () => {
      await expect(service.getStats({ from: '2026-10-16', to: '2026-10-15' })).rejects.toThrow(
        'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc',
      );
    });
    it('xem theo ngày quá 92 ngày -> 400 gợi ý xem theo tháng/năm; theo tháng thì được', async () => {
      await expect(
        service.getStats({ from: '2026-01-01', to: '2026-12-31', groupBy: 'day' }),
      ).rejects.toThrow(/tối đa 92 ngày/);
      await expect(
        service.getStats({ from: '2026-01-01', to: '2026-12-31', groupBy: 'month' }),
      ).resolves.toBeDefined();
    });
    it('không gọi DB khi đầu vào sai', async () => {
      await expect(service.getStats({ from: 'x', to: 'y' })).rejects.toThrow(BadRequestException);
      expect(prisma.qcReview.findMany).not.toHaveBeenCalled();
    });
  });

  describe('thứ tự dòng', () => {
    it('theo kỳ rồi loại việc theo quy trình (Cắt trước Uốn trước Hàn), rồi tên người', async () => {
      reviews({
        cut: [cutReview(T_1610_0900_VN, an, [{ id: 1, mm: '185', qty: 1 }])],
        step: [
          {
            reviewedAt: T_1510_1000_VN,
            segments: [],
            stepBundle: {
              step: 'UON',
              reportedById: 'u-binh',
              reportedBy: { firstName: 'Bình', lastName: 'Trần', username: 'u-binh' },
              batches: [{ segments: [{ ...spec(1, '185'), qty: 1 }] }],
            },
          },
        ],
        batch: [
          batchReview(T_1510_1000_VN, 'HAN', 1, 0, 'Mê ngồi'),
          batchReview(T_1510_1000_VN, 'HAN', 1, 0, 'Mê ngồi', binh),
        ],
      });
      const r = await service.getStats({ from: '2026-10-15', to: '2026-10-16' });
      expect(r.rows.map((x) => `${x.bucket} ${x.op} ${x.workerName}`)).toEqual([
        '2026-10-15 UON Trần Bình',
        '2026-10-15 HAN Nguyễn An',
        '2026-10-15 HAN Trần Bình',
        '2026-10-16 CAT Nguyễn An',
      ]);
    });
  });

  describe('pending - đã báo mà KCS chưa duyệt (tính đến bây giờ)', () => {
    it('Cắt: chưa gửi (CUTTING) tách khỏi chờ KCS (AWAITING_QC)', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([
        { qty: 20, cutBundle: { status: 'CUTTING', openedById: null, openedBy: null } },
        { qty: 100, cutBundle: { status: 'CUTTING', openedById: null, openedBy: null } },
        { qty: 7, cutBundle: { status: 'AWAITING_QC', openedById: null, openedBy: null } },
      ]);
      const r = await service.getStats({ from: '2026-10-15', to: '2026-10-15' });
      expect(r.pending).toEqual([
        { op: 'CAT', workerId: null, workerName: null, notSent: 120, awaitingQc: 7 },
      ]);
      const where = prisma.cutPatternSegment.findMany.mock.calls[0][0].where;
      expect(where.cutBundle.status).toEqual({ in: ['CUTTING', 'AWAITING_QC'] });
    });

    it('Công đoạn phụ: chưa vào bundle = chưa gửi, đã vào bundle chờ KCS = chờ KCS', async () => {
      const none = { reportedById: null, reportedBy: null };
      prisma.stepBatchSegment.findMany.mockResolvedValue([
        { qty: 4, stepBatch: { step: 'UON', stepBundleId: null, ...none } },
        { qty: 6, stepBatch: { step: 'UON', stepBundleId: 9n, ...none } },
        { qty: 2, stepBatch: { step: 'TAN', stepBundleId: null, ...none } },
      ]);
      const r = await service.getStats({ from: '2026-10-15', to: '2026-10-15' });
      expect(r.pending).toEqual([
        { op: 'UON', workerId: null, workerName: null, notSent: 4, awaitingQc: 6 },
        { op: 'TAN', workerId: null, workerName: null, notSent: 2, awaitingQc: 0 },
      ]);
    });

    it('Hàn/Sơn: OPEN = chưa gửi, AWAITING_QC = chờ KCS; sắp theo thứ tự loại việc', async () => {
      const none = { reportedById: null, reportedBy: null };
      prisma.productionBatch.findMany.mockResolvedValue([
        { stage: 'SON', status: 'OPEN', reportedQty: 5, ...none },
        { stage: 'HAN', status: 'AWAITING_QC', reportedQty: 12, ...none },
        { stage: 'HAN', status: 'OPEN', reportedQty: 3, ...none },
      ]);
      const r = await service.getStats({ from: '2026-10-15', to: '2026-10-15' });
      expect(r.pending).toEqual([
        { op: 'HAN', workerId: null, workerName: null, notSent: 3, awaitingQc: 12 },
        { op: 'SON', workerId: null, workerName: null, notSent: 5, awaitingQc: 0 },
      ]);
    });

    it('tách theo công nhân: cùng loại việc, mỗi người một dòng kèm tên (để màn hình lọc "đang chờ" theo người)', async () => {
      const cb = (status: string, u: ReturnType<typeof user>) => ({
        status,
        openedById: u.id,
        openedBy: { firstName: u.firstName, lastName: u.lastName, username: u.username },
      });
      prisma.cutPatternSegment.findMany.mockResolvedValue([
        { qty: 20, cutBundle: cb('CUTTING', an) },
        { qty: 5, cutBundle: cb('AWAITING_QC', an) },
        { qty: 9, cutBundle: cb('CUTTING', binh) },
      ]);
      const r = await service.getStats({ from: '2026-10-15', to: '2026-10-15' });
      expect(r.pending).toEqual([
        { op: 'CAT', workerId: 'u-an', workerName: 'Nguyễn An', notSent: 20, awaitingQc: 5 },
        { op: 'CAT', workerId: 'u-binh', workerName: 'Trần Bình', notSent: 9, awaitingQc: 0 },
      ]);
    });

    it('lọc công nhân áp dụng cho cả số đang chờ', async () => {
      await service.getStats({ from: '2026-10-15', to: '2026-10-15', workerId: 'u-an' });
      expect(prisma.cutPatternSegment.findMany.mock.calls[0][0].where.cutBundle.openedById).toBe(
        'u-an',
      );
      expect(prisma.stepBatchSegment.findMany.mock.calls[0][0].where.stepBatch.reportedById).toBe(
        'u-an',
      );
      expect(prisma.productionBatch.findMany.mock.calls[0][0].where.reportedById).toBe('u-an');
    });
  });

  describe('getMyStats - công nhân chỉ xem được số của CHÍNH mình', () => {
    it('ép workerId = người đăng nhập ở cả 3 nhánh đã duyệt lẫn 3 nhánh đang chờ, đủ mọi tổ', async () => {
      await service.getMyStats('u-an', { from: '2026-10-15', to: '2026-10-15' });
      const wheres = prisma.qcReview.findMany.mock.calls.map((c) => c[0].where);
      expect(wheres).toHaveLength(3); // cắt + công đoạn phụ + lô mảnh (không bị lọc theo tổ)
      expect(wheres.find((w) => w.cutBundleId).cutBundle).toEqual({ openedById: 'u-an' });
      expect(wheres.find((w) => w.stepBundleId).stepBundle).toEqual({ reportedById: 'u-an' });
      expect(wheres.find((w) => w.productionBatchId).productionBatch.reportedById).toBe('u-an');
      expect(prisma.cutPatternSegment.findMany.mock.calls[0][0].where.cutBundle.openedById).toBe(
        'u-an',
      );
      expect(prisma.stepBatchSegment.findMany.mock.calls[0][0].where.stepBatch.reportedById).toBe(
        'u-an',
      );
      expect(prisma.productionBatch.findMany.mock.calls[0][0].where.reportedById).toBe('u-an');
    });

    it('client có gửi workerId/stage của người khác cũng bị bỏ (chỉ lấy from/to/groupBy)', async () => {
      const sneaky = { from: '2026-10-15', to: '2026-10-15', workerId: 'u-binh', stage: 'HAN' };
      await service.getMyStats('u-an', sneaky);
      const wheres = prisma.qcReview.findMany.mock.calls.map((c) => c[0].where);
      expect(wheres).toHaveLength(3);
      expect(JSON.stringify(wheres)).not.toContain('u-binh');
      expect(wheres.find((w) => w.cutBundleId).cutBundle).toEqual({ openedById: 'u-an' });
    });

    it('trả đúng số của mình (khi DB đã lọc theo người)', async () => {
      reviews({ batch: [batchReview(T_1510_1000_VN, 'HAN', 40, 3, 'Mê ngồi')] });
      const r = await service.getMyStats('u-an', { from: '2026-10-15', to: '2026-10-15' });
      expect(r.rows).toEqual([
        {
          bucket: '2026-10-15',
          op: 'HAN',
          workerId: 'u-an',
          workerName: 'Nguyễn An',
          label: 'Mê ngồi',
          passed: 40,
          failed: 3,
        },
      ]);
    });
  });
});
