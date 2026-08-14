import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  AuditAction,
  Prisma,
  PrismaClient,
  ProdApprovalStatus,
  ProdItemStageType,
  ProductionInvoiceStatus,
} from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { nextProductionInvoiceCode } from '../../common/utils/production-invoice-code.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { writeAuditLog } from '../../prisma/extensions/audit-log.extension';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CuttingProposalsService } from '../cutting-proposals/cutting-proposals.service';
import { ProductionOrdersService } from '../production-orders/production-orders.service';
import { SkusService } from '../skus/skus.service';
import { CreateProductionInvoiceDto } from './dto/create-production-invoice.dto';
import { CreateProductionInvoiceItemDto } from './dto/create-production-invoice-item.dto';
import { MergeProductionInvoiceDto } from './dto/merge-production-invoice.dto';
import { PackagingResponseDto } from './dto/packaging-response.dto';
import { ProductionInvoiceItemResponseDto } from './dto/production-invoice-item-response.dto';
import { ProductionInvoiceResponseDto } from './dto/production-invoice-response.dto';
import { RecordPackagingDto } from './dto/record-packaging.dto';
import { RecordTransferCheckDto } from './dto/record-transfer-check.dto';
import { TransferCheckPieceResponseDto } from './dto/transfer-check-piece-response.dto';
import { UpdateProductionInvoiceDto } from './dto/update-production-invoice.dto';
import { UpdateProductionInvoiceItemDto } from './dto/update-production-invoice-item.dto';

type PIWithRefs = Prisma.ProductionInvoiceGetPayload<{
  include: {
    salesOrder: true;
    items: { include: { mfgProduct: true; productVariant: true; stages: true; salesOrder: true } };
  };
}>;
type PIItemWithRefs = Prisma.ProductionInvoiceItemGetPayload<{
  include: { mfgProduct: true; productVariant: true; stages: true; salesOrder: true };
}>;

/** PrismaServiceType (client mở rộng qua $extends) có shape tx callback khác Prisma.TransactionClient
 *  gốc - suy ra đúng type từ chính $transaction của nó thay vì dùng type generated thẳng. */
type PrismaTx = Parameters<Parameters<PrismaServiceType['$transaction']>[0]>[0];

/** Bọc thêm CuttingProposal mới nhất - CHỈ dùng ở findAll/findOne (chỉ 2 màn thật sự cần hiện
 *  "đang tính phương án cắt"), không lan ra include của 10+ hàm ghi khác vốn không cần dữ liệu này. */
const PROPOSAL_STATUS_INCLUDE = {
  salesOrder: true,
  cuttingProposals: { orderBy: { requestedAt: 'desc' as const }, take: 1 },
  items: {
    include: {
      mfgProduct: true,
      productVariant: true,
      stages: true,
      salesOrder: true,
      productionOrder: {
        include: { cuttingProposals: { orderBy: { requestedAt: 'desc' as const }, take: 1 } },
      },
    },
  },
} satisfies Prisma.ProductionInvoiceInclude;
type PIWithProposalStatus = Prisma.ProductionInvoiceGetPayload<{
  include: typeof PROPOSAL_STATUS_INCLUDE;
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
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  /**
   * ProductionInvoiceItem bị loại khỏi AUDITED_MODELS (dòng con đổi liên tục theo vòng đời PI cha
   * - xem audit-log.extension.ts) nên createItem/updateItem không để lại vết, nhưng riêng 5 bước
   * chuyển trạng thái duyệt sản xuất (sendItemToQlsx/sendItemToBoss/approveItem/rejectItemByQlsx/
   * rejectItem) đều overwrite field trên cùng 1 dòng - không có audit thì lịch sử duyệt trước đó
   * (ai gửi/ai duyệt lúc nào) biến mất hoàn toàn khi item đổi trạng thái tiếp theo, không tra lại
   * được qua đâu cả. Ghi thủ công bằng writeAuditLog() (bypass AUDITED_MODELS đúng như jsdoc của
   * nó) để lịch sử duyệt vẫn tra được qua GET /audit-logs?tableName=ProductionInvoiceItem.
   */
  private snapshotItemApproval(item: PIItemWithRefs): Record<string, unknown> {
    return {
      prodApprovalStatus: item.prodApprovalStatus,
      warehouseCode: item.warehouseCode,
      warehouseName: item.warehouseName,
      requestedAt: item.requestedAt,
      requestedById: item.requestedById,
      qlsxAt: item.qlsxAt,
      qlsxById: item.qlsxById,
      decidedAt: item.decidedAt,
      decidedById: item.decidedById,
      rejectReason: item.rejectReason,
    };
  }

  private async auditItemApprovalTransition(
    before: PIItemWithRefs,
    after: PIItemWithRefs,
  ): Promise<void> {
    // Same cast writeAuditLog's own caller (audit-log.extension.ts) uses - the extended client's
    // generic query-args types aren't structurally assignable to plain PrismaClient's, even though
    // .auditLog.create is a superset at runtime.
    const auditLogClient = this.prisma as unknown as Pick<PrismaClient, 'auditLog'>;
    await writeAuditLog(auditLogClient, this.cls, {
      action: AuditAction.UPDATE,
      tableName: 'ProductionInvoiceItem',
      recordId: after.id.toString(),
      oldValue: this.snapshotItemApproval(before),
      newValue: this.snapshotItemApproval(after),
    });
  }

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

    const code = await nextProductionInvoiceCode(this.prisma);
    const created = await this.prisma.productionInvoice.create({
      data: {
        code,
        salesOrderId: salesOrderBigId,
        deadline: dto.deadline ? new Date(dto.deadline) : undefined,
      },
      include: {
        salesOrder: true,
        items: { include: { mfgProduct: true, productVariant: true, stages: true, salesOrder: true } },
      },
    });
    const withCode = await this.prisma.productionInvoice.update({
      where: { id: created.id },
      data: { code: `PI-${created.id}` },
      include: {
        salesOrder: true,
        items: { include: { mfgProduct: true, productVariant: true, stages: true, salesOrder: true } },
      },
    });
    return this.toResponseDto(withCode);
    return this.toResponseDto(created);
  }

  async findAll(query: PaginationQueryDto): Promise<Paginated<ProductionInvoiceResponseDto>> {
    const where: Prisma.ProductionInvoiceWhereInput = {
      // Ẩn PI đã bị rút sạch SKU sang một đợt gộp. KHÔNG xoá bản ghi (PlanForm.productionInvoiceId
      // còn trỏ tới, xoá là mất truy vết) - chỉ không hiện dòng rỗng vô nghĩa cho KHSX.
      items: { some: {} },
      ...(query.search ? { code: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.productionInvoice.findMany({
            ...args,
            include: PROPOSAL_STATUS_INCLUDE,
          }) as Promise<PIWithProposalStatus[]>,
        count: (args) => this.prisma.productionInvoice.count(args),
      },
      query,
      where,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { id: query.sortOrder },
    );
    return {
      data: result.data.map((pi) => this.toResponseDtoWithProposalStatus(pi)),
      meta: result.meta,
    };
  }

  async findOne(id: string): Promise<ProductionInvoiceResponseDto> {
    const bigId = parseBigIntId(id);
    const pi = await this.prisma.productionInvoice.findUnique({
      where: { id: bigId },
      include: PROPOSAL_STATUS_INCLUDE,
    });
    if (!pi) {
      throw new NotFoundException(`Production invoice ${id} not found`);
    }
    return this.toResponseDtoWithProposalStatus(pi);
  }

  async update(id: string, dto: UpdateProductionInvoiceDto): Promise<ProductionInvoiceResponseDto> {
    const bigId = parseBigIntId(id);
    await this.findOneOrThrow(id);
    const updated = await this.prisma.productionInvoice.update({
      where: { id: bigId },
      data: { deadline: dto.deadline ? new Date(dto.deadline) : undefined },
      include: {
        salesOrder: true,
        items: { include: { mfgProduct: true, productVariant: true, stages: true, salesOrder: true } },
      },
    });
    return this.toResponseDto(updated);
  }

  // ─── Gộp đợt cắt (KHSX) ─────────────────────────────────────────────────────

  /**
   * Gộp nhiều SKU đang chờ duyệt thành 1 PI để CẮT CHUNG một đợt (nút "Xác nhận gộp" ở màn Tối ưu
   * cắt sắt). Các SKU có thể đến từ nhiều đơn hàng khác nhau - đó chính là mục đích.
   *
   * Chỉ DI CHUYỂN item sang PI mới, KHÔNG đụng gì tới trạng thái duyệt: sau khi gộp, cả cụm vẫn đi
   * đúng luồng cũ (KHSX đặt thời hạn → gửi QLSX → Sếp duyệt), chỉ khác là Sếp duyệt cả cụm một lần
   * và solver chạy chung cho cả nhóm.
   */
  async mergeItems(
    dto: MergeProductionInvoiceDto,
    actorUserId: string,
  ): Promise<ProductionInvoiceResponseDto> {
    const ids = [...new Set(dto.productionInvoiceItemIds.map((id) => parseBigIntId(id)))];
    // Lặp lại điều kiện của DTO (@ArrayMinSize(2)) có chủ đích: đây là bất biến nghiệp vụ (gộp 1
    // SKU không tiết kiệm được gì) chứ không phải chuyện định dạng request, nên phải đứng vững cả
    // khi service được gọi từ chỗ khác không đi qua ValidationPipe.
    if (ids.length < 2) {
      throw new BadRequestException('Cần ít nhất 2 SKU khác nhau để gộp thành một đợt cắt');
    }

    const mergedId = await this.prisma.$transaction(async (tx) => {
      const items = await tx.productionInvoiceItem.findMany({
        where: { id: { in: ids } },
        include: { productionInvoice: true, stages: true },
      });
      if (items.length !== ids.length) {
        const found = new Set(items.map((i) => i.id));
        throw new NotFoundException(
          `Không tìm thấy SKU: ${ids.filter((id) => !found.has(id)).join(', ')}`,
        );
      }

      // Đã duyệt = đã sinh ProductionOrder và (có thể) đã chạy solver riêng - kéo vào nhóm nữa thì
      // phần sắt của nó bị tính hai lần.
      const approved = items.filter((i) => i.prodApprovalStatus === ProdApprovalStatus.APPROVED);
      if (approved.length > 0) {
        throw new ConflictException(
          `SKU đã được Sếp duyệt thì không gộp được nữa: ${approved.map((i) => i.id).join(', ')}`,
        );
      }
      // Đang nằm trong nhóm khác: rút ra âm thầm sẽ làm sai phương án cắt của nhóm kia (số đoạn
      // hụt đi so với lúc tính). Muốn đổi tổ hợp thì để Sếp từ chối nhóm cũ trước.
      const alreadyMerged = items.filter((i) => i.productionInvoice.isMerged);
      if (alreadyMerged.length > 0) {
        throw new ConflictException(
          `SKU đang thuộc đợt gộp khác: ${alreadyMerged
            .map((i) => `${i.id} (${i.productionInvoice.code})`)
            .join(', ')}`,
        );
      }

      // Cả nhóm cắt cùng lúc nên hạn của nhóm phải theo SKU GẤP NHẤT - lấy hạn muộn hơn là để đơn
      // gấp trễ hẹn.
      const deadlines = items
        .map((i) => this.frameDeadlineOf(i))
        .filter((d): d is Date => d !== null)
        .map((d) => d.getTime());
      const deadline = deadlines.length > 0 ? new Date(Math.min(...deadlines)) : null;

      const created = await tx.productionInvoice.create({
        data: {
          code: await nextProductionInvoiceCode(tx as unknown as PrismaServiceType),
          // Cố ý để null: nhóm có SKU của nhiều đơn hàng, không quy về 1 đơn được. PO gốc của từng
          // SKU nằm ở ProductionInvoiceItem.salesOrderId.
          salesOrderId: null,
          isMerged: true,
          mergedAt: new Date(),
          mergedById: actorUserId,
          deadline,
        },
      });
      await tx.productionInvoiceItem.updateMany({
        where: { id: { in: ids } },
        data: { productionInvoiceId: created.id },
      });

      return created.id;
    });

    return this.toResponseDto(await this.findOneOrThrow(mergedId.toString()));
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
      include: { mfgProduct: true, productVariant: true, stages: true, salesOrder: true },
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
      include: { mfgProduct: true, productVariant: true, stages: true, salesOrder: true },
    });
    await this.auditItemApprovalTransition(item, updated);
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
      include: { mfgProduct: true, productVariant: true, stages: true, salesOrder: true },
    });
    await this.auditItemApprovalTransition(item, updated);
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
      include: { mfgProduct: true, productVariant: true, stages: true, salesOrder: true },
    });
    await this.auditItemApprovalTransition(item, updated);

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
      include: { mfgProduct: true, productVariant: true, stages: true, salesOrder: true },
    });
    await this.auditItemApprovalTransition(item, updated);
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
      include: { mfgProduct: true, productVariant: true, stages: true, salesOrder: true },
    });
    await this.auditItemApprovalTransition(item, updated);
    return this.toItemResponseDto(updated);
  }

  // ─── Sếp duyệt/từ chối CẢ PI gộp ────────────────────────────────────────────

  /**
   * Sếp duyệt cả cụm gộp một lần. KHÔNG duyệt lẻ từng SKU được ở đây vì cả nhóm nằm chung một cây
   * sắt: duyệt một nửa nhóm thì phương án cắt của nửa còn lại không còn đúng nữa.
   *
   * Khác approveItem() ở đúng một điểm cốt lõi: solver chạy MỘT LẦN cho cả nhóm
   * (requestForInvoice) thay vì mỗi SKU một lần - đó chính là chỗ tiết kiệm sắt, tách ra tính
   * riêng là mất sạch phần lợi của việc gộp.
   */
  async approveBatch(piId: string, actorUserId: string): Promise<ProductionInvoiceResponseDto> {
    const pi = await this.assertMergedPi(piId);
    for (const item of pi.items) {
      this.assertItemStatus(item, ProdApprovalStatus.WAITING_BOSS);
    }
    // Kiểm BOM của MỌI SKU trước khi ghi bất cứ thứ gì: thiếu BOM 1 SKU là cả nhóm không cắt chung
    // được, dừng sớm với 409 rõ ràng còn hơn duyệt được nửa nhóm rồi kẹt.
    for (const item of pi.items) {
      await this.productionOrdersService.assertActiveBomRevisionExists(item.mfgProductId);
    }

    const decidedAt = new Date();
    await this.prisma.productionInvoiceItem.updateMany({
      where: { productionInvoiceId: pi.id },
      data: {
        prodApprovalStatus: ProdApprovalStatus.APPROVED,
        decidedAt,
        decidedById: actorUserId,
      },
    });
    // updateMany() không trả lại từng dòng như update() - tự dựng "after" từ "before" đã có sẵn
    // trong pi.items thay vì đọc lại DB, vì đúng 3 field vừa ghi đã biết trước giá trị.
    for (const item of pi.items) {
      await this.auditItemApprovalTransition(item, {
        ...item,
        prodApprovalStatus: ProdApprovalStatus.APPROVED,
        decidedAt,
        decidedById: actorUserId,
      });
    }

    for (const item of pi.items) {
      // Đọc PO từ chính SKU, KHÔNG từ pi.salesOrderId (luôn null với PI gộp) - đọc nhầm chỗ sẽ
      // âm thầm bỏ qua bước tạo PlanForm và làm hỏng "Lệnh kiểm tra vật tư".
      if (item.salesOrderId) {
        await this.skusService.ensureProductionConfirmPlanForm(
          item.salesOrderId,
          item.mfgProductId,
          pi.id,
          actorUserId,
        );
      }
      try {
        await this.productionOrdersService.createFromApproval(
          item.id,
          item.mfgProductId,
          item.quantity,
        );
      } catch (error) {
        this.logger.error(
          `ProductionOrder creation failed unexpectedly for PI item ${item.id} despite BOM check: ${(error as Error).message}`,
        );
      }
    }

    await this.prisma.productionInvoice.update({
      where: { id: pi.id },
      data: { status: ProductionInvoiceStatus.PRODUCING },
    });

    // Best-effort như trigger đơn lẻ: không được phép làm hỏng việc duyệt đã ghi ở trên.
    try {
      await this.cuttingProposalsService.requestForInvoice(pi.id, { requestedById: actorUserId });
    } catch (error) {
      this.logger.error(
        `Auto cutting-proposal trigger failed for merged PI ${pi.id}: ${(error as Error).message}`,
      );
    }

    return this.toResponseDto(await this.findOneOrThrow(piId));
  }

  /**
   * Sếp từ chối cả cụm gộp: PI gộp bị XOÁ HẲN, từng SKU trả về PI của đơn hàng gốc kèm lý do, rồi
   * xuất hiện lại ở màn "Tối ưu cắt sắt" để KHSX gộp tổ hợp khác (yêu cầu Sếp 2026-08-14).
   */
  async rejectBatch(
    piId: string,
    reason: string,
    actorUserId: string,
  ): Promise<{ movedItemIds: string[] }> {
    const pi = await this.assertMergedPi(piId);
    // Đã duyệt = đã sinh ProductionOrder/PlanForm trỏ vào PI này; xoá PI sẽ để lại rác treo.
    const approved = pi.items.filter((i) => i.prodApprovalStatus === ProdApprovalStatus.APPROVED);
    if (approved.length > 0) {
      throw new ConflictException(
        `Đợt gộp ${pi.code} đã có SKU được duyệt (${approved.map((i) => i.id).join(', ')}) - không xoá được nữa`,
      );
    }

    // auditItemApprovalTransition ghi qua this.prisma (ngoài transaction, chủ đích best-effort như
    // 5 chỗ gọi còn lại) - gom cặp before/after trong lúc chạy transaction, CHỈ ghi audit sau khi
    // transaction commit thành công, tránh để lại audit log mồ côi nếu rollback giữa chừng (VD SKU
    // sau trong vòng lặp lỗi).
    const transitions: { before: PIItemWithRefs; after: PIItemWithRefs }[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const item of pi.items) {
        const homePiId = await this.resolveHomePi(tx, item.salesOrderId);
        const updated = await tx.productionInvoiceItem.update({
          where: { id: item.id },
          data: {
            productionInvoiceId: homePiId,
            prodApprovalStatus: ProdApprovalStatus.REJECTED,
            rejectReason: reason,
            decidedAt: new Date(),
            decidedById: actorUserId,
          },
        });
        transitions.push({ before: item, after: { ...item, ...updated } });
      }
      await tx.productionInvoice.delete({ where: { id: pi.id } });
    });
    for (const t of transitions) {
      await this.auditItemApprovalTransition(t.before, t.after);
    }

    return { movedItemIds: pi.items.map((i) => i.id.toString()) };
  }

  /** PI "nhà" để trả SKU về sau khi huỷ đợt gộp: PI thường của đúng đơn hàng đó, chưa có thì tạo. */
  private async resolveHomePi(
    tx: PrismaTx,
    salesOrderId: bigint | null,
  ): Promise<bigint> {
    if (salesOrderId !== null) {
      const existing = await tx.productionInvoice.findFirst({
        where: { salesOrderId, isMerged: false },
        orderBy: { id: 'asc' },
      });
      if (existing) return existing.id;
    }
    const order =
      salesOrderId !== null
        ? await tx.salesOrder.findUnique({ where: { id: salesOrderId } })
        : null;
    const created = await tx.productionInvoice.create({
      data: {
        code: await nextProductionInvoiceCode(tx as unknown as PrismaServiceType),
        salesOrderId,
        deadline: order?.deliveryDate ?? null,
      },
    });
    return created.id;
  }

  private async assertMergedPi(piId: string): Promise<PIWithRefs> {
    const pi = await this.findOneOrThrow(piId);
    if (!pi.isMerged) {
      throw new ConflictException(
        `${pi.code} không phải đợt gộp - PI thường duyệt/từ chối theo từng SKU (xem approveItem/rejectItem)`,
      );
    }
    if (pi.items.length === 0) {
      throw new ConflictException(`Đợt gộp ${pi.code} không còn SKU nào`);
    }
    return pi;
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

  // ─── Đóng gói (PACKAGING) - mirror TransferCheckResult (append-only, SUM-on-read) nhưng đơn
  // giản hơn: theo ProductionInvoiceItem (không theo BomPiece), không có sub-bảng defect. Quyết
  // định nghiệp vụ 2026-08-12: KHÔNG chặn theo số đã qua Chuyền kiểm - chỉ chặn vượt totalQty ───

  async getPackaging(piId: string, itemId: string): Promise<PackagingResponseDto> {
    const pi = await this.findOneOrThrow(piId);
    const item = await this.findItemOrThrow(pi.id, itemId);
    const productionOrder = await this.findProductionOrderOrThrow(item.id, itemId);
    const packedQty = await this.sumPacked(item.id);
    return new PackagingResponseDto({
      totalQty: productionOrder.quantity,
      packedQty,
      remainingQty: productionOrder.quantity - packedQty,
    });
  }

  /** Luôn tạo dòng MỚI (không update-in-place) - cùng lý do TransferCheckResult làm vậy. */
  async recordPackaging(
    piId: string,
    itemId: string,
    dto: RecordPackagingDto,
    actorUserId: string,
  ): Promise<PackagingResponseDto> {
    const pi = await this.findOneOrThrow(piId);
    const item = await this.findItemOrThrow(pi.id, itemId);
    const productionOrder = await this.findProductionOrderOrThrow(item.id, itemId);
    const packedSoFar = await this.sumPacked(item.id);
    if (packedSoFar + dto.boxesPacked > productionOrder.quantity) {
      throw new BadRequestException(
        `Số thùng đóng (${dto.boxesPacked}) vượt quá số còn có thể đóng cho item ${itemId} ` +
          `(tổng ${productionOrder.quantity}, đã đóng ${packedSoFar}, còn ${productionOrder.quantity - packedSoFar})`,
      );
    }

    await this.prisma.packagingRecord.create({
      data: {
        productionInvoiceItemId: item.id,
        boxesPacked: dto.boxesPacked,
        note: dto.note,
        packedById: actorUserId,
      },
    });

    return this.getPackaging(piId, itemId);
  }

  private async sumPacked(productionInvoiceItemId: bigint): Promise<number> {
    const result = await this.prisma.packagingRecord.aggregate({
      where: { productionInvoiceItemId },
      _sum: { boxesPacked: true },
    });
    return result._sum.boxesPacked ?? 0;
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
        items: { include: { mfgProduct: true, productVariant: true, stages: true, salesOrder: true } },
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
      include: { mfgProduct: true, productVariant: true, stages: true, salesOrder: true },
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

  /**
   * Hạn dùng để xếp/gộp đợt cắt, cùng thứ tự ưu tiên với CuttingProposalsService.frameDeadlineOf
   * (materialDeadline → mốc Khung cơ khí → hạn cả phiếu). Cố ý nhân bản logic 3 dòng này thay vì
   * export hàm private của module kia: 2 module không phụ thuộc nhau theo chiều đó, và đây là quy
   * tắc nghiệp vụ đủ nhỏ để trùng lặp rẻ hơn là dựng thêm ràng buộc giữa 2 module.
   */
  private frameDeadlineOf(item: {
    materialDeadline: Date | null;
    stages: { stageType: ProdItemStageType; deadline: Date }[];
    productionInvoice: { deadline: Date | null };
  }): Date | null {
    const frame = item.stages.find((s) => s.stageType === ProdItemStageType.FRAME);
    return item.materialDeadline ?? frame?.deadline ?? item.productionInvoice.deadline ?? null;
  }

  private assertItemStatus(item: PIItemWithRefs, expected: ProdApprovalStatus): void {
    if (item.prodApprovalStatus !== expected) {
      throw new ConflictException(
        `Item ${item.id} phải ở trạng thái ${expected} (đang là ${item.prodApprovalStatus ?? 'chưa gửi'})`,
      );
    }
  }

  /**
   * findAll/findOne only - dựng DTO như toResponseDto() rồi gắn thêm trạng thái phương án cắt MỚI
   * NHẤT của từng SKU (dùng để FE hiện "Đang tính... (đã chạy X phút)" trên màn Lệnh sản xuất mới).
   *
   * Đợt gộp (PI.isMerged) dùng CHUNG 1 phương án cho cả PI (proposal.productionInvoiceId); PI
   * thường mỗi SKU tự có phương án riêng qua ProductionOrder của chính nó.
   */
  private toResponseDtoWithProposalStatus(pi: PIWithProposalStatus): ProductionInvoiceResponseDto {
    const dto = this.toResponseDto(pi);
    const piLevelProposal = pi.isMerged ? pi.cuttingProposals[0] : undefined;
    dto.items.forEach((itemDto, i) => {
      const proposal = piLevelProposal ?? pi.items[i].productionOrder?.cuttingProposals[0];
      itemDto.cuttingProposalStatus = proposal?.status ?? null;
      itemDto.cuttingProposalRequestedAt = proposal?.requestedAt ?? null;
    });
    return dto;
  }

  private toResponseDto(pi: PIWithRefs): ProductionInvoiceResponseDto {
    return new ProductionInvoiceResponseDto({
      id: pi.id.toString(),
      code: pi.code,
      salesOrderId: pi.salesOrderId?.toString() ?? null,
      salesOrderCode: pi.salesOrder?.code ?? null,
      status: pi.status,
      isMerged: pi.isMerged,
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
      salesOrderId: item.salesOrderId?.toString() ?? null,
      salesOrderCode: item.salesOrder?.code ?? null,
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
