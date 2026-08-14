import { randomUUID } from 'crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { nextProductionInvoiceCode } from '../../common/utils/production-invoice-code.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { CreateSalesOrderItemDto } from './dto/create-sales-order-item.dto';
import { SalesOrderResponseDto } from './dto/sales-order-response.dto';
import { SalesOrderItemResponseDto } from './dto/sales-order-item-response.dto';
import { ShipSalesOrderItemDto } from './dto/ship-sales-order-item.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { UpdateSalesOrderItemDto } from './dto/update-sales-order-item.dto';

type SalesOrderWithItems = Prisma.SalesOrderGetPayload<{
  include: { customer: true; items: { include: { mfgProduct: true } } };
}>;
type SalesOrderItemWithProduct = Prisma.SalesOrderItemGetPayload<{ include: { mfgProduct: true } }>;

/**
 * Hợp nhất "salesPOs" (Sales module) + "exportOrders" (Mfg module) của mock thành 1 bảng
 * duy nhất - 2 bảng đó trước chỉ khớp nhau qua so sánh chuỗi poNumber/code, không FK thật.
 * `code` sinh sau khi tạo (PO-{id}) vì id tự tăng chỉ có sau INSERT - dùng placeholder
 * UUID tạm thời để không đụng constraint unique khi vừa insert (xem create()).
 */
@Injectable()
export class SalesOrdersService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async create(dto: CreateSalesOrderDto): Promise<SalesOrderResponseDto> {
    const customerBigId = parseBigIntId(dto.customerId);
    const customer = await this.prisma.customer.findUnique({ where: { id: customerBigId } });
    if (!customer) {
      throw new NotFoundException(`Customer ${dto.customerId} not found`);
    }
    await this.assertProductsExist(dto.items);

    const deliveryDate = this.maxDeliveryDate(dto.items);
    const placeholderCode = `PO-TMP-${randomUUID()}`;

    const created = await this.prisma.salesOrder.create({
      data: {
        code: placeholderCode,
        customerId: customerBigId,
        orderDate: new Date(dto.orderDate),
        deliveryDate,
        attachmentName: dto.attachmentName,
        attachmentUrl: dto.attachmentUrl,
        note: dto.note,
        items: {
          create: dto.items.map((it) => ({
            mfgProductId: parseBigIntId(it.mfgProductId),
            skuName: it.skuName,
            totalQty: it.totalQty,
            deliveryDate: it.deliveryDate ? new Date(it.deliveryDate) : undefined,
          })),
        },
      },
      include: { customer: true, items: { include: { mfgProduct: true } } },
    });

    const withCode = await this.prisma.salesOrder.update({
      where: { id: created.id },
      data: { code: `PO-${created.id}` },
      include: { customer: true, items: { include: { mfgProduct: true } } },
    });

    await this.createLinkedProductionInvoice(withCode);

    return this.toResponseDto(withCode);
  }

  async findAll(query: PaginationQueryDto): Promise<Paginated<SalesOrderResponseDto>> {
    const where: Prisma.SalesOrderWhereInput | undefined = query.search
      ? { code: { contains: query.search, mode: 'insensitive' } }
      : undefined;

    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.salesOrder.findMany({
            ...args,
            include: { customer: true, items: { include: { mfgProduct: true } } },
          }),
        count: (args) => this.prisma.salesOrder.count(args),
      },
      query,
      where,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { id: query.sortOrder },
    );

    return { data: result.data.map((o) => this.toResponseDto(o)), meta: result.meta };
  }

  async findOne(id: string): Promise<SalesOrderResponseDto> {
    return this.toResponseDto(await this.findOneOrThrow(id));
  }

  async update(id: string, dto: UpdateSalesOrderDto): Promise<SalesOrderResponseDto> {
    const bigId = parseBigIntId(id);
    await this.findOneOrThrow(id);

    const updated = await this.prisma.salesOrder.update({
      where: { id: bigId },
      data: {
        attachmentName: dto.attachmentName,
        attachmentUrl: dto.attachmentUrl,
        note: dto.note,
        depositConfirmed: dto.depositConfirmed,
        isActive: dto.isActive,
      },
      include: { customer: true, items: { include: { mfgProduct: true } } },
    });
    return this.toResponseDto(updated);
  }

  async remove(id: string): Promise<void> {
    const bigId = parseBigIntId(id);
    await this.findOneOrThrow(id);
    await this.prisma.salesOrder.delete({ where: { id: bigId } }); // soft-delete (SOFT_DELETE_MODELS)
  }

  // ─── Items ──────────────────────────────────────────────────────────────────

  async addItem(
    salesOrderId: string,
    dto: CreateSalesOrderItemDto,
  ): Promise<SalesOrderItemResponseDto> {
    const order = await this.findOneOrThrow(salesOrderId);
    await this.assertProductsExist([dto]);

    const item = await this.prisma.salesOrderItem.create({
      data: {
        salesOrderId: order.id,
        mfgProductId: parseBigIntId(dto.mfgProductId),
        skuName: dto.skuName,
        totalQty: dto.totalQty,
        deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : undefined,
      },
      include: { mfgProduct: true },
    });
    await this.recomputeDeliveryDate(order.id);
    return this.toItemResponseDto(item);
  }

  async updateItem(
    salesOrderId: string,
    id: string,
    dto: UpdateSalesOrderItemDto,
  ): Promise<SalesOrderItemResponseDto> {
    const order = await this.findOneOrThrow(salesOrderId);
    const item = await this.findItemOrThrow(order.id, id);

    const updated = await this.prisma.salesOrderItem.update({
      where: { id: item.id },
      data: {
        skuName: dto.skuName,
        totalQty: dto.totalQty,
        status: dto.status,
        deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : undefined,
      },
      include: { mfgProduct: true },
    });
    if (dto.deliveryDate) await this.recomputeDeliveryDate(order.id);
    return this.toItemResponseDto(updated);
  }

  /**
   * Ship 1 phần/toàn bộ số lượng của item - cộng dồn qua nhiều lần xuất hàng, có thể gọi song
   * song từ nhiều thao tác ship gần như đồng thời. Trước đây updateItem() nhận shippedQty như
   * 1 giá trị tuyệt đối do client tự tính (đọc số hiện tại + cộng rồi gửi lên) - 2 request cùng
   * đọc 1 giá trị cũ rồi ghi đè sẽ mất mát 1 lần cộng (lost-update). Ở đây phép cộng và điều
   * kiện trần (không vượt totalQty) nằm chung 1 câu UPDATE, Postgres khoá dòng trong lúc ghi nên
   * không có khoảng hở giữa "đọc để kiểm tra" và "ghi" để 2 request cùng vượt trần.
   */
  async shipItem(
    salesOrderId: string,
    itemId: string,
    dto: ShipSalesOrderItemDto,
  ): Promise<SalesOrderItemResponseDto> {
    const orderBigId = parseBigIntId(salesOrderId);
    const itemBigId = parseBigIntId(itemId);

    const updated = await this.prisma.$queryRaw<{ id: bigint }[]>`
      UPDATE "sales_order_items"
      SET "shippedQty" = "shippedQty" + ${dto.qty}
      WHERE "id" = ${itemBigId}
        AND "salesOrderId" = ${orderBigId}
        AND "shippedQty" + ${dto.qty} <= "totalQty"
      RETURNING "id"
    `;

    if (updated.length === 0) {
      const item = await this.prisma.salesOrderItem.findUnique({ where: { id: itemBigId } });
      if (!item || item.salesOrderId !== orderBigId) {
        throw new NotFoundException(
          `Sales order item ${itemId} not found on order ${salesOrderId}`,
        );
      }
      throw new ConflictException(
        `Ship ${dto.qty} vượt quá số lượng còn lại (đã ship ${item.shippedQty}/${item.totalQty})`,
      );
    }

    return this.toItemResponseDto(await this.findItemOrThrow(orderBigId, itemId));
  }

  /**
   * Mirror hành vi mock (OrderManagementPage tự tạo "ProductionInvoice" ngay khi tạo PO):
   * mỗi PO sinh đúng 1 PI 1-1 (salesOrderId) để productplan@demo.com xử lý ở LenhSXPage.
   * Tạo ở đây (không qua ProductionInvoicesController) để SALES_STAFF không cần thêm quyền
   * PRODUCTION_INVOICE:CREATE chỉ vì hệ quả phụ này.
   */
  private async createLinkedProductionInvoice(order: SalesOrderWithItems): Promise<void> {
    const code = await nextProductionInvoiceCode(this.prisma);
    await this.prisma.productionInvoice.create({
      data: {
        code,
        salesOrderId: order.id,
        deadline: order.deliveryDate,
        items: {
          create: order.items.map((it) => ({
            mfgProductId: it.mfgProductId,
            quantity: it.totalQty,
            deliveryDeadline: it.deliveryDate,
          })),
        },
      },
    });
  }

  // ─── Shared lookups ─────────────────────────────────────────────────────────

  private async findOneOrThrow(id: string): Promise<SalesOrderWithItems> {
    const bigId = parseBigIntId(id);
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: bigId },
      include: { customer: true, items: { include: { mfgProduct: true } } },
    });
    if (!order) {
      throw new NotFoundException(`Sales order ${id} not found`);
    }
    return order;
  }

  private async findItemOrThrow(
    salesOrderId: bigint,
    id: string,
  ): Promise<SalesOrderItemWithProduct> {
    const idBigId = parseBigIntId(id);
    const item = await this.prisma.salesOrderItem.findUnique({
      where: { id: idBigId },
      include: { mfgProduct: true },
    });
    if (!item || item.salesOrderId !== salesOrderId) {
      throw new NotFoundException(`Sales order item ${id} not found on order ${salesOrderId}`);
    }
    return item;
  }

  private async assertProductsExist(items: { mfgProductId: string }[]): Promise<void> {
    for (const it of items) {
      const bigId = parseBigIntId(it.mfgProductId);
      const product = await this.prisma.mfgProduct.findUnique({ where: { id: bigId } });
      if (!product) {
        throw new NotFoundException(`Product ${it.mfgProductId} not found`);
      }
    }
  }

  /** deliveryDate của đơn = deliveryDate xa nhất trong các dòng SKU - mirror SalesPO mock. */
  private maxDeliveryDate(items: { deliveryDate?: string }[]): Date | undefined {
    const dates = items.map((it) => it.deliveryDate).filter((d): d is string => !!d);
    if (dates.length === 0) return undefined;
    return new Date(dates.sort().at(-1)!);
  }

  private async recomputeDeliveryDate(salesOrderId: bigint): Promise<void> {
    const items = await this.prisma.salesOrderItem.findMany({
      where: { salesOrderId },
      select: { deliveryDate: true },
    });
    const dates = items.map((it) => it.deliveryDate).filter((d): d is Date => !!d);
    if (dates.length === 0) return;
    const deliveryDate = new Date(Math.max(...dates.map((d) => d.getTime())));
    await this.prisma.salesOrder.update({ where: { id: salesOrderId }, data: { deliveryDate } });
  }

  private toResponseDto(order: SalesOrderWithItems): SalesOrderResponseDto {
    return new SalesOrderResponseDto({
      id: order.id.toString(),
      code: order.code,
      customerId: order.customerId.toString(),
      customerName: order.customer.name,
      orderDate: order.orderDate,
      deliveryDate: order.deliveryDate,
      depositAmount: order.depositAmount.toNumber(),
      depositConfirmed: order.depositConfirmed,
      paidAmount: order.paidAmount.toNumber(),
      attachmentName: order.attachmentName,
      attachmentUrl: order.attachmentUrl,
      note: order.note,
      isActive: order.isActive,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      items: order.items.map((it) => this.toItemResponseDto(it)),
    });
  }

  private toItemResponseDto(item: SalesOrderItemWithProduct): SalesOrderItemResponseDto {
    return new SalesOrderItemResponseDto({
      id: item.id.toString(),
      salesOrderId: item.salesOrderId.toString(),
      mfgProductId: item.mfgProductId.toString(),
      factoryCode: item.mfgProduct.factoryCode,
      skuName: item.skuName,
      totalQty: item.totalQty,
      shippedQty: item.shippedQty,
      status: item.status,
      deliveryDate: item.deliveryDate,
    });
  }
}
