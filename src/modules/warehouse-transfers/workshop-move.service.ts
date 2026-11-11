import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PurchaseProposalStatus,
  ReservationStatus,
  TransferStatus,
  WarehouseKind,
} from '../../generated/prisma/client';
import { loadLenhDisplayCodes } from '../../common/utils/lenh-code.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WorkshopWarehouseResolver } from '../stock/workshop-warehouse.util';
import { isCuttingRecheckPending } from './cutting-recheck.util';
import { MATERIAL_GROUP_SYSTEM_KEYS } from '../../common/constants/material-group-system-keys.constant';

type Db = PrismaServiceType | PrismaTx;

/** Kho gắn theo xưởng: đổi xưởng thì hàng của lệnh ở các kho này phải chuyển sang kho cùng loại của xưởng mới. */
const BOUND_KINDS: WarehouseKind[] = [WarehouseKind.PHOI, WarehouseKind.HAN];
const OPEN_PURCHASE: PurchaseProposalStatus[] = [
  PurchaseProposalStatus.NEW,
  PurchaseProposalStatus.QUOTING,
  PurchaseProposalStatus.SUBMITTED,
  PurchaseProposalStatus.PURCHASING,
];
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export interface WorkshopMoveLine {
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  stockLengthMm: number;
  spec: string;
  /** Đang giữ cho lệnh ở kho cũ, trừ phần đã nằm trên phiếu chuyển chờ nhận. */
  qty: number;
}

/**
 * Phần của phiếu (anh Nhân 10/11/2026 chọn "chỉ chặn sắt"): STEEL = vật tư nhóm Sắt (STEEL_BAR) - chờ KHSX bấm "Đã kiểm" phương
 * án cắt; OTHER = vật tư khác (vật tư hàn, vật tư phụ...) - chuyển ngay. Cùng 1 kho cũ có cả 2 thì lập 2 phiếu.
 */
export type WorkshopMovePart = 'STEEL' | 'OTHER';

export interface WorkshopMovePlan {
  productionInvoiceId: string;
  part: WorkshopMovePart;
  lenhCode: string;
  fromWarehouseId: string;
  fromWarehouseCode: string;
  fromWarehouseName: string;
  toWarehouseId: string;
  toWarehouseCode: string;
  toWarehouseName: string;
  /** Phần sắt mà KHSX chưa bấm "Đã kiểm" phương án cắt sau khi đổi xưởng - chưa lập phiếu được. Phần OTHER luôn false. */
  recheckPending: boolean;
  lines: WorkshopMoveLine[];
}

/**
 * Đổi xưởng khi lệnh đã giữ hàng / đang mua (anh Nhân 09-10/11/2026, Sang trả lời 10/11):
 *  - afterWorkshopChanged(): chạy TRONG transaction đổi xưởng của ProductionInvoicesService.changeWorkshop() - dòng mua chưa
 *    về của lệnh mà kho nhận là kho Phôi/Hàn xưởng cũ thì đổi sang kho cùng loại xưởng mới; thông báo người mua + thủ kho kho
 *    cũ gửi SAU commit (hàm trả về).
 *  - getPlans(): hàng đang giữ cho lệnh (StockReservation ACTIVE) còn nằm ở kho Phôi/Hàn không thuộc xưởng hiện tại của lệnh -
 *    thủ kho kho cũ lập phiếu chuyển (WarehouseTransfersService.createWorkshopMove), kho mới nhận thì giữ chỗ chuyển theo.
 * Cờ "cần kiểm lại" phương án cắt do Sang bật trong changeWorkshop(); ở đây chỉ đọc (cutting-recheck.util.ts).
 */
@Injectable()
export class WorkshopMoveService {
  private readonly logger = new Logger(WorkshopMoveService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Gọi trong transaction đổi xưởng, SAU khi đã ghi workshopId mới cho các dòng của lệnh. Trả về hàm gửi thông báo - người gọi
   * chạy hàm đó sau khi transaction commit (lỗi ở đây thì cả việc đổi xưởng rollback).
   */
  async afterWorkshopChanged(
    tx: PrismaTx,
    productionInvoiceId: bigint,
    toWorkshopId: bigint,
    actorUserId: string,
  ): Promise<() => Promise<void>> {
    const resolver = new WorkshopWarehouseResolver(tx);
    const items = await tx.purchaseProposalItem.findMany({
      where: { proposal: { productionInvoiceId }, status: { in: OPEN_PURCHASE } },
      select: {
        id: true,
        receiveWarehouseCode: true,
        material: {
          select: {
            code: true,
            buyerId: true,
            warehouseId: true,
            warehouse: { select: { id: true, code: true, kind: true, workshopId: true } },
          },
        },
      },
    });
    const overrideCodes = [
      ...new Set(items.map((i) => i.receiveWarehouseCode).filter((c): c is string => !!c)),
    ];
    const overrides = overrideCodes.length
      ? await tx.warehouse.findMany({
          where: { code: { in: overrideCodes } },
          select: { id: true, code: true, name: true, kind: true, workshopId: true },
        })
      : [];
    const byCode = new Map(overrides.map((w) => [w.code, w]));

    const rerouted: { buyerId: string | null; materialCode: string; toCode: string }[] = [];
    for (const it of items) {
      const current = it.receiveWarehouseCode
        ? byCode.get(it.receiveWarehouseCode)
        : it.material.warehouse;
      if (!current?.kind || !BOUND_KINDS.includes(current.kind)) continue;
      if (current.workshopId === toWorkshopId) continue;
      const target = await resolver.kindWarehouseOf(current.kind, toWorkshopId);
      if (!target || target.id === current.id) continue;
      const nextCode = target.id === it.material.warehouseId ? null : target.code;
      await tx.purchaseProposalItem.update({
        where: { id: it.id },
        data: { receiveWarehouseCode: nextCode },
      });
      rerouted.push({
        buyerId: it.material.buyerId,
        materialCode: it.material.code,
        toCode: target.code,
      });
    }

    const plans = await this.getPlans(tx, { productionInvoiceId });
    const piKey = productionInvoiceId.toString();
    return async () => {
      try {
        const lenhCode =
          (await loadLenhDisplayCodes(this.prisma, [productionInvoiceId])).get(piKey) ?? piKey;
        const toNames = await this.warehouseNames(rerouted.map((r) => r.toCode));
        const buyerIds = [
          ...new Set(rerouted.map((r) => r.buyerId).filter((b): b is string => !!b)),
        ];
        if (rerouted.length > 0) {
          await this.notifications.emit('PURCHASE_RECEIVE_WAREHOUSE_CHANGED', {
            entityId: piKey,
            actorId: actorUserId,
            params: {
              lenhCode,
              count: rerouted.length,
              summary: [
                ...new Set(
                  rerouted.map((r) => `${r.materialCode} → ${toNames.get(r.toCode) ?? r.toCode}`),
                ),
              ].join(', '),
              buyerIds,
            },
          });
        }
        // 1 thông báo / kho cũ (dedupeKey theo kho): trước 11/11 mỗi phần Sắt / Vật tư khác gửi 1 cái cùng dedupeKey nên cái
        // sau bị bỏ - thủ kho chỉ thấy số dòng của 1 phần, và lời nhắn luôn ghi "chờ Đã kiểm" kể cả phần lập được ngay.
        const byFrom = new Map<string, WorkshopMovePlan[]>();
        for (const p of plans)
          byFrom.set(p.fromWarehouseId, [...(byFrom.get(p.fromWarehouseId) ?? []), p]);
        for (const [fromWarehouseId, group] of byFrom) {
          const steel = group.find((p) => p.part === 'STEEL');
          const other = group.find((p) => p.part === 'OTHER');
          await this.notifications.emit('WORKSHOP_MOVE_NEEDED', {
            entityId: `${piKey}:${fromWarehouseId}`,
            actorId: actorUserId,
            dedupeKey: `WORKSHOP_MOVE_NEEDED:${piKey}:${fromWarehouseId}`,
            params: {
              lenhCode,
              fromWarehouseName: group[0].fromWarehouseName,
              toWarehouseName: group[0].toWarehouseName,
              count: group.reduce((n, p) => n + p.lines.length, 0),
              steelCount: steel?.lines.length ?? 0,
              otherCount: other?.lines.length ?? 0,
              steelWaiting: steel?.recheckPending ?? false,
              warehouseCodes: [group[0].fromWarehouseCode],
            },
          });
        }
      } catch (error) {
        this.logger.error(
          `Không gửi được thông báo đổi xưởng (lệnh ${piKey}): ${(error as Error).message}`,
        );
      }
    };
  }

  /**
   * Hàng đang giữ cho lệnh ở kho Phôi/Hàn không thuộc xưởng hiện tại của lệnh, gộp theo (lệnh, kho cũ). Lọc theo lệnh và/hoặc
   * kho cũ. Số lượng đã trừ phần nằm trên phiếu chuyển chờ nhận.
   */
  async getPlans(
    db: Db = this.prisma,
    filter: {
      productionInvoiceId?: bigint;
      fromWarehouseCode?: string | null;
      part?: WorkshopMovePart;
    } = {},
  ): Promise<WorkshopMovePlan[]> {
    const reservations = await db.stockReservation.findMany({
      where: {
        status: ReservationStatus.ACTIVE,
        productionInvoiceId: filter.productionInvoiceId ?? { not: null },
        warehouse: {
          kind: { in: BOUND_KINDS },
          ...(filter.fromWarehouseCode ? { code: filter.fromWarehouseCode } : {}),
        },
      },
      select: {
        productionInvoiceId: true,
        materialId: true,
        quantity: true,
        consumedQty: true,
        stockLengthMm: true,
        spec: true,
        warehouse: { select: { id: true, code: true, name: true, kind: true, workshopId: true } },
        material: {
          select: {
            code: true,
            name: true,
            unit: true,
            materialGroup: { select: { systemKey: true } },
          },
        },
      },
    });
    if (reservations.length === 0) return [];
    const resolver = new WorkshopWarehouseResolver(db);
    const piIds = [...new Set(reservations.map((r) => r.productionInvoiceId!))];
    const workshopOf = new Map<string, bigint | null>();
    for (const id of piIds) workshopOf.set(id.toString(), await resolver.workshopIdOfPi(id));

    const pending = await db.warehouseTransferItem.findMany({
      where: {
        transfer: { status: TransferStatus.PENDING, productionInvoiceId: { in: piIds } },
      },
      select: {
        materialId: true,
        quantity: true,
        stockLengthMm: true,
        spec: true,
        transfer: { select: { productionInvoiceId: true, fromWarehouseId: true } },
      },
    });
    const onPending = new Map<string, number>();
    for (const p of pending) {
      const k = `${p.transfer.productionInvoiceId}:${p.transfer.fromWarehouseId}:${p.materialId}:${p.stockLengthMm}:${p.spec}`;
      onPending.set(k, (onPending.get(k) ?? 0) + p.quantity.toNumber());
    }

    const plans = new Map<string, WorkshopMovePlan>();
    const lineMap = new Map<string, WorkshopMoveLine>();
    for (const r of reservations) {
      const piId = r.productionInvoiceId!;
      const ws = workshopOf.get(piId.toString()) ?? null;
      if (ws == null || r.warehouse.workshopId === ws) continue;
      const left = r.quantity.toNumber() - r.consumedQty.toNumber();
      if (left <= 0) continue;
      const part: WorkshopMovePart =
        r.material.materialGroup?.systemKey === MATERIAL_GROUP_SYSTEM_KEYS.STEEL_BAR
          ? 'STEEL'
          : 'OTHER';
      if (filter.part && filter.part !== part) continue;
      const planKey = `${piId}:${r.warehouse.id}:${part}`;
      let plan = plans.get(planKey);
      if (!plan) {
        const target = await resolver.kindWarehouseOf(r.warehouse.kind!, ws);
        if (!target) continue;
        const targetRow = await db.warehouse.findUnique({
          where: { id: target.id },
          select: { name: true },
        });
        plan = {
          productionInvoiceId: piId.toString(),
          part,
          lenhCode: piId.toString(),
          fromWarehouseId: r.warehouse.id.toString(),
          fromWarehouseCode: r.warehouse.code,
          fromWarehouseName: r.warehouse.name,
          toWarehouseId: target.id.toString(),
          toWarehouseCode: target.code,
          toWarehouseName: targetRow?.name ?? target.code,
          recheckPending: part === 'STEEL' && (await isCuttingRecheckPending(db, piId)),
          lines: [],
        };
        plans.set(planKey, plan);
      }
      const lineKey = `${piId}:${r.warehouse.id}:${r.materialId}:${r.stockLengthMm}:${r.spec}`;
      const line = lineMap.get(lineKey);
      if (line) line.qty = round4(line.qty + left);
      else {
        const l: WorkshopMoveLine = {
          materialId: r.materialId.toString(),
          materialCode: r.material.code,
          materialName: r.material.name,
          // Sắt theo cây (có chiều dài cây) đếm bằng cây, không theo đơn vị gốc của vật tư (vd 'Mm') - cùng cách phiếu xuất sắt.
          unit: r.stockLengthMm > 0 ? 'cây' : r.material.unit,
          stockLengthMm: r.stockLengthMm,
          spec: r.spec,
          qty: round4(left),
        };
        lineMap.set(lineKey, l);
        plan.lines.push(l);
      }
    }
    for (const [key, l] of lineMap) {
      l.qty = round4(l.qty - (onPending.get(key) ?? 0));
    }
    const result = [...plans.values()]
      .map((p) => ({ ...p, lines: p.lines.filter((l) => l.qty > 0) }))
      .filter((p) => p.lines.length > 0);
    const codes = await loadLenhDisplayCodes(
      db,
      result.map((p) => BigInt(p.productionInvoiceId)),
    );
    for (const p of result) p.lenhCode = codes.get(p.productionInvoiceId) ?? p.lenhCode;
    return result;
  }

  /**
   * Kho mới nhận phiếu chuyển hàng của lệnh: giữ chỗ của lệnh ở kho cũ chuyển sang kho mới theo đúng số thực nhận từng dòng
   * (vật tư + chiều dài + quy cách). Gọi trong transaction xác nhận phiếu, sau khi đã ghi sổ kho.
   */
  async moveReservationsInTx(
    tx: PrismaTx,
    t: { productionInvoiceId: bigint; fromWarehouseId: bigint; toWarehouseId: bigint },
    lines: { materialId: bigint; stockLengthMm: number; spec: string; qty: number }[],
  ): Promise<void> {
    for (const line of lines) {
      let left = line.qty;
      if (left <= 0) continue;
      const rows = await tx.stockReservation.findMany({
        where: {
          productionInvoiceId: t.productionInvoiceId,
          warehouseId: t.fromWarehouseId,
          materialId: line.materialId,
          stockLengthMm: line.stockLengthMm,
          spec: line.spec,
          status: ReservationStatus.ACTIVE,
        },
        orderBy: { id: 'asc' },
      });
      for (const r of rows) {
        if (left <= 0) break;
        const free = r.quantity.toNumber() - r.consumedQty.toNumber();
        if (free <= 0) continue;
        const take = Math.min(free, left);
        if (take >= free && r.consumedQty.toNumber() === 0) {
          await tx.stockReservation.update({
            where: { id: r.id },
            data: { warehouseId: t.toWarehouseId },
          });
        } else {
          await tx.stockReservation.update({
            where: { id: r.id },
            data: { quantity: round4(r.quantity.toNumber() - take) },
          });
          await tx.stockReservation.create({
            data: {
              warehouseId: t.toWarehouseId,
              materialId: r.materialId,
              quantity: take,
              refType: r.refType,
              refId: r.refId,
              productionInvoiceId: r.productionInvoiceId,
              note: r.note,
              createdById: r.createdById,
              stockLengthMm: r.stockLengthMm,
              spec: r.spec,
            },
          });
        }
        left = round4(left - take);
      }
    }
  }

  private async warehouseNames(codes: string[]): Promise<Map<string, string>> {
    const uniq = [...new Set(codes)];
    if (uniq.length === 0) return new Map();
    const rows = await this.prisma.warehouse.findMany({
      where: { code: { in: uniq } },
      select: { code: true, name: true },
    });
    return new Map(rows.map((r) => [r.code, r.name]));
  }
}
