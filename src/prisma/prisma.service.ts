import { PrismaPg } from '@prisma/adapter-pg';
import { ClsService } from 'nestjs-cls';
import { PrismaClient } from '../generated/prisma/client';
import { AppClsStore } from '../common/interfaces/cls-store.interface';
import { withAuditLog } from './extensions/audit-log.extension';
import { withSoftDelete } from './extensions/soft-delete.extension';

/**
 * Extension order matters: audit-log is applied first (inner layer), soft-delete
 * second (outer layer). This way, when soft-delete rewrites a `delete` into an
 * `update` on a tracked model, that rewritten call re-enters the chain and is
 * picked up exactly once by audit-log's `update` hook - avoiding double logging
 * that would happen if the layers were reversed.
 */
export function createExtendedPrismaClient(cls: ClsService<AppClsStore>) {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const client = new PrismaClient({ adapter });
  return client.$extends(withAuditLog(cls)).$extends(withSoftDelete());
}

export type PrismaServiceType = ReturnType<typeof createExtendedPrismaClient>;

/** DI token for the extended Prisma client. Inject with `@Inject(PRISMA_SERVICE)`. */
export const PRISMA_SERVICE = Symbol('PRISMA_SERVICE');
