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
import { ConsumableMaterialPurchaseService } from './consumable-material-purchase.service';
import { PieceMaterialYieldPurchaseService } from './piece-material-yield-purchase.service';
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
    private readonly productionOrdersService: ProductionOrdersService,
    private readonly cuttingProposalsService: CuttingProposalsService,
    private readonly pieceMaterialYieldPurchaseService: PieceMaterialYieldPurchaseService,
    private readonly consumableMaterialPurchaseService: ConsumableMaterialPurchaseService,
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
        items: {
          include: { mfgProduct: true, productVariant: true, stages: true, salesOrder: true },
        },
      },
    });
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
        items: {
          include: { mfgProduct: true, productVariant: true, stages: true, salesOrder: true },
        },
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
      // hụt đi so với lúc tính). Muốn đổi tổ hợp thì để Sếp từ chối nhóm cũ trước. `?.isMerged`
      // (2026-08-20): item chưa được gom (productionInvoiceId null - PI không còn tự sinh lúc
      // Sales tạo PO) không có productionInvoice, coi như KHÔNG thuộc đợt gộp nào - đúng nghĩa.
      const alreadyMerged = items.filter((i) => i.productionInvoice?.isMerged);
      if (alreadyMerged.length > 0) {
        throw new ConflictException(
          `SKU đang thuộc đợt gộp khác: ${alreadyMerged
            .map((i) => `${i.id} (${i.productionInvoice?.code ?? '—'})`)
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
      // Reset sạch mọi vết của chu kỳ duyệt CŨ (2026-08-24, cùng lý do claimSolo()) - 1 trong các
      // item được gộp có thể vừa quay về từ "chưa gom" sau khi bị Sếp từ chối, vẫn còn mang
      // rejectReason/warehouseName/decidedBy... của lần cắt riêng trước.
      await tx.productionInvoiceItem.updateMany({
        where: { id: { in: ids } },
        data: {
          productionInvoiceId: created.id,
          prodApprovalStatus: null,
          rejectReason: null,
          requestedAt: null,
          requestedById: null,
          warehouseCode: null,
          warehouseName: null,
          qlsxAt: null,
          qlsxById: null,
          decidedAt: null,
          decidedById: null,
        },
      });

      return created.id;
    });

    return this.toResponseDto(await this.findOneOrThrow(mergedId.toString()));
  }

  /**
   * "Tiến hành cắt riêng" (GomDotCatPage) - đúng 1 SKU, KHÔNG gộp gì cả (mergeItems() cố ý chặn
   * dưới 2 SKU, xem comment tại đó - gộp 1 SKU không tiết kiệm được gì nên không dùng chung method
   * với ý nghĩa khác hẳn). Item vừa tạo từ PO (2026-08-20: PI không còn tự sinh lúc Sales tạo PO)
   * có `productionInvoiceId: null` - hàm này tạo cho nó 1 PI thường (isMerged=false) của riêng nó,
   * mirror đúng PI 1-1 mà trước đây SalesOrdersService tự tạo tự động.
   */
  async claimSolo(itemId: string): Promise<ProductionInvoiceResponseDto> {
    const bigId = parseBigIntId(itemId);
    const item = await this.prisma.productionInvoiceItem.findUnique({ where: { id: bigId } });
    if (!item) {
      throw new NotFoundException(`Production invoice item ${itemId} not found`);
    }
    if (item.productionInvoiceId !== null) {
      throw new ConflictException(
        `SKU ${itemId} đã được gom vào phiếu sản xuất rồi - không tạo mới đè lên`,
      );
    }

    const createdId = await this.prisma.$transaction(async (tx) => {
      const created = await tx.productionInvoice.create({
        data: {
          code: await nextProductionInvoiceCode(tx as unknown as PrismaServiceType),
          salesOrderId: item.salesOrderId,
          isMerged: false,
          deadline: item.deliveryDeadline,
        },
      });
      // Reset sạch mọi vết của chu kỳ duyệt CŨ (2026-08-24) - item này có thể vừa quay về từ
      // "chưa gom" sau khi bị Sếp từ chối (rejectItem), vẫn còn mang rejectReason/warehouseName/
      // decidedBy... của lần cắt riêng trước. PI mới = chu kỳ duyệt mới, không được lộ dữ liệu cũ
      // (lịch sử thật đã có AuditLog lo, xem auditItemApprovalTransition).
      await tx.productionInvoiceItem.update({
        where: { id: bigId },
        data: {
          productionInvoiceId: created.id,
          prodApprovalStatus: null,
          rejectReason: null,
          requestedAt: null,
          requestedById: null,
          warehouseCode: null,
          warehouseName: null,
          qlsxAt: null,
          qlsxById: null,
          decidedAt: null,
          decidedById: null,
        },
      });
      return created.id;
    });

    return this.toResponseDto(await this.findOneOrThrow(createdId.toString()));
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

    const data = {
      prodApprovalStatus: ProdApprovalStatus.WAITING_QLSX,
      requestedAt: new Date(),
      requestedById: actorUserId,
      rejectReason: null,
    };
    // updateMany+count guard (pattern SkusService.approve()) - chặn 2 request gửi lại QLSX gần
    // như đồng thời cho cùng item cùng pass check in-memory rồi cùng ghi đè, làm mất dấu ai gửi
    // trước trong audit trail (Medium "Race điều kiện chuỗi duyệt/từ chối PI item").
    // assertNoApprovalOrRejected() cho qua NULL hoặc REJECTED nên where phải khớp đúng OR đó.
    const { count } = await this.prisma.productionInvoiceItem.updateMany({
      where: {
        id: item.id,
        OR: [{ prodApprovalStatus: null }, { prodApprovalStatus: ProdApprovalStatus.REJECTED }],
      },
      data,
    });
    if (count === 0) {
      throw new ConflictException(
        `Item ${item.id} đã được xử lý bởi 1 request khác trong lúc gửi QLSX - không ghi đè`,
      );
    }
    const updated = { ...item, ...data };
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

    const data = {
      prodApprovalStatus: ProdApprovalStatus.WAITING_BOSS,
      warehouseCode,
      warehouseName,
      qlsxAt: new Date(),
      qlsxById: actorUserId,
    };
    const { count } = await this.prisma.productionInvoiceItem.updateMany({
      where: { id: item.id, prodApprovalStatus: ProdApprovalStatus.WAITING_QLSX },
      data,
    });
    if (count === 0) {
      throw new ConflictException(
        `Item ${item.id} đã được xử lý bởi 1 request khác trong lúc gửi Sếp - không ghi đè`,
      );
    }
    const updated = { ...item, ...data };
    await this.auditItemApprovalTransition(item, updated);
    return this.toItemResponseDto(updated);
  }

  // ─── Gửi CẢ PHIẾU (mọi SKU đủ điều kiện) - 2026-08-18 ───────────────────────────
  // Trước đây chỉ có route theo từng itemId. Khi 1 PI = 1 SKU (mỗi đơn Sales 1 phiếu) thì "gửi
  // từng item" chính là "gửi cả phiếu", không ai thấy phiền. Từ khi có PI gộp (Nhịp 2) và cả PI
  // thường của đơn Sales nhiều dòng, KHSX/QLSX phải mở hộp thoại chọn lại từng SKU - trong khi Sếp
  // ĐÃ có approveBatch/rejectBatch từ trước. Hai hàm dưới bù đúng chỗ lệch đó.
  //
  // KHÁC approveBatch/rejectBatch ở một điểm CÓ CHỦ ĐÍCH: KHÔNG gọi assertMergedPi(). Ràng buộc
  // "chỉ đợt gộp" của Sếp đến từ nghiệp vụ cắt (cả nhóm cắt chung cây sắt nên không duyệt lẻ
  // được); còn "gửi đi xử lý" không có ràng buộc nào như vậy - PI thường nhiều SKU cũng cần gửi
  // 1 lần. Cả hai đều BỎ QUA item không đủ điều kiện thay vì ném lỗi (khác assert* của route lẻ):
  // gửi cả phiếu là thao tác gom, chặn cả mẻ chỉ vì 1 SKU đã gửi rồi là sai kỳ vọng người dùng.

  /**
   * KHSX gửi MỌI SKU chưa gửi (hoặc bị QLSX trả lại) của 1 phiếu sang QLSX trong 1 lần.
   * Không nhận dữ liệu riêng theo từng SKU nên gộp là an toàn tuyệt đối - xem sendItemToQlsx().
   */
  async sendBatchToQlsx(
    piId: string,
    actorUserId: string,
    itemIds?: string[],
  ): Promise<ProductionInvoiceResponseDto> {
    const pi = await this.findOneOrThrow(piId);
    // Đủ điều kiện = đúng tập mà assertNoApprovalOrRejected() của route lẻ cho qua.
    // `itemIds` để trống = gửi hết (ca thường); có giá trị = KHSX bỏ tick vài SKU trên UI (vd SKU
    // chưa khai xong mốc thời hạn) - lọc thêm nhưng KHÔNG nới điều kiện trạng thái.
    const selected = itemIds ? new Set(itemIds) : null;
    const targets = pi.items.filter(
      (it) =>
        (!it.prodApprovalStatus || it.prodApprovalStatus === ProdApprovalStatus.REJECTED) &&
        (selected === null || selected.has(it.id.toString())),
    );
    if (targets.length === 0) {
      throw new ConflictException(
        `${pi.code} không còn SKU nào ở trạng thái gửi được (chưa gửi / bị QLSX trả lại)`,
      );
    }

    const requestedAt = new Date();
    await this.prisma.productionInvoiceItem.updateMany({
      where: { id: { in: targets.map((it) => it.id) } },
      data: {
        prodApprovalStatus: ProdApprovalStatus.WAITING_QLSX,
        requestedAt,
        requestedById: actorUserId,
        rejectReason: null,
      },
    });
    // updateMany() không trả từng dòng - dựng "after" từ "before" đã có, cùng cách approveBatch().
    for (const item of targets) {
      await this.auditItemApprovalTransition(item, {
        ...item,
        prodApprovalStatus: ProdApprovalStatus.WAITING_QLSX,
        requestedAt,
        requestedById: actorUserId,
        rejectReason: null,
      });
    }
    return this.findOne(piId);
  }

  /**
   * QLSX gửi MỌI SKU đang chờ mình của 1 phiếu sang Sếp duyệt, DÙNG CHUNG 1 kho thành phẩm.
   * Chọn "chung 1 kho" (không cho chọn riêng từng SKU) vì đã gộp/cùng phiếu thì gần như luôn cùng
   * đích đến; ca hiếm cần kho khác nhau vẫn dùng được route lẻ :itemId/send-to-boss như cũ.
   */
  async sendBatchToBoss(
    piId: string,
    warehouseCode: string,
    warehouseName: string,
    actorUserId: string,
    itemIds?: string[],
  ): Promise<ProductionInvoiceResponseDto> {
    const pi = await this.findOneOrThrow(piId);
    const selected = itemIds ? new Set(itemIds) : null;
    const targets = pi.items.filter(
      (it) =>
        it.prodApprovalStatus === ProdApprovalStatus.WAITING_QLSX &&
        (selected === null || selected.has(it.id.toString())),
    );
    if (targets.length === 0) {
      throw new ConflictException(`${pi.code} không còn SKU nào đang chờ QLSX xử lý`);
    }

    const qlsxAt = new Date();
    await this.prisma.productionInvoiceItem.updateMany({
      where: { id: { in: targets.map((it) => it.id) } },
      data: {
        prodApprovalStatus: ProdApprovalStatus.WAITING_BOSS,
        warehouseCode,
        warehouseName,
        qlsxAt,
        qlsxById: actorUserId,
      },
    });
    for (const item of targets) {
      await this.auditItemApprovalTransition(item, {
        ...item,
        prodApprovalStatus: ProdApprovalStatus.WAITING_BOSS,
        warehouseCode,
        warehouseName,
        qlsxAt,
        qlsxById: actorUserId,
      });
    }
    return this.findOne(piId);
  }

  /**
   * Sếp duyệt cuối - SKU bắt đầu sản xuất; PI tự chuyển PRODUCING khi mọi item đã duyệt. Mirror
   * approveItemByBoss() mock. Ném ConflictException NGAY (không ghi gì) nếu sản phẩm chưa có
   * BomRevision ACTIVE - xem ProductionOrdersService.assertActiveBomRevisionExists().
   */
  async approveItem(
    piId: string,
    itemId: string,
    actorUserId: string,
  ): Promise<ProductionInvoiceItemResponseDto> {
    const pi = await this.findOneOrThrow(piId);
    // L2 (2026-08-26): PI gộp PHẢI duyệt cả cụm (approveBatch), KHÔNG duyệt lẻ từng SKU. Đối
    // xứng với assertMergedPi() ở chiều ngược lại - trước đây chỉ chặn 1 chiều nên đường này bỏ
    // ngỏ: duyệt lẻ 1 SKU của PI gộp sinh phương án cắt neo PO cho SKU đó, rồi approveBatch (hoặc
    // route thô POST /production-invoices/:id/cutting-proposals) vẫn tạo tiếp phương án neo PI phủ
    // TOÀN BỘ cụm - cùng nhu cầu được lập kế hoạch 2 lần, giữ chỗ tồn 2 lần, đẩy đề xuất mua trùng.
    // Bất biến cần giữ: mỗi SKU chỉ được phủ bởi ĐÚNG 1 phương án cắt đang hiệu lực.
    if (pi.isMerged) {
      throw new ConflictException(
        `${pi.code} là đợt gộp - phải duyệt CẢ CỤM một lần (cả nhóm nằm chung một cây sắt, không tách lẻ được), xem approveBatch`,
      );
    }
    const item = await this.findItemOrThrow(pi.id, itemId);
    this.assertItemStatus(item, ProdApprovalStatus.WAITING_BOSS);

    // Duyệt SKU luôn kéo theo tạo ProductionOrder (xem dưới) - kiểm BOM active TRƯỚC khi ghi gì,
    // để thiếu BOM chặn đúng hành động duyệt (409, có lý do rõ ràng) thay vì duyệt xong rồi mới
    // âm thầm phát hiện ở bước tạo ProductionOrder - lỗ hổng đã xác nhận, xem
    // assertActiveBomRevisionExists().
    await this.productionOrdersService.assertActiveBomRevisionExists(item.mfgProductId);

    const data = {
      prodApprovalStatus: ProdApprovalStatus.APPROVED,
      decidedAt: new Date(),
      decidedById: actorUserId,
    };
    // updateMany+count guard TRƯỚC khi tạo ProductionOrder bên dưới - ngoài chặn race ghi đè
    // audit trail (đúng lỗi Medium), còn chặn luôn 2 request duyệt đồng thời cùng kích hoạt
    // createFromApproval() 2 lần cho cùng item.
    const { count } = await this.prisma.productionInvoiceItem.updateMany({
      where: { id: item.id, prodApprovalStatus: ProdApprovalStatus.WAITING_BOSS },
      data,
    });
    if (count === 0) {
      throw new ConflictException(
        `Item ${item.id} đã được xử lý bởi 1 request khác trong lúc Sếp duyệt - không ghi đè`,
      );
    }
    const updated = { ...item, ...data };
    await this.auditItemApprovalTransition(item, updated);

    // Phase 7: tạo lệnh sản xuất ngay khi Sếp duyệt - BOM đã được xác nhận tồn tại ở trên nên
    // gần như chắc chắn thành công (chỉ fail nếu có race hiếm - BOM bị deactivate đúng khoảnh
    // khắc giữa 2 lệnh); log to nếu vẫn xảy ra vì giờ đây không còn là hành vi "biết trước, chấp
    // nhận được" như cũ nữa. Item kẹt ở APPROVED không có ProductionOrder từ đây có đường phục hồi
    // riêng - xem retryProductionOrder() (đính chính 2026-08-29, audit độc lập 28/08 mục Trung
    // bình "SKU đã duyệt nhưng tạo lệnh thất bại -> kẹt vĩnh viễn").
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

    if (productionOrder) {
      await this.triggerPostApprovalProposals(pi.id, item.id, productionOrder.id, actorUserId);
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
   * Trigger đề xuất cắt sắt (theo ĐÚNG 1 ProductionOrder) + 2 trigger mua VTTP/tiêu hao dồn vào
   * onComplete - tách ra dùng chung bởi approveItem() và retryProductionOrder() (đính chính
   * 2026-08-29). Best-effort thật sự: không được phép làm hỏng việc duyệt/tạo lệnh đã ghi xong ở
   * caller, mọi lỗi chỉ log.
   */
  private async triggerPostApprovalProposals(
    piId: bigint,
    itemId: bigint,
    productionOrderId: bigint,
    actorUserId: string,
  ): Promise<void> {
    try {
      // 2 trigger đề xuất mua còn lại (VTTP + tiêu hao phẳng) CỐ Ý dồn vào onComplete - chờ đề
      // xuất mua sắt tính xong (dù thành công/chặn/lỗi) rồi mới tính, thay vì bắn song song như
      // trước 2026-08-24. Steel chạy nền qua solver ngoài (vài chục giây tới vài phút), 2 trigger
      // kia lại tính ngay lập tức - Mua hàng thấy đề xuất vật tư tiêu hao hiện ra trước, đề xuất
      // sắt "CALCULATING" mãi mới tới, rời rạc không đồng bộ. Gộp cả 3 đề xuất mua của 1 PI xuất
      // hiện cùng lúc, sau khi phần chậm nhất (sắt) đã xong.
      await this.cuttingProposalsService.requestForOrder(productionOrderId, {
        requestedById: actorUserId,
        onComplete: async () => {
          // Cùng idiom trigger cắt sắt - tính lại nhu cầu mua nguyên liệu "vật tư thành phẩm"
          // (PieceMaterialYield, vd thanh nhôm/tấm sắt lá) cho CẢ PI mỗi khi có thêm 1 SKU được
          // duyệt, không phải nút bấm riêng (không có màn hình riêng, xem changelog 2026-08-22
          // mục 15) - best-effort, tách try/catch riêng để không lẫn lỗi với trigger kia.
          try {
            await this.pieceMaterialYieldPurchaseService.computeAndUpsertProposals(piId.toString());
          } catch (error) {
            this.logger.error(
              `Auto piece-material-yield-purchase trigger failed for PI item ${itemId}: ${(error as Error).message}`,
            );
          }

          // Cùng idiom - tính nhu cầu mua vật tư tiêu hao phẳng (Dây/Đinh/Tán rút/Nút nhựa/Sơn/
          // Phụ kiện/Bao bì). Trước đây KHÔNG có gì tự tạo PurchaseProposal cho 3 nguồn này (chỉ
          // có "Lệnh kiểm tra vật tư" thủ công trong schema, chưa từng cài đặt) - người mua hàng
          // được gán (Material.buyerId) không bao giờ thấy đề xuất nào dù SKU đã duyệt. Quyết
          // định nghiệp vụ 2026-08-22: tự động hoàn toàn, bỏ qua bước kiểm tra kho thủ công.
          try {
            await this.consumableMaterialPurchaseService.computeAndUpsertProposals(piId.toString());
          } catch (error) {
            this.logger.error(
              `Auto consumable-material-purchase trigger failed for PI item ${itemId}: ${(error as Error).message}`,
            );
          }
        },
      });
    } catch (error) {
      this.logger.error(
        `Auto cutting-proposal trigger failed for PI item ${itemId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Vá điểm kẹt "SKU đã APPROVED nhưng ProductionOrder tạo thất bại -> kẹt vĩnh viễn" (Trung bình,
   * audit độc lập 28/08). `approveItem()`/`approveBatch()` ghi `prodApprovalStatus=APPROVED`
   * TRƯỚC, tạo `ProductionOrder` trong `try/catch` chỉ log lỗi - nếu tạo thất bại (race hiếm: BOM
   * bị deactivate đúng khoảnh khắc giữa 2 lệnh) thì trước đây KHÔNG có route nào để tạo lại, kẹt
   * vĩnh viễn (downstream Chuyền kiểm/Đóng gói báo "chưa được duyệt" dù UI hiển thị đã duyệt).
   *
   * Chỉ chạy được khi item ĐÃ APPROVED và CHƯA có ProductionOrder nào -
   * `ProductionOrder.productionInvoiceItemId` là `@unique` nên gọi lại khi đã có lệnh sẽ tự vi
   * phạm constraint; chặn tường minh ở đây để trả lỗi rõ ràng thay vì lỗi DB thô.
   */
  async retryProductionOrder(
    piId: string,
    itemId: string,
    actorUserId: string,
  ): Promise<ProductionInvoiceItemResponseDto> {
    const pi = await this.findOneOrThrow(piId);
    const item = await this.findItemOrThrow(pi.id, itemId);
    if (item.prodApprovalStatus !== ProdApprovalStatus.APPROVED) {
      throw new ConflictException(
        `Item ${item.id} đang ở trạng thái ${item.prodApprovalStatus ?? 'chưa gửi'} - chỉ item đã APPROVED mới cần tạo lại lệnh sản xuất`,
      );
    }
    const existingOrder = await this.prisma.productionOrder.findUnique({
      where: { productionInvoiceItemId: item.id },
    });
    if (existingOrder) {
      throw new ConflictException(
        `Item ${item.id} đã có lệnh sản xuất (PO ${existingOrder.poNumber}) - không cần tạo lại`,
      );
    }
    // Kiểm lại BOM active trước khi thử - trả 409 rõ ràng nếu vẫn thiếu, thay vì để
    // createFromApproval() ném NotFoundException khó hiểu hơn.
    await this.productionOrdersService.assertActiveBomRevisionExists(item.mfgProductId);

    const productionOrder = await this.productionOrdersService.createFromApproval(
      item.id,
      item.mfgProductId,
      item.quantity,
    );
    await this.triggerPostApprovalProposals(pi.id, item.id, productionOrder.id, actorUserId);

    return this.toItemResponseDto(item);
  }

  /**
   * QLSX từ chối 1 SKU ngay ở bước chọn kho (chưa kịp gửi Sếp) - giờ GIỐNG HỆT Sếp từ chối
   * (rejectItem, 2026-08-28): SKU bị kéo RA KHỎI PI (`productionInvoiceId=null`), quay về đúng
   * trạng thái "chưa gom" để hiện lại ở "Tối ưu cắt sắt" - KHSX gộp/cắt riêng lại từ đầu, không
   * còn gửi lại được ngay trong PI cũ. PI cắt riêng (isMerged=false) luôn chỉ chứa đúng 1 SKU
   * (xem claimSolo()) nên hết SKU là xoá theo, không để lại PI rỗng mồ côi.
   *
   * Route lẻ, FE không còn gọi (xem rejectBatchByQlsx - route thật đang dùng), giữ lại cho tương
   * thích và để gọi thẳng API vẫn nhất quán với hành vi mới.
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

    const data = {
      productionInvoiceId: null,
      prodApprovalStatus: ProdApprovalStatus.REJECTED,
      rejectReason: reason,
      decidedAt: new Date(),
      decidedById: actorUserId,
    };
    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.productionInvoiceItem.updateMany({
        where: { id: item.id, prodApprovalStatus: ProdApprovalStatus.WAITING_QLSX },
        data,
      });
      if (count === 0) {
        throw new ConflictException(
          `Item ${item.id} đã được xử lý bởi 1 request khác trong lúc QLSX từ chối - không ghi đè`,
        );
      }
      const remaining = await tx.productionInvoiceItem.count({
        where: { productionInvoiceId: pi.id },
      });
      if (remaining === 0) {
        await tx.productionInvoice.delete({ where: { id: pi.id } });
      }
      return { ...item, ...data };
    });
    await this.auditItemApprovalTransition(item, updated);
    return this.toItemResponseDto(updated);
  }

  /**
   * QLSX từ chối CẢ PHIẾU (mọi SKU đang chờ mình xử lý) trong 1 lần - "duyệt/từ chối theo PI,
   * không theo từng SKU riêng" (2026-08-24, cùng lý do sendBatchToBoss() ở trên).
   *
   * 2026-08-28: đổi hành vi cho GIỐNG HỆT Sếp từ chối cả cụm gộp (rejectBatch bên dưới) - trước
   * đây chỉ đổi trạng thái, SKU vẫn ở lại PI để KHSX gửi lại ngay; giờ PI bị XOÁ HẲN, mọi SKU trả
   * về "chưa gom" (`productionInvoiceId=null`) để hiện lại ở "Tối ưu cắt sắt" - KHSX gộp/cắt riêng
   * lại tổ hợp khác, không còn đường "sửa rồi gửi lại từ chính PI cũ". Áp dụng cho CẢ PI thường lẫn
   * PI gộp (không gọi `assertMergedPi` - khác `rejectBatch` của Sếp chỉ dành riêng cho PI gộp, vì
   * đây là bước QLSX chung cho cả 2 loại, xem sendBatchToQlsx()).
   *
   * Đòi MỌI SKU của PI đang WAITING_QLSX (không chỉ lọc ra rồi bỏ qua phần còn lại) - PI xoá cả
   * cụm nên không thể chỉ xoá "một phần" PI; còn SKU nào chưa tới lượt QLSX xử lý (VD vẫn REJECTED
   * từ 1 lượt từ chối trước, KHSX chưa gửi lại) thì chặn, tránh xoá PI mà kéo nhầm SKU ở trạng thái
   * khác ra theo mà không ai kiểm soát được.
   */
  async rejectBatchByQlsx(
    piId: string,
    reason: string,
    actorUserId: string,
  ): Promise<{ movedItemIds: string[] }> {
    const pi = await this.findOneOrThrow(piId);
    const notWaiting = pi.items.filter(
      (it) => it.prodApprovalStatus !== ProdApprovalStatus.WAITING_QLSX,
    );
    if (notWaiting.length > 0) {
      throw new ConflictException(
        `${pi.code} có SKU không ở trạng thái chờ QLSX (${notWaiting.map((i) => i.id).join(', ')}) - không xoá cả phiếu được`,
      );
    }
    if (pi.items.length === 0) {
      throw new ConflictException(`${pi.code} không còn SKU nào đang chờ QLSX xử lý`);
    }

    // (Đính chính 2026-08-29, audit độc lập 28/08 mục Nghiêm trọng #3) updateMany lọc kèm đúng
    // trạng thái kỳ vọng + so count thay vì vòng lặp `update()` không điều kiện - cùng lý do/cùng
    // fix với rejectBatch() (Sếp) bên dưới: chặn race với sendBatchToBoss() ghi WAITING_BOSS đúng
    // lúc request này đang chạy, tránh xoá PI mà kéo nhầm 1 item vừa được gửi tiếp sang Sếp.
    const itemIds = pi.items.map((item) => item.id);
    const decidedAt = new Date();
    const transitions: { before: PIItemWithRefs; after: PIItemWithRefs }[] = pi.items.map(
      (item) => ({
        before: item,
        after: {
          ...item,
          productionInvoiceId: null,
          prodApprovalStatus: ProdApprovalStatus.REJECTED,
          rejectReason: reason,
          decidedAt,
          decidedById: actorUserId,
        },
      }),
    );
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.productionInvoiceItem.updateMany({
        where: { id: { in: itemIds }, prodApprovalStatus: ProdApprovalStatus.WAITING_QLSX },
        data: {
          productionInvoiceId: null,
          prodApprovalStatus: ProdApprovalStatus.REJECTED,
          rejectReason: reason,
          decidedAt,
          decidedById: actorUserId,
        },
      });
      if (count !== itemIds.length) {
        throw new ConflictException(
          `${pi.code} đã bị 1 request khác xử lý một phần trong lúc QLSX từ chối cả phiếu - không ghi đè`,
        );
      }
      await tx.productionInvoice.delete({ where: { id: pi.id } });
    });
    for (const t of transitions) {
      await this.auditItemApprovalTransition(t.before, t.after);
    }

    return { movedItemIds: pi.items.map((i) => i.id.toString()) };
  }

  /**
   * Sếp từ chối 1 SKU cắt riêng - SKU quay về cho KHSX sửa thời hạn và gửi lại từ đầu, ĐỒNG THỜI
   * trả về đúng trạng thái "chưa gom" (productionInvoiceId=null) như lúc Sales mới tạo - để nó
   * hiện lại được ở "Tối ưu cắt sắt" (bộ lọc ở đó chỉ hiện SKU thực sự chưa có PI nào, xem
   * loadBatchContext()). PI cắt riêng chỉ tồn tại để chứa đúng 1 SKU (xem claimSolo()) - hết SKU
   * thì xoá theo, không để lại PI rỗng mồ côi. Mirror đúng cách rejectBatch() đã xử lý cho đợt
   * gộp (2026-08-24, thống nhất 2 đường "Sếp từ chối" theo đúng yêu cầu nghiệp vụ).
   */
  async rejectItem(
    piId: string,
    itemId: string,
    reason: string,
    actorUserId: string,
  ): Promise<ProductionInvoiceItemResponseDto> {
    const pi = await this.findOneOrThrow(piId);
    const item = await this.findItemOrThrow(pi.id, itemId);
    this.assertItemStatus(item, ProdApprovalStatus.WAITING_BOSS);

    const data = {
      productionInvoiceId: null,
      prodApprovalStatus: ProdApprovalStatus.REJECTED,
      rejectReason: reason,
      decidedAt: new Date(),
      decidedById: actorUserId,
    };
    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.productionInvoiceItem.updateMany({
        where: { id: item.id, prodApprovalStatus: ProdApprovalStatus.WAITING_BOSS },
        data,
      });
      if (count === 0) {
        throw new ConflictException(
          `Item ${item.id} đã được xử lý bởi 1 request khác trong lúc Sếp từ chối - không ghi đè`,
        );
      }
      const remaining = await tx.productionInvoiceItem.count({
        where: { productionInvoiceId: pi.id },
      });
      if (remaining === 0) {
        await tx.productionInvoice.delete({ where: { id: pi.id } });
      }
      return { ...item, ...data };
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

    // (Đính chính 2026-08-29, audit độc lập 28/08 mục Nghiêm trọng #3) updateMany PHẢI lọc kèm
    // đúng trạng thái kỳ vọng + so count, cùng idiom approveItem()/rejectItem() - trước đây ghi vô
    // điều kiện theo productionInvoiceId, không có gì chặn rejectBatch() ghi đè ngược lại đồng thời
    // trên cùng PI (2 request "duyệt cả cụm" / "từ chối cả cụm" race nhau): request nào commit
    // trước thắng, request thua khớp 0 dòng (status đã đổi) và ConflictException - không còn ca
    // ProductionOrder mồ côi (duyệt xong rồi bị từ chối ghi đè ngay sau, hoặc ngược lại).
    const decidedAt = new Date();
    const itemIds = pi.items.map((item) => item.id);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.productionInvoiceItem.updateMany({
        where: { id: { in: itemIds }, prodApprovalStatus: ProdApprovalStatus.WAITING_BOSS },
        data: {
          prodApprovalStatus: ProdApprovalStatus.APPROVED,
          decidedAt,
          decidedById: actorUserId,
        },
      });
      if (count !== itemIds.length) {
        throw new ConflictException(
          `${pi.code} đã bị 1 request khác xử lý (duyệt/từ chối) một phần trong lúc Sếp duyệt cả cụm - không ghi đè`,
        );
      }
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

    // Best-effort như trigger đơn lẻ: không được phép làm hỏng việc duyệt đã ghi ở trên. Cùng
    // idiom approveItem() (2026-08-24) - 2 trigger mua VTTP/tiêu hao dồn vào onComplete, chỉ chạy
    // SAU khi đề xuất mua sắt của cả cụm gộp tính xong. Trước đây PI gộp KHÔNG có 2 trigger này
    // (chỉ trigger sắt) - người mua hàng phụ trách VTTP/tiêu hao không bao giờ thấy đề xuất nào
    // cho PI gộp dù SKU đã duyệt và có định mức thật.
    try {
      await this.cuttingProposalsService.requestForInvoice(pi.id, {
        requestedById: actorUserId,
        onComplete: async () => {
          try {
            await this.pieceMaterialYieldPurchaseService.computeAndUpsertProposals(
              pi.id.toString(),
            );
          } catch (error) {
            this.logger.error(
              `Auto piece-material-yield-purchase trigger failed for merged PI ${pi.id}: ${(error as Error).message}`,
            );
          }
          try {
            await this.consumableMaterialPurchaseService.computeAndUpsertProposals(
              pi.id.toString(),
            );
          } catch (error) {
            this.logger.error(
              `Auto consumable-material-purchase trigger failed for merged PI ${pi.id}: ${(error as Error).message}`,
            );
          }
        },
      });
    } catch (error) {
      this.logger.error(
        `Auto cutting-proposal trigger failed for merged PI ${pi.id}: ${(error as Error).message}`,
      );
    }

    return this.toResponseDto(await this.findOneOrThrow(piId));
  }

  /**
   * Sếp từ chối cả cụm gộp: PI gộp bị XOÁ HẲN, từng SKU trả về đúng trạng thái "chưa gom"
   * (productionInvoiceId=null) kèm lý do, rồi xuất hiện lại ở màn "Tối ưu cắt sắt" để KHSX gộp tổ
   * hợp khác (yêu cầu Sếp 2026-08-14). Trước đây (tới 2026-08-24) gán tạm mỗi SKU vào 1 "PI nhà"
   * mới tạo ngầm cho đúng đơn hàng gốc - đổi sang null thẳng vì bộ lọc "Tối ưu cắt sắt" giờ chỉ
   * hiện SKU thực sự chưa có PI nào (xem loadBatchContext() bên cutting-proposals.service.ts) -
   * giữ "PI nhà" sẽ khiến SKU bị PI mồ côi che mất, không hiện lại được.
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
    //
    // (Đính chính 2026-08-29, audit độc lập 28/08 mục Nghiêm trọng #3) Trước đây vòng lặp gọi
    // `update()` KHÔNG ĐIỀU KIỆN theo id - không chặn được approveBatch() ghi APPROVED xong (kèm
    // tạo ProductionOrder thật) đúng lúc request này đang chạy: `update()` vẫn ghi đè thành REJECTED
    // + xoá PI, để lại ProductionOrder mồ côi trỏ vào 1 item đã REJECTED. Đổi sang `updateMany` lọc
    // kèm đúng trạng thái kỳ vọng (WAITING_BOSS - trạng thái DUY NHẤT hợp lệ cho item còn gắn PI gộp
    // chưa xử lý, xem assertMergedPi) + so count, cùng idiom approveItem()/rejectItem(): request nào
    // commit trước thắng, request thua khớp 0 dòng và rollback toàn bộ (kể cả xoá PI bên dưới).
    const itemIds = pi.items.map((item) => item.id);
    const decidedAt = new Date();
    const transitions: { before: PIItemWithRefs; after: PIItemWithRefs }[] = pi.items.map(
      (item) => ({
        before: item,
        after: {
          ...item,
          productionInvoiceId: null,
          prodApprovalStatus: ProdApprovalStatus.REJECTED,
          rejectReason: reason,
          decidedAt,
          decidedById: actorUserId,
        },
      }),
    );
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.productionInvoiceItem.updateMany({
        where: { id: { in: itemIds }, prodApprovalStatus: ProdApprovalStatus.WAITING_BOSS },
        data: {
          productionInvoiceId: null,
          prodApprovalStatus: ProdApprovalStatus.REJECTED,
          rejectReason: reason,
          decidedAt,
          decidedById: actorUserId,
        },
      });
      if (count !== itemIds.length) {
        throw new ConflictException(
          `${pi.code} đã bị 1 request khác xử lý (duyệt/từ chối) một phần trong lúc Sếp từ chối cả cụm - không ghi đè`,
        );
      }
      await tx.productionInvoice.delete({ where: { id: pi.id } });
    });
    for (const t of transitions) {
      await this.auditItemApprovalTransition(t.before, t.after);
    }

    return { movedItemIds: pi.items.map((i) => i.id.toString()) };
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
        items: {
          include: { mfgProduct: true, productVariant: true, stages: true, salesOrder: true },
        },
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
    productionInvoice: { deadline: Date | null } | null;
  }): Date | null {
    const frame = item.stages.find((s) => s.stageType === ProdItemStageType.FRAME);
    return item.materialDeadline ?? frame?.deadline ?? item.productionInvoice?.deadline ?? null;
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
      itemDto.productionOrderId = pi.items[i].productionOrder?.id?.toString() ?? null;
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

  /** productionInvoiceId nullable (2026-08-24) - rejectItem()/rejectBatch() trả SKU về đúng trạng
   *  thái "chưa gom" (null) sau khi Sếp từ chối, rồi vẫn trả response qua chính hàm này. */
  private toItemResponseDto(item: PIItemWithRefs): ProductionInvoiceItemResponseDto {
    return new ProductionInvoiceItemResponseDto({
      id: item.id.toString(),
      productionInvoiceId: item.productionInvoiceId?.toString() ?? null,
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
