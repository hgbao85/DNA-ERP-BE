import { BadRequestException } from '@nestjs/common';

const MAX_BIGINT_ID = 9223372036854775807n;

/**
 * Parses a route param into a bigint PK. Phase 2+ domain tables use bigint (not the UUID
 * used by Auth/Core - see schema.prisma "Phase 2" section), so every P2+ controller needs
 * this instead of passing the raw string id straight to Prisma. Rejects non-digit input
 * with a 400 instead of letting `BigInt("abc")` throw an unhandled SyntaxError.
 */
export function parseBigIntId(raw: string): bigint {
  if (!/^\d+$/.test(raw)) {
    throw new BadRequestException(`Mã (id) không hợp lệ: ${raw}`);
  }
  const value = BigInt(raw);
  // 19/11/2026 (T3-10): vượt khoảng bigint của Postgres thì xuống DB thành 500 - chặn ở đây.
  if (value > MAX_BIGINT_ID) {
    throw new BadRequestException(`Mã (id) không hợp lệ: ${raw}`);
  }
  return value;
}
