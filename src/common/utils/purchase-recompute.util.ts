import { Logger } from '@nestjs/common';
import { PurchaseProposalStatus } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { notifyPurchaseDemandDropped } from '../../modules/purchase-proposals/purchase-proposal-notify.util';
import { effectiveOrderQty } from '../../modules/purchase-proposals/purchase-order-qty.util';

const logger = new Logger('PurchaseRecompute');

const EPS = 1e-9;

/**
 * Tính lại số mua khi nhu cầu 1 vật tư đổi (anh Nhân chốt 07/11, áp cho MỌI vật tư): ranh giới là "Giám đốc đã ký".
 *  - CHƯA ký = NEW / QUOTING / SUBMITTED / REJECTED: số mua người mua đã tăng (orderQty) bị bỏ khi nhu cầu GIẢM, quay về số mới
 *    tính và báo người mua nhập lại (dòng SUBMITTED là phiếu đã in -> phiếu cần in lại). Nhu cầu TĂNG thì giữ orderQty.
 *  - ĐÃ ký = PURCHASING (sau "Sếp đã duyệt"): KHÔNG sửa số nào trên dòng; nhu cầu mới thấp hơn số đã ký thì báo người mua + Giám đốc.
 *  - PURCHASED: giữ cách xử lý cũ - chỉ tách dòng NEW cho phần thiếu so với hàng đã nhận.
 * Hàm thuần (không đụng DB) để test được; các service gọi rồi tự ghi DB trong transaction và gửi thông báo SAU commit.
 */
export interface PurchaseRecomputeItem {
  id: bigint;
  status: PurchaseProposalStatus;
  buyQty: number;
  orderQty: number | null;
  receivedQty: number;
}

export interface PurchaseRecomputePlan {
  /** Dòng CHƯA ký được ghi số mới (chỉ 1 dòng, dòng đầu tiên trong danh sách; dòng chưa ký khác giữ nguyên). */
  update: {
    itemId: bigint;
    buyQty: number;
    /** true = đặt orderQty về null. */
    clearOrderQty: boolean;
    /** true = dòng NEW mà số mới = 0 -> chuyển PURCHASED (luật cũ). */
    toPurchased: boolean;
  } | null;
  /** Tạo dòng NEW mới (chưa có dòng chưa ký để ghi, mà vẫn còn phần cần mua). */
  create: { buyQty: number; toPurchased: boolean } | null;
  /** Dòng chưa ký bị bỏ orderQty (chỉ khi số mới > 0) -> báo người mua nhập lại. */
  orderQtyReset: {
    itemId: bigint;
    oldOrderQty: number;
    newBuyQty: number;
    slipPrinted: boolean;
  } | null;
  /** Nhu cầu mới thấp hơn số đã ký (PURCHASING) -> báo người mua + Giám đốc, KHÔNG sửa dòng đã ký. */
  demandDropped: { neededQty: number; signedQty: number } | null;
}

type NumLike = number | { toNumber(): number };
const num = (v: NumLike): number => (typeof v === 'number' ? v : v.toNumber());

/** Đổi dòng Prisma (Decimal) sang dạng số cho `planPurchaseRecompute`. */
export function toRecomputeItem(it: {
  id: bigint;
  status?: PurchaseProposalStatus | null;
  buyQty?: NumLike | null;
  orderQty?: NumLike | null;
  receivedQty?: NumLike | null;
}): PurchaseRecomputeItem {
  return {
    id: it.id,
    // Dòng không rõ trạng thái coi như NEW (chưa ký) - an toàn: không bao giờ coi là đã ký.
    status: it.status ?? PurchaseProposalStatus.NEW,
    buyQty: it.buyQty == null ? 0 : num(it.buyQty),
    orderQty: it.orderQty == null ? null : num(it.orderQty),
    receivedQty: it.receivedQty == null ? 0 : num(it.receivedQty),
  };
}

/** Sắp theo id tăng để chọn dòng ghi ổn định (dòng cũ nhất trước). */
export function sortItemsById<T extends { id: bigint }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const UNSIGNED: ReadonlySet<PurchaseProposalStatus> = new Set([
  PurchaseProposalStatus.NEW,
  PurchaseProposalStatus.QUOTING,
  PurchaseProposalStatus.SUBMITTED,
  PurchaseProposalStatus.REJECTED,
]);

/**
 * Ghi số mới `need` vào 1 dòng CHƯA ký: nhu cầu giảm (need < buyQty cũ) mà người mua đã tăng số mua (orderQty) thì bỏ orderQty
 * và báo nhập lại (chỉ báo khi need > 0; về 0 thì dòng tự đóng, không còn gì để nhập). Nhu cầu tăng/giữ nguyên thì giữ orderQty.
 * Dùng chung cho `planPurchaseRecompute` và luồng sắt (CuttingProposalsService.approve()).
 */
export function planUnsignedWrite(
  target: PurchaseRecomputeItem,
  need: number,
): { clearOrderQty: boolean; orderQtyReset: PurchaseRecomputePlan['orderQtyReset'] } {
  const clearOrderQty = target.orderQty != null && need < target.buyQty - EPS;
  return {
    clearOrderQty,
    orderQtyReset:
      clearOrderQty && need > 0
        ? {
            itemId: target.id,
            oldOrderQty: target.orderQty as number,
            newBuyQty: need,
            slipPrinted: target.status === PurchaseProposalStatus.SUBMITTED,
          }
        : null,
  };
}

/** Dòng chưa có Giám đốc ký (còn sửa số được). */
export function isUnsignedStatus(status: PurchaseProposalStatus): boolean {
  return UNSIGNED.has(status);
}

/**
 * @param items mọi dòng hiện có của 1 khoá (PI, vật tư, quy cách) - theo thứ tự ưu tiên chọn dòng ghi.
 * @param newBuyQty số cần mua vừa tính (nhu cầu×(1+%) − tồn khả dụng, tồn đã gồm hàng đã nhận của chính PI).
 */
export function planPurchaseRecompute(
  items: PurchaseRecomputeItem[],
  newBuyQty: number,
): PurchaseRecomputePlan {
  const plan: PurchaseRecomputePlan = {
    update: null,
    create: null,
    orderQtyReset: null,
    demandDropped: null,
  };
  const signed = items.filter((i) => i.status === PurchaseProposalStatus.PURCHASING);
  const unsigned = items.filter((i) => UNSIGNED.has(i.status));
  const purchased = items.filter((i) => i.status === PurchaseProposalStatus.PURCHASED);

  if (items.length === 0) {
    plan.create = { buyQty: newBuyQty, toPurchased: newBuyQty === 0 };
    return plan;
  }

  // Chỉ còn dòng đã đóng hồ sơ: tách dòng NEW cho phần thiếu (luật cũ, lỗ #6 ngày 2026-08-26).
  if (signed.length === 0 && unsigned.length === 0) {
    const shortfall = newBuyQty - purchased[0].receivedQty;
    if (shortfall > 0) plan.create = { buyQty: shortfall, toPurchased: false };
    return plan;
  }

  // Phần còn chờ về của các dòng đã ký: hàng đó sẽ về nên không cần mua thêm trên dòng chưa ký.
  const pendingSigned = signed.reduce(
    (s, i) => s + Math.max(0, effectiveOrderQty(i.buyQty, i.orderQty) - i.receivedQty),
    0,
  );
  const need = signed.length > 0 ? Math.max(0, newBuyQty - pendingSigned) : newBuyQty;

  // "Nhu cầu giảm" so với số CẦN MUA lúc ký (buyQty), KHÔNG so với số thực mua (orderQty người mua làm tròn lên): cần 406, mua
  // tròn 450, tính lại vẫn cần 406 thì không phải nhu cầu giảm - so với 450 sẽ báo sai ở mọi lần tính lại. Số báo cho người mua
  // vẫn là số thực đã ký mua. Tồn khả dụng đã gồm hàng đã nhận của các dòng này nên cộng lại receivedQty để so cùng gốc.
  const neededQty = newBuyQty + signed.reduce((s, i) => s + i.receivedQty, 0);
  const signedNeed = signed.reduce((s, i) => s + i.buyQty, 0);
  if (signed.length > 0 && neededQty < signedNeed - EPS) {
    plan.demandDropped = {
      neededQty,
      signedQty: signed.reduce((s, i) => s + effectiveOrderQty(i.buyQty, i.orderQty), 0),
    };
  }

  const target = unsigned[0];
  if (target) {
    const w = planUnsignedWrite(target, need);
    plan.update = {
      itemId: target.id,
      buyQty: need,
      clearOrderQty: w.clearOrderQty,
      toPurchased: target.status === PurchaseProposalStatus.NEW && need === 0,
    };
    plan.orderQtyReset = w.orderQtyReset;
  } else if (need > 0) {
    plan.create = { buyQty: need, toPurchased: false };
  }
  return plan;
}

export interface PurchaseRecomputeEvent {
  materialId: bigint;
  orderQtyReset?: PurchaseRecomputePlan['orderQtyReset'];
  demandDropped?: PurchaseRecomputePlan['demandDropped'];
}

/** Gom sự kiện từ 1 plan (rỗng thì trả null) để service gửi thông báo sau commit. */
export function eventFromPlan(
  materialId: bigint,
  plan: PurchaseRecomputePlan,
): PurchaseRecomputeEvent | null {
  if (!plan.orderQtyReset && !plan.demandDropped) return null;
  return {
    materialId,
    orderQtyReset: plan.orderQtyReset,
    demandDropped: plan.demandDropped,
  };
}

/** Best-effort, gọi SAU khi transaction tính lại đã commit. Cùng (lệnh, vật tư) gộp 1 thông báo (dedupe). */
export async function notifyPurchaseOrderQtyReset(
  prisma: PrismaServiceType,
  notifications: NotificationsService,
  input: {
    productionInvoiceId: bigint;
    materialId: bigint;
    oldOrderQty: number;
    newBuyQty: number;
    slipPrinted: boolean;
  },
  actorUserId?: string | null,
): Promise<void> {
  try {
    const [pi, material] = await Promise.all([
      prisma.productionInvoice.findUnique({
        where: { id: input.productionInvoiceId },
        select: { code: true },
      }),
      prisma.material.findUnique({
        where: { id: input.materialId },
        select: { code: true, unit: true, buyerId: true },
      }),
    ]);
    if (!pi || !material) return;
    await notifications.emit('PURCHASE_ORDER_QTY_RESET', {
      entityId: input.productionInvoiceId.toString(),
      actorId: actorUserId ?? undefined,
      dedupeKey: `PURCHASE_ORDER_QTY_RESET:${input.productionInvoiceId}:${input.materialId}`,
      params: {
        piCode: pi.code,
        materialCode: material.code,
        unit: material.unit ?? undefined,
        oldOrderQty: input.oldOrderQty,
        newBuyQty: input.newBuyQty,
        slipPrinted: input.slipPrinted,
        buyerIds: material.buyerId ? [material.buyerId] : [],
      },
    });
  } catch (error) {
    logger.error(
      `Failed to notify order-qty reset (PI ${input.productionInvoiceId}, material ${input.materialId}): ${(error as Error).message}`,
    );
  }
}

export async function emitPurchaseRecomputeNotifications(
  prisma: PrismaServiceType,
  notifications: NotificationsService,
  productionInvoiceId: bigint,
  events: PurchaseRecomputeEvent[],
  actorUserId?: string | null,
): Promise<void> {
  for (const ev of events) {
    if (ev.orderQtyReset) {
      await notifyPurchaseOrderQtyReset(
        prisma,
        notifications,
        {
          productionInvoiceId,
          materialId: ev.materialId,
          oldOrderQty: ev.orderQtyReset.oldOrderQty,
          newBuyQty: ev.orderQtyReset.newBuyQty,
          slipPrinted: ev.orderQtyReset.slipPrinted,
        },
        actorUserId,
      );
    }
    if (ev.demandDropped) {
      await notifyPurchaseDemandDropped(
        prisma,
        notifications,
        {
          productionInvoiceId,
          materialId: ev.materialId,
          neededQty: ev.demandDropped.neededQty,
          signedQty: ev.demandDropped.signedQty,
        },
        actorUserId,
      );
    }
  }
}
