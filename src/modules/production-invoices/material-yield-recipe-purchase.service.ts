import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  PurchaseProposalSource,
  PurchaseProposalStatus,
  StockReservationRefType,
} from '../../generated/prisma/client';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { recomputeProposalStatus } from '../purchase-proposals/purchase-proposal-status.util';
import { notifyPurchaseProposalCreated } from '../purchase-proposals/purchase-proposal-notify.util';
import { NotificationsService } from '../notifications/notifications.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { MaterialYieldRecipesService } from '../material-yield-recipes/material-yield-recipes.service';
import { MaterialYieldRecipePurchaseResultDto } from './dto/material-yield-recipe-purchase-result.dto';

/**
 * Tính nhu cầu mua nguyên liệu ĐẦU VÀO (vd thanh nhôm) cho "vật tư thành phẩm KHÔNG gắn piece" (vd
 * chân nhôm, model MaterialYieldRecipe) cho 1 PI - phần "Mua hàng" còn thiếu của tính năng 2026-10-01
 * (field `MaterialYieldRecipe.inputMaterialId` đã được UI gắn nhãn "nguyên liệu mua" ngay từ đầu,
 * xem MaterialYieldRecipesPage.tsx, nhưng chưa từng được nối vào PurchaseProposal - Mua hàng không
 * có cách nào biết cần mua thêm). Mirror PieceMaterialYieldPurchaseService (dành cho piece CÓ
 * PieceMaterialYield như "pat") gần như 1-1, chỉ khác nguồn tính nhu cầu: đọc thẳng
 * MaterialYieldRecipesService.getProductionDemand() (đã gộp sẵn theo PieceMaterialItem.
 * includeInWeaving qua MỌI mảnh cần đan dùng outputMaterial này trong PI, KHÔNG qua BomPiece/pieceId
 * trực tiếp như PieceMaterialYield cũ) thay vì tự tính lại từ đầu.
 */
@Injectable()
export class MaterialYieldRecipePurchaseService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly materialYieldRecipesService: MaterialYieldRecipesService,
    private readonly stockReservationsService: StockReservationsService,
    private readonly notifications: NotificationsService,
  ) {}

  async computeAndUpsertProposals(
    productionInvoiceId: string,
  ): Promise<MaterialYieldRecipePurchaseResultDto[]> {
    const piBigId = parseBigIntId(productionInvoiceId);
    const pi = await this.prisma.productionInvoice.findUnique({ where: { id: piBigId } });
    if (!pi) {
      throw new NotFoundException(`Production invoice ${productionInvoiceId} not found`);
    }

    const demand = await this.materialYieldRecipesService.getProductionDemand(productionInvoiceId);
    const needed = demand.filter((d) => d.requiredInputQty > 0);
    if (needed.length === 0) {
      return [];
    }

    // Gộp theo inputMaterialId - 2 recipe khác nhau (2 outputMaterial khác nhau) vẫn có thể dùng
    // chung 1 nguyên liệu đầu vào (vd 2 loại vật tư thành phẩm cùng cắt từ 1 loại thanh nhôm).
    const neededByMaterial = new Map<
      string,
      { requiredInputQty: number; recipeIds: string[]; outputMaterialCode: string }
    >();
    for (const d of needed) {
      const acc = neededByMaterial.get(d.inputMaterialId) ?? {
        requiredInputQty: 0,
        recipeIds: [],
        outputMaterialCode: d.outputMaterialCode,
      };
      acc.requiredInputQty += d.requiredInputQty;
      acc.recipeIds.push(d.recipeId);
      neededByMaterial.set(d.inputMaterialId, acc);
    }

    const inputMaterialIds = [...neededByMaterial.keys()].map((id) => BigInt(id));
    const materials = await this.prisma.material.findMany({
      where: { id: { in: inputMaterialIds } },
      include: { warehouse: true },
    });
    const materialById = new Map(materials.map((m) => [m.id.toString(), m]));

    // piecesPerBar chỉ để hiển thị (đã tính SẴN vào requiredInputQty qua getProductionDemand) - đọc
    // thẳng từ recipe gốc thay vì back-tính lại từ required/shortfall (sai đơn vị khi nhiều recipe
    // gộp chung 1 material).
    const recipeIds = needed.map((d) => BigInt(d.recipeId));
    const recipes = await this.prisma.materialYieldRecipe.findMany({
      where: { id: { in: recipeIds } },
    });
    const piecesPerBarByRecipe = new Map(recipes.map((r) => [r.id.toString(), r.piecesPerBar]));

    // materialId đã khai Kho cho từng dòng - kiểm trước khi mở transaction (bất biến, không cần
    // nằm trong khoá), cùng idiom PieceMaterialYieldPurchaseService/ConsumableMaterialPurchaseService.
    const warehouseByMaterial = new Map<string, { warehouseId: bigint; warehouseCode: string }>();
    for (const materialIdStr of neededByMaterial.keys()) {
      const material = materialById.get(materialIdStr);
      if (!material?.warehouse) {
        throw new BadRequestException(
          `Vật tư ${material?.code ?? materialIdStr} chưa được cấu hình Kho - vào Admin > Vật tư để gán Kho trước khi tính đề xuất mua`,
        );
      }
      warehouseByMaterial.set(materialIdStr, {
        warehouseId: material.warehouse.id,
        warehouseCode: material.warehouse.code,
      });
    }

    // MỘT transaction cho CẢ PI, cùng khoá merge "purchase-proposal-merge:<piId>" DÙNG CHUNG với
    // CuttingProposalsService/ConsumableMaterialPurchaseService/PieceMaterialYieldPurchaseService -
    // để 1 PI có nhiều nguồn đề xuất mua (sắt/vật tư tiêu hao/pat/vật tư thành phẩm) đều gộp lại
    // thành đúng 1 PurchaseProposal, không vỡ thành nhiều bản rời rạc.
    const orderedMaterialIds = [...neededByMaterial.keys()].sort();

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
        const acc = neededByMaterial.get(materialIdStr)!;
        const { warehouseId } = warehouseByMaterial.get(materialIdStr)!;
        // Co giữ chỗ của CHÍNH lượt tính TRƯỚC ĐÓ về đúng phần đã tiêu TRƯỚC khi tính available -
        // cùng lý do/cùng fix PieceMaterialYieldPurchaseService.
        await this.stockReservationsService.shrinkToFloor(tx, {
          refType: StockReservationRefType.MATERIAL_YIELD_RECIPE_PURCHASE,
          refId: piBigId.toString(),
          materialId,
        });
        const locked = await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
          SELECT "qty" FROM "stock_quant"
          WHERE "warehouseId" = ${warehouseId} AND "materialId" = ${materialId}
          FOR UPDATE
        `;
        const actualStock = Math.floor(locked.reduce((sum, r) => sum + r.qty.toNumber(), 0));
        const available = await this.stockReservationsService.getAvailableQty(
          tx,
          warehouseId,
          materialId,
          actualStock,
        );
        const consumeQty = Math.min(acc.requiredInputQty, available);
        // 2026-10-08: đệm % hao hụt khi mua (Material.purchaseWastePercentage), CHỈ cộng vào phần
        // THỰC SỰ phải mua, cùng lý do/cùng fix ConsumableMaterialPurchaseService. Đơn vị ở đây
        // MẶC ĐỊNH là cây/tấm NGUYÊN (Int) nên ceil lại sau khi nhân - không mua lẻ cây/tấm.
        const materialForWaste = materialById.get(materialIdStr)!;
        const wastePct = materialForWaste.purchaseWastePercentage?.toNumber() ?? 0;
        const buyQtyRaw = (acc.requiredInputQty - consumeQty) * (1 + wastePct / 100);
        // 2026-10-10: ngoại lệ cho vật tư mua theo tấm LẺ (vd Tấm sắt la, xem docs/
        // LICH_SU_TRAO_DOI_CLAUDE_den_10-10-2026.md 08/10 05:11) - Admin ép giữ thập phân qua
        // Material.purchaseRoundUp=false. Tri-state: null/true đều ceil (mặc định gốc của luồng
        // này), chỉ false mới giữ thập phân - ngược chiều với ConsumableMaterialPurchaseService.
        const buyQty =
          materialForWaste.purchaseRoundUp === false ? buyQtyRaw : Math.ceil(buyQtyRaw);
        computed.push({ materialId, materialIdStr, actualStock, buyQty });
        await this.stockReservationsService.reserveOrAdjust(tx, {
          warehouseId,
          materialId,
          qty: consumeQty,
          refType: StockReservationRefType.MATERIAL_YIELD_RECIPE_PURCHASE,
          refId: piBigId.toString(),
          productionInvoiceId: piBigId,
        });
      }

      // Tìm đề xuất "còn mở" (khác PURCHASED) - cùng idiom 3 service kia.
      let found = await tx.purchaseProposal.findFirst({
        where: { productionInvoiceId: piBigId, status: { not: PurchaseProposalStatus.PURCHASED } },
        include: { items: true },
      });

      if (!found) {
        const firstMaterialIdStr = computed[0].materialIdStr;
        found = await tx.purchaseProposal.create({
          data: {
            sourceType: PurchaseProposalSource.MATERIAL_YIELD_RECIPE,
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
        // Ưu tiên dòng CHƯA đóng hồ sơ nếu 1 material lỡ có 2 dòng - cùng idiom 3 service kia.
        const itemByMaterial = new Map<string, (typeof found.items)[number]>();
        for (const it of found.items) {
          const key = it.materialId.toString();
          const current = itemByMaterial.get(key);
          if (
            !current ||
            (current.status === PurchaseProposalStatus.PURCHASED &&
              it.status !== PurchaseProposalStatus.PURCHASED)
          ) {
            itemByMaterial.set(key, it);
          }
        }
        for (const c of computed) {
          const existingItem = itemByMaterial.get(c.materialIdStr);
          if (existingItem?.status === PurchaseProposalStatus.PURCHASED) {
            const shortfall = c.buyQty - existingItem.receivedQty.toNumber();
            if (shortfall > 0) {
              await tx.purchaseProposalItem.create({
                data: {
                  proposalId: found.id,
                  materialId: c.materialId,
                  buyQty: shortfall,
                  actualStock: c.actualStock,
                },
              });
            }
          } else if (existingItem) {
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

    const results: MaterialYieldRecipePurchaseResultDto[] = [];
    for (const c of computed) {
      const acc = neededByMaterial.get(c.materialIdStr)!;
      const material = materialById.get(c.materialIdStr)!;
      results.push(
        new MaterialYieldRecipePurchaseResultDto({
          recipeId: acc.recipeIds[0],
          outputMaterialCode: acc.outputMaterialCode,
          materialId: c.materialIdStr,
          materialCode: material.code,
          piecesPerBar: piecesPerBarByRecipe.get(acc.recipeIds[0]) ?? 0,
          requiredInputQty: acc.requiredInputQty,
          actualStock: c.actualStock,
          buyQty: c.buyQty,
          purchaseProposalId: proposal.id.toString(),
          purchaseProposalStatus: proposal.status,
        }),
      );
    }

    if (proposal) {
      await notifyPurchaseProposalCreated(this.prisma, this.notifications, proposal.id);
    }

    return results;
  }
}
