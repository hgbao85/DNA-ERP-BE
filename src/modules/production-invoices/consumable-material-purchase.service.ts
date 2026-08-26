import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  MfgStage,
  Prisma,
  PurchaseProposalSource,
  PurchaseProposalStatus,
} from '../../generated/prisma/client';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { recomputeProposalStatus } from '../purchase-proposals/purchase-proposal-status.util';
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
    for (const materialIdStr of requiredByMaterial.keys()) {
      const material = materialById.get(materialIdStr);
      if (!material?.warehouse) {
        throw new BadRequestException(
          `Vật tư ${material?.code ?? materialIdStr} chưa được cấu hình Kho - vào Admin > Vật tư để gán Kho trước khi tính đề xuất mua`,
        );
      }
    }

    // Gộp CẢ PI vào 1 PurchaseProposal duy nhất, bất kể vật tư thuộc kho nào - quyết định nghiệp
    // vụ 2026-08-24 ("Khác kho vẫn gộp chung luôn, Thống nhất là theo 1 PI"): trước đây mỗi vật tư
    // tự có 1 proposal riêng (find-or-create per-material), Boss duyệt xong 1 PI ra hàng chục dòng
    // rời rạc ở "Lệnh mua". warehouseCode cấp proposal giờ CHỈ mang tính hiển thị (lấy theo vật tư
    // đầu tiên, xem comment PurchaseProposalsService dòng ~424) - nguồn xác thực thật để nhập hàng
    // vẫn là PurchaseProposalItem.materialId -> Material.warehouseId, nên gộp khác kho là an toàn.
    //
    // Khoá stock_quant theo THỨ TỰ materialId tăng dần (không theo thứ tự Map) - 2 PI chạm cùng
    // vật tư theo thứ tự ngược nhau sẽ khoá chéo và deadlock, cùng idiom CuttingProposalsService.
    const orderedMaterialIds = [...materialIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    const results = await this.prisma.$transaction(async (tx) => {
      const computed: {
        materialId: bigint;
        materialIdStr: string;
        required: number;
        actualStock: number;
        buyQty: number;
        warehouseCode: string;
      }[] = [];
      for (const materialId of orderedMaterialIds) {
        const materialIdStr = materialId.toString();
        const material = materialById.get(materialIdStr)!;
        const required = requiredByMaterial.get(materialIdStr)!;
        const locked = await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
          SELECT "qty" FROM "stock_quant"
          WHERE "warehouseId" = ${material.warehouse!.id} AND "materialId" = ${materialId}
          FOR UPDATE
        `;
        const actualStock = locked[0]?.qty.toNumber() ?? 0;
        const buyQty = Math.max(0, required - actualStock);
        computed.push({
          materialId,
          materialIdStr,
          required,
          actualStock,
          buyQty,
          warehouseCode: material.warehouse!.code,
        });
      }

      // Khoá theo PI (KHÔNG theo sourceType) - từ 2026-08-25, cả 3 nguồn (sắt/PieceMaterialYield/
      // tiêu hao) tìm-hoặc-tạo vào ĐÚNG 1 PurchaseProposal chung cho cả PI thay vì mỗi nguồn 1
      // dòng riêng (xem CuttingProposalsService.approve(), PieceMaterialYieldPurchaseService -
      // dùng CHUNG khoá "purchase-proposal-merge:<piId>" để 3 nguồn không cùng miss-tìm rồi cùng
      // tạo trùng). Vì thế findFirst bên dưới KHÔNG còn lọc theo sourceType nữa - proposal.
      // sourceType giờ chỉ còn ý nghĩa "nguồn đầu tiên tạo ra nó", không mô tả đủ nội dung nếu đề
      // xuất đã được gộp thêm từ nguồn khác.
      await lockBusinessKey(tx, `purchase-proposal-merge:${piBigId}`);
      // Tìm đề xuất "còn mở" (khác PURCHASED) - không còn lọc NEW (2026-08-25, cùng lý do đã sửa ở
      // CuttingProposalsService.approve(): rollup rời NEW sớm hơn hẳn khi state machine chuyển
      // xuống cấp item, lọc cứng NEW sẽ khiến nguồn này không gộp được vào đề xuất sắt đã có ai
      // bắt đầu xử lý).
      let proposal = await tx.purchaseProposal.findFirst({
        where: {
          productionInvoiceId: piBigId,
          status: { not: PurchaseProposalStatus.PURCHASED },
        },
        include: { items: true },
      });

      if (!proposal) {
        proposal = await tx.purchaseProposal.create({
          data: {
            sourceType: PurchaseProposalSource.CONSUMABLE_AUTO_CALC,
            productionInvoiceId: piBigId,
            warehouseCode: computed[0].warehouseCode,
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
        // Ưu tiên dòng CHƯA đóng hồ sơ (status khác PURCHASED) nếu 1 material lỡ có 2 dòng (dòng cũ
        // đã PURCHASED + dòng mới tách ra cho phần thiếu, xem nhánh dưới) - nếu không, lượt tính lại
        // kế tiếp có thể chọn nhầm dòng đã đóng làm "dòng đang mở" và tách thêm dòng thiếu trùng lặp.
        const itemByMaterial = new Map<string, (typeof proposal.items)[number]>();
        for (const it of proposal.items) {
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
            // Dòng đã đóng hồ sơ (nhận đủ hàng) - KHÔNG ghi đè buyQty lên nó (2026-08-26, lỗ #6 "ghi
            // đè buyQty của item PURCHASED làm thiếu hụt biến mất khỏi hàng đợi vĩnh viễn"). Nếu
            // buyQty vừa tính vẫn cao hơn receivedQty đã chốt, phần chênh lệch là nhu cầu mua THẬT -
            // tách thành dòng NEW riêng để đi lại từ đầu quy trình báo giá, thay vì âm thầm sửa số
            // trên hồ sơ đã đóng (không ai còn thấy nó trong hàng đợi vì activeOnly loại PURCHASED).
            const shortfall = c.buyQty - existingItem.receivedQty.toNumber();
            if (shortfall > 0) {
              await tx.purchaseProposalItem.create({
                data: {
                  proposalId: proposal.id,
                  materialId: c.materialId,
                  buyQty: shortfall,
                  actualStock: c.actualStock,
                },
              });
            }
          } else if (existingItem) {
            // Chỉ ghi đè status khi dòng đó CHƯA ai động vào (còn NEW) - không tự ý huỷ tiến độ
            // báo giá đang dở của người mua nếu lượt tính lại này đổi buyQty của 1 dòng đã QUOTING
            // trở đi (cùng idiom CuttingProposalsService.approve()).
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
                proposalId: proposal.id,
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

      await recomputeProposalStatus(tx, proposal.id);
      proposal = await tx.purchaseProposal.findUniqueOrThrow({
        where: { id: proposal.id },
        include: { items: true },
      });

      return computed.map(
        (c) =>
          new ConsumableMaterialPurchaseResultDto({
            materialId: c.materialIdStr,
            materialCode: materialById.get(c.materialIdStr)!.code,
            required: c.required,
            actualStock: c.actualStock,
            buyQty: c.buyQty,
            purchaseProposalId: proposal.id.toString(),
            purchaseProposalStatus: proposal.status,
          }),
      );
    });

    return results;
  }
}
