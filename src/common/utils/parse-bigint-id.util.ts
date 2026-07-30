import { BadRequestException } from '@nestjs/common';

/**
 * Parses a route param into a bigint PK. Phase 2+ domain tables use bigint (not the UUID
 * used by Auth/Core - see schema.prisma "Phase 2" section), so every P2+ controller needs
 * this instead of passing the raw string id straight to Prisma. Rejects non-digit input
 * with a 400 instead of letting `BigInt("abc")` throw an unhandled SyntaxError.
 */
export function parseBigIntId(raw: string): bigint {
  if (!/^\d+$/.test(raw)) {
    throw new BadRequestException(`Invalid id: ${raw}`);
  }
  return BigInt(raw);
}
