import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { PrismaTx } from '../../prisma/prisma.service';
import {
  IdempotencyKeyInUseException,
  IdempotencyKeyReusedException,
  assertSameIdempotentRequest,
  lockIdempotencyKey,
  normalizeIdempotencyKey,
} from './idempotency.util';

describe('assertSameIdempotentRequest', () => {
  it('Decimal / bigint / số / chuỗi số và mảng khác thứ tự coi là bằng nhau', () => {
    const stored = { qty: new Prisma.Decimal('1.0000'), id: 5n, lines: [{ a: 1 }, { a: 2 }] };
    const incoming = { qty: 1, id: '5', lines: [{ a: 2 }, { a: 1 }] };
    expect(() => assertSameIdempotentRequest(stored, incoming)).not.toThrow();
  });

  it('khác số lượng -> 422 IdempotencyKeyReusedException, câu tiếng Việt', () => {
    const stored = { qty: new Prisma.Decimal('1.0000'), id: 5n };
    let err: unknown;
    try {
      assertSameIdempotentRequest(stored, { qty: 5, id: 5n });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(IdempotencyKeyReusedException);
    const ex = err as IdempotencyKeyReusedException;
    expect(ex.getStatus()).toBe(422);
    expect(ex.name).toBe('IdempotencyKeyReusedException');
    expect(ex.message).toMatch(/mã chống trùng/i);
    expect(ex.message).toMatch(/mất mạng/i);
    expect(ex.message).toMatch(/tải lại màn hình/i);
  });

  it('undefined bằng null, trường vắng bằng null', () => {
    expect(() =>
      assertSameIdempotentRequest({ a: 1, w: null }, { a: 1, w: undefined }),
    ).not.toThrow();
    expect(() => assertSameIdempotentRequest({ a: 1, w: null }, { a: 1 })).not.toThrow();
    expect(() => assertSameIdempotentRequest({ a: 1, w: 3n }, { a: 1 })).toThrow(
      IdempotencyKeyReusedException,
    );
  });

  it('mảng so như tập có lặp: thiếu / thừa phần tử lặp là khác', () => {
    expect(() => assertSameIdempotentRequest({ l: [1, 1, 2] }, { l: [2, 1, 1] })).not.toThrow();
    expect(() => assertSameIdempotentRequest({ l: [1, 2] }, { l: [1, 1, 2] })).toThrow(
      IdempotencyKeyReusedException,
    );
  });

  it('làm tròn 4 chữ số; chuỗi không phải số (mã phiếu) so nguyên văn', () => {
    expect(() => assertSameIdempotentRequest({ q: 0.1 + 0.2 }, { q: 0.3 })).not.toThrow();
    expect(() => assertSameIdempotentRequest({ c: 'NK-001' }, { c: 'NK-001' })).not.toThrow();
    expect(() => assertSameIdempotentRequest({ c: 'NK-001' }, { c: 'NK-002' })).toThrow(
      IdempotencyKeyReusedException,
    );
    expect(() => assertSameIdempotentRequest({ c: '001' }, { c: '1' })).toThrow(
      IdempotencyKeyReusedException,
    );
  });
});

describe('normalizeIdempotencyKey', () => {
  it('cắt khoảng trắng', () => {
    expect(normalizeIdempotencyKey(' abc ', true)).toBe('abc');
  });

  it('thiếu / toàn khoảng trắng mà bắt buộc -> 400 "Header Idempotency-Key là bắt buộc"', () => {
    expect(() => normalizeIdempotencyKey('   ', true)).toThrow(
      'Header Idempotency-Key là bắt buộc',
    );
    expect(() => normalizeIdempotencyKey(undefined, true)).toThrow(BadRequestException);
  });

  it('không bắt buộc mà trống -> undefined', () => {
    expect(normalizeIdempotencyKey('  ', false)).toBeUndefined();
    expect(normalizeIdempotencyKey(null, false)).toBeUndefined();
  });

  it('dài 256 ký tự -> 400 câu độ dài; 255 vẫn qua', () => {
    expect(() => normalizeIdempotencyKey('a'.repeat(256), true)).toThrow(/tối đa 255 ký tự/);
    expect(normalizeIdempotencyKey('a'.repeat(255), true)).toHaveLength(255);
  });
});

describe('lockIdempotencyKey', () => {
  const txReturning = (rows: unknown) => {
    const $queryRaw = jest.fn().mockResolvedValue(rows);
    return { tx: { $queryRaw } as unknown as PrismaTx, $queryRaw };
  };

  it('lấy được khoá thì không ném lỗi, dùng pg_try_advisory_xact_lock 2 số', async () => {
    const { tx, $queryRaw } = txReturning([{ ok: true }]);
    await expect(lockIdempotencyKey(tx, 'stock_ledger', 'K')).resolves.toBeUndefined();
    const call = $queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(call[0].join('?')).toContain('pg_try_advisory_xact_lock(hashtext(?), hashtext(?))');
    expect(call.slice(1)).toEqual(['idem:stock_ledger', 'K']);
  });

  it('khoá đang bị giữ -> 409 IdempotencyKeyInUseException', async () => {
    const { tx } = txReturning([{ ok: false }]);
    const err = await lockIdempotencyKey(tx, 'floor_reports', 'K').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IdempotencyKeyInUseException);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as IdempotencyKeyInUseException).name).toBe('IdempotencyKeyInUseException');
    expect((err as IdempotencyKeyInUseException).getStatus()).toBe(409);
  });
});
