import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { BomRevisionStatus, Prisma } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { ProductionOrderResponseDto } from './dto/production-order-response.dto';

type ProductionOrderRow = Prisma.ProductionOrderGetPayload<object>;

// Mã đơn Sales (cột "PO") + mã PI cha (cột "PI") + hạn giao cho người dùng - xem toResponseDto.
// Include riêng (không gộp vào ProductionOrderRow) vì createFromApproval() không cần tới, tránh
// query thừa.
const SALES_ORDER_CODE_INCLUDE = {
  productionInvoiceItem: {
    select: {
      salesOrder: { select: { code: true } },
      productionInvoice: { select: { id: true, code: true } },
      deliveryDeadline: true,
    },
  },
} satisfies Prisma.ProductionOrderInclude;

type ProductionOrderWithSalesOrder = Prisma.ProductionOrderGetPayload<{
  include: typeof SALES_ORDER_CODE_INCLUDE;
}>;

/**
 * Lệnh sản xuất tại xưởng (Phase 7). KHÔNG có API tạo/release thủ công ở bản này - mỗi
 * ProductionOrder tự sinh 1-1 (createFromApproval) ngay khi Sếp duyệt 1 ProductionInvoiceItem
 * (xem ProductionInvoicesService.approveItem), luôn ở status RELEASED ngay từ đầu vì không
 * còn bước duyệt PO riêng nữa. Giữ entity độc lập (không gộp vào ProductionInvoiceItem) vì
 * Phase 8 (Mua hàng) và Phase 9 (Thực thi Phôi) đã thiết kế sẵn phụ thuộc vào nó.
 */
@Injectable()
export class ProductionOrdersService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  /**
   * Kiểm sớm trước khi ProductionInvoicesService.approveItem() ghi bất kỳ gì - để thiếu BOM
   * active chặn đúng hành động "duyệt" (409, Sếp thấy ngay lý do) thay vì âm thầm để lại 1
   * ProductionInvoiceItem APPROVED mồ côi ProductionOrder (lỗ hổng phát hiện 2026-08-11, xem
   * createFromApproval - lỗi ở đó trước giờ chỉ bị log, không chặn việc duyệt).
   * Không tái dùng để tạo ProductionOrder - createFromApproval() tự truy vấn lại BomRevision,
   * chấp nhận 1 query thừa để 2 hàm giữ độc lập, không đổi hợp đồng NotFoundException đã có
   * test riêng (production-orders.service.spec.ts) của createFromApproval.
   */
  async assertActiveBomRevisionExists(mfgProductId: bigint): Promise<void> {
    const activeRevision = await this.prisma.bomRevision.findFirst({
      where: { mfgProductId, status: BomRevisionStatus.ACTIVE },
    });
    if (!activeRevision) {
      throw new ConflictException(
        `Sản phẩm ${mfgProductId} chưa có định mức (BOM) đang active - không thể duyệt sản xuất. Cần kích hoạt 1 BomRevision trước.`,
      );
    }
  }

  /**
   * Gọi bởi ProductionInvoicesService.approveItem() ngay sau khi 1 item được Sếp duyệt.
   * quantity ghim (snapshot) từ productionInvoiceItem.quantity - giá trị này do Sales tạo và
   * không ai được sửa sau đó, nên ghim 1 lần là an toàn tuyệt đối, không cần đồng bộ lại.
   * bomRevisionId suy từ ACTIVE BomRevision của mfgProductId tại thời điểm này (không suy lại
   * mỗi lần đọc sau).
   */
  async createFromApproval(
    productionInvoiceItemId: bigint,
    mfgProductId: bigint,
    quantity: number,
  ): Promise<ProductionOrderRow> {
    const activeRevision = await this.prisma.bomRevision.findFirst({
      where: { mfgProductId, status: BomRevisionStatus.ACTIVE },
    });
    if (!activeRevision) {
      throw new NotFoundException(
        `Không tìm thấy BomRevision ACTIVE cho sản phẩm ${mfgProductId} - không thể tạo lệnh sản xuất`,
      );
    }

    const poNumber = await this.resolvePoNumber(productionInvoiceItemId);
    return this.prisma.productionOrder.create({
      data: {
        poNumber,
        productionInvoiceItemId,
        mfgProductId,
        bomRevisionId: activeRevision.id,
        quantity,
      },
    });
  }

  /**
   * Mã lệnh SX hiển thị = mã đơn hàng Sales gốc + số thứ tự SKU trong đơn đó (vd "PO-31-2") -
   * KHÔNG còn tự đánh số riêng theo id của chính bảng này (PO-{id} cũ), tránh 2 chuỗi "PO-"
   * độc lập gây nhầm mã lệnh SX nội bộ với mã đơn hàng Sales thật (xem trao đổi 2026-08-18).
   * Item không gắn Sales Order nào (tạo tay qua POST /production-invoices/:id/items, xem
   * ProductionInvoiceItem.salesOrderId) -> "NB-{itemId}" ("Nội bộ") - itemId đã unique sẵn vì
   * ProductionOrder.productionInvoiceItemId là @unique (1-1).
   *
   * Đếm trước khi tạo (không phải sau) để suy đúng "SKU thứ mấy" - chấp nhận rủi ro race hiếm
   * (2 item CÙNG 1 đơn Sales được duyệt gần như đồng thời có thể tính trùng số thứ tự) do
   * unique constraint trên poNumber tự chặn, ném lỗi rõ ràng thay vì âm thầm ghi trùng - đủ an
   * toàn vì approveItem() vốn đã là thao tác bấm tay từng item một, không phải batch job.
   */
  private async resolvePoNumber(productionInvoiceItemId: bigint): Promise<string> {
    const item = await this.prisma.productionInvoiceItem.findUniqueOrThrow({
      where: { id: productionInvoiceItemId },
      select: { salesOrderId: true, salesOrder: { select: { code: true } } },
    });
    if (!item.salesOrderId || !item.salesOrder) {
      return `NB-${productionInvoiceItemId}`;
    }
    const existingCount = await this.prisma.productionOrder.count({
      where: { productionInvoiceItem: { salesOrderId: item.salesOrderId } },
    });
    return `${item.salesOrder.code}-${existingCount + 1}`;
  }

  async findAll(query: PaginationQueryDto): Promise<Paginated<ProductionOrderResponseDto>> {
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.productionOrder.findMany({ ...args, include: SALES_ORDER_CODE_INCLUDE }),
        count: (args) => this.prisma.productionOrder.count(args),
      },
      query,
      undefined,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { id: query.sortOrder },
    );

    return { data: result.data.map((o) => this.toResponseDto(o)), meta: result.meta };
  }

  async findOne(id: string): Promise<ProductionOrderResponseDto> {
    const bigId = parseBigIntId(id);
    const order = await this.prisma.productionOrder.findUnique({
      where: { id: bigId },
      include: SALES_ORDER_CODE_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException(`Production order ${id} not found`);
    }
    return this.toResponseDto(order);
  }

  /** `productionInvoiceItem.productionInvoice!` - ProductionOrder chỉ sinh ra khi Sếp duyệt
   *  (approveItem/approveBatch), mà duyệt bắt buộc item đã qua sendItemToQlsx/sendItemToBoss -
   *  cả hai route đó đều cần piId thật, nên item của 1 ProductionOrder luôn đã có PI (2026-08-20:
   *  productionInvoiceId có thể null cho item MỚI TẠO, nhưng không thể null ở đây). */
  private toResponseDto(order: ProductionOrderWithSalesOrder): ProductionOrderResponseDto {
    return new ProductionOrderResponseDto({
      id: order.id.toString(),
      poNumber: order.poNumber,
      salesOrderCode: order.productionInvoiceItem.salesOrder?.code ?? null,
      productionInvoiceId: order.productionInvoiceItem.productionInvoice!.id.toString(),
      piCode: order.productionInvoiceItem.productionInvoice!.code,
      deliveryDeadline: order.productionInvoiceItem.deliveryDeadline,
      productionInvoiceItemId: order.productionInvoiceItemId.toString(),
      mfgProductId: order.mfgProductId.toString(),
      bomRevisionId: order.bomRevisionId.toString(),
      quantity: order.quantity,
      status: order.status,
      releasedAt: order.releasedAt,
      floorStage: order.floorStage,
      floorStartedAt: order.floorStartedAt,
      floorFinishedAt: order.floorFinishedAt,
      createdAt: order.createdAt,
    });
  }

  /**
   * QLSX (BUSINESS_ROLES.PRODUCTION_MANAGER) bấm "Bắt đầu" ở "Bảng thống kê" - CHỈ đổi
   * floorStage (PENDING/ACTIVE -> ACTIVE), KHÔNG đụng `status` (vẫn RELEASED/IN_PROGRESS như cũ,
   * mua vật tư/xuất sắt không phụ thuộc field này). Cho phép gọi lại dù đã ACTIVE (idempotent,
   * không throw) - tránh lỗi vặt nếu bấm 2 lần/2 tab.
   */
  async startFloor(id: string): Promise<ProductionOrderResponseDto> {
    const bigId = parseBigIntId(id);
    const order = await this.prisma.productionOrder.findUnique({ where: { id: bigId } });
    if (!order) {
      throw new NotFoundException(`Production order ${id} not found`);
    }
    const updated = await this.prisma.productionOrder.update({
      where: { id: bigId },
      data:
        order.floorStage === 'PENDING'
          ? { floorStage: 'ACTIVE', floorStartedAt: new Date() }
          : { floorStage: 'ACTIVE' },
      include: SALES_ORDER_CODE_INCLUDE,
    });
    return this.toResponseDto(updated);
  }

  /**
   * QLSX bấm "Kết thúc" - đổi floorStage sang FINISHED, KHÔNG kiểm tra tiến độ Phôi/Hàn/Sơn/Đan/
   * Đóng gói (quyết định nghiệp vụ 2026-08-31: QLSX toàn quyền, bấm tự do). Idempotent cùng lý do
   * startFloor().
   */
  async finishFloor(id: string): Promise<ProductionOrderResponseDto> {
    const bigId = parseBigIntId(id);
    const order = await this.prisma.productionOrder.findUnique({ where: { id: bigId } });
    if (!order) {
      throw new NotFoundException(`Production order ${id} not found`);
    }
    const updated = await this.prisma.productionOrder.update({
      where: { id: bigId },
      data:
        order.floorFinishedAt == null
          ? { floorStage: 'FINISHED', floorFinishedAt: new Date() }
          : { floorStage: 'FINISHED' },
      include: SALES_ORDER_CODE_INCLUDE,
    });
    return this.toResponseDto(updated);
  }
}
