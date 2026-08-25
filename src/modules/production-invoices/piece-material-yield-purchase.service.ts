import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  PurchaseProposalSource,
  PurchaseProposalStatus,
} from '../../generated/prisma/client';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { recomputeProposalStatus } from '../purchase-proposals/purchase-proposal-status.util';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { PieceMaterialYieldPurchaseResultDto } from './dto/piece-material-yield-purchase-result.dto';

/**
 * Tính nhu cầu mua nguyên liệu cho "vật tư thành phẩm" (piece có PieceMaterialYield - vd chân
 * nhôm needsHan=false, hoặc "pat" needsHan=true cắt từ tấm sắt lá) theo PieceMaterialYield, cho
 * 1 PI - KHÔNG qua CuttingProposal/SegmentSpec (pipeline đó khoá cứng materialGroup=STEEL_BAR và
 * giải bin-packing đa đoạn, sai tầm với tỷ lệ cố định 1 đơn vị→N cái, xem doc comment model
 * PieceMaterialYield). KHÔNG lọc theo needsHan (gỡ bỏ 2026-08-22) - piece nào có
 * PieceMaterialYield đều được tính, bất kể có cần Hàn sau đó hay không. "Kiểm tồn trước" đọc pool
 * ảo dùng CHUNG mọi PI (ProductionBatchesService.getReadyPoolQty - quyết định nghiệp vụ
 * 2026-08-22), không ghi StockLedger thật cho piece nào cả - chỉ ảnh hưởng tới SỐ LƯỢNG NGUYÊN
 * LIỆU đề xuất mua.
 */
@Injectable()
export class PieceMaterialYieldPurchaseService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly productionBatchesService: ProductionBatchesService,
  ) {}

  async computeAndUpsertProposals(
    productionInvoiceId: string,
  ): Promise<PieceMaterialYieldPurchaseResultDto[]> {
    const piBigId = parseBigIntId(productionInvoiceId);
    const pi = await this.prisma.productionInvoice.findUnique({ where: { id: piBigId } });
    if (!pi) {
      throw new NotFoundException(`Production invoice ${productionInvoiceId} not found`);
    }

    // Mọi ProductionOrder (1 SKU/PO đã duyệt) thuộc PI này - 1 PI có thể có nhiều SKU/nhiều PO
    // (xem memory project_pi_multi_sku_multi_po), KHÔNG có sẵn hàm gộp nhu cầu piece nào ở tầng
    // PI trước tính năng này (chỉ có getPieceTransferPlan/listTransferCheckPieces, cả 2 đều theo
    // từng productionOrderId riêng lẻ).
    const orders = await this.prisma.productionOrder.findMany({
      where: { productionInvoiceItem: { productionInvoiceId: piBigId } },
    });
    if (orders.length === 0) {
      return [];
    }
    const bomRevisionIds = [...new Set(orders.map((o) => o.bomRevisionId))];

    const [bomPieces, yields] = await Promise.all([
      // Không lọc needsHan - piece nào không có PieceMaterialYield sẽ tự bị bỏ qua bên dưới
      // (`if (!yieldRow) continue`), không cần lọc trước ở đây.
      this.prisma.bomPiece.findMany({
        where: { bomRevisionId: { in: bomRevisionIds } },
      }),
      this.prisma.pieceMaterialYield.findMany({
        where: { bomRevisionId: { in: bomRevisionIds } },
        include: { material: { include: { warehouse: true } } },
      }),
    ]);
    const yieldByRevisionPiece = new Map(yields.map((y) => [`${y.bomRevisionId}:${y.pieceId}`, y]));

    // Gộp required theo pieceId across mọi order/SKU của PI (mỗi order tự tra bomPiece của đúng
    // bomRevisionId nó ghim).
    const requiredByPiece = new Map<string, number>();
    for (const order of orders) {
      for (const bp of bomPieces) {
        if (bp.bomRevisionId !== order.bomRevisionId) continue;
        const key = bp.pieceId.toString();
        requiredByPiece.set(key, (requiredByPiece.get(key) ?? 0) + bp.qtyPerUnit * order.quantity);
      }
    }
    if (requiredByPiece.size === 0) {
      return [];
    }

    const pieceIds = [...requiredByPiece.keys()].map((k) => BigInt(k));
    const onHandPool = await this.productionBatchesService.getReadyPoolQty(pieceIds);

    // 1 piece chỉ tra được yield qua ĐÚNG revision nó thuộc - lấy dòng bomPiece tương ứng để biết
    // revisionId của từng piece (an toàn kể cả khi 2 order dùng revision khác nhau cho cùng piece).
    const revisionByPiece = new Map<string, bigint>();
    for (const bp of bomPieces) {
      revisionByPiece.set(bp.pieceId.toString(), bp.bomRevisionId);
    }

    const results: PieceMaterialYieldPurchaseResultDto[] = [];
    // Gộp theo materialId - nhiều piece có thể dùng chung 1 material (dù hiện luôn 1-1
    // piece↔material, khác material có thể phục vụ nhiều piece khác nhau).
    const barsNeededByMaterial = new Map<
      string,
      { bars: number; requiredPieces: number; onHandPieces: number; piecesPerBar: number }
    >();
    for (const [pieceKey, required] of requiredByPiece) {
      const revisionId = revisionByPiece.get(pieceKey);
      if (!revisionId) continue;
      const yieldRow = yieldByRevisionPiece.get(`${revisionId}:${pieceKey}`);
      if (!yieldRow) continue; // Piece chưa khai định mức nguyên liệu - bỏ qua, không chặn PI.

      const onHand = onHandPool.get(pieceKey) ?? 0;
      const net = Math.max(0, required - onHand);
      const bars = Math.ceil(net / yieldRow.piecesPerBar);

      const materialKey = yieldRow.materialId.toString();
      const acc = barsNeededByMaterial.get(materialKey) ?? {
        bars: 0,
        requiredPieces: 0,
        onHandPieces: 0,
        piecesPerBar: yieldRow.piecesPerBar,
      };
      acc.bars += bars;
      acc.requiredPieces += required;
      acc.onHandPieces += onHand;
      barsNeededByMaterial.set(materialKey, acc);
    }

    if (barsNeededByMaterial.size === 0) {
      return results;
    }

    // materialId đã khai Kho cho từng dòng - kiểm trước khi mở transaction (bất biến, không cần
    // nằm trong khoá), cùng idiom ConsumableMaterialPurchaseService.
    const warehouseByMaterial = new Map<string, { warehouseId: bigint; warehouseCode: string }>();
    for (const materialIdStr of barsNeededByMaterial.keys()) {
      const materialId = BigInt(materialIdStr);
      const yieldRow = yields.find((y) => y.materialId === materialId);
      if (!yieldRow?.material.warehouse) {
        throw new BadRequestException(
          `Vật tư ${yieldRow?.material.code ?? materialIdStr} chưa được cấu hình Kho - vào Admin > Vật tư để gán Kho trước khi tính đề xuất mua`,
        );
      }
      warehouseByMaterial.set(materialIdStr, {
        warehouseId: yieldRow.material.warehouse.id,
        warehouseCode: yieldRow.material.warehouse.code,
      });
    }

    // MỘT transaction cho CẢ PI (2026-08-25, thay vì mỗi vật tư 1 transaction/1 proposal riêng
    // như trước) - lý do kép: (1) tránh 1 PI có N vật tư "vật tư thành phẩm" thì tự vỡ thành N
    // PurchaseProposal (mỗi cái chỉ 1 dòng, tìm theo `items.some({materialId})` cũ không bao giờ
    // gộp lại được với nhau); (2) gộp chung được với đề xuất do CuttingProposalsService/
    // ConsumableMaterialPurchaseService tạo cho cùng PI - xem khoá "purchase-proposal-merge:<piId>"
    // dùng CHUNG ở cả 3 nơi. Khoá theo THỨ TỰ materialId tăng dần khi lock stock_quant, cùng lý do
    // tránh deadlock đã áp dụng ở 2 service kia.
    const orderedMaterialIds = [...barsNeededByMaterial.keys()].sort();

    const computed: {
      materialId: bigint;
      materialIdStr: string;
      actualStock: number;
      buyQty: number;
    }[] = [];

    let proposal!: { id: bigint; status: PurchaseProposalStatus };

    await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `purchase-proposal-merge:${piBigId}`);

      for (const materialIdStr of orderedMaterialIds) {
        const materialId = BigInt(materialIdStr);
        const acc = barsNeededByMaterial.get(materialIdStr)!;
        const { warehouseId } = warehouseByMaterial.get(materialIdStr)!;
        const locked = await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
          SELECT "qty" FROM "stock_quant"
          WHERE "warehouseId" = ${warehouseId} AND "materialId" = ${materialId}
          FOR UPDATE
        `;
        const actualStock = Math.floor(locked[0]?.qty.toNumber() ?? 0);
        const buyQty = Math.max(0, acc.bars - actualStock);
        computed.push({ materialId, materialIdStr, actualStock, buyQty });
      }

      // Tìm đề xuất "còn mở" (khác PURCHASED) - không còn lọc NEW (2026-08-25, cùng lý do đã sửa ở
      // CuttingProposalsService.approve()/ConsumableMaterialPurchaseService).
      let found = await tx.purchaseProposal.findFirst({
        where: { productionInvoiceId: piBigId, status: { not: PurchaseProposalStatus.PURCHASED } },
        include: { items: true },
      });

      if (!found) {
        const firstMaterialIdStr = computed[0].materialIdStr;
        found = await tx.purchaseProposal.create({
          data: {
            sourceType: PurchaseProposalSource.PIECE_MATERIAL_YIELD,
            productionInvoiceId: piBigId,
            warehouseCode: warehouseByMaterial.get(firstMaterialIdStr)!.warehouseCode,
            items: {
              create: computed.map((c) => ({
                materialId: c.materialId,
                buyQty: c.buyQty,
                actualStock: c.actualStock,
                status: c.buyQty === 0 ? PurchaseProposalStatus.PURCHASED : undefined,
                purchasedAt: c.buyQty === 0 ? new Date() : undefined,
              })),
            },
          },
          include: { items: true },
        });
      } else {
        const itemByMaterial = new Map(found.items.map((it) => [it.materialId.toString(), it]));
        for (const c of computed) {
          const existingItem = itemByMaterial.get(c.materialIdStr);
          if (existingItem) {
            // Chỉ ghi đè status khi dòng đó còn NEW - cùng idiom CuttingProposalsService.approve().
            const nextStatus =
              existingItem.status === PurchaseProposalStatus.NEW && c.buyQty === 0
                ? PurchaseProposalStatus.PURCHASED
                : undefined;
            await tx.purchaseProposalItem.update({
              where: { id: existingItem.id },
              data: {
                buyQty: c.buyQty,
                actualStock: c.actualStock,
                ...(nextStatus ? { status: nextStatus, purchasedAt: new Date() } : {}),
              },
            });
          } else {
            await tx.purchaseProposalItem.create({
              data: {
                proposalId: found.id,
                materialId: c.materialId,
                buyQty: c.buyQty,
                actualStock: c.actualStock,
                status: c.buyQty === 0 ? PurchaseProposalStatus.PURCHASED : undefined,
                purchasedAt: c.buyQty === 0 ? new Date() : undefined,
              },
            });
          }
        }
      }

      await recomputeProposalStatus(tx, found.id);
      found = await tx.purchaseProposal.findUniqueOrThrow({
        where: { id: found.id },
        include: { items: true },
      });
      proposal = found;
    });

    for (const c of computed) {
      const acc = barsNeededByMaterial.get(c.materialIdStr)!;
      const yieldRow = yields.find((y) => y.materialId === c.materialId)!;
      results.push(
        new PieceMaterialYieldPurchaseResultDto({
          materialId: c.materialIdStr,
          materialCode: yieldRow.material.code,
          requiredPieces: acc.requiredPieces,
          onHandPieces: acc.onHandPieces,
          piecesPerBar: acc.piecesPerBar,
          barsNeeded: acc.bars,
          actualStock: c.actualStock,
          buyQty: c.buyQty,
          purchaseProposalId: proposal.id.toString(),
          purchaseProposalStatus: proposal.status,
        }),
      );
    }

    return results;
  }
}
