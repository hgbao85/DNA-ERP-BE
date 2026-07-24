/**
 * Dynamic model dispatch (`client[modelKey]`) is inherently untyped - Prisma has no
 * generic "lookup a delegate by model name string" API. Disabled file-wide rather
 * than per call-site since every unsafe-* warning here traces back to that one gap.
 */
/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { AuditAction, Prisma, PrismaClient } from '../../generated/prisma/client';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { SOFT_DELETE_MODELS } from '../soft-delete-models.constant';

/** Models whose create/update/delete operations are recorded to AuditLog. */
const AUDITED_MODELS = new Set(['User', 'Role', 'UserRole', 'RolePermission']);

/** Minimal shape needed to dynamically call `client[modelKey].findFirst(...)` by model name. */
interface DynamicDelegateClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [modelKey: string]: any;
}

function toModelKey(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

function extractId(record: unknown): string {
  if (record && typeof record === 'object' && 'id' in record) {
    return String(record.id);
  }
  return 'unknown';
}

async function writeAuditLog(
  client: Pick<PrismaClient, 'auditLog'>,
  cls: ClsService<AppClsStore>,
  entry: {
    action: AuditAction;
    tableName: string;
    recordId: string;
    oldValue?: unknown;
    newValue?: unknown;
  },
): Promise<void> {
  const userId = cls.isActive() ? cls.get('userId') : undefined;
  const ip = cls.isActive() ? cls.get('ip') : undefined;
  const correlationId = cls.isActive() ? cls.getId() : undefined;

  await client.auditLog.create({
    data: {
      userId: userId ?? null,
      action: entry.action,
      tableName: entry.tableName,
      recordId: entry.recordId,
      oldValue: entry.oldValue ?? Prisma.JsonNull,
      newValue: entry.newValue ?? Prisma.JsonNull,
      ipAddress: ip ?? null,
      correlationId: correlationId ?? null,
    },
  });
}

/**
 * Prisma Client Extension standing in for the deprecated `$use` middleware API:
 * records create/update/delete on tracked models to AuditLog, attributing the
 * change to the current request's user/ip/correlation id via nestjs-cls.
 *
 * Known limitation: batch operations (updateMany/deleteMany) are not audited
 * per-row here to keep the scaffold simple - extend if a future module needs it.
 */
export function withAuditLog(cls: ClsService<AppClsStore>) {
  return Prisma.defineExtension((client) => {
    // Prisma's generic `Exact` machinery can't structurally verify the extended
    // client against a plain PrismaClient pick, even though it's a superset at
    // runtime - cast once here rather than fighting it at every call site.
    const auditLogClient = client as unknown as Pick<PrismaClient, 'auditLog'>;

    return client.$extends({
      name: 'audit-log',
      query: {
        $allModels: {
          async create({ model, args, query }) {
            const result = await query(args);
            if (AUDITED_MODELS.has(model)) {
              await writeAuditLog(auditLogClient, cls, {
                action: AuditAction.CREATE,
                tableName: model,
                recordId: extractId(result),
                newValue: result,
              });
            }
            return result;
          },
          async update({ model, args, query }) {
            let before: unknown = null;
            if (AUDITED_MODELS.has(model)) {
              const modelKey = toModelKey(model);
              before = await (client as DynamicDelegateClient)[modelKey]
                .findFirst({ where: args.where })
                .catch(() => null);
            }
            const result = await query(args);
            if (AUDITED_MODELS.has(model)) {
              await writeAuditLog(auditLogClient, cls, {
                action: AuditAction.UPDATE,
                tableName: model,
                recordId: extractId(result) !== 'unknown' ? extractId(result) : extractId(before),
                oldValue: before,
                newValue: result,
              });
            }
            return result;
          },
          async delete({ model, args, query }) {
            // Soft-deletable models never reach a real DELETE: the soft-delete extension
            // rewrites the operation into an UPDATE before it gets here, which is where
            // it's logged instead. Logging it again here would double-count the action.
            const shouldAudit = AUDITED_MODELS.has(model) && !SOFT_DELETE_MODELS.has(model);
            let before: unknown = null;
            if (shouldAudit) {
              const modelKey = toModelKey(model);
              before = await (client as DynamicDelegateClient)[modelKey]
                .findFirst({ where: args.where })
                .catch(() => null);
            }
            const result = await query(args);
            if (shouldAudit) {
              await writeAuditLog(auditLogClient, cls, {
                action: AuditAction.DELETE,
                tableName: model,
                recordId: extractId(before) !== 'unknown' ? extractId(before) : extractId(result),
                oldValue: before,
              });
            }
            return result;
          },
        },
      },
    });
  });
}
