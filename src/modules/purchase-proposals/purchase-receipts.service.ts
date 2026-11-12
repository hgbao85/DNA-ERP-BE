import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  Prisma,
  PurchaseProposalStatus,
  PurchaseReceiptStatus,
} from '../../generated/prisma/client';
import { MATERIAL_GROUP_SYSTEM_KEYS } from '../../common/constants/material-group-system-keys.constant';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreatePurchaseReceiptDto,
  PreviewPurchaseReceiptDto,
  ReceiptAllocationDto,
  RejectPurchaseReceiptDto,
} from './dto/purchase-receipt.dto';
import { effectiveOrderQty } from './purchase-order-qty.util';
import {
  PurchaseProposalsService,
  ReceiveLine,
  SUPPLIER_WAREHOUSE_CODE,
} from './purchase-proposals.service';
import { AllocationResult, autoAllocate } from './purchase-receipt-allocation.util';
import { supplierOrderCode } from './supplier-order-code.util';
import { allocateSlipCode } from '../issue-slips/slip-code.util';

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
/** YYYY-MM-DD theo giờ VN -> đầu / cuối ngày đó. */
const vnDayStart = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00+07:00`);
const vnDayEnd = (day: string) => new Date(`${day.slice(0, 10)}T23:59:59.999+07:00`);
const cleanUrls = (urls: string[] | undefined) => [
  ...new Set((urls ?? []).map((u) => u.trim()).filter(Boolean)),
];

export interface PreviewLine {
  itemId: string;
  proposalId: string;
  lenhCode: string;
  deadline: Date | null;
  buyQty: number;
  purchaseQty: number;
  receivedQty: number;
  qty: number;
}

export interface PurchaseReceiptResult {
  id: string;
  /** Số phiếu nhập NK (Đợt 6); null với phiếu từ chối / phiếu trước Đợt 6. */
  code: string | null;
  status: PurchaseReceiptStatus;
  receivedQty: number;
  /** Phần vượt tổng số còn lại của đơn (4.12). */
  overQty: number;
  allocation: PreviewLine[];
  allocationAdjusted: boolean;
}

/**
 * Nhận hàng mua theo phiếu (Đợt 5d, 2026-11-05) - bản v8 YC8 (nhập 1 lần tự chia), YC4 4.3-4.6 (chứng từ nhập bắt buộc,
 * SL phiếu giao = SL thực nhận, Từ chối nhận, phiếu cân xe với sắt). Thay route nhận từng dòng cũ
 * (`POST /purchase-proposals/:id/items/:itemId/receive`, đã gỡ - không có chứng từ thì không có đường nhập nào khác).
 *
 * 1 phiếu = 1 vật tư (cùng quy cách, cùng chiều dài cây, cùng kho nhận) của 1 đơn đặt hàng NCC; đơn gộp nhiều lệnh thì
 * các dòng của từng lệnh nằm chung 1 phiếu và được chia theo `autoAllocate`.
 */
@Injectable()
export class PurchaseReceiptsService {
  private readonly logger = new Logger(PurchaseReceiptsService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly proposals: PurchaseProposalsService,
    private readonly notifications: NotificationsService,
  ) {}

  async preview(
    dto: PreviewPurchaseReceiptDto,
    warehouseScope: string | null,
  ): Promise<PreviewLine[]> {
    const lines = await this.loadGroup(dto.itemIds, warehouseScope);
    return this.toPreview(lines, autoAllocate(lines.map(allocationLineOf), round4(dto.qty)));
  }

  async receive(
    dto: CreatePurchaseReceiptDto,
    userId: string,
    idempotencyKey: string,
    warehouseScope: string | null,
  ): Promise<PurchaseReceiptResult> {
    const existing = await this.findByKey(idempotencyKey);
    if (existing) return existing;

    const lines = await this.loadGroup(dto.itemIds, warehouseScope);
    const first = lines[0];
    const supplierUnitQty = dto.supplierUnitQty ?? 1;
    const total = round4(dto.unitRateQty * supplierUnitQty);
    // 4.5: không dung sai, kể cả hàng cân/đo - cân lại lệch phiếu giao thì NCC sửa phiếu rồi mới nhận.
    const checked = dto.supplierUnitQty != null ? dto.supplierUnitQty : dto.unitRateQty;
    if (round4(dto.deliveredQty) !== round4(checked)) {
      throw new BadRequestException(
        `Số thực nhận (${round4(checked)}) phải bằng số trên phiếu giao (${round4(dto.deliveredQty)}). ` +
          'Lệch thì không nhận - bấm "Từ chối nhận" để báo người mua làm việc lại với NCC.',
      );
    }

    // Chứng từ - khoá cứng ngay lúc nhập (YC4, V4-1, V5-1).
    const supplierSlipUrls = cleanUrls(dto.supplierSlipUrls);
    const receiptSlipUrls = cleanUrls(dto.receiptSlipUrls);
    const weighSlipUrls = cleanUrls(dto.weighSlipUrls);
    const overReason = dto.overReason?.trim() || undefined;
    const slipCode = dto.slipCode.trim();
    const overFileUrls = cleanUrls(dto.overFileUrls);
    const missing: string[] = [];
    if (supplierSlipUrls.length === 0) missing.push('phiếu giao hàng của NCC');
    if (receiptSlipUrls.length === 0) missing.push('phiếu nhập kho nhà máy đã ký');
    const approvalFileUrls = this.approvalFilesOf(lines, cleanUrls(dto.approvalFileUrls));
    if (approvalFileUrls.length === 0) missing.push('phiếu đề xuất Giám đốc ký');
    if (isSteelLine(first) && weighSlipUrls.length === 0) {
      missing.push('phiếu cân xe (bắt buộc với sắt)');
    }
    if (missing.length > 0) {
      throw new BadRequestException(`Thiếu ảnh chứng từ: ${missing.join(', ')}.`);
    }

    const supplierWarehouse = await this.prisma.warehouse.findUniqueOrThrow({
      where: { code: SUPPLIER_WAREHOUSE_CODE },
    });

    let outcome;
    try {
      outcome = await this.prisma.$transaction(
        async (tx) => {
          // Khoá mọi đề xuất liên quan theo thứ tự id cố định - 2 phiếu cùng chạm 2 lệnh không khoá chéo nhau.
          const proposalIds = [...new Set(lines.map((l) => l.proposal.id))].sort((a, b) =>
            a < b ? -1 : a > b ? 1 : 0,
          );
          for (const id of proposalIds) await lockBusinessKey(tx, `purchase-proposal-mutate:${id}`);

          // Tự chia theo số đã nhận MỚI NHẤT (sau khoá), không theo số đọc trước transaction.
          const fresh = await tx.purchaseProposalItem.findMany({
            where: { id: { in: lines.map((l) => l.item.id) } },
            select: { id: true, receivedQty: true, status: true },
          });
          const freshById = new Map(fresh.map((f) => [f.id.toString(), f]));
          for (const l of lines) {
            const f = freshById.get(l.item.id.toString());
            if (!f || f.status !== PurchaseProposalStatus.PURCHASING) {
              throw new ConflictException(
                `Vật tư ${l.item.material.code} của lệnh ${l.lenhCode} không còn chờ nhận (vừa có thao tác khác) - tải lại màn hình`,
              );
            }
          }
          const autoAlloc = autoAllocate(
            lines.map((l) => ({
              ...allocationLineOf(l),
              receivedQty: freshById.get(l.item.id.toString())!.receivedQty.toNumber(),
            })),
            total,
          );
          const finalAlloc = dto.allocation
            ? this.validateAllocation(dto.allocation, lines, total)
            : autoAlloc;
          const isAdjusted = !!dto.allocation && !sameAllocation(autoAlloc, finalAlloc);

          // Số phiếu NK đã giữ lúc in (Đợt 6, 4.8) - mỗi số chỉ gắn 1 phiếu nhận.
          const { count: codeUsed } = await tx.reservedSlipCode.updateMany({
            where: { code: slipCode, kind: 'NK', usedAt: null },
            data: { usedAt: new Date() },
          });
          if (codeUsed !== 1) {
            throw new BadRequestException(
              `Số phiếu nhập ${slipCode} không hợp lệ hoặc đã dùng cho lần nhập khác - bấm "In phiếu nhập" để lấy số mới`,
            );
          }

          // 4.12: vượt tổng số CÒN LẠI của đơn (số đặt − đã nhận, đọc sau khoá) thì bắt buộc lý do.
          const remainingTotal = lines.reduce((sum, l) => {
            const received = freshById.get(l.item.id.toString())!.receivedQty.toNumber();
            const ordered = effectiveOrderQty(
              l.item.buyQty.toNumber(),
              l.item.orderQty?.toNumber() ?? null,
            );
            return sum + Math.max(0, ordered - received);
          }, 0);
          const overQty = round4(Math.max(0, total - remainingTotal));
          if (overQty > 0 && !overReason) {
            throw new BadRequestException(
              `Nhận vượt ${overQty} so với số còn lại của đơn (${round4(remainingTotal)}) - bắt buộc ghi lý do nhận vượt.`,
            );
          }

          const receipt = await tx.purchaseReceipt.create({
            data: {
              code: slipCode,
              supplierOrderId: first.item.supplierOrderId,
              materialId: first.item.materialId,
              warehouseCode: first.warehouseCode,
              spec: first.item.spec ?? '',
              stockLengthMm: first.item.stockLengthMm,
              status: PurchaseReceiptStatus.RECEIVED,
              unitRateQty: dto.unitRateQty,
              supplierUnitQty,
              deliveredQty: dto.deliveredQty,
              receivedQty: total,
              supplierSlipUrls,
              approvalFileUrls,
              receiptSlipUrls,
              weighSlipUrls,
              rejectFileUrls: [],
              autoAllocation: autoAlloc as unknown as Prisma.InputJsonValue,
              allocation: finalAlloc as unknown as Prisma.InputJsonValue,
              allocationAdjusted: isAdjusted,
              overQty,
              overReason: overQty > 0 ? overReason : null,
              overFileUrls: overQty > 0 ? overFileUrls : [],
              idempotencyKey,
              createdById: userId,
            },
          });

          const done: {
            line: ReceiveLine;
            qty: number;
            saved: Awaited<ReturnType<PurchaseProposalsService['applyItemReceipt']>>;
          }[] = [];
          for (const a of finalAlloc) {
            if (a.qty <= 0) continue;
            const line = lines.find((l) => l.item.id.toString() === a.itemId)!;
            const saved = await this.proposals.applyItemReceipt(tx, {
              line,
              qty: a.qty,
              unitRateQty: dto.unitRateQty,
              supplierUnitShare: round4((supplierUnitQty * a.qty) / total),
              receiptId: receipt.id,
              supplierWarehouseId: supplierWarehouse.id,
              userId,
              idempotencyKey,
            });
            done.push({ line, qty: a.qty, saved });
          }
          return {
            receiptId: receipt.id,
            overQty,
            applied: done,
            auto: autoAlloc,
            finalAllocation: finalAlloc,
            adjusted: isAdjusted,
          };
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      // Cùng Idempotency-Key gửi 2 lần gần nhau: lần sau đụng unique idempotencyKey -> trả phiếu lần đầu đã ghi.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const again = await this.findByKey(idempotencyKey);
        if (again) return again;
      }
      throw error;
    }
    const { receiptId, overQty, applied, auto, finalAllocation, adjusted } = outcome;

    for (const a of applied) {
      await this.proposals.afterItemReceipt(a.line, a.qty, a.saved, userId);
    }
    if (overQty > 0) {
      await this.notifyOverReceived(first, total, overQty, overReason!, receiptId, userId);
    }
    if (adjusted) {
      this.logger.log(
        `Phiếu nhận ${receiptId}: thủ kho ${userId} chỉnh phân bổ ${JSON.stringify(auto)} -> ${JSON.stringify(finalAllocation)}`,
      );
    }
    return {
      id: receiptId.toString(),
      code: slipCode,
      status: PurchaseReceiptStatus.RECEIVED,
      receivedQty: total,
      overQty,
      allocation: this.toPreview(lines, finalAllocation),
      allocationAdjusted: adjusted,
    };
  }

  async reject(
    dto: RejectPurchaseReceiptDto,
    userId: string,
    idempotencyKey: string,
    warehouseScope: string | null,
  ): Promise<PurchaseReceiptResult> {
    const existing = await this.findByKey(idempotencyKey);
    if (existing) return existing;

    const lines = await this.loadGroup(dto.itemIds, warehouseScope);
    const first = lines[0];
    const fileUrls = cleanUrls(dto.fileUrls);
    if (fileUrls.length === 0)
      throw new BadRequestException('Cần ít nhất 1 ảnh bằng chứng khi từ chối nhận');

    const receipt = await this.prisma.purchaseReceipt.create({
      data: {
        supplierOrderId: first.item.supplierOrderId,
        materialId: first.item.materialId,
        warehouseCode: first.warehouseCode,
        spec: first.item.spec ?? '',
        stockLengthMm: first.item.stockLengthMm,
        status: PurchaseReceiptStatus.REJECTED,
        unitRateQty: dto.deliveredQty,
        supplierUnitQty: 1,
        deliveredQty: dto.deliveredQty,
        receivedQty: 0,
        supplierSlipUrls: [],
        approvalFileUrls: [],
        receiptSlipUrls: [],
        weighSlipUrls: [],
        rejectReason: dto.reason.trim(),
        rejectFileUrls: fileUrls,
        autoAllocation: [],
        allocation: [],
        idempotencyKey,
        createdById: userId,
      },
    });

    const order = first.item.supplierOrder;
    try {
      await this.notifications.emit('PURCHASE_RECEIPT_REJECTED', {
        entityId: first.proposal.id.toString(),
        actorId: userId,
        params: {
          materialCode: first.item.material.code,
          unit: first.item.material.unit,
          deliveredQty: dto.deliveredQty,
          reason: dto.reason.trim(),
          orderCode: order
            ? `${order.supplier.name} – Số ${supplierOrderCode(order.seq, order.year)}`
            : undefined,
          buyerIds: first.item.material.buyerId ? [first.item.material.buyerId] : [],
        },
      });
    } catch (error) {
      this.logger.error(
        `Không gửi được thông báo từ chối nhận (phiếu ${receipt.id}): ${(error as Error).message}`,
      );
    }

    return {
      id: receipt.id.toString(),
      code: null,
      status: PurchaseReceiptStatus.REJECTED,
      receivedQty: 0,
      overQty: 0,
      allocation: [],
      allocationAdjusted: false,
    };
  }

  private async notifyOverReceived(
    first: ReceiveLine,
    receivedQty: number,
    overQty: number,
    reason: string,
    receiptId: bigint,
    userId: string,
  ): Promise<void> {
    const order = first.item.supplierOrder;
    try {
      await this.notifications.emit('PURCHASE_OVER_RECEIVED', {
        entityId: first.proposal.id.toString(),
        actorId: userId,
        params: {
          materialCode: first.item.material.code,
          unit: first.item.material.unit,
          receivedQty,
          overQty,
          reason,
          orderCode: order
            ? `${order.supplier.name} – Số ${supplierOrderCode(order.seq, order.year)}`
            : undefined,
          buyerIds: first.item.material.buyerId ? [first.item.material.buyerId] : [],
        },
      });
    } catch (error) {
      this.logger.error(
        `Không gửi được thông báo nhận vượt (phiếu ${receiptId}): ${(error as Error).message}`,
      );
    }
  }

  /**
   * "In phiếu nhập" (Đợt 6, bản v8 4.2, 4.8): giữ 1 số NK-yymmdd-NNN cho thủ kho in phiếu, người giao ký, chụp tải vào ô "Phiếu
   * nhập kho" rồi xác nhận nhập kèm số này. In lại cùng lần nhận thì dùng lại số chưa dùng của chính người đó trong ngày.
   */
  async reserveSlipCode(userId: string, reuse?: string): Promise<{ code: string }> {
    if (reuse) {
      const old = await this.prisma.reservedSlipCode.findUnique({ where: { code: reuse } });
      if (old && old.kind === 'NK' && !old.usedAt && old.createdById === userId) {
        return { code: old.code };
      }
    }
    const code = await this.prisma.$transaction(async (tx) => {
      const c = await allocateSlipCode(tx, 'NK');
      await tx.reservedSlipCode.create({ data: { code: c, kind: 'NK', createdById: userId } });
      return c;
    });
    return { code };
  }

  /** Lịch sử phiếu nhận (kể cả phiếu từ chối) của 1 đơn đặt hàng hoặc 1 vật tư. */
  async list(query: { supplierOrderId?: string; materialId?: string }) {
    const where: Prisma.PurchaseReceiptWhereInput = {
      ...(query.supplierOrderId ? { supplierOrderId: parseBigIntId(query.supplierOrderId) } : {}),
      ...(query.materialId ? { materialId: parseBigIntId(query.materialId) } : {}),
    };
    const rows = await this.prisma.purchaseReceipt.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        material: { select: { code: true, name: true, unit: true } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id.toString(),
      code: r.code,
      supplierOrderId: r.supplierOrderId?.toString() ?? null,
      materialCode: r.material.code,
      materialName: r.material.name,
      unit: r.material.unit,
      warehouseCode: r.warehouseCode,
      status: r.status,
      deliveredQty: r.deliveredQty.toNumber(),
      receivedQty: r.receivedQty.toNumber(),
      supplierSlipUrls: r.supplierSlipUrls,
      approvalFileUrls: r.approvalFileUrls,
      receiptSlipUrls: r.receiptSlipUrls,
      weighSlipUrls: r.weighSlipUrls,
      rejectReason: r.rejectReason,
      rejectFileUrls: r.rejectFileUrls,
      allocation: r.allocation,
      autoAllocation: r.autoAllocation,
      allocationAdjusted: r.allocationAdjusted,
      overQty: r.overQty.toNumber(),
      overReason: r.overReason,
      overFileUrls: r.overFileUrls,
      createdByName: `${r.createdBy.firstName} ${r.createdBy.lastName}`.trim(),
      createdAt: r.createdAt,
    }));
  }

  /**
   * Thống kê nhận vượt (4.12): từng lần nhận vượt + gộp theo NCC, vật tư, thủ kho. Đếm số lần ở mọi nhóm; tổng số vượt chỉ cộng
   * theo vật tư (khác vật tư khác đơn vị, cộng chéo vô nghĩa). Ngày theo giờ VN, mặc định 30 ngày gần nhất.
   */
  async overStats(query: { from?: string; to?: string }) {
    const to = query.to ? vnDayEnd(query.to) : new Date();
    const from = query.from ? vnDayStart(query.from) : new Date(to.getTime() - 30 * 86_400_000);
    const rows = await this.prisma.purchaseReceipt.findMany({
      where: {
        status: PurchaseReceiptStatus.RECEIVED,
        overQty: { gt: 0 },
        createdAt: { gte: from, lte: to },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        material: { select: { code: true, name: true, unit: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        supplierOrder: { select: { seq: true, year: true, supplier: { select: { name: true } } } },
      },
    });
    const items = rows.map((r) => ({
      id: r.id.toString(),
      createdAt: r.createdAt,
      supplierName: r.supplierOrder?.supplier.name ?? '(không có đơn)',
      orderCode: r.supplierOrder
        ? supplierOrderCode(r.supplierOrder.seq, r.supplierOrder.year)
        : null,
      materialCode: r.material.code,
      materialName: r.material.name,
      unit: r.material.unit,
      receivedQty: r.receivedQty.toNumber(),
      overQty: r.overQty.toNumber(),
      overReason: r.overReason ?? '',
      overFileUrls: r.overFileUrls,
      createdByName: `${r.createdBy.firstName} ${r.createdBy.lastName}`.trim(),
    }));
    const group = (keyOf: (i: (typeof items)[number]) => string) => {
      const map = new Map<string, number>();
      for (const i of items) map.set(keyOf(i), (map.get(keyOf(i)) ?? 0) + 1);
      return [...map.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    };
    const byMaterialMap = new Map<
      string,
      { code: string; name: string; unit: string; count: number; overQty: number }
    >();
    for (const i of items) {
      const cur = byMaterialMap.get(i.materialCode) ?? {
        code: i.materialCode,
        name: i.materialName,
        unit: i.unit,
        count: 0,
        overQty: 0,
      };
      cur.count += 1;
      cur.overQty = round4(cur.overQty + i.overQty);
      byMaterialMap.set(i.materialCode, cur);
    }
    return {
      from,
      to,
      items,
      bySupplier: group((i) => i.supplierName),
      byMaterial: [...byMaterialMap.values()].sort(
        (a, b) => b.count - a.count || a.code.localeCompare(b.code),
      ),
      byUser: group((i) => i.createdByName),
    };
  }

  // ─── helpers ───────────────────────────────────────────────────────────────────────────────

  /** Đọc + kiểm các dòng của 1 phiếu: cùng đơn đặt hàng, cùng vật tư/quy cách/chiều dài cây, cùng kho, đang chờ nhận. */
  private async loadGroup(rawIds: string[], warehouseScope: string | null): Promise<ReceiveLine[]> {
    const ids = [...new Set(rawIds)].map((id) => parseBigIntId(id));
    const lines = await this.proposals.loadReceiveLines(ids);
    const first = lines[0];
    for (const l of lines) {
      if (l.item.status !== PurchaseProposalStatus.PURCHASING) {
        throw new ConflictException(
          `Vật tư ${l.item.material.code} của lệnh ${l.lenhCode} đang ở trạng thái ${l.item.status} - chỉ dòng đã Giám đốc duyệt, chưa nhận đủ mới nhận hàng được`,
        );
      }
      if (warehouseScope && warehouseScope !== l.warehouseCode) {
        throw new ForbiddenException(
          `Bạn chỉ nhận hàng cho kho '${warehouseScope}', dòng này về kho '${l.warehouseCode}'`,
        );
      }
      const sameGroup =
        l.item.materialId === first.item.materialId &&
        (l.item.spec ?? '') === (first.item.spec ?? '') &&
        (l.item.stockLengthMm ?? null) === (first.item.stockLengthMm ?? null) &&
        l.warehouseCode === first.warehouseCode &&
        l.item.supplierOrderId === first.item.supplierOrderId;
      if (!sameGroup) {
        throw new BadRequestException(
          'Các dòng của 1 lần nhận phải cùng đơn đặt hàng, cùng vật tư (quy cách, chiều dài cây) và cùng kho nhận',
        );
      }
    }
    if (lines.length > 1 && first.item.supplierOrderId == null) {
      throw new BadRequestException(
        'Chỉ gộp nhận nhiều lệnh được khi các dòng nằm trong cùng 1 đơn đặt hàng',
      );
    }
    return lines;
  }

  /** (2) Phiếu đề xuất Giám đốc ký: lấy từ đơn đặt hàng; dữ liệu cũ (trước đơn đặt hàng) lấy file gắn trên dòng; không có
   *  thì phải tải tay. */
  private approvalFilesOf(lines: ReceiveLine[], uploaded: string[]): string[] {
    const fromOrder = lines[0].item.supplierOrder?.approvalFileUrl;
    if (fromOrder) return [fromOrder];
    const fromItems = cleanUrls(lines.map((l) => l.item.approvalFileUrl ?? ''));
    if (fromItems.length > 0) return fromItems;
    return uploaded;
  }

  private validateAllocation(
    input: ReceiptAllocationDto[],
    lines: ReceiveLine[],
    total: number,
  ): AllocationResult[] {
    const ids = new Set(lines.map((l) => l.item.id.toString()));
    const seen = new Set<string>();
    for (const a of input) {
      if (!ids.has(a.itemId) || seen.has(a.itemId)) {
        throw new BadRequestException(
          `Phân bổ có dòng ${a.itemId} không thuộc lần nhận này hoặc bị lặp`,
        );
      }
      seen.add(a.itemId);
    }
    const sum = round4(input.reduce((s, a) => s + a.qty, 0));
    if (sum !== total) {
      throw new BadRequestException(`Tổng phân bổ (${sum}) phải bằng số thực nhận (${total})`);
    }
    return lines.map((l) => ({
      itemId: l.item.id.toString(),
      qty: round4(input.find((a) => a.itemId === l.item.id.toString())?.qty ?? 0),
    }));
  }

  private toPreview(lines: ReceiveLine[], alloc: AllocationResult[]): PreviewLine[] {
    return alloc.map((a) => {
      const l = lines.find((x) => x.item.id.toString() === a.itemId)!;
      const buyQty = l.item.buyQty.toNumber();
      return {
        itemId: a.itemId,
        proposalId: l.proposal.id.toString(),
        lenhCode: l.lenhCode,
        deadline: l.deadline,
        buyQty,
        purchaseQty: effectiveOrderQty(buyQty, l.item.orderQty?.toNumber()),
        receivedQty: l.item.receivedQty.toNumber(),
        qty: a.qty,
      };
    });
  }

  private async findByKey(idempotencyKey: string): Promise<PurchaseReceiptResult | null> {
    const r = await this.prisma.purchaseReceipt.findUnique({ where: { idempotencyKey } });
    if (!r) return null;
    const allocation = (r.allocation as unknown as AllocationResult[]) ?? [];
    let preview: PreviewLine[] = [];
    if (allocation.length > 0) {
      const lines = await this.proposals.loadReceiveLines(allocation.map((a) => BigInt(a.itemId)));
      preview = this.toPreview(lines, allocation);
    }
    return {
      id: r.id.toString(),
      code: r.code,
      status: r.status,
      receivedQty: r.receivedQty.toNumber(),
      overQty: r.overQty.toNumber(),
      allocation: preview,
      allocationAdjusted: r.allocationAdjusted,
    };
  }
}

function isSteelLine(l: ReceiveLine): boolean {
  return l.item.material.materialGroup?.systemKey === MATERIAL_GROUP_SYSTEM_KEYS.STEEL_BAR;
}

function allocationLineOf(l: ReceiveLine) {
  const buyQty = l.item.buyQty.toNumber();
  return {
    itemId: l.item.id.toString(),
    buyQty,
    orderQty: effectiveOrderQty(buyQty, l.item.orderQty?.toNumber()),
    receivedQty: l.item.receivedQty.toNumber(),
    deadline: l.deadline,
    approvedAt: l.approvedAt,
  };
}

function sameAllocation(a: AllocationResult[], b: AllocationResult[]): boolean {
  const m = new Map(a.map((x) => [x.itemId, x.qty]));
  return b.length === a.length && b.every((x) => m.get(x.itemId) === x.qty);
}
