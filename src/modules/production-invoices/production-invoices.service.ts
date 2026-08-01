import { randomUUID } from 'crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProdApprovalStatus, ProductionInvoiceStatus } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { PlanFormsService } from '../plan-forms/plan-forms.service';
import { CreateProductionInvoiceDto } from './dto/create-production-invoice.dto';
import { CreateProductionInvoiceItemDto } from './dto/create-production-invoice-item.dto';
import { ProductionInvoiceItemResponseDto } from './dto/production-invoice-item-response.dto';
import { ProductionInvoiceResponseDto } from './dto/production-invoice-response.dto';
import { UpdateProductionInvoiceDto } from './dto/update-production-invoice.dto';

type PIWithRefs = Prisma.ProductionInvoiceGetPayload<{
  include: {
    salesOrder: true;
    items: { include: { mfgProduct: true; productVariant: true } };
  };
}>;
type PIItemWithRefs = Prisma.ProductionInvoiceItemGetPayload<{
  include: { mfgProduct: true; productVariant: true };
}>;

/**
 * Lệnh sản xuất (PI) - dịch ngược ProductionInvoiceService trong mock FE. Mỗi
 * ProductionInvoiceItem tự chạy state machine duyệt sản xuất riêng (prodApprovalStatus:
 * WAITING_QLSX -> WAITING_BOSS -> APPROVED/REJECTED). PI tự chuyển PRODUCING khi MỌI item
 * đã APPROVED.
 */
@Injectable()
export class ProductionInvoicesService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly planFormsService: PlanFormsService,
  ) {}

  async create(dto: CreateProductionInvoiceDto): Promise<ProductionInvoiceResponseDto> {
    const salesOrderBigId = dto.salesOrderId ? parseBigIntId(dto.salesOrderId) : undefined;
    if (salesOrderBigId) {
      const salesOrder = await this.prisma.salesOrder.findUnique({
        where: { id: salesOrderBigId },
      });
      if (!salesOrder) {
        throw new NotFoundException(`Sales order ${dto.salesOrderId} not found`);
      }
    }

    const placeholderCode = `PI-TMP-${randomUUID()}`;
    const created = await this.prisma.productionInvoice.create({
      data: {
        code: placeholderCode,
        salesOrderId: salesOrderBigId,
        deadline: dto.deadline ? new Date(dto.deadline) : undefined,
      },
      include: {
        salesOrder: true,
        items: { include: { mfgProduct: true, productVariant: true } },
      },
    });
    const withCode = await this.prisma.productionInvoice.update({
      where: { id: created.id },
      data: { code: `PI-${created.id}` },
      include: {
        salesOrder: true,
        items: { include: { mfgProduct: true, productVariant: true } },
      },
    });
    return this.toResponseDto(withCode);
  }

  async findAll(query: PaginationQueryDto): Promise<Paginated<ProductionInvoiceResponseDto>> {
    const where: Prisma.ProductionInvoiceWhereInput | undefined = query.search
      ? { code: { contains: query.search, mode: 'insensitive' } }
      : undefined;

    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.productionInvoice.findMany({
            ...args,
            include: {
              salesOrder: true,
              items: { include: { mfgProduct: true, productVariant: true } },
            },
          }),
        count: (args) => this.prisma.productionInvoice.count(args),
      },
      query,
      where,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { id: query.sortOrder },
    );
    return { data: result.data.map((pi) => this.toResponseDto(pi)), meta: result.meta };
  }

  async findOne(id: string): Promise<ProductionInvoiceResponseDto> {
    return this.toResponseDto(await this.findOneOrThrow(id));
  }

  async update(id: string, dto: UpdateProductionInvoiceDto): Promise<ProductionInvoiceResponseDto> {
    const bigId = parseBigIntId(id);
    await this.findOneOrThrow(id);
    const updated = await this.prisma.productionInvoice.update({
      where: { id: bigId },
      data: { deadline: dto.deadline ? new Date(dto.deadline) : undefined },
      include: {
        salesOrder: true,
        items: { include: { mfgProduct: true, productVariant: true } },
      },
    });
    return this.toResponseDto(updated);
  }

  // ─── Items ──────────────────────────────────────────────────────────────────

  async addItem(
    piId: string,
    dto: CreateProductionInvoiceItemDto,
  ): Promise<ProductionInvoiceItemResponseDto> {
    const pi = await this.findOneOrThrow(piId);
    const mfgProductBigId = parseBigIntId(dto.mfgProductId);
    const product = await this.prisma.mfgProduct.findUnique({ where: { id: mfgProductBigId } });
    if (!product) {
      throw new NotFoundException(`Product ${dto.mfgProductId} not found`);
    }

    const item = await this.prisma.productionInvoiceItem.create({
      data: {
        productionInvoiceId: pi.id,
        mfgProductId: mfgProductBigId,
        productVariantId: dto.productVariantId ? parseBigIntId(dto.productVariantId) : undefined,
        quantity: dto.quantity,
        materialDeadline: dto.materialDeadline ? new Date(dto.materialDeadline) : undefined,
        deliveryDeadline: dto.deliveryDeadline ? new Date(dto.deliveryDeadline) : undefined,
      },
      include: { mfgProduct: true, productVariant: true },
    });
    return this.toItemResponseDto(item);
  }

  /** KHSX gửi 1 SKU cho QLSX xử lý - mirror sendItemToQlsx() mock. */
  async sendItemToQlsx(
    piId: string,
    itemId: string,
    actorUserId: string,
  ): Promise<ProductionInvoiceItemResponseDto> {
    const pi = await this.findOneOrThrow(piId);
    const item = await this.findItemOrThrow(pi.id, itemId);
    this.assertNoApprovalOrRejected(item);

    const updated = await this.prisma.productionInvoiceItem.update({
      where: { id: item.id },
      data: {
        prodApprovalStatus: ProdApprovalStatus.WAITING_QLSX,
        requestedAt: new Date(),
        requestedById: actorUserId,
        rejectReason: null,
      },
      include: { mfgProduct: true, productVariant: true },
    });
    return this.toItemResponseDto(updated);
  }

  /** QLSX chọn kho thành phẩm làm điểm cuối rồi gửi Sếp duyệt - mirror sendItemToBoss() mock. */
  async sendItemToBoss(
    piId: string,
    itemId: string,
    warehouseCode: string,
    warehouseName: string,
    actorUserId: string,
  ): Promise<ProductionInvoiceItemResponseDto> {
    const pi = await this.findOneOrThrow(piId);
    const item = await this.findItemOrThrow(pi.id, itemId);
    this.assertItemStatus(item, ProdApprovalStatus.WAITING_QLSX);

    const updated = await this.prisma.productionInvoiceItem.update({
      where: { id: item.id },
      data: {
        prodApprovalStatus: ProdApprovalStatus.WAITING_BOSS,
        warehouseCode,
        warehouseName,
        qlsxAt: new Date(),
        qlsxById: actorUserId,
      },
      include: { mfgProduct: true, productVariant: true },
    });
    return this.toItemResponseDto(updated);
  }

  /**
   * Sếp duyệt cuối - SKU bắt đầu sản xuất; tạo/tái dùng PlanForm origin=PRODUCTION_CONFIRM
   * cho SKU này; PI tự chuyển PRODUCING khi mọi item đã duyệt. Mirror approveItemByBoss() mock.
   */
  async approveItem(
    piId: string,
    itemId: string,
    actorUserId: string,
  ): Promise<ProductionInvoiceItemResponseDto> {
    const pi = await this.findOneOrThrow(piId);
    const item = await this.findItemOrThrow(pi.id, itemId);
    this.assertItemStatus(item, ProdApprovalStatus.WAITING_BOSS);

    const updated = await this.prisma.productionInvoiceItem.update({
      where: { id: item.id },
      data: {
        prodApprovalStatus: ProdApprovalStatus.APPROVED,
        decidedAt: new Date(),
        decidedById: actorUserId,
      },
      include: { mfgProduct: true, productVariant: true },
    });

    if (pi.salesOrderId) {
      await this.planFormsService.ensureProductionConfirmPlanForm(
        pi.salesOrderId,
        item.mfgProductId,
        pi.id,
        actorUserId,
      );
    }

    const remaining = await this.prisma.productionInvoiceItem.count({
      where: {
        productionInvoiceId: pi.id,
        prodApprovalStatus: { not: ProdApprovalStatus.APPROVED },
      },
    });
    if (remaining === 0) {
      await this.prisma.productionInvoice.update({
        where: { id: pi.id },
        data: { status: ProductionInvoiceStatus.PRODUCING },
      });
    }

    return this.toItemResponseDto(updated);
  }

  /** Sếp từ chối - SKU quay về cho KHSX sửa thời hạn và gửi lại từ đầu. Mirror rejectItem() mock. */
  async rejectItem(
    piId: string,
    itemId: string,
    reason: string,
    actorUserId: string,
  ): Promise<ProductionInvoiceItemResponseDto> {
    const pi = await this.findOneOrThrow(piId);
    const item = await this.findItemOrThrow(pi.id, itemId);
    this.assertItemStatus(item, ProdApprovalStatus.WAITING_BOSS);

    const updated = await this.prisma.productionInvoiceItem.update({
      where: { id: item.id },
      data: {
        prodApprovalStatus: ProdApprovalStatus.REJECTED,
        rejectReason: reason,
        decidedAt: new Date(),
        decidedById: actorUserId,
      },
      include: { mfgProduct: true, productVariant: true },
    });
    return this.toItemResponseDto(updated);
  }

  // ─── Shared lookups / guards ──────────────────────────────────────────────

  private async findOneOrThrow(id: string): Promise<PIWithRefs> {
    const bigId = parseBigIntId(id);
    const pi = await this.prisma.productionInvoice.findUnique({
      where: { id: bigId },
      include: {
        salesOrder: true,
        items: { include: { mfgProduct: true, productVariant: true } },
      },
    });
    if (!pi) {
      throw new NotFoundException(`Production invoice ${id} not found`);
    }
    return pi;
  }

  private async findItemOrThrow(piId: bigint, id: string): Promise<PIItemWithRefs> {
    const idBigId = parseBigIntId(id);
    const item = await this.prisma.productionInvoiceItem.findUnique({
      where: { id: idBigId },
      include: { mfgProduct: true, productVariant: true },
    });
    if (!item || item.productionInvoiceId !== piId) {
      throw new NotFoundException(`Production invoice item ${id} not found on PI ${piId}`);
    }
    return item;
  }

  /** sendItemToQlsx: gửi lại được khi chưa từng gửi hoặc vừa bị Sếp từ chối - mirror mock. */
  private assertNoApprovalOrRejected(item: PIItemWithRefs): void {
    if (item.prodApprovalStatus && item.prodApprovalStatus !== ProdApprovalStatus.REJECTED) {
      throw new ConflictException(
        `Item ${item.id} đang ở trạng thái ${item.prodApprovalStatus}, không thể gửi lại QLSX`,
      );
    }
  }

  private assertItemStatus(item: PIItemWithRefs, expected: ProdApprovalStatus): void {
    if (item.prodApprovalStatus !== expected) {
      throw new ConflictException(
        `Item ${item.id} phải ở trạng thái ${expected} (đang là ${item.prodApprovalStatus ?? 'chưa gửi'})`,
      );
    }
  }

  private toResponseDto(pi: PIWithRefs): ProductionInvoiceResponseDto {
    return new ProductionInvoiceResponseDto({
      id: pi.id.toString(),
      code: pi.code,
      salesOrderId: pi.salesOrderId?.toString() ?? null,
      salesOrderCode: pi.salesOrder?.code ?? null,
      status: pi.status,
      deadline: pi.deadline,
      createdAt: pi.createdAt,
      updatedAt: pi.updatedAt,
      items: pi.items.map((it) => this.toItemResponseDto(it)),
    });
  }

  private toItemResponseDto(item: PIItemWithRefs): ProductionInvoiceItemResponseDto {
    return new ProductionInvoiceItemResponseDto({
      id: item.id.toString(),
      productionInvoiceId: item.productionInvoiceId.toString(),
      mfgProductId: item.mfgProductId.toString(),
      factoryCode: item.mfgProduct.factoryCode,
      productName: item.mfgProduct.name,
      productVariantId: item.productVariantId?.toString() ?? null,
      colorCode: item.productVariant?.colorCode ?? null,
      quantity: item.quantity,
      materialDeadline: item.materialDeadline,
      deliveryDeadline: item.deliveryDeadline,
      prodApprovalStatus: item.prodApprovalStatus,
      requestedAt: item.requestedAt,
      requestedById: item.requestedById,
      warehouseCode: item.warehouseCode,
      warehouseName: item.warehouseName,
      qlsxAt: item.qlsxAt,
      qlsxById: item.qlsxById,
      decidedAt: item.decidedAt,
      decidedById: item.decidedById,
      rejectReason: item.rejectReason,
    });
  }
}
