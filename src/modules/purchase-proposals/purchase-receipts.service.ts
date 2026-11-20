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
  SupplierOrderStatus,
} from '../../generated/prisma/client';
import { MATERIAL_GROUP_SYSTEM_KEYS } from '../../common/constants/material-group-system-keys.constant';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import {
  IdempotencyKeyInUseException,
  assertSameIdempotentRequest,
  lockIdempotencyKey,
} from '../../common/utils/idempotency.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
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
    const lines = await this.loadGroup(dto.itemIds, warehouseScope, true);
    return this.toPreview(lines, autoAllocate(lines.map(allocationLineOf), round4(dto.qty)));
  }

  async receive(
    dto: CreatePurchaseReceiptDto,
    userId: string,
    idempotencyKey: string,
    warehouseScope: string | null,
  ): Promise<PurchaseReceiptResult> {
    // T3-9 (20/11/2026): gửi lại cùng khoá -> so vân tay (người, loại, số phiếu NK, số lượng, nhóm dòng) rồi mới trả phiếu cũ;
    // khác thì 422 (IdempotencyKeyReusedException). Phải làm TRƯỚC loadGroup vì phiếu cũ có thể đã nhận đủ các dòng.
    const supplierUnitQty = dto.supplierUnitQty ?? 1;
    const slipCode = dto.slipCode.trim();
    const expected: ReceiptFingerprint = {
      status: PurchaseReceiptStatus.RECEIVED,
      createdById: userId,
      code: slipCode,
      unitRateQty: dto.unitRateQty,
      supplierUnitQty,
      deliveredQty: dto.deliveredQty,
      itemIds: itemIdsOf(dto.itemIds),
    };
    const existing = await this.findByKey(idempotencyKey, userId, expected);
    if (existing) return existing;

    const lines = await this.loadGroup(dto.itemIds, warehouseScope, true).catch(async (error) => {
      // Bản thắng vừa commit giữa lúc đọc nhanh và lúc đọc dòng (dòng không còn chờ nhận) -> trả phiếu của bản thắng.
      const won = await this.findByKey(idempotencyKey, userId, expected);
      if (won) return won;
      throw error;
    });
    if (!Array.isArray(lines)) return lines;
    const first = lines[0];
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
          // T3-9: câu ĐẦU là try-lock khoá chống trùng (bản trùng đang chạy -> 409 ngay), TRƯỚC khoá đề xuất và số phiếu;
          // rồi đọc lại theo khoá - bản thắng vừa commit thì không ghi nữa, không vấp kiểm số phiếu NK (400).
          await lockIdempotencyKey(tx, 'purchase_receipts', idempotencyKey);
          const dup = await tx.purchaseReceipt.findUnique({ where: { idempotencyKey } });
          if (dup) {
            assertSameReceipt(dup, expected);
            return null;
          }
          // Khoá mọi đề xuất liên quan theo thứ tự id cố định - 2 phiếu cùng chạm 2 lệnh không khoá chéo nhau.
          const proposalIds = [...new Set(lines.map((l) => l.proposal.id))].sort((a, b) =>
            a < b ? -1 : a > b ? 1 : 0,
          );
          for (const id of proposalIds) await lockBusinessKey(tx, `purchase-proposal-mutate:${id}`);
          // K4 (16/11): tái kiểm đơn đặt hàng SAU khoá - "Thay phiếu" (revise) cũng khoá cùng các khoá đề xuất trên rồi mới
          // đưa đơn về DRAFT, nên tới đây trạng thái đơn là số mới nhất.
          await this.assertOrderApprovedInTx(tx, first.item.supplierOrderId);

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

          // Số phiếu NK đã giữ lúc in (Đợt 6, 4.8) - mỗi số chỉ gắn 1 phiếu nhận, và chỉ người đã in (giữ số) mới dùng được (rà soát
          // 14/11, lỗi thấp: trước đây ai cũng dùng được số người khác in, lệch dấu vết ai in / ai nhận).
          const { count: codeUsed } = await tx.reservedSlipCode.updateMany({
            where: { code: slipCode, kind: 'NK', usedAt: null, createdById: userId },
            data: { usedAt: new Date() },
          });
          if (codeUsed !== 1) {
            const held = await tx.reservedSlipCode.findUnique({
              where: { code: slipCode },
              select: { kind: true, usedAt: true, createdById: true },
            });
            throw new BadRequestException(
              held && held.kind === 'NK' && !held.usedAt && held.createdById !== userId
                ? `Số phiếu nhập ${slipCode} do người khác in - bấm "In phiếu nhập" để lấy số của mình`
                : `Số phiếu nhập ${slipCode} không hợp lệ hoặc đã dùng cho lần nhập khác - bấm "In phiếu nhập" để lấy số mới`,
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
        const again = await this.findByKey(idempotencyKey, userId, expected);
        if (again) return again;
      }
      throw error;
    }
    if (!outcome) {
      // Phiếu cùng khoá vừa commit ở request khác: trả phiếu đó, KHÔNG chạy việc phụ (cộng dòng, đóng "từ chối nhận",
      // báo nhận vượt) - bản thắng đã làm rồi.
      const won = await this.findByKey(idempotencyKey, userId, expected);
      if (won) return won;
      throw new IdempotencyKeyInUseException();
    }
    const { receiptId, overQty, applied, auto, finalAllocation, adjusted } = outcome;

    for (const a of applied) {
      await this.proposals.afterItemReceipt(a.line, a.qty, a.saved, userId);
    }
    // Rà soát 14/11 MH4: lần giao này nhận được -> "Kho từ chối nhận" của lần giao trước (cùng đề xuất) hết giá trị.
    for (const proposalId of new Set(lines.map((l) => l.proposal.id))) {
      await this.proposals.resolveReceiptRejected(proposalId);
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
    // T3-9 (20/11/2026): so vân tay {loại REJECTED, người, SL phiếu giao, lý do} trước khi trả phiếu cũ.
    const expected: ReceiptFingerprint = {
      status: PurchaseReceiptStatus.REJECTED,
      createdById: userId,
      deliveredQty: dto.deliveredQty,
      rejectReason: dto.reason.trim(),
      // 20/11/2026 (QA): thêm nhóm dòng vào vân tay để cùng khoá mà khác dòng không bị trả nhầm phiếu cũ.
      itemIds: itemIdsOf(dto.itemIds),
    };
    const existing = await this.findByKey(idempotencyKey, userId, expected);
    if (existing) return existing;

    const lines = await this.loadGroup(dto.itemIds, warehouseScope).catch(async (error) => {
      const won = await this.findByKey(idempotencyKey, userId, expected);
      if (won) return won;
      throw error;
    });
    if (!Array.isArray(lines)) return lines;
    const first = lines[0];
    const fileUrls = cleanUrls(dto.fileUrls);
    if (fileUrls.length === 0)
      throw new BadRequestException('Cần ít nhất 1 ảnh bằng chứng khi từ chối nhận');
    // MH8 (rà soát 14/11): đọc LẠI trạng thái dòng ngay trước khi ghi - dòng vừa được nhận đủ / đóng ở nơi khác thì không ghi
    // phiếu từ chối cho dòng đó nữa.
    const fresh = await this.prisma.purchaseProposalItem.findMany({
      where: { id: { in: lines.map((l) => l.item.id) } },
      select: { id: true, status: true },
    });
    if (fresh.some((f) => f.status !== PurchaseProposalStatus.PURCHASING)) {
      throw new ConflictException('Có dòng vừa được nhận đủ hoặc đóng ở nơi khác - tải lại trang');
    }

    let receipt: { id: bigint } | null;
    try {
      receipt = await this.prisma.$transaction(async (tx) => {
        // T3-9: try-lock khoá chống trùng là câu đầu; bản thắng vừa commit thì không ghi nữa.
        await lockIdempotencyKey(tx, 'purchase_receipts', idempotencyKey);
        const dup = await tx.purchaseReceipt.findUnique({ where: { idempotencyKey } });
        if (dup) {
          assertSameReceipt(dup, expected);
          return null;
        }
        return tx.purchaseReceipt.create({
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
            // Phiếu từ chối không phân bổ số; chỉ lưu nhóm dòng (qty 0) để so vân tay khi gửi lại (20/11/2026).
            autoAllocation: lines.map((l) => ({ itemId: l.item.id.toString(), qty: 0 })),
            allocation: [],
            idempotencyKey,
            createdById: userId,
          },
        });
      });
    } catch (error) {
      // MH8: bấm đúp cùng Idempotency-Key - lần sau đụng unique, trả phiếu lần đầu thay vì lỗi 500 (giống nhận hàng).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const again = await this.findByKey(idempotencyKey, userId, expected);
        if (again) return again;
      }
      throw error;
    }
    if (!receipt) {
      // Bản thắng vừa commit: trả phiếu của nó, không báo người mua lần 2.
      const won = await this.findByKey(idempotencyKey, userId, expected);
      if (won) return won;
      throw new IdempotencyKeyInUseException();
    }

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
  private async loadGroup(
    rawIds: string[],
    warehouseScope: string | null,
    forReceive = false,
  ): Promise<ReceiveLine[]> {
    const ids = [...new Set(rawIds)].map((id) => parseBigIntId(id));
    const lines = await this.proposals.loadReceiveLines(ids);
    const first = lines[0];
    // K4 (danh sách lỗi 16/11): trước đây chỉ kiểm trạng thái dòng - đơn đã "Thay phiếu" (về DRAFT, chờ Giám đốc ký lại) mà còn
    // dòng nhận dở (vẫn "Đang mua") thì vẫn nhận tiếp được theo phiếu cũ. Từ chối nhận vẫn cho, vì hàng NCC giao tới vẫn
    // phải trả lại được.
    const order = first?.item.supplierOrder;
    if (forReceive && order && order.status !== SupplierOrderStatus.APPROVED) {
      throw new ConflictException(
        this.orderNotApprovedMessage(order.seq, order.year, order.status),
      );
    }
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

  /** Khoá dòng đơn đặt hàng và tái kiểm đã duyệt (dòng cũ không có đơn thì bỏ qua). */
  private async assertOrderApprovedInTx(tx: PrismaTx, orderId: bigint | null): Promise<void> {
    if (orderId == null) return;
    const [row] = await tx.$queryRaw<{ status: SupplierOrderStatus; seq: number; year: number }[]>`
      SELECT "status", "seq", "year" FROM "supplier_orders" WHERE "id" = ${orderId} FOR UPDATE
    `;
    if (row && row.status !== SupplierOrderStatus.APPROVED) {
      throw new ConflictException(this.orderNotApprovedMessage(row.seq, row.year, row.status));
    }
  }

  private orderNotApprovedMessage(seq: number, year: number, status: SupplierOrderStatus): string {
    const code = supplierOrderCode(seq, year);
    return status === SupplierOrderStatus.CANCELLED
      ? `Đơn đặt hàng ${code} đã huỷ - không nhận hàng theo đơn này được`
      : `Đơn đặt hàng ${code} đang thay phiếu, chờ Giám đốc ký lại - nhận hàng sau khi người mua bấm "Sếp đã duyệt"`;
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
    // MH7 (rà soát 14/11): làm tròn TỪNG dòng trước rồi mới so tổng - trước đây so tổng của số chưa làm tròn (3.33333×2 +
    // 3.33334 = 10 qua kiểm tra) nhưng ghi từng dòng đã làm tròn (tổng 9.9999), dòng có thể kẹt mãi ở "Đang mua".
    const result = lines.map((l) => ({
      itemId: l.item.id.toString(),
      qty: round4(input.find((a) => a.itemId === l.item.id.toString())?.qty ?? 0),
    }));
    const sum = round4(result.reduce((s, a) => s + a.qty, 0));
    if (sum !== total) {
      throw new BadRequestException(
        `Tổng phân bổ (${sum}, mỗi dòng làm tròn 4 số lẻ) phải bằng số thực nhận (${total})`,
      );
    }
    return result;
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

  /**
   * MH8: khoá chống trùng thuộc NGƯỜI tạo. T3-9 (20/11/2026): so vân tay với lần gửi lại - khác người / loại / nội dung thì
   * 422 (IdempotencyKeyReusedException; trước đây khác người trả 409 và không so nội dung).
   */
  private async findByKey(
    idempotencyKey: string,
    userId: string,
    expected: ReceiptFingerprint,
  ): Promise<PurchaseReceiptResult | null> {
    const r = await this.prisma.purchaseReceipt.findUnique({ where: { idempotencyKey } });
    if (!r) return null;
    assertSameReceipt(r, expected);
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

/** Vân tay của 1 lần nhận / từ chối nhận (T3-9) - chỉ các trường nghiệp vụ, không so ảnh, ghi chú, phân bổ chỉnh tay. */
interface ReceiptFingerprint {
  status: PurchaseReceiptStatus;
  createdById: string;
  code?: string | null;
  unitRateQty?: number | Prisma.Decimal;
  supplierUnitQty?: number | Prisma.Decimal;
  deliveredQty: number | Prisma.Decimal;
  itemIds?: string[];
  rejectReason?: string;
}

/** Nhóm dòng của 1 lần gửi: bỏ trùng, về dạng chuỗi số (giống loadGroup). */
function itemIdsOf(rawIds: string[]): string[] {
  return [...new Set(rawIds)].map((id) => parseBigIntId(id).toString());
}

/**
 * Vân tay đã lưu trên phiếu. Nhóm dòng lấy từ autoAllocation (autoAllocate luôn trả đủ mọi dòng của nhóm), KHÔNG lấy từ
 * allocation - thủ kho có thể đã chỉnh tay, lấy từ đó sẽ báo 422 oan cho 1 lần gửi lại hợp lệ.
 */
function receiptFingerprint(r: {
  status: PurchaseReceiptStatus;
  createdById: string;
  code: string | null;
  unitRateQty: Prisma.Decimal;
  supplierUnitQty: Prisma.Decimal;
  deliveredQty: Prisma.Decimal;
  rejectReason: string | null;
  autoAllocation: unknown;
}): ReceiptFingerprint {
  if (r.status === PurchaseReceiptStatus.REJECTED) {
    return {
      status: r.status,
      createdById: r.createdById,
      deliveredQty: r.deliveredQty,
      rejectReason: r.rejectReason ?? '',
      itemIds: ((r.autoAllocation as AllocationResult[] | null) ?? []).map((a) => String(a.itemId)),
    };
  }
  return {
    status: r.status,
    createdById: r.createdById,
    code: r.code,
    unitRateQty: r.unitRateQty,
    supplierUnitQty: r.supplierUnitQty,
    deliveredQty: r.deliveredQty,
    itemIds: ((r.autoAllocation as AllocationResult[] | null) ?? []).map((a) => String(a.itemId)),
  };
}

/**
 * So vân tay đã lưu với lần gửi lại. Phiếu từ chối CŨ (trước 20/11/2026) chưa lưu nhóm dòng (autoAllocation rỗng) thì bỏ
 * qua phần itemIds - không có gì để so, không báo 422 oan.
 */
function assertSameReceipt(
  stored: Parameters<typeof receiptFingerprint>[0],
  expected: ReceiptFingerprint,
): void {
  const fp = receiptFingerprint(stored);
  if (expected.status === PurchaseReceiptStatus.REJECTED && (fp.itemIds?.length ?? 0) === 0) {
    assertSameIdempotentRequest({ ...fp, itemIds: undefined }, { ...expected, itemIds: undefined });
    return;
  }
  assertSameIdempotentRequest(fp, expected);
}
