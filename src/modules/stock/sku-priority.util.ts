import { ProductionOrderFloorStage } from '../../generated/prisma/client';
import type { PrismaTx } from '../../prisma/prisma.service';
import {
  PurchaseDeadlineItem,
  purchaseDeadlineOf,
  purchaseGroupOf,
} from '../../common/utils/frame-deadline.util';

/**
 * YC11 (bản v8 mục 11.1/11.3, 05/11/2026): trong 1 lệnh gộp (1 PI nhiều SKU), vật tư tiêu hao / đóng gói / đan / vật tư thành
 * phẩm phải ưu tiên SKU cần sớm hơn. Giữ chỗ và số mua vẫn tính chung cho cả PI (không đổi), nên ưu tiên đặt ở BƯỚC XUẤT: khi xuất
 * vật tư M cho SKU Y, chừa lại phần SKU sớm hơn trong cùng PI còn cần (định mức − đã xuất của chính luồng đó), Y chỉ lấy phần dư.
 * Sắt KHÔNG đi qua đây - pool giữ chỗ của sắt đã xếp theo hạn SKU (StockReservationsService.loadPool), v8 11.3 chốt sắt ưu tiên
 * theo phương án cắt.
 *
 * "Sớm hơn" = hạn vật tư theo nhóm mua của M (`purchaseDeadlineOf`, cùng ngày màn Mua hàng / Bảng mốc hiện), bằng ngày thì dòng
 * vào lệnh trước (id nhỏ hơn - thay cho "Giám đốc duyệt trước" của YC8, 2 SKU cùng PI được duyệt cùng lúc). Chưa có hạn xếp cuối.
 * SKU đã Kết thúc không còn cần gì, bỏ qua. PI 1 SKU: không có SKU khác, không chừa gì - hành vi như cũ.
 */

export interface SiblingOrder {
  id: bigint;
  bomRevisionId: bigint;
  quantity: number;
  wireMaterialId: bigint | null;
  cushionMaterialId: bigint | null;
}

export interface SkuHolder {
  productionOrderId: string;
  /** Số LSX của dòng SKU đó (mã hiển thị), chưa có thì số PO. */
  lenhCode: string;
  deadline: Date | null;
  qty: number;
}

export interface SkuHoldback {
  /** Tổng phải chừa cho các SKU sớm hơn. */
  qty: number;
  holders: SkuHolder[];
  /** Mã vật tư - cho câu báo lỗi (chỉ có khi phải đọc vật tư, tức PI có SKU khác). */
  materialCode?: string;
}

const NO_HOLDBACK: SkuHoldback = { qty: 0, holders: [] };

type OrderRank = { deadline: Date | null; itemId: bigint };

/** a xếp trước b? (hạn sớm hơn, bằng hạn thì dòng vào trước; chưa có hạn xếp cuối) */
export function ranksBefore(a: OrderRank, b: OrderRank): boolean {
  const ta = a.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
  const tb = b.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta < tb;
  return a.itemId < b.itemId;
}

const ITEM_DEADLINE_SELECT = {
  id: true,
  lsxCode: true,
  materialDeadline: true,
  finishedMaterialDeadline: true,
  stages: { select: { stageType: true, deadline: true } },
  productionInvoice: { select: { deadline: true } },
} as const;

/**
 * Phần phải chừa cho các SKU sớm hơn trong cùng PI khi xuất `materialId` cho `orderId`. `remainingOf(sibling)` = phần SKU đó còn
 * cần theo ĐÚNG luồng xuất đang gọi (định mức − đã xuất, ≤ 0 coi như 0). Gọi TRONG transaction của luồng xuất, sau khi đã khoá
 * stock_quant - lần xuất của SKU sớm hơn cũng khoá cùng dòng stock_quant nên số "đã xuất" đọc ở đây không lệch.
 */
export async function loadSkuPriorityHoldback(
  tx: PrismaTx,
  input: {
    orderId: bigint;
    productionInvoiceItemId: bigint;
    productionInvoiceId: bigint;
    materialId: bigint;
    remainingOf: (sibling: SiblingOrder) => Promise<number>;
  },
): Promise<SkuHoldback> {
  const siblings = await tx.productionOrder.findMany({
    where: {
      id: { not: input.orderId },
      floorStage: { not: ProductionOrderFloorStage.FINISHED },
      productionInvoiceItem: { productionInvoiceId: input.productionInvoiceId },
    },
    select: {
      id: true,
      poNumber: true,
      bomRevisionId: true,
      quantity: true,
      wireMaterialId: true,
      cushionMaterialId: true,
      productionInvoiceItem: { select: ITEM_DEADLINE_SELECT },
    },
    orderBy: { id: 'asc' },
  });
  if (siblings.length === 0) return NO_HOLDBACK;

  const [ownItem, material] = await Promise.all([
    tx.productionInvoiceItem.findUniqueOrThrow({
      where: { id: input.productionInvoiceItemId },
      select: ITEM_DEADLINE_SELECT,
    }),
    tx.material.findUniqueOrThrow({
      where: { id: input.materialId },
      select: { code: true, detailKind: true },
    }),
  ]);
  const group = purchaseGroupOf(material.detailKind);
  const deadlineOf = (it: PurchaseDeadlineItem) => purchaseDeadlineOf(it, group);
  const own: OrderRank = { deadline: deadlineOf(ownItem), itemId: ownItem.id };

  const holders: SkuHolder[] = [];
  for (const sib of siblings) {
    const item = sib.productionInvoiceItem;
    const rank: OrderRank = { deadline: deadlineOf(item), itemId: item.id };
    if (!ranksBefore(rank, own)) continue;
    const qty = Math.max(0, await input.remainingOf(sib));
    if (qty <= 0) continue;
    holders.push({
      productionOrderId: sib.id.toString(),
      lenhCode: item.lsxCode?.trim() || sib.poNumber,
      deadline: rank.deadline,
      qty,
    });
  }
  const qty = holders.reduce((s, h) => s + h.qty, 0);
  return { qty: Math.round(qty * 10000) / 10000, holders, materialCode: material.code };
}

function deadlineLabel(d: Date | null): string {
  if (!d) return 'chưa có hạn';
  // Giờ VN (UTC+7) - tự tính, toLocaleDateString('vi-VN') ra "10-11" hay "10/11" tuỳ bản ICU của Node.
  const vn = new Date(d.getTime() + 7 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `cần ${pad(vn.getUTCDate())}/${pad(vn.getUTCMonth() + 1)}`;
}

/** Câu báo lỗi khi tồn khả dụng còn lại sau khi chừa không đủ - gọi khi `holdback.qty > 0`. */
export function skuHoldbackMessage(
  holdback: SkuHoldback,
  availableQty: number,
  requestedQty: number,
  materialLabel: string,
): string {
  const left = Math.max(0, Math.round((availableQty - holdback.qty) * 10000) / 10000);
  const who = holdback.holders
    .map((h) => `${h.qty} cho lệnh ${h.lenhCode} (${deadlineLabel(h.deadline)})`)
    .join(', ');
  return (
    `Tồn kho khả dụng ${availableQty} vật tư ${materialLabel}, đang chừa ${who} - SKU cần sớm hơn trong cùng lệnh gộp được ` +
    `xuất trước. Lệnh này chỉ còn xuất được ${left}, không đủ ${requestedQty}`
  );
}
