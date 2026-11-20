import { FloorReportKind, Prisma } from '../../generated/prisma/client';
import { assertFloorReportReplayMatches, isIdempotencyConflict } from './floor-report.util';
import { IdempotencyKeyReusedException } from './idempotency.util';

const p2002 = (meta: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test', meta });

describe('isIdempotencyConflict', () => {
  it('nhận đúng dạng lỗi của Prisma 7 + adapter-pg (không có meta.target)', () => {
    // Dạng lấy thật từ DB local 2026-10-13 khi chèn trùng floor_reports.idempotencyKey.
    const e = p2002({
      modelName: 'FloorReport',
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: {
          originalCode: '23505',
          kind: 'UniqueConstraintViolation',
          constraint: { fields: ['"idempotencyKey"'] },
        },
      },
    });
    expect(isIdempotencyConflict(e)).toBe(true);
  });

  it('vẫn nhận dạng cũ meta.target', () => {
    expect(isIdempotencyConflict(p2002({ target: ['idempotencyKey'] }))).toBe(true);
  });

  it('trùng cột khác (vd reversalOfId) không phải trùng khoá', () => {
    const e = p2002({
      driverAdapterError: { cause: { constraint: { fields: ['"reversalOfId"'] } } },
    });
    expect(isIdempotencyConflict(e)).toBe(false);
    expect(isIdempotencyConflict(new Error('x'))).toBe(false);
  });
});

describe('assertFloorReportReplayMatches (T4-4, 20/11/2026)', () => {
  type Prev = Parameters<typeof assertFloorReportReplayMatches>[0];
  const pieceReport = (over: Record<string, unknown> = {}): Prev =>
    ({
      kind: FloorReportKind.PIECE,
      reportedById: 'han-1',
      workstationId: 7n,
      lines: [{ segmentSpecId: null, pieceId: 3n, qty: 2 }],
      stepBatch: null,
      cutBundle: null,
      productionBatch: { stage: 'HAN', productionOrderId: 11n, pieceId: 3n },
      ...over,
    }) as unknown as Prev;
  const pieceExpected = {
    kind: FloorReportKind.PIECE,
    reportedById: 'han-1',
    workstationId: 7n,
    lines: [{ pieceId: 3n, qty: 2 }],
    batch: { stage: 'HAN', productionOrderId: 11n, pieceId: 3n },
  };

  it('cùng người, máy, mảnh, số lượng, đợt -> qua', () => {
    expect(() => assertFloorReportReplayMatches(pieceReport(), pieceExpected)).not.toThrow();
  });

  it.each([
    ['khác số lượng', { lines: [{ pieceId: 3n, qty: 3 }] }],
    ['khác người', { reportedById: 'son-1' }],
    ['khác máy', { workstationId: 8n }],
    ['khác mảnh', { lines: [{ pieceId: 4n, qty: 2 }] }],
    ['khác lệnh', { batch: { stage: 'HAN', productionOrderId: 12n, pieceId: 3n } }],
    ['khác tổ', { batch: { stage: 'SON', productionOrderId: 11n, pieceId: 3n } }],
    ['khác loại báo', { kind: FloorReportKind.CUT }],
  ])('%s -> 422 IdempotencyKeyReusedException', (_label, patch) => {
    expect(() =>
      assertFloorReportReplayMatches(pieceReport(), { ...pieceExpected, ...patch }),
    ).toThrow(IdempotencyKeyReusedException);
  });

  it('công đoạn phụ: cùng cỡ đoạn, cùng số nhưng khác công đoạn hoặc vật tư -> 422', () => {
    const prev = {
      kind: FloorReportKind.STEP,
      reportedById: 'cn-1',
      workstationId: null,
      lines: [{ segmentSpecId: 9n, pieceId: null, qty: 5 }],
      stepBatch: { productionInvoiceId: 1n, materialId: 2n, step: 'UON', productionOrderId: 4n },
      cutBundle: null,
      productionBatch: null,
    } as unknown as Prev;
    const exp = {
      kind: FloorReportKind.STEP,
      reportedById: 'cn-1',
      lines: [{ segmentSpecId: 9n, qty: 5 }],
      step: { productionInvoiceId: 1n, materialId: 2n, step: 'UON', productionOrderId: 4n },
    };
    expect(() => assertFloorReportReplayMatches(prev, exp)).not.toThrow();
    expect(() =>
      assertFloorReportReplayMatches(prev, { ...exp, step: { ...exp.step, step: 'DAP' } }),
    ).toThrow(IdempotencyKeyReusedException);
    expect(() =>
      assertFloorReportReplayMatches(prev, { ...exp, step: { ...exp.step, materialId: 3n } }),
    ).toThrow(IdempotencyKeyReusedException);
  });

  it('công đoạn phụ: QLSX đổi SKU của đợt rồi máy gửi lại cùng khoá -> KHÔNG 422 (không so SKU), nhưng khác PI vẫn 422', () => {
    const prev = {
      kind: FloorReportKind.STEP,
      reportedById: 'cn-1',
      workstationId: null,
      lines: [{ segmentSpecId: 9n, pieceId: null, qty: 5 }],
      stepBatch: { productionInvoiceId: 1n, materialId: 2n, step: 'UON', productionOrderId: 4n },
      cutBundle: null,
      productionBatch: null,
    } as unknown as Prev;
    const exp = {
      kind: FloorReportKind.STEP,
      reportedById: 'cn-1',
      lines: [{ segmentSpecId: 9n, qty: 5 }],
      step: { productionInvoiceId: 1n, materialId: 2n, step: 'UON', productionOrderId: 99n },
    };
    expect(() => assertFloorReportReplayMatches(prev, exp)).not.toThrow();
    expect(() =>
      assertFloorReportReplayMatches(prev, {
        ...exp,
        step: { ...exp.step, productionInvoiceId: 7n },
      }),
    ).toThrow(IdempotencyKeyReusedException);
  });

  it('báo cắt: gửi sang lô khác -> 422; lần báo cũ đã bị hủy hết (không còn lô) thì không so lô', () => {
    const prev = {
      kind: FloorReportKind.CUT,
      reportedById: 'cn-1',
      workstationId: null,
      lines: [{ segmentSpecId: 9n, pieceId: null, qty: 10 }],
      stepBatch: null,
      cutBundle: { steelIssueId: 100n },
      productionBatch: null,
    } as unknown as Prev;
    const exp = {
      kind: FloorReportKind.CUT,
      reportedById: 'cn-1',
      lines: [{ segmentSpecId: 9n, qty: 10 }],
      cutIssueId: 100n,
    };
    expect(() => assertFloorReportReplayMatches(prev, exp)).not.toThrow();
    expect(() => assertFloorReportReplayMatches(prev, { ...exp, cutIssueId: 101n })).toThrow(
      IdempotencyKeyReusedException,
    );
    const reversed = { ...prev, cutBundle: null } as unknown as Prev;
    expect(() =>
      assertFloorReportReplayMatches(reversed, { ...exp, cutIssueId: 101n }),
    ).not.toThrow();
  });
});
