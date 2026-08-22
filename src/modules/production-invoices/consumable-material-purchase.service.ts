import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  MfgStage,
  Prisma,
  PurchaseProposalSource,
  PurchaseProposalStatus,
} from '../../generated/prisma/client';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { ConsumableMaterialPurchaseResultDto } from './dto/consumable-material-purchase-result.dto';

/**
 * Tính nhu cầu mua "vật tư tiêu hao phẳng" cho 1 PI - gộp cả 3 nguồn định mức không có khái
 * niệm cắt: PieceMaterialItem (Dây/Đinh/Tán rút/Nút nhựa, theo TỪNG PIECE), ConsumableBom (Sơn,
 * phẳng theo cả lệnh, stage HAN/SON), BomAccessoryItem (Phụ kiện/Bao bì, phẳng theo cả lệnh).
 * TỰ ĐỘNG hoàn toàn - quyết định nghiệp vụ 2026-08-22: bỏ qua "Lệnh kiểm tra vật tư" thủ công
 * (MaterialInspectionRequest/InspectionKhoResult - có sẵn trong schema nhưng CHƯA TỪNG được cài
 * đặt ở tầng service/controller, xác nhận qua grep toàn repo) vì trước giờ không có gì tự tạo
 * PurchaseProposal cho 3 nguồn này cả - người mua hàng được gán (Material.buyerId) không bao
 * giờ thấy đề xuất nào dù SKU đã duyệt.
 *
 * Khác PieceMaterialYieldPurchaseService (đơn vị nguyên - số cây, làm tròn lên): buyQty ở đây là
 * Decimal (kg sơn, mét dây...) - KHÔNG làm tròn, giữ nguyên phân số.
 */
@Injectable()
export class ConsumableMaterialPurchaseService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async computeAndUpsertProposals(
    productionInvoiceId: string,
  ): Promise<ConsumableMaterialPurchaseResultDto[]> {
    const piBigId = parseBigIntId(productionInvoiceId);
    const pi = await this.prisma.productionInvoice.findUnique({ where: { id: piBigId } });
    if (!pi) {
      throw new NotFoundException(`Production invoice ${productionInvoiceId} not found`);
    }

    const orders = await this.prisma.productionOrder.findMany({
      where: { productionInvoiceItem: { productionInvoiceId: piBigId } },
    });
    if (orders.length === 0) {
      return [];
    }
    const bomRevisionIds = [...new Set(orders.map((o) => o.bomRevisionId))];

    const [bomPieces, pieceMaterialItems, consumableBoms, accessoryItems] = await Promise.all([
      this.prisma.bomPiece.findMany({ where: { bomRevisionId: { in: bomRevisionIds } } }),
      this.prisma.pieceMaterialItem.findMany({ where: { bomRevisionId: { in: bomRevisionIds } } }),
      this.prisma.consumableBom.findMany({
        where: {
          bomRevisionId: { in: bomRevisionIds },
          stage: { in: [MfgStage.HAN, MfgStage.SON] },
        },
      }),
      this.prisma.bomAccessoryItem.findMany({ where: { bomRevisionId: { in: bomRevisionIds } } }),
    ]);
    const pieceQtyByRevPiece = new Map<string, number>(
      bomPieces.map((bp) => [`${bp.bomRevisionId}:${bp.pieceId}`, bp.qtyPerUnit]),
    );

    const requiredByMaterial = new Map<string, number>();
    const addRequired = (materialId: bigint, qty: number) => {
      const key = materialId.toString();
      requiredByMaterial.set(key, (requiredByMaterial.get(key) ?? 0) + qty);
    };

    for (const order of orders) {
      // Dây/Đinh/Tán rút/Nút nhựa - PHẢI nhân thêm BomPiece.qtyPerUnit (SL mảnh/SKU) vì định mức
      // này gắn theo TỪNG PIECE, khác ConsumableBom/BomAccessoryItem phẳng theo cả lệnh.
      for (const pmi of pieceMaterialItems) {
        if (pmi.bomRevisionId !== order.bomRevisionId) continue;
        const pieceQty = pieceQtyByRevPiece.get(`${order.bomRevisionId}:${pmi.pieceId}`);
        if (!pieceQty) continue; // piece không thuộc BOM của order này - bỏ qua, không throw
        addRequired(pmi.materialId, pieceQty * order.quantity * pmi.qtyPerPiece.toNumber());
      }
      // Sơn (ConsumableBom, HAN/SON) - phẳng, không qua piece.
      for (const cb of consumableBoms) {
        if (cb.bomRevisionId !== order.bomRevisionId) continue;
        addRequired(cb.materialId, cb.qtyPerUnit.toNumber() * order.quantity);
      }
      // Phụ kiện/Bao bì (BomAccessoryItem) - phẳng, không qua piece.
      for (const item of accessoryItems) {
        if (item.bomRevisionId !== order.bomRevisionId) continue;
        addRequired(item.materialId, item.qtyPerUnit.toNumber() * order.quantity);
      }
    }
    if (requiredByMaterial.size === 0) {
      return [];
    }

    const materialIds = [...requiredByMaterial.keys()].map((id) => BigInt(id));
    const materialRows = await this.prisma.material.findMany({
      where: { id: { in: materialIds } },
      include: { warehouse: true },
    });
    const materialById = new Map(materialRows.map((m) => [m.id.toString(), m]));

    const results: ConsumableMaterialPurchaseResultDto[] = [];
    for (const [materialIdStr, required] of requiredByMaterial) {
      const materialId = BigInt(materialIdStr);
      const material = materialById.get(materialIdStr);
      if (!material?.warehouse) {
        throw new BadRequestException(
          `Vật tư ${material?.code ?? materialIdStr} chưa được cấu hình Kho - vào Admin > Vật tư để gán Kho trước khi tính đề xuất mua`,
        );
      }
      const warehouseId = material.warehouse.id;
      const warehouseCode = material.warehouse.code;

      const { proposal, actualStock, buyQty } = await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
          SELECT "qty" FROM "stock_quant"
          WHERE "warehouseId" = ${warehouseId} AND "materialId" = ${materialId}
          FOR UPDATE
        `;
        const actualStock = locked[0]?.qty.toNumber() ?? 0;
        const buyQty = Math.max(0, required - actualStock);

        const coveredData =
          buyQty === 0 ? { status: PurchaseProposalStatus.PURCHASED, purchasedAt: new Date() } : {};

        const existing = await tx.purchaseProposal.findFirst({
          where: {
            productionInvoiceId: piBigId,
            sourceType: PurchaseProposalSource.CONSUMABLE_AUTO_CALC,
            status: PurchaseProposalStatus.NEW,
            items: { some: { materialId } },
          },
          include: { items: true },
        });

        if (existing) {
          const item = existing.items.find((it) => it.materialId === materialId)!;
          await tx.purchaseProposalItem.update({
            where: { id: item.id },
            data: { buyQty, actualStock },
          });
          const updatedProposal =
            buyQty === 0
              ? await tx.purchaseProposal.update({ where: { id: existing.id }, data: coveredData })
              : existing;
          return { proposal: updatedProposal, actualStock, buyQty };
        }

        const created = await tx.purchaseProposal.create({
          data: {
            sourceType: PurchaseProposalSource.CONSUMABLE_AUTO_CALC,
            productionInvoiceId: piBigId,
            warehouseCode,
            items: { create: [{ materialId, buyQty, actualStock }] },
            ...coveredData,
          },
        });
        return { proposal: created, actualStock, buyQty };
      });

      results.push(
        new ConsumableMaterialPurchaseResultDto({
          materialId: materialIdStr,
          materialCode: material.code,
          required,
          actualStock,
          buyQty,
          purchaseProposalId: proposal.id.toString(),
          purchaseProposalStatus: proposal.status,
        }),
      );
    }

    return results;
  }
}
