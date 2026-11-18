import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ProductionInvoiceStatus,
  ProductionOrderFloorStage,
  ProductionOrderStatus,
  TransferStatus,
  WarehouseKind,
} from '../../generated/prisma/client';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WorkshopWarehouseResolver } from '../stock/workshop-warehouse.util';
import { WarehouseTransfersService } from './warehouse-transfers.service';

const NOTIFICATION_TYPE = 'PIECES_TO_PAINT_PENDING' as const;
const ENTITY_TYPE = 'PRODUCTION_INVOICE';
const LOCK_TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 } as const;

/** Một lệnh còn mảnh hàn xong chờ chuyển sang kho Sơn (lệnh của xưởng không có kho Sơn riêng). */
export interface PaintPendingInfo {
  piId: bigint;
  piCode: string;
  workshopId: bigint;
  /** Số mảnh thủ kho còn lập phiếu được thật (đã qua KCS Hàn, chưa nằm trong phiếu, còn tồn ở kho Hàn). */
  pendingQty: number;
  weldWarehouseCode: string;
  weldWarehouseName: string;
  paintWarehouseName: string;
}

const dedupeKeyOf = (piId: bigint | string): string => `pieces-to-paint-pending:${piId}`;

/**
 * Nhắc thủ kho Hàn chuyển mảnh sang kho Sơn (N1, 18/11/2026). Xưởng không có kho Sơn riêng (Phước An) sơn ở xưởng khác nên
 * mảnh hàn xong phải lập phiếu chuyển kho; phần mềm KHÔNG tự lập phiếu, chỉ báo "còn N mảnh chờ chuyển".
 *
 * Số mảnh chờ chuyển = số thủ kho làm được thật ở màn "Xuất theo đơn hàng":
 * - cùng tập lệnh màn đó hiện: PO RELEASED / IN_PROGRESS của lệnh còn chạy (chưa DONE / CANCELLED) có >= 1 SKU ACTIVE;
 * - mỗi mảnh bị chặn theo tồn thật ở kho Hàn trừ phiếu chuyển mảnh chờ nhận (createPieceTransfer).
 *
 * Tin tự đóng khi về 0 hoặc khi lệnh rời khỏi tập (DONE / CANCELLED / đổi xưởng có kho Sơn / hết SKU ACTIVE) ở syncAll().
 * Mọi hàm "ghi tin" chạy dưới khoá theo lệnh `paint-pending:{id lệnh}`.
 */
@Injectable()
export class PaintTransferReminderService {
  private readonly logger = new Logger(PaintTransferReminderService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly transfers: WarehouseTransfersService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Số mảnh chờ chuyển của từng lệnh thuộc xưởng không có kho Sơn (khoá = id lệnh dạng chuỗi). Mỗi lệnh thuộc tập đều có
   * mặt (kể cả pendingQty = 0). `productionInvoiceId` cho trước thì chỉ tính lệnh đó.
   */
  async pendingByPi(productionInvoiceId?: bigint): Promise<Map<string, PaintPendingInfo>> {
    const result = new Map<string, PaintPendingInfo>();
    const orders = await this.prisma.productionOrder.findMany({
      where: {
        status: { in: [ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS] },
        productionInvoiceItem: {
          productionInvoiceId: productionInvoiceId ?? { not: null },
          workshopId: { not: null },
          productionInvoice: {
            status: {
              notIn: [ProductionInvoiceStatus.DONE, ProductionInvoiceStatus.CANCELLED],
            },
            // Cùng luật FE listProductionOrdersForStage: chỉ cần 1 SKU của lệnh đã Bắt đầu (ACTIVE).
            items: {
              some: { productionOrder: { floorStage: ProductionOrderFloorStage.ACTIVE } },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        productionInvoiceItem: {
          select: {
            productionInvoiceId: true,
            workshopId: true,
            productionInvoice: { select: { code: true } },
          },
        },
      },
    });
    if (orders.length === 0) return result;

    const resolver = new WorkshopWarehouseResolver(this.prisma);
    const paintWarehouse = await resolver.kindWarehouseOf(WarehouseKind.SON, null);
    const paintName = paintWarehouse
      ? ((
          await this.prisma.warehouse.findUnique({
            where: { id: paintWarehouse.id },
            select: { name: true },
          })
        )?.name ?? 'kho Sơn')
      : 'kho Sơn';

    // Chỉ giữ lệnh của xưởng không có kho Sơn riêng, có kho Hàn.
    const hasPaint = new Map<string, boolean>();
    const weldOf = new Map<string, { id: bigint; code: string; name: string } | null>();
    const orderIdsByPi = new Map<string, string[]>();
    for (const o of orders) {
      const item = o.productionInvoiceItem;
      const piId = item.productionInvoiceId;
      const workshopId = item.workshopId;
      if (piId == null || workshopId == null) continue;
      const wsKey = workshopId.toString();
      if (!hasPaint.has(wsKey)) {
        hasPaint.set(wsKey, await resolver.workshopHasPaint(workshopId));
        const weld = await resolver.kindWarehouseOf(WarehouseKind.HAN, workshopId);
        const weldRow = weld
          ? await this.prisma.warehouse.findUnique({
              where: { id: weld.id },
              select: { id: true, code: true, name: true },
            })
          : null;
        weldOf.set(wsKey, weldRow);
      }
      if (hasPaint.get(wsKey) || !weldOf.get(wsKey)) continue;
      const weld = weldOf.get(wsKey)!;
      const key = piId.toString();
      if (!result.has(key)) {
        result.set(key, {
          piId,
          piCode: item.productionInvoice?.code ?? `#${piId}`,
          workshopId,
          pendingQty: 0,
          weldWarehouseCode: weld.code,
          weldWarehouseName: weld.name,
          paintWarehouseName: paintName,
        });
      }
      const ids = orderIdsByPi.get(key) ?? [];
      ids.push(o.id.toString());
      orderIdsByPi.set(key, ids);
    }
    const allOrderIds = [...orderIdsByPi.values()].flat();
    // getPieceTransferPlan ném lỗi khi danh sách rỗng - không gọi.
    if (allOrderIds.length === 0) return result;

    const plan = await this.transfers.getPieceTransferPlan(allOrderIds, this.prisma, 'TO_PAINT');
    const piOfOrder = new Map<string, string>();
    for (const [piKey, ids] of orderIdsByPi) for (const id of ids) piOfOrder.set(id, piKey);

    // Giới hạn theo tồn mảnh thật ở kho Hàn trừ phiếu chuyển mảnh chờ nhận (như createPieceTransfer).
    const weldIds = [
      ...new Set([...result.values()].map((r) => weldOf.get(r.workshopId.toString())!.id)),
    ];
    const pieceIds = [
      ...new Set(plan.filter((p) => p.suggestedQty > 0).map((p) => BigInt(p.pieceId))),
    ];
    const left = new Map<string, number>();
    if (pieceIds.length > 0) {
      const [quants, pendings] = await Promise.all([
        this.prisma.stockQuant.findMany({
          where: { warehouseId: { in: weldIds }, pieceId: { in: pieceIds } },
          select: { warehouseId: true, pieceId: true, qty: true },
        }),
        this.prisma.warehouseTransferPieceItem.findMany({
          where: {
            pieceId: { in: pieceIds },
            transfer: { status: TransferStatus.PENDING, fromWarehouseId: { in: weldIds } },
          },
          select: {
            pieceId: true,
            quantity: true,
            transfer: { select: { fromWarehouseId: true } },
          },
        }),
      ]);
      for (const q of quants) {
        const k = `${q.warehouseId}:${q.pieceId}`;
        left.set(k, (left.get(k) ?? 0) + q.qty.toNumber());
      }
      for (const p of pendings) {
        const k = `${p.transfer.fromWarehouseId}:${p.pieceId}`;
        left.set(k, (left.get(k) ?? 0) - p.quantity);
      }
    }

    for (const item of plan) {
      if (item.suggestedQty <= 0) continue;
      const piKey = piOfOrder.get(item.productionOrderId);
      const info = piKey ? result.get(piKey) : undefined;
      if (!info) continue;
      const stockKey = `${weldOf.get(info.workshopId.toString())!.id}:${item.pieceId}`;
      const available = Math.max(0, Math.floor(left.get(stockKey) ?? 0));
      const take = Math.min(item.suggestedQty, available);
      if (take <= 0) continue;
      left.set(stockKey, available - take);
      info.pendingQty += take;
    }
    return result;
  }

  /**
   * Số lệnh còn mảnh chờ chuyển sang Sơn khi `warehouseCode` là kho Hàn của xưởng không có kho Sơn; kho khác trả 0.
   * Tính từ dữ liệu, không đọc bảng tin.
   */
  async countPendingOrders(warehouseCode: string | null | undefined): Promise<number> {
    if (!(await this.isPaintLegWeldWarehouse(warehouseCode))) return 0;
    const map = await this.pendingByPi();
    let n = 0;
    for (const info of map.values()) {
      if (info.weldWarehouseCode === warehouseCode && info.pendingQty > 0) n += 1;
    }
    return n;
  }

  /** Kho `warehouseCode` có phải kho Hàn của xưởng không có kho Sơn riêng (nơi thủ kho phải lập phiếu sang Sơn). */
  async isPaintLegWeldWarehouse(warehouseCode: string | null | undefined): Promise<boolean> {
    if (!warehouseCode) return false;
    const wh = await this.prisma.warehouse.findUnique({
      where: { code: warehouseCode },
      select: { kind: true, workshopId: true },
    });
    if (!wh || wh.kind !== WarehouseKind.HAN || wh.workshopId == null) return false;
    return !(await new WorkshopWarehouseResolver(this.prisma).workshopHasPaint(wh.workshopId));
  }

  /**
   * Phát / cập nhật / đóng tin cho mọi lệnh, rồi đóng tin của lệnh rời khỏi tập (DONE, CANCELLED, đổi sang xưởng có kho Sơn,
   * hết SKU ACTIVE). Gọi ở lượt nhắc nền. Lỗi từng lệnh chỉ ghi log, không chặn lệnh khác.
   */
  async syncAll(): Promise<void> {
    // Map đầu chỉ để biết lệnh nào cần xét; số mảnh thật tính lại trong syncOne SAU khi lấy khoá lệnh.
    const map = await this.pendingByPi();
    for (const info of map.values()) {
      try {
        await this.syncOne(info.piId);
      } catch (error) {
        this.logger.error(
          `Failed to sync paint-transfer reminder (PI ${info.piId}): ${(error as Error).message}`,
        );
      }
    }
    const open = await this.prisma.notification.findMany({
      where: { type: NOTIFICATION_TYPE, recipients: { some: { resolvedAt: null } } },
      select: { entityId: true },
    });
    for (const n of open) {
      if (!n.entityId || (map.get(n.entityId)?.pendingQty ?? 0) > 0) continue;
      try {
        await this.syncOne(BigInt(n.entityId));
      } catch (error) {
        this.logger.error(
          `Failed to close paint-transfer reminder (PI ${n.entityId}): ${(error as Error).message}`,
        );
      }
    }
  }

  /**
   * Làm tươi tin của lệnh chứa 1 PO (gọi sau khi KCS Hàn đạt). FLOOR_ALERTS=off thì không phát: khi tắt nhắc nền sẽ không có
   * lượt nào giảm / đóng tin, nên không phát để khỏi có tin mở mãi (số đỏ vẫn tính từ dữ liệu).
   */
  async refreshForOrder(productionOrderId: string): Promise<void> {
    if (process.env.FLOOR_ALERTS === 'off') return;
    const order = await this.prisma.productionOrder.findUnique({
      where: { id: BigInt(productionOrderId) },
      select: { productionInvoiceItem: { select: { productionInvoiceId: true } } },
    });
    const piId = order?.productionInvoiceItem.productionInvoiceId;
    if (piId == null) return;
    await this.syncOne(piId);
  }

  /**
   * Dưới khoá theo lệnh: 2 KCS chấm 2 lô Hàn cùng lệnh cùng lúc chỉ ra 1 tin (cột dedupeKey không unique). Số mảnh chờ
   * chuyển được tính lại SAU khi có khoá, để tin vừa được lượt khác phát không bị đóng nhầm / hạ số theo số cũ.
   */
  private async syncOne(piId: bigint): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `paint-pending:${piId}`);
      const info = (await this.pendingByPi(piId)).get(piId.toString());
      await this.applyOne(piId, info);
    }, LOCK_TX_OPTIONS);
  }

  private async applyOne(piId: bigint, info: PaintPendingInfo | undefined): Promise<void> {
    const dedupeKey = dedupeKeyOf(piId);
    if (!info || info.pendingQty <= 0) {
      await this.notifications.resolve({
        entityType: ENTITY_TYPE,
        entityId: piId.toString(),
        types: [NOTIFICATION_TYPE],
      });
      return;
    }
    const params = {
      piCode: info.piCode,
      piId: piId.toString(),
      pendingQty: info.pendingQty,
      weldWarehouseCodes: [info.weldWarehouseCode],
      weldWarehouseName: info.weldWarehouseName,
      paintWarehouseName: info.paintWarehouseName,
    };
    const open = await this.prisma.notification.findFirst({
      where: { type: NOTIFICATION_TYPE, dedupeKey, recipients: { some: { resolvedAt: null } } },
      orderBy: { createdAt: 'desc' },
      select: { data: true },
    });
    const emit = (): Promise<void> =>
      this.notifications.emit(NOTIFICATION_TYPE, {
        entityId: piId.toString(),
        dedupeKey,
        params,
      });
    if (!open) {
      await emit();
      return;
    }
    const prev = (open.data as { pendingQty?: unknown } | null)?.pendingQty;
    if (typeof prev !== 'number' || info.pendingQty > prev) {
      // Có mảnh mới: gộp vào tin cũ và hiện lại chưa đọc.
      await emit();
    } else if (info.pendingQty < prev) {
      // Số giảm: cập nhật nội dung, giữ trạng thái đã đọc. Tin vừa bị đóng giữa chừng thì phát tin mới.
      const updated = await this.notifications.updateOpenContent(
        NOTIFICATION_TYPE,
        dedupeKey,
        params,
      );
      if (!updated) await emit();
    }
  }
}
