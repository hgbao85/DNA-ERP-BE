import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CancelledGoodsKind,
  IssueSlipLineKind,
  IssueSlipStatus,
  ProductionOrderCancelStatus,
  ProductionOrderStatus,
} from '../../generated/prisma/client';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';

/** Kho thành phẩm mặc định khi dòng SKU chưa ghi kho cụ thể. */
export const DEFAULT_TP_WAREHOUSE_CODE = 'thanh-pham';
export const tpWarehouseOf = (code: string | null | undefined): string =>
  code && code.trim() ? code : DEFAULT_TP_WAREHOUSE_CODE;

/** Ghi chú trên CancelledGoodsTransfer do hệ thống tự lấy tồn. */
export const WOVEN_STOCK_AUTO_NOTE = 'Tự lấy từ tồn khung đan kho thành phẩm';

/** 1 nguồn tồn: khung đan của 1 lệnh SX đã huỷ, theo mảnh. */
export interface WovenStockSource {
  cancelRequestId: bigint;
  sourceItemId: bigint;
  sourceOrderId: bigint;
  qty: number;
}

/** Tồn khung đan theo (kho thành phẩm, mảnh, màu dây). */
export interface WovenStockBucket {
  warehouseCode: string;
  pieceId: bigint;
  wireMaterialId: bigint | null;
  qty: number;
  /** Nguồn theo thứ tự đề nghị huỷ cũ trước (lấy trước). */
  sources: WovenStockSource[];
}

const bucketKey = (wc: string, pieceId: bigint, wire: bigint | null) =>
  `${wc}:${pieceId}:${wire ?? 'none'}`;

/**
 * Tồn khung đan (Q6 huỷ lệnh, anh Nhân trả lời 26/11/2026 - câu 1b, 2a, 3a):
 *  - khung đã đan của SKU bị huỷ (đã nhận về từ điểm đan, kể cả phần nhận về SAU khi huỷ) nằm ở kho thành phẩm của lệnh bị huỷ,
 *    thành tồn theo mã mảnh + màu dây;
 *  - lệnh sau cần đúng mảnh + màu dây (cùng kho thành phẩm) TỰ lấy tồn trước, chỉ xuất đan phần còn thiếu.
 *
 * Không có bảng tồn riêng / không ghi sổ kho: mảnh đan từ trước tới nay không đi StockLedger (xuất đan trừ kho giữ mảnh sang
 * PRODUCTION, nhận đan chỉ ghi WeavingReceipt). Tồn tính lại từ dữ liệu:
 *   tồn của 1 lệnh đã huỷ = đã nhận đan + đã lấy tồn vào − đã qua chuyền kiểm − đã lấy tồn ra
 * "Lấy tồn" ghi CancelledGoodsTransfer kind WOVEN (nguồn = dòng SKU đã huỷ, đích = dòng SKU nhận) - dòng nhận coi như đã nhận đan
 * thêm số đó (Chuyền kiểm đếm), và định mức xuất đan của dòng nhận trừ đi số đó.
 */
@Injectable()
export class WovenStockService {
  private readonly logger = new Logger(WovenStockService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly realtime: RealtimeService,
  ) {}

  /** Tồn khung đan hiện có, lọc tuỳ chọn theo kho / mảnh / màu dây (undefined = mọi giá trị). */
  async loadStock(
    db: PrismaTx | PrismaServiceType,
    filter: { warehouseCode?: string; pieceId?: bigint; wireMaterialId?: bigint | null } = {},
  ): Promise<WovenStockBucket[]> {
    const reqs = await db.productionOrderCancelRequest.findMany({
      where: {
        status: ProductionOrderCancelStatus.APPROVED,
        productionOrder: { status: ProductionOrderStatus.CANCELLED },
      },
      select: {
        id: true,
        productionOrder: {
          select: {
            id: true,
            productionInvoiceItem: {
              select: { id: true, warehouseCode: true, wireMaterialId: true },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
    });
    // 1 lệnh chỉ có 1 đề nghị huỷ được duyệt; phòng hờ trùng thì giữ cái đầu.
    const seen = new Set<string>();
    const srcs = reqs.filter((r) => {
      const k = r.productionOrder.id.toString();
      if (seen.has(k)) return false;
      seen.add(k);
      const item = r.productionOrder.productionInvoiceItem;
      if (
        filter.warehouseCode !== undefined &&
        tpWarehouseOf(item.warehouseCode) !== filter.warehouseCode
      )
        return false;
      if (
        filter.wireMaterialId !== undefined &&
        (item.wireMaterialId ?? null) !== (filter.wireMaterialId ?? null)
      )
        return false;
      return true;
    });
    if (srcs.length === 0) return [];
    const orderIds = srcs.map((s) => s.productionOrder.id);
    const itemIds = srcs.map((s) => s.productionOrder.productionInvoiceItem.id);
    const pieceWhere = filter.pieceId !== undefined ? { pieceId: filter.pieceId } : {};
    const [receipts, takenIn, takenOut, checked] = await Promise.all([
      db.weavingReceipt.groupBy({
        by: ['productionOrderId', 'pieceId'],
        where: { productionOrderId: { in: orderIds }, ...pieceWhere },
        _sum: { qty: true },
      }),
      db.cancelledGoodsTransfer.groupBy({
        by: ['targetItemId', 'pieceId'],
        where: { kind: CancelledGoodsKind.WOVEN, targetItemId: { in: itemIds }, ...pieceWhere },
        _sum: { qty: true },
      }),
      db.cancelledGoodsTransfer.groupBy({
        by: ['sourceItemId', 'pieceId'],
        where: { kind: CancelledGoodsKind.WOVEN, sourceItemId: { in: itemIds }, ...pieceWhere },
        _sum: { qty: true },
      }),
      db.transferCheckResult.groupBy({
        by: ['productionInvoiceItemId', 'pieceId'],
        where: { productionInvoiceItemId: { in: itemIds }, ...pieceWhere },
        _sum: { checkedQty: true },
      }),
    ]);
    // khoá theo (dòng SKU, mảnh)
    const qtyBy = new Map<string, number>();
    const add = (k: string, n: number) => qtyBy.set(k, (qtyBy.get(k) ?? 0) + n);
    const itemOfOrder = new Map(
      srcs.map((s) => [
        s.productionOrder.id.toString(),
        s.productionOrder.productionInvoiceItem.id,
      ]),
    );
    for (const r of receipts) {
      const itemId = itemOfOrder.get(r.productionOrderId.toString());
      if (itemId != null) add(`${itemId}:${r.pieceId}`, r._sum.qty ?? 0);
    }
    for (const t of takenIn)
      if (t.pieceId != null) add(`${t.targetItemId}:${t.pieceId}`, t._sum.qty ?? 0);
    for (const t of takenOut)
      if (t.pieceId != null) add(`${t.sourceItemId}:${t.pieceId}`, -(t._sum.qty ?? 0));
    for (const c of checked)
      add(`${c.productionInvoiceItemId}:${c.pieceId}`, -(c._sum.checkedQty ?? 0));

    const srcByItem = new Map(
      srcs.map((s) => [s.productionOrder.productionInvoiceItem.id.toString(), s]),
    );
    const buckets = new Map<string, WovenStockBucket>();
    for (const [k, qty] of qtyBy) {
      if (qty <= 0) continue;
      const [itemStr, pieceStr] = k.split(':');
      const s = srcByItem.get(itemStr);
      if (!s) continue;
      const item = s.productionOrder.productionInvoiceItem;
      const wc = tpWarehouseOf(item.warehouseCode);
      const pieceId = BigInt(pieceStr);
      const wire = item.wireMaterialId ?? null;
      const bk = bucketKey(wc, pieceId, wire);
      let b = buckets.get(bk);
      if (!b) {
        b = { warehouseCode: wc, pieceId, wireMaterialId: wire, qty: 0, sources: [] };
        buckets.set(bk, b);
      }
      b.qty += qty;
      b.sources.push({
        cancelRequestId: s.id,
        sourceItemId: item.id,
        sourceOrderId: s.productionOrder.id,
        qty,
      });
    }
    for (const b of buckets.values()) {
      b.sources.sort((a, c) =>
        a.cancelRequestId < c.cancelRequestId ? -1 : a.cancelRequestId > c.cancelRequestId ? 1 : 0,
      );
    }
    return [...buckets.values()];
  }

  /**
   * Cấp tồn khung đan của 1 (kho, mảnh, màu dây) cho các lệnh đang chạy cần đúng loại đó - lệnh cũ trước (id tăng dần). Mỗi lệnh
   * nhận tối đa phần còn thiếu = định mức − đã xuất đan − đang trên phiếu xuất đan chờ ký − đã lấy tồn. Idempotent; trả về id các
   * lệnh vừa nhận thêm.
   */
  async allocateBucket(
    warehouseCode: string,
    pieceId: bigint,
    wireMaterialId: bigint | null,
    actorId: string,
  ): Promise<bigint[]> {
    const touched = await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `woven-stock:${bucketKey(warehouseCode, pieceId, wireMaterialId)}`);
      const [bucket] = await this.loadStock(tx, { warehouseCode, pieceId, wireMaterialId });
      if (!bucket || bucket.qty <= 0) return [];
      const targets = await tx.productionOrder.findMany({
        where: {
          status: { not: ProductionOrderStatus.CANCELLED },
          floorStage: 'ACTIVE',
          productionInvoiceItem: {
            cancelledAt: null,
            wireMaterialId,
            ...(warehouseCode === DEFAULT_TP_WAREHOUSE_CODE
              ? { OR: [{ warehouseCode }, { warehouseCode: null }] }
              : { warehouseCode }),
          },
        },
        select: { id: true, quantity: true, bomRevisionId: true, productionInvoiceItemId: true },
        orderBy: { id: 'asc' },
      });
      if (targets.length === 0) return [];
      const bomPieces = await tx.bomPiece.findMany({
        where: {
          bomRevisionId: { in: [...new Set(targets.map((t) => t.bomRevisionId))] },
          pieceId,
          isWoven: true,
        },
        select: { bomRevisionId: true, qtyPerUnit: true },
      });
      const perUnitByRev = new Map(
        bomPieces.map((b) => [b.bomRevisionId.toString(), b.qtyPerUnit]),
      );
      const sources = bucket.sources.map((s) => ({ ...s }));
      let left = bucket.qty;
      const out: bigint[] = [];
      for (const t of targets) {
        if (left <= 0) break;
        const perUnit = perUnitByRev.get(t.bomRevisionId.toString());
        if (!perUnit) continue;
        // Cùng khoá với chặn trần xuất đan + chuyền kiểm của dòng nhận.
        await lockBusinessKey(tx, `weaving-issue:${t.id}:${pieceId}`);
        await lockBusinessKey(tx, `transfer-check:${t.productionInvoiceItemId}:${pieceId}`);
        const need = await this.remainingNeedInTx(
          tx,
          t.id,
          t.productionInvoiceItemId,
          pieceId,
          perUnit * t.quantity,
        );
        let take = Math.min(need, left);
        if (take <= 0) continue;
        left -= take;
        for (const s of sources) {
          if (take <= 0) break;
          const n = Math.min(s.qty, take);
          if (n <= 0) continue;
          await tx.cancelledGoodsTransfer.create({
            data: {
              cancelRequestId: s.cancelRequestId,
              kind: CancelledGoodsKind.WOVEN,
              sourceItemId: s.sourceItemId,
              targetItemId: t.productionInvoiceItemId,
              pieceId,
              qty: n,
              note: WOVEN_STOCK_AUTO_NOTE,
              createdById: actorId,
            },
          });
          s.qty -= n;
          take -= n;
        }
        out.push(t.id);
      }
      return out;
    });
    for (const id of touched) {
      this.realtime.publishEntityChanged({
        entity: 'PRODUCTION_ORDER',
        entityId: id,
        action: 'UPDATED',
        actorId,
      });
    }
    return touched;
  }

  /** Phần khung đan còn thiếu của 1 (lệnh, mảnh) - định mức − đã xuất − trên phiếu chờ ký − đã lấy tồn. */
  async remainingNeedInTx(
    tx: PrismaTx | PrismaServiceType,
    orderId: bigint,
    itemId: bigint,
    pieceId: bigint,
    plannedQty: number,
  ): Promise<number> {
    const [issued, draft, taken] = await Promise.all([
      tx.weavingIssue.aggregate({
        where: { productionOrderId: orderId, pieceId },
        _sum: { qty: true },
      }),
      tx.issueSlipLine.aggregate({
        where: {
          kind: IssueSlipLineKind.WEAVING_PIECE,
          productionOrderId: orderId,
          pieceId,
          slip: { status: IssueSlipStatus.DRAFT },
        },
        _sum: { qty: true },
      }),
      this.takenFromStock(tx, itemId, pieceId),
    ]);
    return plannedQty - (issued._sum.qty ?? 0) - (draft._sum.qty?.toNumber() ?? 0) - taken;
  }

  /** Số khung dòng SKU đã lấy từ tồn (mọi lần) cho 1 mảnh. */
  async takenFromStock(
    db: PrismaTx | PrismaServiceType,
    itemId: bigint,
    pieceId: bigint,
  ): Promise<number> {
    const agg = await db.cancelledGoodsTransfer.aggregate({
      where: { kind: CancelledGoodsKind.WOVEN, targetItemId: itemId, pieceId },
      _sum: { qty: true },
    });
    return agg._sum.qty ?? 0;
  }

  /** Cấp tồn cho mọi tồn khung đan đang có (sau khi duyệt huỷ / nhận đan của lệnh đã huỷ). Best-effort - lỗi chỉ log. */
  async allocateAll(actorId: string, filter: { pieceId?: bigint } = {}): Promise<void> {
    try {
      const buckets = await this.loadStock(this.prisma, filter);
      for (const b of buckets)
        await this.allocateBucket(b.warehouseCode, b.pieceId, b.wireMaterialId, actorId);
    } catch (e) {
      this.logger.error(`Cấp tồn khung đan lỗi: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Cấp tồn cho 1 lệnh đang chạy (Bắt đầu / trước khi lên phiếu xuất đan): mọi mảnh đan của lệnh. Best-effort - lỗi chỉ log. */
  async allocateForOrder(orderId: bigint, actorId: string, pieceId?: bigint): Promise<void> {
    try {
      const order = await this.prisma.productionOrder.findUnique({
        where: { id: orderId },
        select: {
          bomRevisionId: true,
          productionInvoiceItem: { select: { warehouseCode: true, wireMaterialId: true } },
        },
      });
      if (!order) return;
      const wc = tpWarehouseOf(order.productionInvoiceItem.warehouseCode);
      const wire = order.productionInvoiceItem.wireMaterialId ?? null;
      const buckets = await this.loadStock(this.prisma, {
        warehouseCode: wc,
        wireMaterialId: wire,
        ...(pieceId !== undefined ? { pieceId } : {}),
      });
      if (buckets.length === 0) return;
      const woven = await this.prisma.bomPiece.findMany({
        where: { bomRevisionId: order.bomRevisionId, isWoven: true },
        select: { pieceId: true },
      });
      const wovenIds = new Set(woven.map((w) => w.pieceId.toString()));
      for (const b of buckets) {
        if (!wovenIds.has(b.pieceId.toString())) continue;
        await this.allocateBucket(wc, b.pieceId, wire, actorId);
      }
    } catch (e) {
      this.logger.error(
        `Cấp tồn khung đan cho lệnh ${orderId} lỗi: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
