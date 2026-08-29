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
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { CreatePackagingIssueDto } from './dto/create-packaging-issue.dto';
import { PackagingIssuePlanItemResponseDto } from './dto/packaging-issue-plan-item-response.dto';
import { PackagingIssueResponseDto } from './dto/packaging-issue-response.dto';

const PACKAGING_ISSUE_INCLUDE = {
  productionOrder: {
    include: { productionInvoiceItem: { select: { salesOrder: { select: { code: true } } } } },
  },
  material: true,
} satisfies Prisma.PackagingIssueInclude;

type PackagingIssueRow = Prisma.PackagingIssueGetPayload<{
  include: typeof PACKAGING_ISSUE_INCLUDE;
}>;

/// Kho vật lý nguồn - cùng MATERIAL_WAREHOUSE_CODE ở material-issues.service.ts (2 domain dùng
/// chung 1 kho vật lý, khác mục đích: vật tư tiêu hao Hàn/Sơn vs vật tư đóng gói).
const PACKAGING_SOURCE_WAREHOUSE_CODE = 'vat-tu-tp';
/// Kho vật lý đích - khác PRODUCTION_WAREHOUSE_CODE (kho ảo) ở material-issues/steel-issues: vật
/// tư đóng gói đi thẳng tới kho thành phẩm thật, không qua kho ảo PRODUCTION.
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
 *
 * (Đính chính 2026-08-29, audit độc lập 28/08 mục Nghiêm trọng #1 - cùng lỗi/cùng fix với
 * MaterialIssuesService) postEntry() PHẢI chạy TRONG transaction tạo packaging_issue (truyền `tx`)
 * - trước đây gọi NGOÀI transaction khiến khoá FOR UPDATE ở stock_quant nhả trước khi bút toán ghi
 * xong, 2 lệnh SX khác nhau xuất cùng vật tư gần lúc nhau có thể cùng đọc thấy tồn cũ và cùng trừ.
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
    this.assertWarehouseScope(warehouseScope);

    // Cả 2 kho đều là hằng số cố định - resolve 1 lần ở đây, dùng lại cho cả nhánh
    // idempotency-retry lẫn nhánh tạo mới bên dưới (xem đính chính 2026-08-29 ở đầu file).
    const [sourceWarehouse, destWarehouse] = await Promise.all([
      this.prisma.warehouse.findUniqueOrThrow({ where: { code: PACKAGING_SOURCE_WAREHOUSE_CODE } }),
      this.prisma.warehouse.findUniqueOrThrow({ where: { code: PACKAGING_DEST_WAREHOUSE_CODE } }),
    ]);

    if (idempotencyKey) {
      const existing = await this.prisma.packagingIssue.findUnique({
        where: { idempotencyKey },
        include: PACKAGING_ISSUE_INCLUDE,
      });
      if (existing) {
        await this.postLedgerEntry(existing, issuedById, sourceWarehouse.id, destWarehouse.id);
        return this.toResponseDto(existing);
      }
    }

    const order = await this.findOrderOrThrow(productionOrderId);
    const materialBigId = parseBigIntId(dto.materialId);

    // Khoá advisory (H3 fix, cùng lý do H2 ở MaterialIssuesService) - không có dòng có sẵn để
    // FOR UPDATE cho lần xuất đầu tiên của 1 khoá (order, material) - xem lockBusinessKey().
    const created = await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `packaging-issue:${order.id}:${materialBigId}`);

      const plannedQty = await this.resolvePlannedQty(
        tx,
        order.bomRevisionId,
        materialBigId,
        order.quantity,
      );
      const issuedSoFar = await this.sumIssued(tx, order.id, materialBigId);
      const remaining = plannedQty - issuedSoFar;
      if (dto.issuedQty > remaining) {
        throw new BadRequestException(
          `Số lượng xuất (${dto.issuedQty}) vượt quá số lượng còn có thể xuất cho vật tư ${dto.materialId} ` +
            `(định mức ${plannedQty}, đã xuất ${issuedSoFar}, còn ${remaining})`,
        );
      }

      // Vấn đề #1 audit 26/08 (Nghiêm trọng) - cùng lý do MaterialIssuesService.create(): trước
      // đây chỉ check định mức BOM, không đối chiếu tồn kho vật lý. FOR UPDATE chặn cả race giữa
      // 2 lệnh SX khác nhau cùng xuất 1 vật tư; getAvailableQty() để không giành tồn với chuyển
      // kho nội bộ đang giữ chỗ vật tư này.
      // Vật tư thường vĩnh viễn chỉ có bucket 0, nhưng KHÔNG giả định 1 dòng duy nhất - cộng dồn
      // mọi dòng trả về (kế hoạch "chiều dài cây sắt" 2026-08-29, Bước 6). FOR UPDATE khoá TẤT CẢ
      // bucket của vật tư đó, đúng ý "lấy tổng, đừng ai đụng vào".
      const stockRows = await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
        SELECT "qty" FROM "stock_quant"
        WHERE "warehouseId" = ${sourceWarehouse.id} AND "materialId" = ${materialBigId}
        FOR UPDATE
      `;
      const onHand = stockRows.reduce((sum, r) => sum + r.qty.toNumber(), 0);
      const availableQty = await this.stockReservationsService.getAvailableQty(
        tx,
        sourceWarehouse.id,
        materialBigId,
        'ALL',
        onHand,
      );
      if (dto.issuedQty > availableQty) {
        throw new ConflictException(
          `Tồn kho khả dụng (${availableQty}) không đủ xuất ${dto.issuedQty} cho vật tư ${dto.materialId} - kiểm tra lại tồn kho thực tế trước khi xuất`,
        );
      }

      const issue = await tx.packagingIssue.create({
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
      // PHẢI nằm trong transaction đang giữ khoá FOR UPDATE ở trên (xem đính chính 2026-08-29 ở
      // đầu file) - khoá chỉ nhả sau khi bút toán ghi xong, chặn được lệnh SX khác đọc trúng tồn cũ.
      await this.postLedgerEntry(issue, issuedById, sourceWarehouse.id, destWarehouse.id, tx);
      return issue;
    });

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
    const [accessoryItems, issues] = await Promise.all([
      this.prisma.bomAccessoryItem.findMany({
        where: { bomRevisionId: { in: bomRevisionIds }, kind: AccessoryItemKind.PACKAGING },
        include: { material: true },
      }),
      this.prisma.packagingIssue.findMany({
        where: { productionOrderId: { in: orders.map((o) => o.id) } },
        select: { productionOrderId: true, materialId: true, issuedQty: true },
      }),
    ]);

    const issuedByKey = new Map<string, number>();
    for (const i of issues) {
      const key = `${i.productionOrderId}:${i.materialId}`;
      issuedByKey.set(key, (issuedByKey.get(key) ?? 0) + i.issuedQty.toNumber());
    }

    const result: PackagingIssuePlanItemResponseDto[] = [];
    for (const order of orders) {
      const items = accessoryItems.filter((a) => a.bomRevisionId === order.bomRevisionId);
      for (const item of items) {
        const key = `${order.id}:${item.materialId}`;
        const requiredQty = item.qtyPerUnit.toNumber() * order.quantity;
        const issuedQty = issuedByKey.get(key) ?? 0;
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
            requiredQty,
            issuedQty,
            remainingToIssue: requiredQty - issuedQty,
          }),
        );
      }
    }
    return result;
  }

  private async postLedgerEntry(
    issue: PackagingIssueRow,
    createdById: string,
    fromWarehouseId: bigint,
    toWarehouseId: bigint,
    tx?: PrismaTx,
  ): Promise<void> {
    await this.stockLedgerService.postEntry(
      {
        fromWarehouseId,
        toWarehouseId,
        materialId: issue.materialId,
        stockLengthMm: 0,
        qty: issue.issuedQty.toNumber(),
        refType: StockLedgerRefType.PACKAGING_ISSUE,
        refId: issue.id.toString(),
        createdById,
        idempotencyKey: `packaging-issue:${issue.id}`,
      },
      tx,
    );
  }

  /** null = tổng kho (BOSS/ADMIN) - không có gì để chặn, cùng idiom MaterialIssuesService/
   *  SteelIssuesService/WeavingIssuesService.assertWarehouseScope(). */
  private assertWarehouseScope(warehouseScope: string | null): void {
    if (warehouseScope && warehouseScope !== PACKAGING_SOURCE_WAREHOUSE_CODE) {
      throw new ForbiddenException(
        `Caller bị giới hạn ở kho '${warehouseScope}', không được xuất vật tư đóng gói từ kho '${PACKAGING_SOURCE_WAREHOUSE_CODE}'`,
      );
    }
  }

  private async resolvePlannedQty(
    tx: PrismaTx,
    bomRevisionId: bigint,
    materialId: bigint,
    orderQuantity: number,
  ): Promise<number> {
    const item = await tx.bomAccessoryItem.findUnique({
      where: { bomRevisionId_materialId: { bomRevisionId, materialId } },
    });
    if (!item || item.kind !== AccessoryItemKind.PACKAGING) {
      throw new NotFoundException(
        `Vật tư ${materialId} không thuộc định mức đóng gói (BomAccessoryItem kind=PACKAGING) của lệnh sản xuất này`,
      );
    }
    return item.qtyPerUnit.toNumber() * orderQuantity;
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
