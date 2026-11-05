import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AuditAction, ProdItemStageType } from '../../generated/prisma/client';
import { BUSINESS_ROLES } from '../../common/constants/roles.constant';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { auditEvent } from '../../common/utils/audit-event.util';
import { checkMergeRules, skuLabel } from '../../common/utils/merge-rules.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DeadlineValues } from './deadline-changes/deadline-changes.types';
import { isStageKey, stageTypeOf } from './deadline-changes/deadline-values.util';

/** SystemConfig là bảng 1 dòng (id = 1) - đọc luật gộp solverMergeWindowDays/solverMergeMaxSkus. */
const SYSTEM_CONFIG_ID = 1;

/** Phần A – Đợt 9: hình dạng tối thiểu của 1 dòng SKU mà audit + thông báo đổi mốc cần (PIItemWithRefs của ProductionInvoicesService khớp). */
export interface DeadlineAuditItem {
  id: bigint;
  productionInvoiceId: bigint | null;
  materialDeadline: Date | null;
  finishedMaterialDeadline: Date | null;
  deliveryDeadline: Date | null;
  stages: { stageType: ProdItemStageType; deadline: Date }[];
  mfgProduct: { factoryCode: string };
}

/** Đầu vào ghi mốc của 1 dòng SKU (cùng hình với UpdateProductionInvoiceItemDto). */
export interface ItemDeadlineWrite {
  materialDeadline?: string;
  finishedMaterialDeadline?: string;
  deliveryDeadline?: string;
  stages?: { stageType: ProdItemStageType; deadline: string }[];
}

type WriteTx = Pick<PrismaServiceType, 'productionInvoiceItem' | 'productionInvoiceItemStage'>;
type MergeTx = Pick<PrismaServiceType, 'productionInvoiceItem' | 'systemConfig'>;

/**
 * Phần A – Đợt 9 (YC2): ĐƯỜNG GHI MỐC dùng chung - tách từ ProductionInvoicesService để "Sửa thời hạn" (dòng chưa duyệt) và
 * DeadlineChangesService (Sếp duyệt lại / dòng đã duyệt) cùng một chỗ: ghi mốc, luật gộp, audit + thông báo bộ phận liên quan.
 */
@Injectable()
export class ItemDeadlineWriter {
  private readonly logger = new Logger(ItemDeadlineWriter.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly cls: ClsService<AppClsStore>,
    private readonly notifications: NotificationsService,
  ) {}

  /** Ghi mốc kế hoạch của 1 SKU (dùng chung cho sửa 1 SKU và sửa cả PI). */
  async applyItemDeadlines(tx: WriteTx, itemId: bigint, dto: ItemDeadlineWrite): Promise<void> {
    if (dto.materialDeadline || dto.finishedMaterialDeadline || dto.deliveryDeadline) {
      await tx.productionInvoiceItem.update({
        where: { id: itemId },
        data: {
          materialDeadline: dto.materialDeadline ? new Date(dto.materialDeadline) : undefined,
          finishedMaterialDeadline: dto.finishedMaterialDeadline
            ? new Date(dto.finishedMaterialDeadline)
            : undefined,
          deliveryDeadline: dto.deliveryDeadline ? new Date(dto.deliveryDeadline) : undefined,
        },
      });
    }
    for (const stage of dto.stages ?? []) {
      await tx.productionInvoiceItemStage.upsert({
        where: {
          productionInvoiceItemId_stageType: {
            productionInvoiceItemId: itemId,
            stageType: stage.stageType,
          },
        },
        create: {
          productionInvoiceItemId: itemId,
          stageType: stage.stageType,
          deadline: new Date(stage.deadline),
        },
        update: { deadline: new Date(stage.deadline) },
      });
    }
  }

  /** Đổi `DeadlineValues` ('YYYY-MM-DD' theo khoá) sang đầu vào ghi mốc; khoá null / vắng bị bỏ qua (không xoá mốc). */
  toWrite(values: DeadlineValues): ItemDeadlineWrite {
    const out: ItemDeadlineWrite = {};
    for (const [key, day] of Object.entries(values) as [keyof DeadlineValues, string | null][]) {
      if (!day) continue;
      if (key === 'materialDeadline') out.materialDeadline = day;
      else if (key === 'finishedMaterialDeadline') out.finishedMaterialDeadline = day;
      else if (isStageKey(key)) {
        (out.stages ??= []).push({
          stageType: stageTypeOf(key) as ProdItemStageType,
          deadline: day,
        });
      }
    }
    return out;
  }

  /**
   * LUẬT GỘP khi sửa hạn lệnh gộp (2026-10-24): không có chỗ này thì gộp xong kéo hạn 1 SKU ra xa là lách được luật "chỉ gom các lệnh
   * cách nhau ≤ 3 ngày". Đọc lại trong CÙNG giao dịch (thấy giá trị vừa ghi) và ném lỗi để rollback.
   */
  async assertMergedPiDeadlineRule(tx: MergeTx, piId: bigint): Promise<void> {
    await this.checkMerge(tx, piId, new Map());
  }

  /**
   * Biến thể kiểm trên giá trị DỰ KIẾN (Đợt 9): `overrides` (id dòng → mốc sắp đổi) chồng lên giá trị đang lưu - dùng khi KHSX tạo
   * yêu cầu chờ Sếp (mốc chưa ghi) và khi gom hiện tại + yêu cầu chờ của các dòng khác trong lệnh.
   */
  async assertMergedPiProjectedRule(
    tx: MergeTx,
    piId: bigint,
    overrides: Map<string, DeadlineValues>,
  ): Promise<void> {
    await this.checkMerge(tx, piId, overrides);
  }

  private async checkMerge(
    tx: MergeTx,
    piId: bigint,
    overrides: Map<string, DeadlineValues>,
  ): Promise<void> {
    const items = await tx.productionInvoiceItem.findMany({
      where: { productionInvoiceId: piId },
      include: { stages: true, mfgProduct: true, salesOrder: true },
    });
    if (items.length < 2) return;
    const cfg = await tx.systemConfig.findUniqueOrThrow({
      where: { id: SYSTEM_CONFIG_ID },
      select: { solverMergeWindowDays: true, solverMergeMaxSkus: true },
    });
    const rule = checkMergeRules(
      items.map((i) => {
        const ov = overrides.get(i.id.toString());
        let materialDeadline = i.materialDeadline;
        let stages = i.stages;
        if (ov) {
          if (ov.materialDeadline) materialDeadline = new Date(ov.materialDeadline);
          stages = [...stages];
          for (const [key, day] of Object.entries(ov)) {
            if (!day || !key.startsWith('stage.')) continue;
            const stageType = key.slice('stage.'.length) as ProdItemStageType;
            const at = new Date(day);
            const idx = stages.findIndex((s) => s.stageType === stageType);
            if (idx >= 0) stages[idx] = { ...stages[idx], deadline: at };
            else stages.push({ stageType, deadline: at } as (typeof stages)[number]);
          }
        }
        return {
          materialDeadline,
          stages,
          label: skuLabel(i.mfgProduct.factoryCode, i.salesOrder?.orderCode),
        };
      }),
      { windowDays: cfg.solverMergeWindowDays, maxSkus: cfg.solverMergeMaxSkus },
      'invoice',
    );
    if (!rule.ok) throw new BadRequestException(rule.reason);
  }

  /**
   * Audit + báo bộ phận liên quan khi mốc kế hoạch đổi (chỉ khi giá trị THỰC SỰ đổi, không phải lưu lại y nguyên).
   * Best-effort NGOÀI transaction: lỗi chỉ log, không làm hỏng thao tác sửa. `note` (vd "Sếp đã duyệt"): ghi vào audit
   * (khoá `_note` của newValue - để lịch sử phân biệt sửa thẳng / Sếp duyệt) và đứng đầu nội dung thông báo.
   */
  async auditAndNotifyDeadlineChange(
    piCode: string,
    before: DeadlineAuditItem,
    after: DeadlineAuditItem,
    note?: string,
  ): Promise<void> {
    const fmt = (d: Date | null | undefined) =>
      d ? d.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '(chưa có)';
    const changed = (a: Date | null | undefined, b: Date | null | undefined) =>
      (a?.getTime() ?? null) !== (b?.getTime() ?? null);
    const stageLabel: Record<string, string> = {
      FRAME: 'Khung cơ khí',
      // Phần A – Đợt 3 (YC10): đổi "Đan" -> "Nhập đan", "Kiểm tra chuyển kho" -> "Chuyền kiểm"; thêm 2 mốc ngày bắt đầu.
      WEAVING: 'Nhập đan',
      TRANSFER_CHECK: 'Chuyền kiểm',
      PACKAGING: 'Đóng gói',
      PHOI_START: 'Bắt đầu Phôi',
      PACKAGING_START: 'Bắt đầu đóng gói',
      FRAME_PHOI: 'Phôi',
      FRAME_HAN: 'Hàn',
      FRAME_SON: 'Sơn',
    };
    const stageRoles: Record<string, string[]> = {
      FRAME: [BUSINESS_ROLES.PHOI_STAFF, BUSINESS_ROLES.HAN_STAFF, BUSINESS_ROLES.SON_STAFF],
      PHOI_START: [BUSINESS_ROLES.PHOI_STAFF], // Phần A – Đợt 3
      FRAME_PHOI: [BUSINESS_ROLES.PHOI_STAFF],
      FRAME_HAN: [BUSINESS_ROLES.HAN_STAFF],
      FRAME_SON: [BUSINESS_ROLES.SON_STAFF],
    };
    const stageWarehouses: Record<string, string[]> = {
      WEAVING: ['phoi-son-han', 'vat-tu-tp'],
      TRANSFER_CHECK: ['vat-tu-tp', 'thanh-pham'],
      PACKAGING: ['vat-tu-tp', 'thanh-pham'],
      PACKAGING_START: ['vat-tu-tp', 'thanh-pham'], // Phần A – Đợt 3
    };

    const changes: string[] = [];
    const oldValue: Record<string, string | null> = {};
    const newValue: Record<string, string | null> = {};
    const roles = new Set<string>();
    const warehouseIds = new Set<string>();
    const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

    if (changed(before.materialDeadline, after.materialDeadline)) {
      changes.push(
        `Mua VT khung & đan: ${fmt(before.materialDeadline)} → ${fmt(after.materialDeadline)}`,
      );
      oldValue.materialDeadline = iso(before.materialDeadline);
      newValue.materialDeadline = iso(after.materialDeadline);
      roles.add(BUSINESS_ROLES.PURCHASER);
    }
    // "Mua VT còn lại" (2026-10-27): vật tư thành phẩm về kho VTTP rồi xuất đóng gói - báo Mua hàng + thủ kho VTTP/thành phẩm.
    if (changed(before.finishedMaterialDeadline, after.finishedMaterialDeadline)) {
      changes.push(
        `Mua VT còn lại: ${fmt(before.finishedMaterialDeadline)} → ${fmt(after.finishedMaterialDeadline)}`,
      );
      oldValue.finishedMaterialDeadline = iso(before.finishedMaterialDeadline);
      newValue.finishedMaterialDeadline = iso(after.finishedMaterialDeadline);
      roles.add(BUSINESS_ROLES.PURCHASER);
      ['vat-tu-tp', 'thanh-pham'].forEach((w) => warehouseIds.add(w));
    }
    if (changed(before.deliveryDeadline, after.deliveryDeadline)) {
      changes.push(`Giao hàng: ${fmt(before.deliveryDeadline)} → ${fmt(after.deliveryDeadline)}`);
      oldValue.deliveryDeadline = iso(before.deliveryDeadline);
      newValue.deliveryDeadline = iso(after.deliveryDeadline);
      roles.add(BUSINESS_ROLES.SALES_STAFF);
    }
    for (const stage of after.stages) {
      const prev = before.stages.find((st) => st.stageType === stage.stageType);
      if (prev && !changed(prev.deadline, stage.deadline)) continue;
      const label = stageLabel[stage.stageType] ?? stage.stageType;
      changes.push(`${label}: ${fmt(prev?.deadline)} → ${fmt(stage.deadline)}`);
      oldValue[`stage.${stage.stageType}`] = iso(prev?.deadline);
      newValue[`stage.${stage.stageType}`] = iso(stage.deadline);
      (stageRoles[stage.stageType] ?? []).forEach((r) => roles.add(r));
      (stageWarehouses[stage.stageType] ?? []).forEach((w) => warehouseIds.add(w));
    }
    if (changes.length === 0) return;
    // Phần A – Đợt 3 (V4-20): mọi lần đổi mốc đều báo thêm QLSX (để chốt lại kế hoạch năng lực).
    roles.add(BUSINESS_ROLES.PRODUCTION_MANAGER);
    if (note) newValue._note = note;

    await auditEvent(this.prisma, this.cls, this.logger, {
      action: AuditAction.UPDATE,
      tableName: 'ProductionInvoiceItem',
      recordId: after.id,
      oldValue,
      newValue,
    });
    try {
      await this.notifications.emit('PI_ITEM_DEADLINE_CHANGED', {
        entityId: (after.productionInvoiceId ?? before.productionInvoiceId ?? 0n).toString(),
        actorId: this.cls.get('userId'),
        params: {
          piCode,
          factoryCode: after.mfgProduct.factoryCode,
          changes,
          roles: [...roles],
          warehouseIds: [...warehouseIds],
          ...(note ? { note } : {}),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to create PI deadline notification (item ${after.id}): ${(error as Error).message}`,
      );
    }
  }
}
