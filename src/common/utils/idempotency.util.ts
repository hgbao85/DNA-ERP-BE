import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { PrismaTx } from '../../prisma/prisma.service';

/**
 * QUY ƯỚC CHỐNG TRÙNG (Idempotency-Key) - NGUỒN DUY NHẤT, mọi module dùng chung (20/11/2026).
 * Theo IETF "Idempotency-Key HTTP Header", OASIS Repeatable Requests và cách Stripe.
 *
 * - Client gửi UUID v4 qua header `Idempotency-Key`, dài 1-255 ký tự sau khi cắt khoảng trắng.
 * - Cùng khoá, cùng "vân tay", đã ghi: trả lại kết quả cũ (cùng mã 2xx), KHÔNG chạy lại việc phụ
 *   (thông báo, realtime, cộng số...).
 * - Khác vân tay, khác người hoặc khác loại thao tác: 422, `IdempotencyKeyReusedException`.
 * - Bản trùng đang chạy song song: 409, `IdempotencyKeyInUseException`. Đây là trường hợp DUY NHẤT
 *   client được bấm lại với cùng khoá.
 * - Thiếu khoá ở route bắt buộc: 400.
 * - Vân tay = các trường nghiệp vụ đã lưu sẵn trên dòng (không thêm cột băm). Không so ghi chú và ảnh.
 * - Cơ chế: đọc nhanh ngoài transaction -> câu ĐẦU của transaction là `lockIdempotencyKey` (try-lock,
 *   không chờ) -> đọc lại trong transaction -> ghi; unique index là chốt cuối cùng.
 *   Thứ tự khoá: khoá chống trùng TRƯỚC, rồi mới các khoá nghiệp vụ (`lockBusinessKey`) của luồng đó.
 * - Lỗi 4xx / 5xx không lưu gì (khoá nằm cùng transaction với thao tác nên rollback là hết).
 *
 * Tên 2 lớp exception là contract BE <-> FE: bộ lọc lỗi trả `error = exception.name`, màn hình so trường
 * này (FE chỉ giữ khoá cũ khi statusCode 0 hoặc 409 'IdempotencyKeyInUseException').
 */

/** Khoá dùng lại cho thao tác khác (khác người / loại / nội dung) - 422. */
export class IdempotencyKeyReusedException extends UnprocessableEntityException {
  constructor() {
    super(
      'Mã chống trùng của lần gửi này đã được dùng cho một thao tác khác (khác người, khác loại hoặc khác nội dung). Nếu bạn vừa bị mất mạng thì lần gửi trước có thể đã được ghi - tải lại màn hình để xem, rồi mới thao tác lại',
    );
  }
}

/** Bản trùng đang chạy song song - 409, chỉ trường hợp này được bấm lại với cùng khoá. */
export class IdempotencyKeyInUseException extends ConflictException {
  constructor() {
    super('Lần gửi trước của thao tác này đang được xử lý - chờ giây lát rồi bấm lại');
  }
}

/** Phạm vi khoá: cùng chuỗi khoá ở 2 phạm vi khác nhau không chặn nhau. */
export type IdempotencyScope =
  'notifications' | 'purchase_receipts' | 'stock_ledger' | 'floor_reports';

const MAX_KEY_LENGTH = 255;

/** Cắt khoảng trắng và kiểm độ dài 1-255. `required` mà thiếu -> 400; không bắt buộc mà trống -> undefined. */
export function normalizeIdempotencyKey(raw: string | null | undefined, required: true): string;
export function normalizeIdempotencyKey(
  raw: string | null | undefined,
  required: boolean,
): string | undefined;
export function normalizeIdempotencyKey(
  raw: string | null | undefined,
  required: boolean,
): string | undefined {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!key) {
    if (required) throw new BadRequestException('Header Idempotency-Key là bắt buộc');
    return undefined;
  }
  if (key.length > MAX_KEY_LENGTH) {
    throw new BadRequestException(
      `Header Idempotency-Key tối đa ${MAX_KEY_LENGTH} ký tự (nhận ${key.length})`,
    );
  }
  return key;
}

/**
 * Câu ĐẦU của transaction: lấy khoá advisory (không chờ) theo (phạm vi, khoá). Có người khác đang giữ
 * thì ném 409 `IdempotencyKeyInUseException` ngay. Khoá tự nhả khi transaction kết thúc. Dùng dạng 2 số
 * int4 nên không đụng không gian khoá 1 số bigint của `lockBusinessKey`.
 */
export async function lockIdempotencyKey(
  tx: PrismaTx,
  scope: IdempotencyScope,
  key: string,
): Promise<void> {
  const rows = await tx.$queryRaw<{ ok: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(hashtext(${`idem:${scope}`}), hashtext(${key})) AS ok`;
  if (rows?.[0]?.ok === false) throw new IdempotencyKeyInUseException();
}

const NUMERIC_TEXT = /^-?(0|[1-9]\d*)(\.\d+)?$/;

function numberText(fixed: string): string {
  const text = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
  return text === '-0' || text === '' ? '0' : text;
}

/** Đưa về dạng so sánh: số -> chuỗi làm tròn 4 chữ số, undefined = null, mảng = tập có lặp đã sắp xếp. */
function canonical(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'bigint') return `n:${value.toString()}`;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? `n:${numberText(value.toFixed(4))}` : `s:${String(value)}`;
  }
  if (Prisma.Decimal.isDecimal(value)) return `n:${numberText(value.toFixed(4))}`;
  if (typeof value === 'boolean') return `b:${value}`;
  if (typeof value === 'string') {
    return NUMERIC_TEXT.test(value) ? `n:${numberText(Number(value).toFixed(4))}` : `s:${value}`;
  }
  if (value instanceof Date) return `d:${value.toISOString()}`;
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // Trường undefined / null coi như vắng mặt.
    const parts = Object.keys(obj)
      .filter((k) => obj[k] !== undefined && obj[k] !== null)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`);
    return `{${parts.join(',')}}`;
  }
  return 's:?';
}

/**
 * So vân tay lần đã lưu với lần gửi lại; khác -> 422 `IdempotencyKeyReusedException`. Số (bigint / number /
 * Decimal / chuỗi số) so theo giá trị làm tròn 4 chữ số; hai bên đều thiếu trường coi như bằng nhau.
 */
export function assertSameIdempotentRequest(stored: unknown, incoming: unknown): void {
  if (canonical(stored) !== canonical(incoming)) throw new IdempotencyKeyReusedException();
}
