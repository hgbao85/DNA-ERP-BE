import { randomUUID } from 'crypto';
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, ProdApprovalStatus, ProductionInvoiceStatus } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CuttingProposalsService } from '../cutting-proposals/cutting-proposals.service';
import { ProductionOrdersService } from '../production-orders/production-orders.service';
import { SkusService } from '../skus/skus.service';
import { CreateProductionInvoiceDto } from './dto/create-production-invoice.dto';
import { CreateProductionInvoiceItemDto } from './dto/create-production-invoice-item.dto';
import { ProductionInvoiceItemResponseDto } from './dto/production-invoice-item-response.dto';
import { ProductionInvoiceResponseDto } from './dto/production-invoice-response.dto';
import { RecordTransferCheckDto } from './dto/record-transfer-check.dto';
import { TransferCheckPieceResponseDto } from './dto/transfer-check-piece-response.dto';
import { UpdateProductionInvoiceDto } from './dto/update-production-invoice.dto';
import { UpdateProductionInvoiceItemDto } from './dto/update-production-invoice-item.dto';

type PIWithRefs = Prisma.ProductionInvoiceGetPayload<{
  include: {
    salesOrder: true;
    items: { include: { mfgProduct: true; productVariant: true; stages: true } };
  };
}>;
type PIItemWithRefs = Prisma.ProductionInvoiceItemGetPayload<{
  include: { mfgProduct: true; productVariant: true; stages: true };
}>;

/**
 * Lệnh sản xuất (PI) - dịch ngược ProductionInvoiceService trong mock FE. Mỗi
 * ProductionInvoiceItem tự chạy state machine duyệt sản xuất riêng (prodApprovalStatus:
 * WAITING_QLSX -> WAITING_BOSS -> APPROVED/REJECTED). PI tự chuyển PRODUCING khi MỌI item
 * đã APPROVED.
 */
@Injectable()
export class ProductionInvoicesService {
  private readonly logger = new Logger(ProductionInvoicesService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly skusService: SkusService,
    private readonly productionOrdersService: ProductionOrdersService,
    private readonly cuttingProposalsService: CuttingProposalsService,
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
        items: { include: { mfgProduct: true, productVariant: true, stages: true } },
      },
    });
    const withCode = await this.prisma.productionInvoice.update({
      where: { id: created.id },
      data: { code: `PI-${created.id}` },
      include: {
        salesOrder: true,
        items: { include: { mfgProduct: true, productVariant: true, stages: true } },
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
              items: { include: { mfgProduct: true, productVariant: true, stages: true } },
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
        items: { include: { mfgProduct: true, productVariant: true, stages: true } },
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
      include: { mfgProduct: true, productVariant: true, stages: true },
    });
    return this.toItemResponseDto(item);
  }

  /**
   * KHSX sửa thời hạn kế hoạch của 1 SKU (LenhSXPage "Sửa thời hạn") - materialDeadline/
   * deliveryDeadline ghi thẳng lên item, còn `stages` (Khung cơ khí/Đan/Đóng gói) upsert theo
   * unique (productionInvoiceItemId, stageType) vì đây là mốc kế hoạch do KHSX đặt, không phải
   * tiến độ thực thi Phôi/Hàn/Sơn thật (domain đó chưa tồn tại - xem ProdItemStageType).
   */
  async updateItem(
    piId: string,
    itemId: string,
    dto: UpdateProductionInvoiceItemDto,
  ): Promise<ProductionInvoiceItemResponseDto> {
    const pi = await this.findOneOrThrow(piId);
    const item = await this.findItemOrThrow(pi.id, itemId);

    await this.prisma.$transaction(async (tx) => {
      if (dto.materialDeadline || dto.deliveryDeadline) {
        await tx.productionInvoiceItem.update({
          where: { id: item.id },
          data: {
            materialDeadline: dto.materialDeadline ? new Date(dto.materialDeadline) : undefined,
            deliveryDeadline: dto.deliveryDeadline ? new Date(dto.deliveryDeadline) : undefined,
          },
        });
      }
      for (const stage of dto.stages ?? []) {
        await tx.productionInvoiceItemStage.upsert({
          where: {
            productionInvoiceItemId_stageType: {
              productionInvoiceItemId: item.id,
              stageType: stage.stageType,
            },
          },
          create: {
            productionInvoiceItemId: item.id,
            stageType: stage.stageType,
            deadline: new Date(stage.deadline),
          },
          update: { deadline: new Date(stage.deadline) },
        });
      }
    });

    const updated = await this.findItemOrThrow(pi.id, itemId);
    return this.toItemResponseDto(updated);
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
      include: { mfgProduct: true, productVariant: true, stages: true },
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
      include: { mfgProduct: true, productVariant: true, stages: true },
    });
    return this.toItemResponseDto(updated);
  }

  /**
   * Sếp duyệt cuối - SKU bắt đầu sản xuất; tạo/tái dùng PlanForm origin=PRODUCTION_CONFIRM
   * cho SKU này; PI tự chuyển PRODUCING khi mọi item đã duyệt. Mirror approveItemByBoss() mock.
   * Ném ConflictException NGAY (không ghi gì) nếu sản phẩm chưa có BomRevision ACTIVE - xem
   * ProductionOrdersService.assertActiveBomRevisionExists().
   */
  async approveItem(
    piId: string,
    itemId: string,
    actorUserId: string,
  ): Promise<ProductionInvoiceItemResponseDto> {
    const pi = await this.findOneOrThrow(piId);
    const item = await this.findItemOrThrow(pi.id, itemId);
    this.assertItemStatus(item, ProdApprovalStatus.WAITING_BOSS);

    // Duyệt SKU luôn kéo theo tạo ProductionOrder (xem dưới) - kiểm BOM active TRƯỚC khi ghi gì,
    // để thiếu BOM chặn đúng hành động duyệt (409, có lý do rõ ràng) thay vì duyệt xong rồi mới
    // âm thầm phát hiện ở bước tạo ProductionOrder - lỗ hổng đã xác nhận, xem
    // assertActiveBomRevisionExists().
    await this.productionOrdersService.assertActiveBomRevisionExists(item.mfgProductId);

    const updated = await this.prisma.productionInvoiceItem.update({
      where: { id: item.id },
      data: {
        prodApprovalStatus: ProdApprovalStatus.APPROVED,
        decidedAt: new Date(),
        decidedById: actorUserId,
      },
      include: { mfgProduct: true, productVariant: true, stages: true },
    });

    if (pi.salesOrderId) {
      await this.skusService.ensureProductionConfirmPlanForm(
        pi.salesOrderId,
        item.mfgProductId,
        pi.id,
        actorUserId,
      );
    }

    // Phase 7: tạo lệnh sản xuất ngay khi Sếp duyệt - BOM đã được xác nhận tồn tại ở trên nên
    // gần như chắc chắn thành công (chỉ fail nếu có race hiếm - BOM bị deactivate đúng khoảnh
    // khắc giữa 2 lệnh); log to nếu vẫn xảy ra vì giờ đây không còn là hành vi "biết trước, chấp
    // nhận được" như cũ nữa.
    let productionOrder: { id: bigint } | undefined;
    try {
      productionOrder = await this.productionOrdersService.createFromApproval(
        item.id,
        item.mfgProductId,
        item.quantity,
      );
    } catch (error) {
      this.logger.error(
        `ProductionOrder creation failed unexpectedly for PI item ${item.id} despite BOM check: ${(error as Error).message}`,
      );
    }

    // Trigger đề xuất cắt sắt tự động/ngầm - tách try/catch riêng, best-effort thật sự (không có
    // màn hình riêng, không được phép làm hỏng việc duyệt SKU đã ghi ở trên dù ProductionOrder
    // đã tạo thành công).
    if (productionOrder) {
      try {
        await this.cuttingProposalsService.requestForOrder(productionOrder.id, {
          requestedById: actorUserId,
        });
      } catch (error) {
        this.logger.error(
          `Auto cutting-proposal trigger failed for PI item ${item.id}: ${(error as Error).message}`,
        );
      }
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

  /**
   * QLSX từ chối ngay ở bước chọn kho (chưa kịp gửi Sếp) - SKU quay về cho KHSX sửa thời hạn và
   * gửi lại từ đầu, giống hệt đường Sếp từ chối (rejectItem) - cùng field `prodApprovalStatus:
   * REJECTED`/`rejectReason`/`decidedAt`/`decidedById`, KHSX không cần phân biệt ai từ chối.
   */
  async rejectItemByQlsx(
    piId: string,
    itemId: string,
    reason: string,
    actorUserId: string,
  ): Promise<ProductionInvoiceItemResponseDto> {
    const pi = await this.findOneOrThrow(piId);
    const item = await this.findItemOrThrow(pi.id, itemId);
    this.assertItemStatus(item, ProdApprovalStatus.WAITING_QLSX);

    const updated = await this.prisma.productionInvoiceItem.update({
      where: { id: item.id },
      data: {
        prodApprovalStatus: ProdApprovalStatus.REJECTED,
        rejectReason: reason,
        decidedAt: new Date(),
        decidedById: actorUserId,
      },
      include: { mfgProduct: true, productVariant: true, stages: true },
    });
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
      include: { mfgProduct: true, productVariant: true, stages: true },
    });
    return this.toItemResponseDto(updated);
  }

  // ─── Chuyền kiểm (TRANSFER_CHECK) - xem comment model TransferCheckResult ───

  /**
   * Danh sách mảnh cần kiểm cho 1 item + tiến độ đã kiểm - mirror mockPieces()/pieceState ở
   * KhoChuyenKiemPage.tsx, toàn bộ số liệu đều thật (totalQty suy từ BOM đã ghim ở
   * ProductionOrder, checkedQty/defectCount SUM từ TransferCheckResult, readyQty SUM từ
   * WeavingReceipt - xem WeavingIssuesModule, M2 "Phân bổ/nhận hàng đan" đóng gap này 2026-08-11).
   */
  async listTransferCheckPieces(
    piId: string,
    itemId: string,
  ): Promise<TransferCheckPieceResponseDto[]> {
    const pi = await this.findOneOrThrow(piId);
    const item = await this.findItemOrThrow(pi.id, itemId);
    const productionOrder = await this.findProductionOrderOrThrow(item.id, itemId);

    const [bomPieces, results, receiptSums] = await Promise.all([
      this.prisma.bomPiece.findMany({
        where: { bomRevisionId: productionOrder.bomRevisionId },
        include: { piece: true },
      }),
      this.prisma.transferCheckResult.findMany({
        where: { productionInvoiceItemId: item.id },
        include: { defects: true },
      }),
      // Nguồn thật cho readyQty - SUM WeavingReceipt.qty theo mảnh, mọi điểm đan cộng lại (đúng
      // cách hàm này không phân biệt điểm đan). Xem WeavingIssuesModule.
      this.prisma.weavingReceipt.groupBy({
        by: ['pieceId'],
        where: { productionOrderId: productionOrder.id },
        _sum: { qty: true },
      }),
    ]);

    const readyQtyByPiece = new Map<string, number>(
      receiptSums.map((r) => [r.pieceId.toString(), r._sum.qty ?? 0]),
    );

    return bomPieces.map((bp) => {
      const pieceResults = results.filter((r) => r.pieceId === bp.pieceId);
      return new TransferCheckPieceResponseDto({
        pieceId: bp.pieceId.toString(),
        pieceName: bp.piece.name,
        totalQty: bp.qtyPerUnit * productionOrder.quantity,
        readyQty: readyQtyByPiece.get(bp.pieceId.toString()) ?? 0,
        checkedQty: pieceResults.reduce((sum, r) => sum + r.checkedQty, 0),
        defectCount: pieceResults.reduce((sum, r) => sum + r.defects.length, 0),
      });
    });
  }

  /**
   * Ghi 1 lần kiểm cho 1 mảnh - luôn tạo dòng MỚI (không update dòng cũ), nên nhiều lần kiểm
   * cùng 1 mảnh gọi gần như đồng thời chỉ đơn giản chèn nhiều dòng độc lập, không có khoảng hở
   * đọc-rồi-ghi để lost-update như shippedQty cũ (xem SalesOrdersService.shipItem).
   */
  async recordTransferCheck(
    piId: string,
    itemId: string,
    dto: RecordTransferCheckDto,
    actorUserId: string,
  ): Promise<TransferCheckPieceResponseDto> {
    const pi = await this.findOneOrThrow(piId);
    const item = await this.findItemOrThrow(pi.id, itemId);
    const productionOrder = await this.findProductionOrderOrThrow(item.id, itemId);
    const pieceBigId = parseBigIntId(dto.pieceId);

    const bomPiece = await this.prisma.bomPiece.findUnique({
      where: {
        bomRevisionId_pieceId: {
          bomRevisionId: productionOrder.bomRevisionId,
          pieceId: pieceBigId,
        },
      },
    });
    if (!bomPiece) {
      throw new NotFoundException(
        `Mảnh ${dto.pieceId} không thuộc định mức (BOM) của item ${itemId}`,
      );
    }

    await this.prisma.transferCheckResult.create({
      data: {
        productionInvoiceItemId: item.id,
        pieceId: pieceBigId,
        checkedQty: dto.checkedQty,
        note: dto.note,
        checkedById: actorUserId,
        defects: dto.defects?.length
          ? { create: dto.defects.map((d) => ({ reason: d.reason, imageUrl: d.imageUrl })) }
          : undefined,
      },
    });

    const pieces = await this.listTransferCheckPieces(piId, itemId);
    return pieces.find((p) => p.pieceId === dto.pieceId)!;
  }

  private async findProductionOrderOrThrow(itemBigId: bigint, itemId: string) {
    const productionOrder = await this.prisma.productionOrder.findUnique({
      where: { productionInvoiceItemId: itemBigId },
    });
    if (!productionOrder) {
      throw new ConflictException(
        `Item ${itemId} chưa có ProductionOrder (chưa được Sếp duyệt) - chưa có mảnh nào để kiểm`,
      );
    }
    return productionOrder;
  }

  // ─── Shared lookups / guards ──────────────────────────────────────────────

  private async findOneOrThrow(id: string): Promise<PIWithRefs> {
    const bigId = parseBigIntId(id);
    const pi = await this.prisma.productionInvoice.findUnique({
      where: { id: bigId },
      include: {
        salesOrder: true,
        items: { include: { mfgProduct: true, productVariant: true, stages: true } },
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
      include: { mfgProduct: true, productVariant: true, stages: true },
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
      stages: item.stages.map((s) => ({ stageType: s.stageType, deadline: s.deadline })),
    });
  }
}
