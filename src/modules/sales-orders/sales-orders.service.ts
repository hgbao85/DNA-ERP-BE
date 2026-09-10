import { randomUUID } from 'crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
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

    await this.createProductionInvoiceItems(withCode);
    await this.linkExistingSkus(withCode);

    // Vừa tạo xong trong chính lệnh gọi này - không thể đã gộp PI/đã giao hàng, khỏi cần query.
    return this.toResponseDto(withCode, null);
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

    // Đính chính audit toàn diện 10/09 (disable nút Xoá khi biết trước sẽ bị chặn): 1 query gộp
    // theo TOÀN BỘ orderIds của trang hiện tại thay vì count() riêng từng order (N+1) - chỉ cần
    // biết CÓ gộp PI hay không cho danh sách, không cần đúng số lượng (số chính xác chỉ quan
    // trọng ở remove()/findOne(), nơi đã count() riêng cho đúng 1 order).
    const orderIds = result.data.map((o) => o.id);
    const merged = await this.prisma.productionInvoiceItem.findMany({
      where: {
        productionInvoiceId: { not: null },
        OR: [
          { salesOrderId: { in: orderIds } },
          { productionInvoice: { salesOrderId: { in: orderIds } } },
        ],
      },
      select: { salesOrderId: true, productionInvoice: { select: { salesOrderId: true } } },
    });
    const mergedIds = new Set(
      merged.flatMap((m) =>
        [m.salesOrderId, m.productionInvoice?.salesOrderId].filter((x): x is bigint => x != null),
      ),
    );

    return {
      data: result.data.map((o) =>
        this.toResponseDto(
          o,
          this.buildDeleteBlockReason(o.code, o.items, mergedIds.has(o.id) ? 1 : 0),
        ),
      ),
      meta: result.meta,
    };
  }

  async findOne(id: string): Promise<SalesOrderResponseDto> {
    const order = await this.findOneOrThrow(id);
    const mergedCount = await this.countMergedProductionInvoiceItems(order.id);
    return this.toResponseDto(
      order,
      this.buildDeleteBlockReason(order.code, order.items, mergedCount),
    );
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
    const mergedCount = await this.countMergedProductionInvoiceItems(bigId);
    return this.toResponseDto(
      updated,
      this.buildDeleteBlockReason(updated.code, updated.items, mergedCount),
    );
  }

  /**
   * Đính chính audit toàn diện 09/09 (Trung bình/Bán hàng): trước đây xoá không kiểm tra gì cả -
   * đơn hàng "biến mất" khỏi mọi danh sách Sales (soft-delete lọc deletedAt) nhưng
   * ProductionInvoiceItem/PlanForm/ProductionInvoice liên quan vẫn còn nguyên, mất khả năng tra
   * "định mức/lệnh sản xuất này của khách nào" trong khi nhà máy vẫn sản xuất/giao hàng thật.
   * Ngưỡng "đã đưa vào sản xuất" = đã gộp vào 1 PI (productionInvoiceId != null, qua
   * mergeItems()/claimSolo()) - KHÔNG dùng "tồn tại ProductionInvoiceItem" làm mốc vì
   * createProductionInvoiceItems() (create(), dòng ~70) đã tạo sẵn 1 dòng cho MỌI item ngay lúc
   * Sales lưu đơn (productionInvoiceId=null lúc đầu) - dùng "tồn tại" sẽ chặn xoá mọi đơn hàng kể
   * cả vừa tạo xong.
   *
   * 10/09: gom logic chặn vào buildDeleteBlockReason() (dùng chung với findAll()/findOne()/update()
   * để hiển thị TRƯỚC qua deleteBlockedReason, cho FE disable nút Xoá thay vì để bấm rồi mới báo
   * lỗi) - hành vi/message ném ra ở đây không đổi so với trước.
   */
  async remove(id: string): Promise<void> {
    const bigId = parseBigIntId(id);
    const order = await this.findOneOrThrow(id);

    const mergedCount = await this.countMergedProductionInvoiceItems(bigId);
    const reason = this.buildDeleteBlockReason(order.code, order.items, mergedCount);
    if (reason) {
      throw new ConflictException(reason);
    }

    // Guard trên đã đảm bảo MỌI ProductionInvoiceItem của đơn có productionInvoiceId = null (chưa
    // gộp PI) - 4 bảng con của nó (stages/productionOrder/transferCheckResults/packagingRecords)
    // đều bắt buộc PI thật mới ghi được (xem production-invoices.service.ts
    // findItemOrThrow()/findProductionOrderOrThrow()) nên chắc chắn rỗng, xoá thẳng không vi phạm
    // FK (Prisma default Restrict, không Cascade, cho các FK đó). Cùng lý do, bất kỳ
    // ProductionInvoice (vỏ PI, tạo qua POST /production-invoices) nào còn salesOrderId trỏ về đơn
    // này chắc chắn 0 item - an toàn xoá thẳng.
    //
    // 10/09: SalesOrder đã bỏ khỏi SOFT_DELETE_MODELS theo yêu cầu người dùng - salesOrder.delete()
    // dưới đây giờ là hard delete THẬT (không còn tự rewrite thành update deletedAt). Vì vậy phải
    // dọn/gỡ hết các bảng còn FK trỏ tới trước khi xoá, nếu không Postgres sẽ chặn (FK Restrict).
    // PlanForm/Sku đã gắn qua linkExistingSkus() (nếu có) KHÔNG bị xoá - dữ liệu độc lập của KHSX
    // (định mức, lịch sử duyệt...), có trước cả PO này - chỉ GỠ LIÊN KẾT (salesOrderId = null) để
    // hết trỏ tới đơn sắp xoá, SKU đó vẫn còn nguyên, sẵn sàng gắn cho đơn khác sau này.
    await this.prisma.$transaction(async (tx) => {
      const linkedSkus = await tx.planForm.findMany({ where: { salesOrderId: bigId } });
      for (const sku of linkedSkus) {
        await tx.planForm.update({ where: { id: sku.id }, data: { salesOrderId: null } });
      }

      await tx.productionInvoice.deleteMany({ where: { salesOrderId: bigId } });
      await tx.productionInvoiceItem.deleteMany({ where: { salesOrderId: bigId } });
      await tx.salesOrderItem.deleteMany({ where: { salesOrderId: bigId } });
      await tx.salesOrder.delete({ where: { id: bigId } }); // hard delete thật
    });
  }

  /**
   * OR: [{salesOrderId}, {productionInvoice:{salesOrderId}}] mirror đúng updateItem() (dòng
   * 199-204) - ProductionInvoiceItem.salesOrderId ghim thẳng PO gốc (PI gộp), còn
   * productionInvoice.salesOrderId phủ trường hợp PI không-gộp 1-1.
   */
  private async countMergedProductionInvoiceItems(bigId: bigint): Promise<number> {
    return this.prisma.productionInvoiceItem.count({
      where: {
        productionInvoiceId: { not: null },
        OR: [{ salesOrderId: bigId }, { productionInvoice: { salesOrderId: bigId } }],
      },
    });
  }

  /**
   * Message lý do chặn xoá - dùng chung cho remove() (ném ConflictException) và
   * findAll()/findOne()/update() (hiển thị TRƯỚC qua deleteBlockedReason) để không lệch nội
   * dung/logic giữa "báo trước" và "chặn thật lúc xoá". `mergedCount` truyền `1` (không cần đúng
   * số) khi gọi từ findAll() - xem chỗ gọi.
   */
  private buildDeleteBlockReason(
    code: string,
    items: { shippedQty: number; totalQty: number; skuName: string | null; mfgProductId: bigint }[],
    mergedCount: number,
  ): string | null {
    if (mergedCount > 0) {
      return (
        `Đơn hàng ${code} có ${mergedCount} dòng đã được KHSX gộp vào Phiếu sản xuất - ` +
        `không thể xoá, sẽ mất dấu vết trong khi nhà máy vẫn đang sản xuất theo đơn này.`
      );
    }
    const shippedItem = items.find((it) => it.shippedQty > 0);
    if (shippedItem) {
      return (
        `Đơn hàng ${code} đã giao ${shippedItem.shippedQty}/${shippedItem.totalQty} cho ` +
        `dòng "${shippedItem.skuName ?? shippedItem.mfgProductId}" - không thể xoá đơn đã giao hàng một phần.`
      );
    }
    return null;
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

    // Medium fix: totalQty trước đây sửa được vô hạn định, kể cả sau khi đã ghim vào
    // ProductionInvoiceItem.quantity (chỉ ghim 1 lần lúc PI được tạo, không tự đồng bộ lại) -
    // sản xuất làm theo số cũ trong khi đơn hàng thực tế đã đổi, không ai được cảnh báo. Join
    // qua CẢ item.salesOrderId (PI gộp, ghim thẳng) LẪN productionInvoice.salesOrderId (PI
    // thường tạo qua resolveProductionInvoice() - xem skus.service.ts, không set field trên item)
    // vì tuỳ đường tạo mà field nào có giá trị.
    if (dto.totalQty !== undefined && dto.totalQty !== item.totalQty) {
      const linked = await this.prisma.productionInvoiceItem.findFirst({
        where: {
          mfgProductId: item.mfgProductId,
          OR: [{ salesOrderId: order.id }, { productionInvoice: { salesOrderId: order.id } }],
        },
      });
      if (linked) {
        throw new ConflictException(
          `Sản phẩm ${item.mfgProduct.factoryCode} của đơn hàng ${order.id} đã ghim vào lệnh sản xuất (PI item ${linked.id}) - không thể tự sửa số lượng, liên hệ KHSX để xử lý qua quy trình khác`,
        );
      }
    }

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
   * Tạo sẵn ProductionInvoiceItem cho từng dòng PO ngay lúc Sales lưu đơn - GIỮ nguyên mọi máy
   * theo dõi nghiệp vụ (prodApprovalStatus, stages, BOM preview ở "Tối ưu cắt sắt"...) vốn neo
   * trên bảng này. KHÁC trước (2026-08-20): KHÔNG còn bọc sẵn trong 1 ProductionInvoice -
   * productionInvoiceId để NULL. PI tự sinh ngay lúc tạo PO khiến "Lệnh sản xuất mới" của KHSX lộ
   * ra cả đơn hàng chưa xác nhận cọc, chưa chắc chắn về mặt thương mại. Từ nay PI chỉ sinh khi
   * KHSX chủ động gom qua GomDotCatPage ("Xác nhận gộp" gọi mergeItems(), "Tiến hành cắt riêng"
   * gọi claimSolo() - xem production-invoices.service.ts).
   */
  private async createProductionInvoiceItems(order: SalesOrderWithItems): Promise<void> {
    await this.prisma.productionInvoiceItem.createMany({
      data: order.items.map((it) => ({
        productionInvoiceId: null,
        mfgProductId: it.mfgProductId,
        salesOrderId: order.id,
        quantity: it.totalQty,
        deliveryDeadline: it.deliveryDate,
      })),
    });
  }

  /**
   * Gắn PO vừa tạo vào SKU (PlanForm) đã có sẵn cho đúng sản phẩm này - trường hợp KHSX tạo
   * SKU trước ("Tạo SKU mới"), Sales tham chiếu tới sau khi lên PO (xem PlanForm.salesOrderId
   * doc: "KHSX tạo trước, đơn hàng tham chiếu tới sau"). Chỉ có tác dụng với SKU CHƯA gắn đơn
   * hàng nào (salesOrderId null) - không được ghi đè PO đã gắn từ trước. Nhiều SKU cùng sản
   * phẩm, cùng chưa gắn đơn thì lấy SKU tạo sớm nhất (id nhỏ nhất) - đơn giản, tất định, mirror
   * "SKU độc lập với Sales Order" (skus.service.ts create) - PO chỉ gắn khi có ai đó chủ động
   * chọn, không tự suy luận theo tên khách hàng. productionInvoiceId để NULL (2026-08-20, cùng
   * lý do createProductionInvoiceItems()) - PI gắn sau, lúc KHSX gom.
   */
  private async linkExistingSkus(order: SalesOrderWithItems): Promise<void> {
    for (const item of order.items) {
      const candidate = await this.prisma.planForm.findFirst({
        where: { mfgProductId: item.mfgProductId, salesOrderId: null },
        orderBy: { id: 'asc' },
      });
      if (!candidate) continue;
      await this.prisma.planForm.update({
        where: { id: candidate.id },
        data: { salesOrderId: order.id, productionInvoiceId: null },
      });
    }
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

  private toResponseDto(
    order: SalesOrderWithItems,
    deleteBlockedReason: string | null,
  ): SalesOrderResponseDto {
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
      deleteBlockedReason,
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
