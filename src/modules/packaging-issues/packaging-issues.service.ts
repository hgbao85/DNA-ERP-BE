import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessoryItemKind,
  Prisma,
  ProductionOrder,
  StockLedgerRefType,
} from '../../generated/prisma/client';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import {
  assertItemPiHasActiveFloor,
  assertItemPiHasActiveFloorLocked,
} from '../../common/utils/floor-gate.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { CreatePackagingIssueDto } from './dto/create-packaging-issue.dto';
import { PackagingIssuePlanItemResponseDto } from './dto/packaging-issue-plan-item-response.dto';
import { PackagingIssueResponseDto } from './dto/packaging-issue-response.dto';

const PACKAGING_ISSUE_INCLUDE = {
  productionOrder: {
    include: {
      productionInvoiceItem: {
        select: { salesOrder: { select: { code: true } }, warehouseCode: true },
      },
    },
  },
  material: true,
} satisfies Prisma.PackagingIssueInclude;

type PackagingIssueRow = Prisma.PackagingIssueGetPayload<{
  include: typeof PACKAGING_ISSUE_INCLUDE;
}>;

/// Kho vật lý nguồn KHÔNG còn hardcode 1 code (2026-09-03) - đọc động từ Material.warehouseId,
/// mirror CuttingProposalsService.approve()/MaterialIssuesService, cho phép nhiều kho vat-tu-tp-*
/// cùng tồn tại thay vì 1 kho gốc duy nhất.
/// Kho vật lý đích MẶC ĐỊNH - khác PRODUCTION_WAREHOUSE_CODE (kho ảo) ở material-issues/
/// steel-issues: vật tư đóng gói đi thẳng tới kho thành phẩm thật, không qua kho ảo PRODUCTION.
/// Chỉ dùng khi PI item CHƯA có warehouseCode (chưa qua sendItemToBoss) - đích thật ưu tiên đọc
/// từ ProductionInvoiceItem.warehouseCode (kho QLSX chọn lúc duyệt, có thể là 1 kho thành phẩm
/// PHỤ dạng 'thanh-pham-{n}') - trước đây hard-code literal này bất kể QLSX chọn kho nào, khiến
/// hàng luôn "về" kho thành phẩm gốc dù QLSX đã chọn kho phụ khi gửi Sếp duyệt.
const PACKAGING_DEST_WAREHOUSE_CODE = 'thanh-pham';

/**
 * Xuất vật tư đóng gói (2026-08-19, thay MOCK ở WarehouseXuatPage.tsx scope 'vat-tu-tp') - tem
 * nhãn, màng PE, túi zip... từ kho vat-tu-tp sang kho thanh-pham theo PO. Định mức nằm ở
 * BomAccessoryItem (kind=PACKAGING, theo bomRevisionId của PO) - "còn xuất được bao nhiêu" =
 * qtyPerUnit × order.quantity trừ SUM(PackagingIssue.issuedQty đã có), cùng idiom
 * MaterialIssuesService/SteelIssuesService/WeavingIssuesService.getIssuePlan().
 *
 * KHÁC MaterialIssue: không có state machine ISSUED->RECEIVED - cả kho nguồn (vat-tu-tp) lẫn kho
 * đích (thanh-pham) đều là thủ kho, WarehouseXuatPage không có màn "nhận hàng" riêng cho packaging
 * (khác KhoNhapDanPage/XacNhanVatTuPage) - ghi StockLedger ngay lúc tạo, giống MaterialIssue ghi
 * ngay khi xuất (vật tư đóng gói cũng chưa bị trừ tồn ở bước nào trước đó).
 */
@Injectable()
export class PackagingIssuesService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly stockLedgerService: StockLedgerService,
    private readonly stockReservationsService: StockReservationsService,
  ) {}

  async create(
    productionOrderId: string,
    dto: CreatePackagingIssueDto,
    issuedById: string,
    warehouseScope: string | null,
    idempotencyKey?: string,
  ): Promise<PackagingIssueResponseDto> {
    if (idempotencyKey) {
      const existing = await this.prisma.packagingIssue.findUnique({
        where: { idempotencyKey },
        include: PACKAGING_ISSUE_INCLUDE,
      });
      if (existing) {
        await this.postLedgerEntry(existing, issuedById);
        return this.toResponseDto(existing);
      }
    }

    const order = await this.findOrderOrThrow(productionOrderId);
    await assertItemPiHasActiveFloor(
      this.prisma,
      order.productionInvoiceItemId,
      'xuất vật tư đóng gói',
    );
    const materialBigId = parseBigIntId(dto.materialId);
    const sourceWarehouse = await this.findMaterialWarehouseOrThrow(materialBigId);
    // Gate theo ĐÚNG instance kho vật lý của vật tư này (không chỉ cùng gia đình vat-tu-tp) - Thủ
    // kho của vat-tu-tp-2 không được xuất vật tư đang thật sự nằm ở kho vat-tu-tp gốc và ngược lại.
    this.assertWarehouseScope(warehouseScope, sourceWarehouse.code);

    // Khoá advisory (H3 fix, cùng lý do H2 ở MaterialIssuesService) - không có dòng có sẵn để
    // FOR UPDATE cho lần xuất đầu tiên của 1 khoá (order, material) - xem lockBusinessKey().
    const created = await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `packaging-issue:${order.id}:${materialBigId}`);
      await assertItemPiHasActiveFloorLocked(
        tx,
        order.productionInvoiceItemId,
        'xuất vật tư đóng gói',
      );

      const item = await this.resolveAccessoryItem(tx, order.bomRevisionId, materialBigId);
      const plannedQty = item.qtyPerUnit.toNumber() * order.quantity;
      const issuedSoFar = await this.sumIssued(tx, order.id, materialBigId);
      const remaining = plannedQty - issuedSoFar;
      if (dto.issuedQty > remaining) {
        throw new BadRequestException(
          `Số lượng xuất (${dto.issuedQty}) vượt quá số lượng còn có thể xuất cho vật tư ${dto.materialId} ` +
            `(định mức ${plannedQty}, đã xuất ${issuedSoFar}, còn ${remaining})`,
        );
      }

      // 2026-09-04 (xác nhận nghiệp vụ với user): Chuyền kiểm là gate BẮT BUỘC trước Đóng gói cho
      // MỌI mảnh, kể cả mảnh không cần đan (needsHan/needsSon quyết định công đoạn Phôi/Hàn/Sơn
      // cuối cùng, không liên quan gì đến việc có phải qua Chuyền kiểm hay không) - trước đây
      // create() không hề đọc TransferCheckResult, thủ kho vat-tu-tp xuất được đóng gói dù chưa ai
      // chuyền kiểm. checkedUnits tính "đồng bộ" (Math.min qua mọi mảnh trong BOM, mirror cách
      // WarehouseTransfersService.getPieceTransferPlan() cap suggestedQty theo readyQty QC_DONE) -
      // 1 sản phẩm chỉ tính "đã chuyền kiểm" khi ĐỦ mọi mảnh của nó đã được kiểm.
      const checkedUnits = await this.resolveCheckedUnits(
        tx,
        order.bomRevisionId,
        order.productionInvoiceItemId,
      );
      const checkedCappedQty = item.qtyPerUnit.toNumber() * checkedUnits;
      const remainingByCheck = checkedCappedQty - issuedSoFar;
      if (dto.issuedQty > remainingByCheck) {
        throw new ConflictException(
          `Chỉ ${checkedUnits}/${order.quantity} sản phẩm đã qua Chuyền kiểm (đã xuất ${issuedSoFar}, ` +
            `còn được xuất theo Chuyền kiểm ${Math.max(0, remainingByCheck)}) - không thể xuất đóng gói cho ${dto.issuedQty} ` +
            `vượt quá số đã chuyền kiểm`,
        );
      }

      // Vấn đề #1 audit 26/08 (Nghiêm trọng) - cùng lý do MaterialIssuesService.create(): trước
      // đây chỉ check định mức BOM, không đối chiếu tồn kho vật lý. FOR UPDATE chặn cả race giữa
      // 2 lệnh SX khác nhau cùng xuất 1 vật tư; getAvailableQty() để không giành tồn với chuyển
      // kho nội bộ đang giữ chỗ vật tư này.
      const [stockRow] = await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
        SELECT "qty" FROM "stock_quant"
        WHERE "warehouseId" = ${sourceWarehouse.id} AND "materialId" = ${materialBigId}
        FOR UPDATE
      `;
      const onHand = stockRow?.qty.toNumber() ?? 0;
      const availableQty = await this.stockReservationsService.getAvailableQty(
        tx,
        sourceWarehouse.id,
        materialBigId,
        onHand,
      );
      if (dto.issuedQty > availableQty) {
        throw new ConflictException(
          `Tồn kho khả dụng (${availableQty}) không đủ xuất ${dto.issuedQty} cho vật tư ${dto.materialId} - kiểm tra lại tồn kho thực tế trước khi xuất`,
        );
      }

      return tx.packagingIssue.create({
        data: {
          productionOrderId: order.id,
          materialId: materialBigId,
          issuedQty: dto.issuedQty,
          issuedById,
          idempotencyKey,
          note: dto.note,
        },
        include: PACKAGING_ISSUE_INCLUDE,
      });
    });

    await this.postLedgerEntry(created, issuedById);
    return this.toResponseDto(created);
  }

  /** "Cần xuất bao nhiêu" theo (PO, vật tư), gộp nhiều PO 1 lần - WarehouseXuatPage cần liệt kê
   *  mọi PO đang hoạt động cùng lúc, cùng idiom WarehouseTransfersService.getPieceTransferPlan(). */
  async getBulkPlan(productionOrderIds: string[]): Promise<PackagingIssuePlanItemResponseDto[]> {
    if (productionOrderIds.length === 0) {
      throw new BadRequestException('Phải truyền ít nhất 1 productionOrderId');
    }
    const orderBigIds = productionOrderIds.map((id) => parseBigIntId(id));
    const orders = await this.prisma.productionOrder.findMany({
      where: { id: { in: orderBigIds } },
      include: {
        mfgProduct: true,
        productionInvoiceItem: { select: { salesOrder: { select: { code: true } } } },
      },
    });

    const bomRevisionIds = [...new Set(orders.map((o) => o.bomRevisionId))];
    const [accessoryItems, issues, bomPieces, checkedSums] = await Promise.all([
      this.prisma.bomAccessoryItem.findMany({
        where: { bomRevisionId: { in: bomRevisionIds }, kind: AccessoryItemKind.PACKAGING },
        include: { material: { include: { warehouse: true } } },
      }),
      this.prisma.packagingIssue.findMany({
        where: { productionOrderId: { in: orders.map((o) => o.id) } },
        select: { productionOrderId: true, materialId: true, issuedQty: true },
      }),
      this.prisma.bomPiece.findMany({ where: { bomRevisionId: { in: bomRevisionIds } } }),
      this.prisma.transferCheckResult.groupBy({
        by: ['productionInvoiceItemId', 'pieceId'],
        where: { productionInvoiceItemId: { in: orders.map((o) => o.productionInvoiceItemId) } },
        _sum: { checkedQty: true },
      }),
    ]);

    const issuedByKey = new Map<string, number>();
    for (const i of issues) {
      const key = `${i.productionOrderId}:${i.materialId}`;
      issuedByKey.set(key, (issuedByKey.get(key) ?? 0) + i.issuedQty.toNumber());
    }

    // Chuyền kiểm cap, đồng bộ theo (productionInvoiceItemId, bomRevisionId) - mirror
    // resolveCheckedUnits() bản đơn, gộp cho nhiều order 1 lần cùng idiom hàm này.
    const bomPiecesByRevision = new Map<string, typeof bomPieces>();
    for (const bp of bomPieces) {
      const key = bp.bomRevisionId.toString();
      const arr = bomPiecesByRevision.get(key) ?? [];
      arr.push(bp);
      bomPiecesByRevision.set(key, arr);
    }
    const checkedByItemPiece = new Map<string, number>();
    for (const r of checkedSums) {
      checkedByItemPiece.set(`${r.productionInvoiceItemId}:${r.pieceId}`, r._sum.checkedQty ?? 0);
    }
    const checkedUnitsByOrder = new Map<string, number>();
    for (const order of orders) {
      const pieces = bomPiecesByRevision.get(order.bomRevisionId.toString()) ?? [];
      const units =
        pieces.length === 0
          ? 0
          : Math.min(
              ...pieces.map((bp) =>
                Math.floor(
                  (checkedByItemPiece.get(`${order.productionInvoiceItemId}:${bp.pieceId}`) ?? 0) /
                    bp.qtyPerUnit,
                ),
              ),
            );
      checkedUnitsByOrder.set(order.id.toString(), units);
    }

    const result: PackagingIssuePlanItemResponseDto[] = [];
    for (const order of orders) {
      const items = accessoryItems.filter((a) => a.bomRevisionId === order.bomRevisionId);
      const checkedUnits = checkedUnitsByOrder.get(order.id.toString()) ?? 0;
      for (const item of items) {
        const key = `${order.id}:${item.materialId}`;
        const requiredQty = item.qtyPerUnit.toNumber() * order.quantity;
        const issuedQty = issuedByKey.get(key) ?? 0;
        const checkedCappedQty = item.qtyPerUnit.toNumber() * checkedUnits;
        result.push(
          new PackagingIssuePlanItemResponseDto({
            productionOrderId: order.id.toString(),
            poNumber: order.poNumber,
            salesOrderCode: order.productionInvoiceItem.salesOrder?.code ?? null,
            productName: order.mfgProduct.name,
            materialId: item.materialId.toString(),
            materialCode: item.material.code,
            materialName: item.material.name,
            materialUnit: item.material.unit,
            materialWarehouseCode: item.material.warehouse?.code ?? null,
            requiredQty,
            issuedQty,
            // Trần thật là MIN(định mức BOM, đã qua Chuyền kiểm) - "Kế hoạch" (requiredQty) vẫn
            // giữ nguyên tổng nhu cầu BOM để thủ kho biết đích cuối, nhưng "Còn lại" phải phản ánh
            // đúng số HIỆN được phép xuất ngay bây giờ (2026-09-04, cùng gate với create()).
            remainingToIssue: Math.min(requiredQty, checkedCappedQty) - issuedQty,
          }),
        );
      }
    }
    return result;
  }

  private async postLedgerEntry(issue: PackagingIssueRow, createdById: string): Promise<void> {
    // fromWarehouseId đọc thẳng từ Material.warehouseId (đã include ở PACKAGING_ISSUE_INCLUDE) -
    // không còn tra theo literal code. Chỉ chưa từng null ở đây vì create() đã chặn qua
    // findMaterialWarehouseOrThrow() trước khi tạo bản ghi.
    if (!issue.material.warehouseId) {
      throw new BadRequestException(
        `Vật tư ${issue.material.code} chưa được cấu hình Kho - vào Admin > Vật tư để gán Kho trước khi ghi sổ`,
      );
    }
    const destWarehouseCode =
      issue.productionOrder.productionInvoiceItem.warehouseCode ?? PACKAGING_DEST_WAREHOUSE_CODE;
    const toWarehouse = await this.prisma.warehouse.findUniqueOrThrow({
      where: { code: destWarehouseCode },
    });
    await this.stockLedgerService.postEntry({
      fromWarehouseId: issue.material.warehouseId,
      toWarehouseId: toWarehouse.id,
      materialId: issue.materialId,
      qty: issue.issuedQty.toNumber(),
      refType: StockLedgerRefType.PACKAGING_ISSUE,
      refId: issue.id.toString(),
      createdById,
      idempotencyKey: `packaging-issue:${issue.id}`,
    });
  }

  /** Kho vật lý CỤ THỂ của vật tư này, đọc từ Material.warehouseId (mirror
   *  CuttingProposalsService.approve()) - 400 rõ ràng nếu Admin chưa cấu hình Kho cho vật tư đó. */
  private async findMaterialWarehouseOrThrow(id: bigint): Promise<{ id: bigint; code: string }> {
    const material = await this.prisma.material.findUnique({
      where: { id },
      select: { code: true, warehouseId: true, warehouse: { select: { id: true, code: true } } },
    });
    if (!material) {
      throw new NotFoundException(`Material ${id} not found`);
    }
    if (!material.warehouseId || !material.warehouse) {
      throw new BadRequestException(
        `Vật tư ${material.code} chưa được cấu hình Kho - vào Admin > Vật tư để gán Kho trước khi xuất`,
      );
    }
    return material.warehouse;
  }

  /** null = tổng kho (BOSS/ADMIN) - không có gì để chặn, cùng idiom MaterialIssuesService/
   *  SteelIssuesService/WeavingIssuesService.assertWarehouseScope(). Khác null: phải khớp ĐÚNG kho
   *  vật lý cụ thể mà vật tư này đang nằm (expectedWarehouseCode, đọc từ Material.warehouseId). */
  private assertWarehouseScope(warehouseScope: string | null, expectedWarehouseCode: string): void {
    if (warehouseScope && warehouseScope !== expectedWarehouseCode) {
      throw new ForbiddenException(
        `Caller bị giới hạn ở kho '${warehouseScope}', không được xuất vật tư đóng gói từ kho '${expectedWarehouseCode}'`,
      );
    }
  }

  private async resolveAccessoryItem(
    client: PrismaServiceType | PrismaTx,
    bomRevisionId: bigint,
    materialId: bigint,
  ) {
    const item = await client.bomAccessoryItem.findUnique({
      where: { bomRevisionId_materialId: { bomRevisionId, materialId } },
    });
    if (!item || item.kind !== AccessoryItemKind.PACKAGING) {
      throw new NotFoundException(
        `Vật tư ${materialId} không thuộc định mức đóng gói (BomAccessoryItem kind=PACKAGING) của lệnh sản xuất này`,
      );
    }
    return item;
  }

  /**
   * Số sản phẩm đã qua Chuyền kiểm, ĐỒNG BỘ mọi mảnh trong BOM (1 sản phẩm chỉ tính "xong" khi đủ
   * mọi mảnh của nó đã được kiểm - mirror WarehouseTransfersService.getPieceTransferPlan() cap
   * suggestedQty theo readyQty QC_DONE). Áp dụng cho MỌI mảnh bất kể needsHan/needsSon/isWoven -
   * Chuyền kiểm là bước bắt buộc trước Đóng gói theo đúng quy trình thật (xác nhận với user
   * 2026-09-04), không phải chỉ mảnh phải đan mới cần.
   */
  private async resolveCheckedUnits(
    client: PrismaServiceType | PrismaTx,
    bomRevisionId: bigint,
    productionInvoiceItemId: bigint,
  ): Promise<number> {
    const [bomPieces, checkedSums] = await Promise.all([
      client.bomPiece.findMany({ where: { bomRevisionId } }),
      client.transferCheckResult.groupBy({
        by: ['pieceId'],
        where: { productionInvoiceItemId },
        _sum: { checkedQty: true },
      }),
    ]);
    if (bomPieces.length === 0) return 0;
    const checkedByPiece = new Map<string, number>(
      checkedSums.map((r) => [r.pieceId.toString(), r._sum.checkedQty ?? 0]),
    );
    return Math.min(
      ...bomPieces.map((bp) =>
        Math.floor((checkedByPiece.get(bp.pieceId.toString()) ?? 0) / bp.qtyPerUnit),
      ),
    );
  }

  private async sumIssued(
    tx: PrismaTx,
    productionOrderId: bigint,
    materialId: bigint,
  ): Promise<number> {
    const result = await tx.packagingIssue.aggregate({
      where: { productionOrderId, materialId },
      _sum: { issuedQty: true },
    });
    return result._sum.issuedQty?.toNumber() ?? 0;
  }

  private async findOrderOrThrow(id: string): Promise<ProductionOrder> {
    const bigId = parseBigIntId(id);
    const order = await this.prisma.productionOrder.findUnique({ where: { id: bigId } });
    if (!order) {
      throw new NotFoundException(`Production order ${id} not found`);
    }
    return order;
  }

  private toResponseDto(issue: PackagingIssueRow): PackagingIssueResponseDto {
    return new PackagingIssueResponseDto({
      id: issue.id.toString(),
      productionOrderId: issue.productionOrderId.toString(),
      poNumber: issue.productionOrder.poNumber,
      salesOrderCode: issue.productionOrder.productionInvoiceItem.salesOrder?.code ?? null,
      materialId: issue.materialId.toString(),
      materialCode: issue.material.code,
      materialName: issue.material.name,
      issuedQty: issue.issuedQty.toNumber(),
      issuedAt: issue.issuedAt,
      issuedById: issue.issuedById,
      note: issue.note,
    });
  }
}
