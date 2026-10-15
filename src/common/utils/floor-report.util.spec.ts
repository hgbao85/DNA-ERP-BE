import { Prisma } from '../../generated/prisma/client';
import { isIdempotencyConflict } from './floor-report.util';

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
