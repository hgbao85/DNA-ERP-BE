import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { BomRevisionStatus, Prisma } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { ProductionOrderResponseDto } from './dto/production-order-response.dto';

type ProductionOrderRow = Prisma.ProductionOrderGetPayload<object>;

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

    const created = await this.prisma.productionOrder.create({
      data: {
        poNumber: `PENDING-${productionInvoiceItemId}`,
        productionInvoiceItemId,
        mfgProductId,
        bomRevisionId: activeRevision.id,
        quantity,
      },
    });
    return this.prisma.productionOrder.update({
      where: { id: created.id },
      data: { poNumber: `PO-${created.id}` },
    });
  }

  async findAll(query: PaginationQueryDto): Promise<Paginated<ProductionOrderResponseDto>> {
    const result = await paginate(
      {
        findMany: (args) => this.prisma.productionOrder.findMany(args),
        count: (args) => this.prisma.productionOrder.count(args),
      },
      query,
      undefined,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { id: query.sortOrder },
    );

    return { data: result.data.map((o) => this.toResponseDto(o)), meta: result.meta };
  }

  async findOne(id: string): Promise<ProductionOrderResponseDto> {
    return this.toResponseDto(await this.findOneOrThrow(id));
  }

  async findOneOrThrow(id: string): Promise<ProductionOrderRow> {
    const bigId = parseBigIntId(id);
    const order = await this.prisma.productionOrder.findUnique({ where: { id: bigId } });
    if (!order) {
      throw new NotFoundException(`Production order ${id} not found`);
    }
    return order;
  }

  private toResponseDto(order: ProductionOrderRow): ProductionOrderResponseDto {
    return new ProductionOrderResponseDto({
      id: order.id.toString(),
      poNumber: order.poNumber,
      productionInvoiceItemId: order.productionInvoiceItemId.toString(),
      mfgProductId: order.mfgProductId.toString(),
      bomRevisionId: order.bomRevisionId.toString(),
      quantity: order.quantity,
      status: order.status,
      releasedAt: order.releasedAt,
      createdAt: order.createdAt,
    });
  }
}
