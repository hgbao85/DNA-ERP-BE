import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  AuditAction,
  DeadlineChangeBatchStatus,
  DeadlineChangeRequestStatus,
  Prisma,
  ProductionInvoiceStatus,
  ProductionOrderFloorStage,
  ProdApprovalStatus,
} from '../../../generated/prisma/client';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../../common/constants/roles.constant';
import { AppClsStore } from '../../../common/interfaces/cls-store.interface';
import { lockBusinessKey } from '../../../common/utils/advisory-lock.util';
import { vnDayKey } from '../../../common/utils/floor-stats.util';
import { loadLenhDisplayCodes } from '../../../common/utils/lenh-code.util';
import { milestoneOrderWarnings } from '../../../common/utils/milestone-order.util';
import { parseBigIntId } from '../../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ItemDeadlineWriter } from '../item-deadline-writer.service';
import { DeadlineActor, DeadlineChangesPort } from './deadline-changes.port';
import {
  DEADLINE_FIELDS,
  DeadlineChangeBatchDto,
  DeadlineChangeRequestDto,
  DeadlineChangeSource,
  DeadlineEntryCheck,
  DeadlineEntryInput,
  DeadlineFieldChange,
  DeadlineFieldKey,
  DeadlineHistoryEntry,
  DeadlineSaveResult,
  DeadlineValues,
  DecideDeadlineBatchInput,
  ORDER_VIOLATION_BLOCKS,
  PendingDeadlineChangeRef,
  UserRef,
} from './deadline-changes.types';
import {
  diffValues,
  fieldLabel,
  pendingRefOf,
  pickChanged,
  valuesOfItem,
} from './deadline-values.util';

/** Dòng SKU kèm mọi thứ cần để kiểm 1 dòng nhập (xem `evaluate`). */
const ITEM_INCLUDE = {
  productionInvoice: { select: { id: true, code: true, status: true, isMerged: true } },
  mfgProduct: { select: { factoryCode: true, name: true } },
  stages: true,
  productionOrder: { select: { floorStage: true } },
  deadlineChangeRequests: { where: { status: 'PENDING' as const }, select: { id: true } },
} satisfies Prisma.ProductionInvoiceItemInclude;
type LoadedItem = Prisma.ProductionInvoiceItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

const USER_SELECT = { id: true, firstName: true, lastName: true } as const;
const BATCH_INCLUDE = {
  requestedBy: { select: USER_SELECT },
  decidedBy: { select: USER_SELECT },
  requests: {
    orderBy: { id: 'asc' as const },
    include: {
      productionInvoiceItem: {
        include: {
          productionInvoice: { select: { id: true, code: true } },
          mfgProduct: { select: { factoryCode: true, name: true } },
          stages: true,
        },
      },
    },
  },
} satisfies Prisma.DeadlineChangeBatchInclude;
type LoadedBatch = Prisma.DeadlineChangeBatchGetPayload<{ include: typeof BATCH_INCLUDE }>;

type Db = Pick<PrismaServiceType, 'productionInvoiceItem' | 'productionInvoice' | 'systemConfig'>;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const FIELD_KEYS = new Set<string>(DEADLINE_FIELDS.map((f) => f.key));
const REVIEWER_ROLES: string[] = [
  BUSINESS_ROLES.BOSS,
  BUSINESS_ROLES.PRODUCTION_MANAGER,
  DEFAULT_ROLES.ADMIN,
];
const NOTE_APPROVED = 'Sếp đã duyệt';
const REJECT_REASON_MIN = 3;

const isValidDay = (s: unknown): s is string => {
  if (typeof s !== 'string' || !DAY_RE.test(s)) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const dm = (day: string | null | undefined) =>
  day ? `${day.slice(8, 10)}/${day.slice(5, 7)}` : '(chưa có)';
const userName = (u: { firstName: string; lastName: string }) =>
  `${u.firstName} ${u.lastName}`.trim();
const userRef = (u: { id: string; firstName: string; lastName: string }): UserRef => ({
  id: u.id,
  name: userName(u),
});

/**
 * Phần A – Đợt 9 (YC2): lõi "sửa kế hoạch ở mọi giai đoạn + Sếp duyệt lại". Dòng SKU chưa Sếp duyệt → ghi mốc thẳng (cùng đường ghi,
 * audit, thông báo như "Sửa thời hạn" cũ); dòng đã duyệt → yêu cầu trong 1 lô chờ Sếp (mốc cũ vẫn chạy tới khi duyệt). Mọi quyết định
 * kiểm LẠI trong giao dịch dưới khoá nghiệp vụ theo dòng (+ theo lệnh) nên 2 người cùng sửa không lách được. Thiết kế: plan mục 5b.
 */
@Injectable()
export class DeadlineChangesService implements DeadlineChangesPort {
  private readonly logger = new Logger(DeadlineChangesService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly cls: ClsService<AppClsStore>,
    private readonly notifications: NotificationsService,
    private readonly writer: ItemDeadlineWriter,
  ) {}

  // ─── Kiểm (không ghi) ─────────────────────────────────────────────────────────────────────────

  async previewEntries(entries: DeadlineEntryInput[]): Promise<DeadlineEntryCheck[]> {
    return (await this.evaluate(this.prisma, entries)).checks;
  }

  /**
   * Kiểm từng dòng nhập. Dùng cho cả preview (ngoài giao dịch) và kiểm lại trong giao dịch của saveEntries. Trả thêm các dòng SKU đã
   * nạp (trạng thái TRƯỚC khi ghi) để saveEntries ghi audit.
   */
  private async evaluate(
    db: Db,
    entries: DeadlineEntryInput[],
  ): Promise<{ checks: DeadlineEntryCheck[]; items: Map<string, LoadedItem> }> {
    const ids = [
      ...new Set(entries.filter((e) => /^\d+$/.test(e.itemId)).map((e) => BigInt(e.itemId))),
    ];
    const loaded = ids.length
      ? await db.productionInvoiceItem.findMany({
          where: { id: { in: ids } },
          include: ITEM_INCLUDE,
        })
      : [];
    const items = new Map(loaded.map((i) => [i.id.toString(), i]));
    const piIds = [
      ...new Set(loaded.filter((i) => i.productionInvoiceId).map((i) => i.productionInvoiceId!)),
    ];
    const displayCodes = await loadLenhDisplayCodes(db, piIds);

    const seen = new Set<string>();
    const checks: DeadlineEntryCheck[] = entries.map((entry) => {
      const item = items.get(entry.itemId);
      const check: DeadlineEntryCheck = {
        itemId: entry.itemId,
        lenhCode: item
          ? (item.lsxCode ??
            displayCodes.get(String(item.productionInvoiceId)) ??
            item.productionInvoice?.code ??
            '')
          : '',
        skuCode: item?.mfgProduct.factoryCode ?? '',
        kind: 'ERROR',
        changes: [],
        errors: [],
        warnings: [],
      };
      if (!item) {
        check.errors.push('Mã dòng không tồn tại');
        return check;
      }
      if (seen.has(entry.itemId)) {
        check.errors.push('Dòng xuất hiện 2 lần trong cùng lần lưu');
        return check;
      }
      seen.add(entry.itemId);
      if (!item.productionInvoice) {
        check.errors.push('Dòng chưa thuộc lệnh nào');
        return check;
      }
      if (item.productionInvoice.status === ProductionInvoiceStatus.CANCELLED) {
        check.errors.push('Lệnh đã huỷ - không sửa được mốc');
        return check;
      }
      if (item.productionOrder?.floorStage === ProductionOrderFloorStage.FINISHED) {
        check.errors.push('Lệnh đã Kết thúc - không sửa được mốc');
        return check;
      }
      if (item.deadlineChangeRequests.length > 0) {
        check.errors.push('Đang chờ Sếp duyệt lại - Huỷ yêu cầu cũ rồi mới sửa lại được');
        return check;
      }

      const badKeys = Object.keys(entry.newValues).filter((k) => !FIELD_KEYS.has(k));
      if (badKeys.length > 0) check.errors.push(`Mốc không hợp lệ: ${badKeys.join(', ')}`);
      for (const [k, v] of Object.entries(entry.newValues)) {
        if (FIELD_KEYS.has(k) && v !== null && v !== undefined && !isValidDay(v)) {
          check.errors.push(
            `Ngày không hợp lệ ở "${fieldLabel(k as DeadlineFieldKey)}" (cần dạng YYYY-MM-DD)`,
          );
        }
      }
      if (check.errors.length > 0) return check;

      const current = valuesOfItem(item);
      const changes = diffValues(current, entry.newValues);
      check.changes = changes;
      // V9-1: file Excel cũ không được ghi đè mốc mới hơn - mốc ĐỔI mà hiện tại khác lúc tải file thì lỗi dòng.
      for (const c of changes) {
        const was = entry.expectedOld?.[c.key];
        if (was !== undefined && (was ?? null) !== (current[c.key] ?? null)) {
          check.errors.push(
            `Mốc ${c.label} đã đổi từ lúc tải file (lúc tải ${dm(was)}, hiện tại ${dm(current[c.key])}) – tải file mới`,
          );
        }
      }
      if (check.errors.length > 0) return check;

      if (changes.length === 0) {
        check.kind = 'NO_CHANGE';
        return check;
      }
      const projected = { ...current };
      for (const c of changes) projected[c.key] = c.to;
      const warnings = milestoneOrderWarnings({
        ...projected,
        deliveryDeadline: item.deliveryDeadline ? vnDayKey(item.deliveryDeadline) : null,
      });
      if (ORDER_VIOLATION_BLOCKS) check.errors.push(...warnings);
      else check.warnings.push(...warnings);
      check.kind =
        check.errors.length > 0
          ? 'ERROR'
          : item.prodApprovalStatus === ProdApprovalStatus.APPROVED
            ? 'NEEDS_APPROVAL'
            : 'APPLY';
      return check;
    });

    await this.checkMergedProjection(db, checks, items);
    return { checks, items };
  }

  /**
   * Luật gộp trên giá trị DỰ KIẾN của CẢ lệnh gộp: giá trị đang lưu + đổi trong lần này (dòng chưa lỗi) + yêu cầu chờ của các dòng khác.
   * Vi phạm → mọi dòng đang đổi của lệnh đó mang lỗi (rollback cả lần ở chế độ strict).
   */
  private async checkMergedProjection(
    db: Db,
    checks: DeadlineEntryCheck[],
    items: Map<string, LoadedItem>,
  ): Promise<void> {
    const byPi = new Map<string, DeadlineEntryCheck[]>();
    for (const c of checks) {
      if (c.kind !== 'APPLY' && c.kind !== 'NEEDS_APPROVAL') continue;
      const item = items.get(c.itemId)!;
      if (!item.productionInvoice?.isMerged) continue;
      const key = item.productionInvoice.id.toString();
      byPi.set(key, [...(byPi.get(key) ?? []), c]);
    }
    for (const [piKey, group] of byPi) {
      const piId = BigInt(piKey);
      const overrides = new Map<string, DeadlineValues>();
      const pending = await db.productionInvoiceItem.findMany({
        where: { productionInvoiceId: piId },
        select: {
          id: true,
          deadlineChangeRequests: { where: { status: 'PENDING' }, select: { newValues: true } },
        },
      });
      for (const p of pending) {
        const req = p.deadlineChangeRequests[0];
        if (req) overrides.set(p.id.toString(), req.newValues as DeadlineValues);
      }
      for (const c of group) overrides.set(c.itemId, pickChanged(c.changes).newValues);
      try {
        await this.writer.assertMergedPiProjectedRule(db, piId, overrides);
      } catch (error) {
        if (!(error instanceof BadRequestException)) throw error;
        for (const c of group) {
          c.kind = 'ERROR';
          c.errors.push(error.message);
        }
      }
    }
  }

  // ─── Ghi ──────────────────────────────────────────────────────────────────────────────────────

  async saveEntries(
    actor: DeadlineActor,
    entries: DeadlineEntryInput[],
    source: DeadlineChangeSource,
    opts: { strict: boolean; note?: string; idempotencyKey?: string },
  ): Promise<DeadlineSaveResult> {
    if (opts.idempotencyKey) {
      const existing = await this.findBatchByKey(opts.idempotencyKey);
      if (existing) return { applied: [], batch: await this.toBatchDto(existing), skipped: [] };
    }

    let outcome: {
      checks: DeadlineEntryCheck[];
      items: Map<string, LoadedItem>;
      batchId: bigint | null;
    };
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        await this.lockForEntries(tx, entries);
        const { checks, items } = await this.evaluate(tx, entries);
        const errors = checks.filter((c) => c.kind === 'ERROR');
        if (opts.strict && errors.length > 0) {
          throw new BadRequestException(
            errors
              .map((c) =>
                `${c.lenhCode} · ${c.skuCode}: ${c.errors.join('; ')}`.replace(/^ · : /, ''),
              )
              .join('\n'),
          );
        }
        for (const c of checks.filter((x) => x.kind === 'APPLY')) {
          await this.writer.applyItemDeadlines(
            tx,
            BigInt(c.itemId),
            this.writer.toWrite(pickChanged(c.changes).newValues),
          );
        }
        const approval = checks.filter((c) => c.kind === 'NEEDS_APPROVAL');
        let batchId: bigint | null = null;
        if (approval.length > 0) {
          const batch = await tx.deadlineChangeBatch.create({
            data: {
              source,
              requestedById: actor.id,
              note: opts.note,
              idempotencyKey: opts.idempotencyKey,
              requests: {
                create: approval.map((c) => {
                  const { oldValues, newValues } = pickChanged(c.changes);
                  return {
                    productionInvoiceItemId: BigInt(c.itemId),
                    oldValues: oldValues,
                    newValues: newValues,
                  };
                }),
              },
            },
            select: { id: true },
          });
          batchId = batch.id;
        }
        return { checks, items, batchId };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Khoá chống gửi 2 lần (đua nhau) → trả lô đã có; còn lại là index "1 yêu cầu chờ / dòng" (hàng rào cuối).
        if (opts.idempotencyKey) {
          const existing = await this.findBatchByKey(opts.idempotencyKey);
          if (existing) return { applied: [], batch: await this.toBatchDto(existing), skipped: [] };
        }
        throw new ConflictException('Có dòng đang chờ Sếp duyệt lại - tải lại rồi thử lại');
      }
      throw error;
    }

    // Sau khi commit: audit + thông báo cho dòng ghi thẳng (best-effort, như đường cũ).
    const applied = outcome.checks.filter((c) => c.kind === 'APPLY');
    for (const c of applied) {
      const before = outcome.items.get(c.itemId)!;
      const after = await this.prisma.productionInvoiceItem.findUnique({
        where: { id: before.id },
        include: { stages: true, mfgProduct: { select: { factoryCode: true } } },
      });
      if (after) {
        await this.writer.auditAndNotifyDeadlineChange(
          before.productionInvoice?.code ?? '',
          before,
          after,
        );
      }
    }

    let batchDto: DeadlineChangeBatchDto | null = null;
    if (outcome.batchId) {
      const batch = await this.loadBatch(outcome.batchId);
      batchDto = await this.toBatchDto(batch);
      await this.notifyPending(actor, batch, batchDto);
    }
    return {
      applied,
      batch: batchDto,
      skipped: outcome.checks.filter((c) => c.kind === 'ERROR'),
    };
  }

  /** Khoá nghiệp vụ theo dòng + theo lệnh (luật gộp xét cả lệnh), theo THỨ TỰ cố định để 2 giao dịch không khoá chéo nhau. */
  private async lockForEntries(tx: PrismaTx, entries: DeadlineEntryInput[]): Promise<void> {
    const ids = [
      ...new Set(entries.filter((e) => /^\d+$/.test(e.itemId)).map((e) => BigInt(e.itemId))),
    ];
    if (ids.length === 0) return;
    const rows = await tx.productionInvoiceItem.findMany({
      where: { id: { in: ids } },
      select: { id: true, productionInvoiceId: true },
    });
    const keys = new Set<string>();
    for (const r of rows) {
      keys.add(`deadline-change:item:${r.id.toString()}`);
      if (r.productionInvoiceId) keys.add(`deadline-change:pi:${r.productionInvoiceId.toString()}`);
    }
    for (const key of [...keys].sort()) await lockBusinessKey(tx, key);
  }

  private async notifyPending(
    actor: DeadlineActor,
    batch: LoadedBatch,
    dto: DeadlineChangeBatchDto,
  ): Promise<void> {
    try {
      await this.notifications.emit('DEADLINE_CHANGE_PENDING', {
        entityId: batch.id.toString(),
        actorId: actor.id,
        dedupeKey: `deadline-change-batch:${batch.id.toString()}`,
        params: {
          skuCount: dto.requests.length,
          lenhCodes: dto.requests.map((r) => r.lenhCode),
          requestedByName: userName(batch.requestedBy),
          source: batch.source,
        },
      });
    } catch (error) {
      this.logger.error(
        `Không tạo được thông báo DEADLINE_CHANGE_PENDING (lô ${batch.id}): ${(error as Error).message}`,
      );
    }
  }

  // ─── Đọc ──────────────────────────────────────────────────────────────────────────────────────

  async pendingByItem(itemIds: bigint[]): Promise<Map<string, PendingDeadlineChangeRef>> {
    const out = new Map<string, PendingDeadlineChangeRef>();
    if (itemIds.length === 0) return out;
    const rows = await this.prisma.deadlineChangeRequest.findMany({
      where: { productionInvoiceItemId: { in: itemIds }, status: 'PENDING' },
    });
    for (const r of rows) out.set(r.productionInvoiceItemId.toString(), pendingRefOf(r));
    return out;
  }

  async countPendingBatches(): Promise<number> {
    return this.prisma.deadlineChangeBatch.count({ where: { status: 'PENDING' } });
  }

  async listBatches(
    actor: DeadlineActor,
    opts: { status?: DeadlineChangeBatchStatus | 'ALL'; mine?: boolean },
  ): Promise<DeadlineChangeBatchDto[]> {
    const status = opts.status ?? 'PENDING';
    // KHSX chỉ xem lô của mình; Sếp / QLSX / Admin xem hết (hoặc `mine`).
    const mineOnly = opts.mine || !this.isReviewer(actor);
    const batches = await this.prisma.deadlineChangeBatch.findMany({
      where: {
        ...(status !== 'ALL' ? { status } : {}),
        ...(mineOnly ? { requestedById: actor.id } : {}),
      },
      include: BATCH_INCLUDE,
      orderBy: { requestedAt: 'desc' },
      take: 200,
    });
    return this.toBatchDtos(batches);
  }

  async getBatch(actor: DeadlineActor, id: string): Promise<DeadlineChangeBatchDto> {
    const batch = await this.loadBatch(parseBigIntId(id));
    if (!this.isReviewer(actor) && batch.requestedById !== actor.id) {
      throw new ForbiddenException('Chỉ xem được lô do chính mình gửi');
    }
    return (await this.toBatchDtos([batch]))[0];
  }

  private isReviewer(actor: DeadlineActor): boolean {
    return actor.roles.some((r) => REVIEWER_ROLES.includes(r));
  }

  private async loadBatch(id: bigint): Promise<LoadedBatch> {
    const batch = await this.prisma.deadlineChangeBatch.findUnique({
      where: { id },
      include: BATCH_INCLUDE,
    });
    if (!batch) throw new NotFoundException(`Lô đổi mốc ${id} không tồn tại`);
    return batch;
  }

  private findBatchByKey(key: string): Promise<LoadedBatch | null> {
    return this.prisma.deadlineChangeBatch.findUnique({
      where: { idempotencyKey: key },
      include: BATCH_INCLUDE,
    });
  }

  private async toBatchDto(batch: LoadedBatch): Promise<DeadlineChangeBatchDto> {
    return (await this.toBatchDtos([batch]))[0];
  }

  /** Dựng DTO cho nhiều lô với 1 lần nạp mã lệnh hiển thị. `warnings` tính lúc đọc: mốc hiện tại của dòng chồng giá trị MỚI của yêu cầu. */
  private async toBatchDtos(batches: LoadedBatch[]): Promise<DeadlineChangeBatchDto[]> {
    const piIds = batches.flatMap((b) =>
      b.requests
        .map((r) => r.productionInvoiceItem.productionInvoiceId)
        .filter((id): id is bigint => id !== null),
    );
    const displayCodes = await loadLenhDisplayCodes(this.prisma, piIds);
    return batches.map((batch) => {
      const requests: DeadlineChangeRequestDto[] = batch.requests.map((r) => {
        const item = r.productionInvoiceItem;
        const oldValues = r.oldValues as DeadlineValues;
        const newValues = r.newValues as DeadlineValues;
        const projected = { ...valuesOfItem(item) };
        for (const [k, v] of Object.entries(newValues)) {
          if (v) projected[k as DeadlineFieldKey] = v;
        }
        return {
          id: r.id.toString(),
          itemId: item.id.toString(),
          piId: String(item.productionInvoiceId ?? ''),
          lenhCode:
            item.lsxCode ??
            displayCodes.get(String(item.productionInvoiceId)) ??
            item.productionInvoice?.code ??
            '',
          skuCode: item.mfgProduct.factoryCode,
          skuName: item.mfgProduct.name ?? null,
          quantity: item.quantity,
          status: r.status,
          oldValues,
          newValues,
          changes: diffValues(oldValues, newValues),
          warnings: milestoneOrderWarnings({
            ...projected,
            deliveryDeadline: item.deliveryDeadline ? vnDayKey(item.deliveryDeadline) : null,
          }),
          rejectReason: r.status === 'REJECTED' ? batch.decisionNote : null,
        };
      });
      const count = (s: DeadlineChangeRequestStatus) =>
        requests.filter((r) => r.status === s).length;
      return {
        id: batch.id.toString(),
        source: batch.source,
        status: batch.status,
        requestedBy: userRef(batch.requestedBy),
        requestedAt: batch.requestedAt.toISOString(),
        decidedBy: batch.decidedBy ? userRef(batch.decidedBy) : null,
        decidedAt: batch.decidedAt?.toISOString() ?? null,
        decisionNote: batch.decisionNote,
        note: batch.note,
        counts: {
          total: requests.length,
          pending: count('PENDING'),
          approved: count('APPROVED'),
          rejected: count('REJECTED'),
          cancelled: count('CANCELLED'),
        },
        requests,
      };
    });
  }

  // ─── Sếp quyết ────────────────────────────────────────────────────────────────────────────────

  /**
   * Sếp quyết 1 lô: yêu cầu có trong `approveRequestIds` → áp mốc (kiểm mốc hiện tại vẫn = `oldValues`, lệch → 409), yêu cầu chờ còn lại
   * → từ chối (cần lý do ≥ 3 ký tự). Áp trong 1 giao dịch cùng luật gộp; audit + thông báo bộ phận sau khi commit.
   */
  async decide(
    actor: DeadlineActor,
    batchId: string,
    input: DecideDeadlineBatchInput,
  ): Promise<DeadlineChangeBatchDto> {
    const id = parseBigIntId(batchId);
    const approveIds = new Set(input.approveRequestIds);
    const reason = input.rejectReason?.trim() ?? '';

    const applied = await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `deadline-change:batch:${id.toString()}`);
      const batch = await tx.deadlineChangeBatch.findUnique({
        where: { id },
        include: { requests: { orderBy: { id: 'asc' } } },
      });
      if (!batch) throw new NotFoundException(`Lô đổi mốc ${batchId} không tồn tại`);
      if (batch.status !== DeadlineChangeBatchStatus.PENDING) {
        throw new ConflictException('Lô này đã được quyết hoặc đã huỷ');
      }
      const pending = batch.requests.filter(
        (r) => r.status === DeadlineChangeRequestStatus.PENDING,
      );
      const pendingIds = new Set(pending.map((r) => r.id.toString()));
      const stray = [...approveIds].filter((rid) => !pendingIds.has(rid));
      if (stray.length > 0) {
        throw new BadRequestException(
          `Yêu cầu ${stray.join(', ')} không thuộc lô này hoặc không còn chờ duyệt`,
        );
      }
      const approved = pending.filter((r) => approveIds.has(r.id.toString()));
      const rejected = pending.filter((r) => !approveIds.has(r.id.toString()));
      if (rejected.length > 0 && reason.length < REJECT_REASON_MIN) {
        throw new BadRequestException(
          `Có yêu cầu bị từ chối - cần ghi lý do (tối thiểu ${REJECT_REASON_MIN} ký tự)`,
        );
      }

      const touched: { before: LoadedItem; piCode: string }[] = [];
      const mergedPiIds = new Set<bigint>();
      // Khoá theo thứ tự cố định rồi mới đọc / áp.
      const approvedItemIds = approved.map((r) => r.productionInvoiceItemId);
      const keyRows = approvedItemIds.length
        ? await tx.productionInvoiceItem.findMany({
            where: { id: { in: approvedItemIds } },
            select: { id: true, productionInvoiceId: true },
          })
        : [];
      const keys = new Set<string>();
      for (const r of keyRows) {
        keys.add(`deadline-change:item:${r.id.toString()}`);
        if (r.productionInvoiceId)
          keys.add(`deadline-change:pi:${r.productionInvoiceId.toString()}`);
      }
      for (const key of [...keys].sort()) await lockBusinessKey(tx, key);

      for (const req of approved) {
        const item = await tx.productionInvoiceItem.findUnique({
          where: { id: req.productionInvoiceItemId },
          include: ITEM_INCLUDE,
        });
        if (!item) throw new NotFoundException('Dòng SKU của yêu cầu không còn tồn tại');
        const lenh = item.lsxCode ?? item.productionInvoice?.code ?? '';
        if (
          item.productionInvoice?.status === ProductionInvoiceStatus.CANCELLED ||
          item.productionOrder?.floorStage === ProductionOrderFloorStage.FINISHED
        ) {
          throw new ConflictException(
            `Lệnh ${lenh} đã huỷ / Kết thúc - không áp mốc được, hãy từ chối yêu cầu này`,
          );
        }
        // V9-2: giá trị hiện tại phải còn đúng bằng lúc KHSX gửi, không thì Sếp đang duyệt trên số cũ.
        const current = valuesOfItem(item);
        const oldValues = req.oldValues as DeadlineValues;
        for (const [k, was] of Object.entries(oldValues) as [DeadlineFieldKey, string | null][]) {
          if ((current[k] ?? null) !== (was ?? null)) {
            throw new ConflictException(
              `Mốc ${fieldLabel(k)} của lệnh ${lenh} · ${item.mfgProduct.factoryCode} đã đổi từ lúc gửi (lúc gửi ${dm(was)}, hiện tại ${dm(current[k])}) - từ chối yêu cầu này để KHSX gửi lại`,
            );
          }
        }
        await this.writer.applyItemDeadlines(
          tx,
          item.id,
          this.writer.toWrite(req.newValues as DeadlineValues),
        );
        if (item.productionInvoice?.isMerged) mergedPiIds.add(item.productionInvoice.id);
        touched.push({ before: item, piCode: item.productionInvoice?.code ?? '' });
      }
      for (const piId of mergedPiIds) await this.writer.assertMergedPiDeadlineRule(tx, piId);

      const now = new Date();
      if (approved.length > 0) {
        await tx.deadlineChangeRequest.updateMany({
          where: { id: { in: approved.map((r) => r.id) } },
          data: { status: 'APPROVED', decidedAt: now },
        });
      }
      if (rejected.length > 0) {
        await tx.deadlineChangeRequest.updateMany({
          where: { id: { in: rejected.map((r) => r.id) } },
          data: { status: 'REJECTED', decidedAt: now },
        });
      }
      await tx.deadlineChangeBatch.update({
        where: { id },
        data: {
          status: 'DECIDED',
          decidedById: actor.id,
          decidedAt: now,
          decisionNote: rejected.length > 0 ? reason : null,
        },
      });
      return {
        touched,
        requestedById: batch.requestedById,
        total: pending.length,
        rejected: rejected.length,
        approved: approved.length,
      };
    });

    // Sau commit (best-effort): audit + báo bộ phận từng dòng đã duyệt, báo KHSX, đóng thông báo chờ của Sếp.
    for (const { before, piCode } of applied.touched) {
      const after = await this.prisma.productionInvoiceItem.findUnique({
        where: { id: before.id },
        include: { stages: true, mfgProduct: { select: { factoryCode: true } } },
      });
      if (after) {
        await this.writer.auditAndNotifyDeadlineChange(piCode, before, after, NOTE_APPROVED);
      }
    }
    try {
      await this.notifications.emit('DEADLINE_CHANGE_DECIDED', {
        entityId: id.toString(),
        actorId: actor.id,
        params: {
          total: applied.total,
          approved: applied.approved,
          rejected: applied.rejected,
          reason: applied.rejected > 0 ? reason : undefined,
          requestedById: applied.requestedById,
        },
      });
      await this.notifications.resolve({
        entityType: 'DEADLINE_CHANGE_BATCH',
        entityId: id.toString(),
        types: ['DEADLINE_CHANGE_PENDING'],
      });
    } catch (error) {
      this.logger.error(
        `Không gửi được thông báo kết quả lô đổi mốc ${id}: ${(error as Error).message}`,
      );
    }
    return this.toBatchDto(await this.loadBatch(id));
  }

  // ─── KHSX huỷ yêu cầu ─────────────────────────────────────────────────────────────────────────

  /**
   * KHSX (người gửi) hoặc Admin huỷ 1 yêu cầu đang chờ. Lô hết yêu cầu chờ → CANCELLED (chưa yêu cầu nào được quyết) hoặc DECIDED;
   * khi đó đóng thông báo chờ của Sếp.
   */
  async cancelRequest(actor: DeadlineActor, requestId: string): Promise<DeadlineChangeBatchDto> {
    const rid = parseBigIntId(requestId);
    const batchId = await this.prisma.$transaction(async (tx) => {
      const req = await tx.deadlineChangeRequest.findUnique({
        where: { id: rid },
        include: { batch: true },
      });
      if (!req) throw new NotFoundException(`Yêu cầu đổi mốc ${requestId} không tồn tại`);
      await lockBusinessKey(tx, `deadline-change:batch:${req.batchId.toString()}`);
      const fresh = await tx.deadlineChangeRequest.findUniqueOrThrow({ where: { id: rid } });
      const isOwner = req.batch.requestedById === actor.id;
      if (!isOwner && !actor.roles.includes(DEFAULT_ROLES.ADMIN)) {
        throw new ForbiddenException('Chỉ người gửi hoặc Admin huỷ được yêu cầu này');
      }
      if (fresh.status !== DeadlineChangeRequestStatus.PENDING) {
        throw new ConflictException('Yêu cầu này không còn chờ duyệt (Sếp đã quyết hoặc đã huỷ)');
      }
      await tx.deadlineChangeRequest.update({
        where: { id: rid },
        data: { status: 'CANCELLED', decidedAt: new Date() },
      });
      const siblings = await tx.deadlineChangeRequest.findMany({
        where: { batchId: req.batchId },
        select: { status: true },
      });
      if (!siblings.some((s) => s.status === 'PENDING')) {
        const anyDecided = siblings.some((s) => s.status === 'APPROVED' || s.status === 'REJECTED');
        await tx.deadlineChangeBatch.update({
          where: { id: req.batchId },
          data: { status: anyDecided ? 'DECIDED' : 'CANCELLED' },
        });
        return { id: req.batchId, closed: true };
      }
      return { id: req.batchId, closed: false };
    });
    if (batchId.closed) {
      try {
        await this.notifications.resolve({
          entityType: 'DEADLINE_CHANGE_BATCH',
          entityId: batchId.id.toString(),
          types: ['DEADLINE_CHANGE_PENDING'],
        });
      } catch (error) {
        this.logger.error(`Không đóng được thông báo chờ duyệt: ${(error as Error).message}`);
      }
    }
    return this.toBatchDto(await this.loadBatch(batchId.id));
  }

  // ─── Lịch sử ──────────────────────────────────────────────────────────────────────────────────

  /**
   * Lịch sử đổi mốc của 1 dòng SKU, mới nhất trước: sửa thẳng (từ audit `ProductionInvoiceItem`, bỏ bản ghi có ghi chú "Sếp đã
   * duyệt" - đã có từ yêu cầu) + các yêu cầu (gửi / duyệt / từ chối / huỷ).
   */
  async historyOf(itemId: string): Promise<DeadlineHistoryEntry[]> {
    const id = parseBigIntId(itemId);
    const [audits, requests] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: {
          tableName: 'ProductionInvoiceItem',
          recordId: id.toString(),
          action: AuditAction.UPDATE,
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.prisma.deadlineChangeRequest.findMany({
        where: { productionInvoiceItemId: id },
        include: {
          batch: {
            include: { requestedBy: { select: USER_SELECT }, decidedBy: { select: USER_SELECT } },
          },
        },
        orderBy: { id: 'desc' },
      }),
    ]);
    const userIds = [...new Set(audits.map((a) => a.userId).filter((u): u is string => !!u))];
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: USER_SELECT })
      : [];
    const userById = new Map(users.map((u) => [u.id, userRef(u)]));

    const out: DeadlineHistoryEntry[] = [];
    for (const a of audits) {
      const oldV = (a.oldValue ?? {}) as Record<string, string | null>;
      const newV = (a.newValue ?? {}) as Record<string, string | null>;
      if (newV._note) continue; // đã có dạng APPROVED từ yêu cầu
      const toDay = (v: string | null | undefined) => (v ? vnDayKey(new Date(v)) : null);
      const changes: DeadlineFieldChange[] = [];
      for (const f of DEADLINE_FIELDS) {
        if (!(f.key in newV)) continue;
        changes.push({
          key: f.key,
          label: f.label,
          from: toDay(oldV[f.key]),
          to: toDay(newV[f.key]),
        });
      }
      if (changes.length === 0) continue; // audit không phải đổi mốc (vd chuyển trạng thái duyệt) hoặc chỉ hạn giao
      out.push({
        at: a.createdAt.toISOString(),
        by: a.userId ? (userById.get(a.userId) ?? null) : null,
        kind: 'DIRECT',
        source: null,
        changes,
        note: null,
      });
    }
    for (const r of requests) {
      const changes = diffValues(r.oldValues as DeadlineValues, r.newValues as DeadlineValues);
      const requester = userRef(r.batch.requestedBy);
      const decider = r.batch.decidedBy ? userRef(r.batch.decidedBy) : null;
      out.push({
        at: r.createdAt.toISOString(),
        by: requester,
        kind: 'REQUESTED',
        source: r.batch.source,
        changes,
        note: r.batch.note,
      });
      if (r.status === 'APPROVED') {
        out.push({
          at: (r.decidedAt ?? r.createdAt).toISOString(),
          by: decider,
          kind: 'APPROVED',
          source: r.batch.source,
          changes,
          note: NOTE_APPROVED,
        });
      } else if (r.status === 'REJECTED') {
        out.push({
          at: (r.decidedAt ?? r.createdAt).toISOString(),
          by: decider,
          kind: 'REJECTED',
          source: r.batch.source,
          changes,
          note: r.batch.decisionNote,
        });
      } else if (r.status === 'CANCELLED') {
        out.push({
          at: (r.decidedAt ?? r.createdAt).toISOString(),
          by: requester,
          kind: 'CANCELLED',
          source: r.batch.source,
          changes,
          note: null,
        });
      }
    }
    return out.sort((x, y) => y.at.localeCompare(x.at));
  }
}
