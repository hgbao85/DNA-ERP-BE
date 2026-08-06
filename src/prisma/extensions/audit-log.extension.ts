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
const AUDITED_MODELS = new Set([
  'User',
  'Role',
  'UserRole',
  'RolePermission',
  // Phase 2 - independent master-data/BOM entities only, not junction/line-item rows
  // owned by a BomRevision (those change too often while DRAFT to be worth auditing -
  // see CONTRIBUTING.md "2. Audit log").
  'MaterialGroup',
  'Material',
  'Supplier',
  'DefectReason',
  'WeavingPoint',
  'Warehouse',
  'Customer',
  'MfgProduct',
  'ProductVariant',
  'Piece',
  'Part',
  'SegmentSpec',
  'BomRevision',
  // Sales Order + Production Order domain - chỉ audit bảng cha (entity nghiệp vụ độc lập),
  // không audit SalesOrderItem/ProductionInvoiceItem/PlanFormManhReview/PlanFormDetailReview
  // (con, đổi liên tục theo vòng đời cha) - cùng lý do BomPiece/BomPart không được audit.
  'SalesOrder',
  'PlanForm',
  'ProductionInvoice',
  // Phase 3 - WarehouseTransfer là entity nghiệp vụ độc lập với workflow duyệt riêng (PENDING ->
  // CONFIRMED/REJECTED), cùng tier với SalesOrder/ProductionInvoice. Không audit StockLedger
  // (tự nó đã là sổ ghi chép bất biến, có createdBy/createdAt riêng - audit lại là dư thừa),
  // StockQuant (cache, được đồng bộ bởi trigger DB nên Prisma extension không thấy các lần ghi
  // đó), hay WarehouseTransferItem/Reservation (dòng con, cùng lý do BomPiece không được audit).
  'WarehouseTransfer',
]);

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

/**
 * Strip fields that must never land in an audit-log snapshot, even hashed - audit_logs
 * is typically readable by a wider group than raw DB access, so storing the argon2 hash
 * there just widens the offline-brute-force attack surface for no benefit (nothing ever
 * reads password back out of an audit entry).
 */
const REDACTED_FIELDS: Partial<Record<string, string[]>> = {
  User: ['password'],
};

function redact(model: string, record: unknown): unknown {
  const fields = REDACTED_FIELDS[model];
  if (!fields || !record || typeof record !== 'object') {
    return record;
  }
  const clone = { ...(record as Record<string, unknown>) };
  for (const field of fields) {
    if (field in clone) {
      delete clone[field];
    }
  }
  return clone;
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
                newValue: redact(model, result),
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
                oldValue: redact(model, before),
                newValue: redact(model, result),
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
                oldValue: redact(model, before),
              });
            }
            return result;
          },
        },
      },
    });
  });
}
