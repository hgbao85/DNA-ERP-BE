import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  AuditAction,
  BomOptionKind,
  BomRevisionStatus,
  CuttingProposalStatus,
  Prisma,
  PrismaClient,
  ProductionInvoiceStatus,
} from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { toMaterialChoiceRef } from '../../common/utils/material-choice-ref.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { sortOrderBy } from '../../common/utils/sort-order-by.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { writeAuditLog } from '../../prisma/extensions/audit-log.extension';
import { WorkshopScopeService } from '../../common/workshop-scope/workshop-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SegmentStockService } from '../segment-stock/segment-stock.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { ProductionOrderResponseDto } from './dto/production-order-response.dto';
import { ResyncBomDto } from './dto/resync-bom.dto';

type ProductionOrderRow = Prisma.ProductionOrderGetPayload<object>;

// Mã đơn Sales (cột "PO") + mã PI cha (cột "PI") + hạn giao cho người dùng - xem toResponseDto.
// Include riêng (không gộp vào ProductionOrderRow) vì createFromApproval() không cần tới, tránh
// query thừa.
const SALES_ORDER_CODE_INCLUDE = {
  // Loại dây/nệm đã chốt trên lệnh (xem ProductionOrder.wireMaterialId) - FE hiện cạnh tên SKU.
  wireMaterial: true,
  cushionMaterial: true,
  productionInvoiceItem: {
    select: {
      salesOrder: { select: { orderCode: true } },
      productionInvoice: { select: { id: true, code: true } },
      deliveryDeadline: true,
      warehouseCode: true,
      // Mốc kế hoạch Khung cơ khí/Phôi/Hàn/Sơn/Đan/Đóng gói (LenhSXPage "Sửa thời hạn") - lấy
      // kèm cùng query, KHÔNG round-trip riêng - dùng để hiện "Deadline" thật ở màn Hàn/Sơn
      // (core.tsx fetchHanSonRows(), trước đây hard-code '—' vì ProductionOrder tự nó không có
      // cột deadline, xem changelog 2026-09-12-han-son-deadline-that.md).
      stages: { select: { stageType: true, deadline: true } },
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
  private readonly logger = new Logger(ProductionOrdersService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly cls: ClsService<AppClsStore>,
    private readonly notifications: NotificationsService,
    private readonly stockReservationsService: StockReservationsService,
    private readonly workshopScope: WorkshopScopeService,
    private readonly segmentStockService: SegmentStockService,
  ) {}

  /**
   * Cổng xưởng theo phạm vi QLSX (2026-11-12): chỉ QLSX của xưởng chứa lệnh mới Bắt đầu/Tạm dừng/Kết thúc/
   * nạp lại định mức. Xưởng lấy ở SKU của lệnh (null = lệnh cũ chưa có xưởng -> ai cũng thao tác như trước).
   */
  private async assertCanManageOrder(
    userId: string | undefined,
    workshopId: bigint | null | undefined,
  ): Promise<void> {
    const scope = await this.workshopScope.getScope(userId);
    this.workshopScope.assertCanManage(scope, [workshopId], 'lệnh sản xuất này');
  }

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
    /** Luồng "Solve trước → tạo PI" (2026-09-30): ghim ĐÚNG revision đã được solver tính (chụp lúc
     *  KHSX bấm Tính), không phải revision ACTIVE lúc Sếp duyệt - số cây của phương án cắt chỉ đúng
     *  với revision đó. Bỏ trống = lấy ACTIVE như luồng cũ. */
    pinnedBomRevisionId?: bigint,
  ): Promise<ProductionOrderRow> {
    const activeRevision = pinnedBomRevisionId
      ? { id: pinnedBomRevisionId }
      : await this.prisma.bomRevision.findFirst({
          where: { mfgProductId, status: BomRevisionStatus.ACTIVE },
        });
    if (!activeRevision) {
      throw new NotFoundException(
        `Không tìm thấy BomRevision ACTIVE cho sản phẩm ${mfgProductId} - không thể tạo lệnh sản xuất`,
      );
    }

    const item = await this.prisma.productionInvoiceItem.findUniqueOrThrow({
      where: { id: productionInvoiceItemId },
      select: {
        salesOrderId: true,
        salesOrder: { select: { orderCode: true } },
        wireMaterialId: true,
        cushionMaterialId: true,
      },
    });
    const data = {
      productionInvoiceItemId,
      mfgProductId,
      bomRevisionId: activeRevision.id,
      quantity,
      // Chốt loại dây/nệm Sales đã chọn - từ đây mua hàng/xuất đan đọc từ lệnh, không đọc lại
      // dòng đơn (xem BomOptionResolver). NULL = SKU không có tick lựa chọn.
      wireMaterialId: item.wireMaterialId ?? null,
      cushionMaterialId: item.cushionMaterialId ?? null,
    };
    if (!item.salesOrderId || !item.salesOrder) {
      return this.prisma.productionOrder.create({
        data: { poNumber: `NB-${productionInvoiceItemId}`, ...data },
      });
    }
    // L1 16/11: cấp số + tạo lệnh dưới khoá theo đơn bán - 2 SKU cùng đơn duyệt cùng lúc không còn
    // cùng đếm ra 1 số (trùng poNumber -> tạo lệnh lỗi, dòng "Đã duyệt" mà không có lệnh).
    const { salesOrderId, salesOrder } = item;
    return this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `po-number:${salesOrderId}`);
      const poNumber = await this.nextPoNumber(tx, salesOrderId, salesOrder.orderCode);
      return tx.productionOrder.create({ data: { poNumber, ...data } });
    });
  }

  /**
   * Loại dây/nệm Sales chọn phải khớp tick của bản định mức mà lệnh sắp ghim: bản có tick loại nào
   * thì bắt buộc đã chọn đúng 1 trong số đó; bản không có tick loại nào thì không được kèm lựa
   * chọn. Kiểm TRƯỚC khi ghi APPROVED (cùng chỗ với assertActiveBomRevisionExists) để sai lệch chặn
   * đúng hành động duyệt (409, có lý do) thay vì để lại item APPROVED mồ côi lệnh sản xuất.
   * pinnedBomRevisionId bỏ trống = bản ACTIVE hiện tại (luồng cũ, không có phương án cắt tính sẵn).
   */
  async assertChoiceMatchesRevision(
    mfgProductId: bigint,
    pinnedBomRevisionId: bigint | undefined,
    choice: { wireMaterialId?: bigint | null; cushionMaterialId?: bigint | null },
    subject: string,
  ): Promise<void> {
    const revisionId =
      pinnedBomRevisionId ??
      (
        await this.prisma.bomRevision.findFirst({
          where: { mfgProductId, status: BomRevisionStatus.ACTIVE },
          select: { id: true },
        })
      )?.id;
    // Không có bản nào để đối chiếu: assertActiveBomRevisionExists đã/sẽ chặn riêng.
    if (revisionId == null) return;
    await this.assertChoiceFitsRevision(revisionId, choice, subject);
  }

  private async assertChoiceFitsRevision(
    bomRevisionId: bigint,
    choice: { wireMaterialId?: bigint | null; cushionMaterialId?: bigint | null },
    subject: string,
  ): Promise<void> {
    const options = await this.prisma.bomOption.findMany({
      where: { bomRevisionId },
      select: { kind: true, materialId: true },
    });
    const check = (kind: BomOptionKind, label: string, chosen: bigint | null | undefined) => {
      const allowed = options.filter((o) => o.kind === kind).map((o) => o.materialId);
      if (allowed.length === 0) {
        if (chosen != null) {
          throw new ConflictException(
            `${subject} đã chọn ${label} nhưng bản định mức ${bomRevisionId} không có lựa chọn ${label} - cần sửa lại dòng đơn hàng`,
          );
        }
        return;
      }
      if (chosen == null) {
        throw new ConflictException(
          `${subject} chưa chọn ${label} (bản định mức ${bomRevisionId} có ${allowed.length} lựa chọn) - Sales cần chọn trước khi duyệt`,
        );
      }
      if (!allowed.includes(chosen)) {
        throw new ConflictException(
          `${subject}: ${label} đã chọn không nằm trong bản định mức ${bomRevisionId} - cần chọn lại`,
        );
      }
    };
    check(BomOptionKind.WIRE, 'màu dây', choice.wireMaterialId);
    check(BomOptionKind.CUSHION, 'màu vải nệm', choice.cushionMaterialId);
  }

  /**
   * Mã lệnh SX hiển thị = mã đơn hàng Sales gốc + số thứ tự SKU trong đơn đó (vd "PO-31-2") -
   * KHÔNG còn tự đánh số riêng theo id của chính bảng này (PO-{id} cũ), tránh 2 chuỗi "PO-"
   * độc lập gây nhầm mã lệnh SX nội bộ với mã đơn hàng Sales thật (xem trao đổi 2026-08-18).
   * 2026-09-10: "mã đơn hàng Sales gốc" ở trên đổi nguồn từ SalesOrder.code (PO-{id} tự sinh,
   * nay chỉ còn nội bộ) sang SalesOrder.orderCode (Sales tự nhập tay) - ví dụ thực tế giờ có thể
   * là "DH-KHACHA-01-2" thay vì "PO-31-2", tuỳ mã Sales đặt.
   * Item không gắn Sales Order nào (tạo tay qua POST /production-invoices/:id/items, xem
   * ProductionInvoiceItem.salesOrderId) -> "NB-{itemId}" ("Nội bộ") - itemId đã unique sẵn vì
   * ProductionOrder.productionInvoiceItemId là @unique (1-1).
   *
   * L1 16/11: số thứ tự = số lớn nhất đã cấp cho đơn này + 1 (không lấy số lệnh đếm được + 1 nữa: lệnh
   * bị xoá ở giữa làm số đếm tụt và đụng số đã có). Gọi dưới khoá `po-number:{đơn}` (createFromApproval)
   * nên 2 lần duyệt cùng lúc nối đuôi nhau. Unique trên poNumber vẫn là chốt chặn cuối.
   */
  private async nextPoNumber(
    tx: Pick<PrismaServiceType, 'productionOrder'>,
    salesOrderId: bigint,
    orderCode: string,
  ): Promise<string> {
    const existing = await tx.productionOrder.findMany({
      where: { productionInvoiceItem: { salesOrderId } },
      select: { poNumber: true },
    });
    const prefix = `${orderCode}-`;
    let max = existing.length;
    for (const { poNumber } of existing) {
      const tail = poNumber.startsWith(prefix) ? poNumber.slice(prefix.length) : '';
      if (/^\d+$/.test(tail)) max = Math.max(max, Number(tail));
    }
    return `${prefix}${max + 1}`;
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
      sortOrderBy(query, ['id', 'poNumber', 'createdAt'], { id: query.sortOrder }),
    );

    const activeRevisionByProduct = await this.fetchActiveBomRevisionIds(
      result.data.map((o) => o.mfgProductId),
    );
    return {
      data: result.data.map((o) => this.toResponseDto(o, activeRevisionByProduct)),
      meta: result.meta,
    };
  }

  async findOne(id: string): Promise<ProductionOrderResponseDto> {
    const bigId = parseBigIntId(id);
    const order = await this.prisma.productionOrder.findUnique({
      where: { id: bigId },
      include: SALES_ORDER_CODE_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException(`Không tìm thấy lệnh xưởng ${id}`);
    }
    const activeRevisionByProduct = await this.fetchActiveBomRevisionIds([order.mfgProductId]);
    return this.toResponseDto(order, activeRevisionByProduct);
  }

  /** mfgProductId -> id của BomRevision đang ACTIVE của sản phẩm đó (tối đa 1 bản/sản phẩm, xem
   *  unique index `bom_revision_one_active_per_product`) - dùng để so với `bomRevisionId` đã ghim
   *  trên từng ProductionOrder (xem `bomOutOfDate` ở toResponseDto). 1 query duy nhất cho cả
   *  batch, không lặp theo từng dòng.
   *
   *  KHÔNG còn `private`: ProductionInvoicesService.toResponseDtoWithProposalStatus() (đã inject
   *  sẵn ProductionOrdersService) tái dùng đúng hàm này để tính `bomOutOfDate` cho "Bảng thống kê"
   *  (ThongKePagePlan.tsx) - tránh chép lại cùng 1 query ở 2 module, lệch nhau 1 lần sửa là ra 2
   *  công thức "đã cũ" khác nhau. */
  async fetchActiveBomRevisionIds(mfgProductIds: bigint[]): Promise<Map<string, bigint>> {
    const uniqueIds = [...new Set(mfgProductIds.map((id) => id.toString()))].map(BigInt);
    if (uniqueIds.length === 0) return new Map();
    const revisions = await this.prisma.bomRevision.findMany({
      where: { mfgProductId: { in: uniqueIds }, status: BomRevisionStatus.ACTIVE },
      select: { id: true, mfgProductId: true },
    });
    return new Map(revisions.map((r) => [r.mfgProductId.toString(), r.id]));
  }

  /** `productionInvoiceItem.productionInvoice!` - ProductionOrder chỉ sinh ra khi Sếp duyệt
   *  (approveItem/approveBatch), mà duyệt bắt buộc item đã qua sendItemToQlsx/sendItemToBoss -
   *  cả hai route đó đều cần piId thật, nên item của 1 ProductionOrder luôn đã có PI (2026-08-20:
   *  productionInvoiceId có thể null cho item MỚI TẠO, nhưng không thể null ở đây). */
  private toResponseDto(
    order: ProductionOrderWithSalesOrder,
    activeRevisionByProduct: Map<string, bigint>,
  ): ProductionOrderResponseDto {
    const activeRevisionId = activeRevisionByProduct.get(order.mfgProductId.toString());
    return new ProductionOrderResponseDto({
      id: order.id.toString(),
      poNumber: order.poNumber,
      salesOrderCode: order.productionInvoiceItem.salesOrder?.orderCode ?? null,
      productionInvoiceId: order.productionInvoiceItem.productionInvoice!.id.toString(),
      piCode: order.productionInvoiceItem.productionInvoice!.code,
      deliveryDeadline: order.productionInvoiceItem.deliveryDeadline,
      warehouseCode: order.productionInvoiceItem.warehouseCode,
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
      wireMaterial: order.wireMaterial ? toMaterialChoiceRef(order.wireMaterial) : null,
      cushionMaterial: order.cushionMaterial ? toMaterialChoiceRef(order.cushionMaterial) : null,
      // activeRevisionId undefined (sản phẩm không còn bản ACTIVE nào, hiếm) - coi như KHÔNG
      // out-of-date, tránh cảnh báo sai khi không có gì để so sánh.
      bomOutOfDate: activeRevisionId != null && activeRevisionId !== order.bomRevisionId,
      stages: order.productionInvoiceItem.stages.map((s) => ({
        stageType: s.stageType,
        deadline: s.deadline,
      })),
    });
  }

  /**
   * QLSX (BUSINESS_ROLES.PRODUCTION_MANAGER) bấm "Bắt đầu" (từ PENDING) hoặc "Tiếp tục" (từ
   * PAUSED) ở "Bảng thống kê" - dùng chung route floor-start vì cùng là chuyển sang ACTIVE, chỉ
   * khác nhãn nút bên FE (xem FloorStageCell). CHỈ đổi floorStage, KHÔNG đụng `status` (vẫn
   * RELEASED/IN_PROGRESS như cũ, mua vật tư/xuất sắt không phụ thuộc field này). floorStartedAt chỉ
   * set lần đầu (lúc còn PENDING) - "Tiếp tục" sau khi tạm dừng không ghi đè lại mốc bắt đầu gốc.
   * Cho phép gọi lại dù đã ACTIVE (idempotent, không throw) - tránh lỗi vặt nếu bấm 2 lần/2 tab.
   *
   * LS1 rà soát 18/11: lệnh đã FINISHED KHÔNG mở lại được (409) - khớp FE ("Kết thúc - không hoàn tác được", không có nút
   * mở lại). Trước đây mở lại được qua API: PI DONE -> PRODUCING nhưng giữ chỗ vật tư / sắt đã nhả lúc Kết thúc
   * (releaseReservationsIfPiFinished) không giữ lại được (giữ chỗ sắt chỉ sinh lúc duyệt phương án cắt) -> xuất sắt phần
   * còn lại 409 vĩnh viễn. Ghi có điều kiện theo trạng thái đọc được + kiểm count: 2 tab bấm chéo nhau (vd 1 tab vừa Kết
   * thúc) thì lượt sau 409 thay vì ghi đè.
   */
  async startFloor(id: string, userId?: string): Promise<ProductionOrderResponseDto> {
    const bigId = parseBigIntId(id);
    const order = await this.prisma.productionOrder.findUnique({
      where: { id: bigId },
      include: { productionInvoiceItem: { select: { workshopId: true } } },
    });
    if (!order) {
      throw new NotFoundException(`Không tìm thấy lệnh xưởng ${id}`);
    }
    await this.assertCanManageOrder(userId, order.productionInvoiceItem?.workshopId);
    const { count } =
      order.floorStage === 'PENDING'
        ? await this.prisma.productionOrder.updateMany({
            where: { id: bigId, floorStage: 'PENDING' },
            data: { floorStage: 'ACTIVE', floorStartedAt: new Date() },
          })
        : await this.prisma.productionOrder.updateMany({
            where: { id: bigId, floorStage: { in: ['PAUSED', 'ACTIVE'] } },
            data: { floorStage: 'ACTIVE' },
          });
    if (count === 0) await this.throwFloorStageConflict(bigId, 'bắt đầu / tiếp tục');
    const updated = await this.prisma.productionOrder.findUniqueOrThrow({
      where: { id: bigId },
      include: SALES_ORDER_CODE_INCLUDE,
    });
    const dto = this.toResponseDto(
      updated,
      await this.fetchActiveBomRevisionIds([updated.mfgProductId]),
    );
    await this.recordFloorChange(
      order.floorStage,
      'ACTIVE',
      dto,
      order.floorStage === 'PENDING'
        ? 'PRODUCTION_ORDER_FLOOR_STARTED'
        : 'PRODUCTION_ORDER_FLOOR_RESUMED',
    );
    return dto;
  }

  /**
   * QLSX bấm "Tạm dừng" - đổi floorStage sang PAUSED, gate assertPiHasActiveFloor() (chỉ khớp
   * ACTIVE) sẽ chặn mọi thao tác ghi trên xưởng cho tới khi bấm lại "Bắt đầu"/"Tiếp tục" (cùng
   * route floor-start, xem controller). Không kiểm tra tiến độ.
   *
   * LS1 rà soát 18/11: CHỈ tạm dừng được lệnh đang làm (ACTIVE; gọi lại khi đã PAUSED thì thôi). Trước đây ghi không điều
   * kiện - tab cũ bấm "Tạm dừng" lệnh vừa Kết thúc kéo FINISHED -> PAUSED rồi "Tiếp tục" -> ACTIVE, PI vẫn DONE và giữ chỗ
   * đã nhả -> không xuất sắt được nữa.
   */
  async pauseFloor(id: string, userId?: string): Promise<ProductionOrderResponseDto> {
    const bigId = parseBigIntId(id);
    const order = await this.prisma.productionOrder.findUnique({
      where: { id: bigId },
      include: { productionInvoiceItem: { select: { workshopId: true } } },
    });
    if (!order) {
      throw new NotFoundException(`Không tìm thấy lệnh xưởng ${id}`);
    }
    await this.assertCanManageOrder(userId, order.productionInvoiceItem?.workshopId);
    const { count } = await this.prisma.productionOrder.updateMany({
      where: { id: bigId, floorStage: { in: ['ACTIVE', 'PAUSED'] } },
      data: { floorStage: 'PAUSED' },
    });
    if (count === 0) await this.throwFloorStageConflict(bigId, 'tạm dừng');
    const updated = await this.prisma.productionOrder.findUniqueOrThrow({
      where: { id: bigId },
      include: SALES_ORDER_CODE_INCLUDE,
    });
    const dto = this.toResponseDto(
      updated,
      await this.fetchActiveBomRevisionIds([updated.mfgProductId]),
    );
    await this.recordFloorChange(order.floorStage, 'PAUSED', dto, 'PRODUCTION_ORDER_FLOOR_PAUSED');
    return dto;
  }

  /** Ghi trạng thái xưởng có điều kiện không khớp (count = 0) - đọc lại để báo đúng trạng thái hiện tại. */
  private async throwFloorStageConflict(id: bigint, action: string): Promise<never> {
    const current = await this.prisma.productionOrder.findUnique({
      where: { id },
      select: { floorStage: true },
    });
    throw new ConflictException(
      current?.floorStage === 'FINISHED'
        ? `Lệnh xưởng ${id} đã Kết thúc - không ${action} được nữa (Kết thúc không hoàn tác được)`
        : `Lệnh xưởng ${id} đang ở trạng thái ${current?.floorStage ?? 'không rõ'} - không ${action} được. Tải lại trang.`,
    );
  }

  /**
   * QLSX bấm "Kết thúc" - đổi floorStage sang FINISHED, KHÔNG kiểm tra tiến độ Phôi/Hàn/Sơn/Đan/
   * Đóng gói (quyết định nghiệp vụ 2026-08-31: QLSX toàn quyền, bấm tự do). Idempotent cùng lý do
   * startFloor().
   */
  async finishFloor(id: string, userId?: string): Promise<ProductionOrderResponseDto> {
    const bigId = parseBigIntId(id);
    const order = await this.prisma.productionOrder.findUnique({
      where: { id: bigId },
      include: { productionInvoiceItem: { select: { workshopId: true } } },
    });
    if (!order) {
      throw new NotFoundException(`Không tìm thấy lệnh xưởng ${id}`);
    }
    await this.assertCanManageOrder(userId, order.productionInvoiceItem?.workshopId);
    const updated = await this.prisma.productionOrder.update({
      where: { id: bigId },
      data:
        order.floorFinishedAt == null
          ? { floorStage: 'FINISHED', floorFinishedAt: new Date() }
          : { floorStage: 'FINISHED' },
      include: SALES_ORDER_CODE_INCLUDE,
    });
    const dto = this.toResponseDto(
      updated,
      await this.fetchActiveBomRevisionIds([updated.mfgProductId]),
    );
    await this.recordFloorChange(
      order.floorStage,
      'FINISHED',
      dto,
      'PRODUCTION_ORDER_FLOOR_FINISHED',
    );
    await this.releaseReservationsIfPiFinished(updated.productionInvoiceItemId);
    // N1 (18/11/2026): đóng tin nhắc "đã đóng gói đủ - bấm Kết thúc" của SKU này. Best-effort: lỗi chỉ ghi log. Mở lại SKU
    // (startFloor) không phát lại tin.
    try {
      await this.notifications.resolve({
        entityType: 'PRODUCTION_INVOICE_ITEM',
        entityId: String(updated.productionInvoiceItemId),
        types: ['PI_ITEM_READY_TO_FINISH'],
      });
    } catch (error) {
      this.logger.error(
        `Failed to resolve PI_ITEM_READY_TO_FINISH (item ${updated.productionInvoiceItemId}): ${(error as Error).message}`,
      );
    }
    return dto;
  }

  /**
   * 2026-10-28: khi MỌI lệnh sản xuất của PI đã Kết thúc thì nhả phần giữ chỗ tồn kho còn dư của PI đó
   * (xem StockReservationsService.releaseByProductionInvoice - không nhả thì phần dư chặn oan PI khác).
   * Không bọc chung transaction với việc đổi floorStage: 2 lệnh cùng PI Kết thúc gần đồng thời thì ít nhất
   * 1 lượt thấy "đã xong hết" (mỗi lượt đã commit floorStage của mình trước khi đếm) và việc nhả idempotent.
   * Best-effort - lỗi chỉ log, không được làm hỏng việc Kết thúc đã ghi (cùng recordFloorChange).
   */
  private async releaseReservationsIfPiFinished(productionInvoiceItemId: bigint): Promise<void> {
    let piId: bigint | null;
    try {
      const item = await this.prisma.productionInvoiceItem.findUniqueOrThrow({
        where: { id: productionInvoiceItemId },
        select: { productionInvoiceId: true },
      });
      piId = item.productionInvoiceId;
      if (piId == null) return;
      const unfinished = await this.prisma.productionOrder.count({
        where: {
          productionInvoiceItem: { productionInvoiceId: piId },
          floorStage: { not: 'FINISHED' },
        },
      });
      if (unfinished > 0) return;
    } catch (error) {
      this.logger.error(
        `Failed to release reservations after finishing PI of item ${productionInvoiceItemId}: ${(error as Error).message}`,
      );
      return;
    }
    // 16/11/2026: trước đây PI không bao giờ được ghi DONE (kẹt mãi PRODUCING). Chỉ đổi khi đang
    // PRODUCING - không đè PLANNING/CANCELLED; idempotent khi 2 lệnh Kết thúc cùng lúc. try/catch
    // riêng - lỗi ở đây không được chặn việc nhả giữ chỗ bên dưới.
    try {
      await this.prisma.productionInvoice.updateMany({
        where: { id: piId, status: ProductionInvoiceStatus.PRODUCING },
        data: { status: ProductionInvoiceStatus.DONE },
      });
    } catch (error) {
      this.logger.error(
        `Failed to mark PI ${piId} DONE after finishing item ${productionInvoiceItemId}: ${(error as Error).message}`,
      );
    }
    try {
      await this.stockReservationsService.releaseByProductionInvoice(this.prisma, piId);
    } catch (error) {
      this.logger.error(
        `Failed to release reservations after finishing PI of item ${productionInvoiceItemId}: ${(error as Error).message}`,
      );
    }
    // 13/11/2026: nhả luôn giữ ĐOẠN kho Phôi của lệnh về cột dư (không có dòng giữ thì không làm gì, nên không cần kiểm công tắc).
    // try/catch riêng - lỗi giữ đoạn không làm hỏng việc nhả giữ chỗ vật tư ở trên và ngược lại.
    try {
      const actorId = this.cls.isActive() ? (this.cls.get('userId') ?? null) : null;
      await this.prisma.$transaction((tx) =>
        this.segmentStockService.releaseOrderHoldings(tx, {
          productionInvoiceId: piId,
          actorId,
          reason: 'PI_FINISHED',
        }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to release segment holdings after finishing PI of item ${productionInvoiceItemId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Sau mỗi lần QLSX đổi `floorStage` (P1 mục 31 changelog notification): (1) ghi AuditLog - ProductionOrder không nằm trong
   * AUDITED_MODELS nên trước đây "ai bấm Tạm dừng/Kết thúc, lúc nào" không truy được; (2) báo các tổ xưởng. Bấm lại cùng
   * trạng thái (idempotent) thì KHÔNG ghi/báo gì. Best-effort: lỗi ở đây không được làm hỏng việc đổi trạng thái đã ghi.
   */
  private async recordFloorChange(
    from: string,
    to: 'ACTIVE' | 'PAUSED' | 'FINISHED',
    order: ProductionOrderResponseDto,
    type:
      | 'PRODUCTION_ORDER_FLOOR_STARTED'
      | 'PRODUCTION_ORDER_FLOOR_RESUMED'
      | 'PRODUCTION_ORDER_FLOOR_PAUSED'
      | 'PRODUCTION_ORDER_FLOOR_FINISHED',
  ): Promise<void> {
    if (from === to) return;
    try {
      const auditLogClient = this.prisma as unknown as Pick<PrismaClient, 'auditLog'>;
      await writeAuditLog(auditLogClient, this.cls, {
        action: AuditAction.UPDATE,
        tableName: 'ProductionOrder',
        recordId: order.id,
        oldValue: { floorStage: from },
        newValue: { floorStage: to },
      });
    } catch (error) {
      this.logger.error(
        `Không ghi được audit floorStage (order ${order.id}): ${(error as Error).message}`,
      );
    }
    try {
      // Tiếp tục/Kết thúc làm thông báo "Tạm dừng" hết giá trị -> tự đóng.
      if (to !== 'PAUSED') {
        await this.notifications.resolve({
          entityType: 'PRODUCTION_ORDER',
          entityId: order.id,
          types: ['PRODUCTION_ORDER_FLOOR_PAUSED'],
        });
      }
      await this.notifications.emit(type, {
        entityId: order.id,
        params: {
          piCode: order.piCode ?? `#${order.productionInvoiceId ?? order.id}`,
          poNumber: order.poNumber,
        },
      });
    } catch (error) {
      this.logger.error(
        `Không phát được thông báo ${type} (order ${order.id}): ${(error as Error).message}`,
      );
    }
  }

  /**
   * Việc 3b (changelog-2026-09-11-bom-revision-ghim-cu-canh-bao.md mục 8): đường sửa CHÍNH THỐNG
   * để đổi `bomRevisionId` đã ghim của MỘT ProductionOrder sang bản ACTIVE mới nhất - thay cho
   * việc sửa thẳng DB (đúng đường đã gây ra ca 6mm -> 60mm). `bomOutOfDate` (fetchActiveBomRevisionIds
   * ở trên) chỉ BÁO, nút này mới THỰC SỰ đổi.
   *
   * 4 điều kiện, đủ CẢ 4 mới cho đổi - trượt điều kiện nào trả đúng lý do đó, không gộp chung một
   * câu "không thực hiện được":
   *   1. status = RELEASED (chưa DONE/CANCELLED).
   *   2. floorStage = PENDING - đây là CỔNG DUY NHẤT cần kiểm cho "xưởng đã đụng vào lệnh này
   *      chưa": floorStage tự nó là cờ kiểm soát hiển thị bên Hàn/Sơn/Phôi (xem doc comment
   *      ProductionOrder.floorStage và startFloor() ở trên) - PENDING nghĩa là 3 xưởng đó CHƯA
   *      THỂ thấy lệnh này, nên không cần dò riêng từng bảng SteelIssue/MaterialIssue/
   *      WeavingIssue/ProductionBatch: tất cả đều nằm SAU floor-start.
   *   3. Không có CuttingProposal nào APPROVED neo vào lệnh này (solo) hoặc PI chứa nó (gộp) -
   *      đã chốt phương án cắt thì đổi định mức là đổi ngầm; PurchaseProposal chỉ được tạo SAU
   *      approve() nên điều kiện này tự bao luôn "chưa mua gì" mà không cần kiểm riêng.
   *   4. Sản phẩm có bản ACTIVE KHÁC bản đang ghim - không có gì để nạp thì không cho bấm.
   *
   * Ghi audit TAY (ProductionOrder không nằm trong AUDITED_MODELS - dòng nghiệp vụ đổi liên tục
   * theo vòng đời, xem audit-log.extension.ts) để lại bomRevisionId cũ/mới + lý do KHSX/QLSX gõ.
   */
  async resyncBom(
    id: string,
    dto: ResyncBomDto,
    userId?: string,
  ): Promise<ProductionOrderResponseDto> {
    const bigId = parseBigIntId(id);
    const order = await this.prisma.productionOrder.findUnique({
      where: { id: bigId },
      include: {
        productionInvoiceItem: {
          select: {
            ...SALES_ORDER_CODE_INCLUDE.productionInvoiceItem.select,
            productionInvoiceId: true,
            workshopId: true,
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException(`Không tìm thấy lệnh xưởng ${id}`);
    }
    await this.assertCanManageOrder(userId, order.productionInvoiceItem.workshopId);
    if (order.status !== 'RELEASED') {
      throw new ConflictException(
        `Lệnh sản xuất ${id} đang ở trạng thái ${order.status} - chỉ nạp lại định mức được khi còn RELEASED`,
      );
    }
    if (order.floorStage !== 'PENDING') {
      throw new ConflictException(
        `Lệnh sản xuất ${id} đã bấm "Bắt đầu" ở xưởng (floorStage=${order.floorStage}) - không nạp lại định mức được nữa`,
      );
    }

    const approvedProposal = await this.prisma.cuttingProposal.findFirst({
      where: {
        status: CuttingProposalStatus.APPROVED,
        OR: [
          { productionOrderId: bigId },
          { productionInvoiceId: order.productionInvoiceItem.productionInvoiceId },
        ],
      },
      select: { id: true },
    });
    if (approvedProposal) {
      throw new ConflictException(
        `Lệnh sản xuất ${id} đã có phương án cắt ${approvedProposal.id} được duyệt - không nạp lại định mức được nữa (đổi ngầm phương án đã chốt)`,
      );
    }

    const activeRevision = await this.prisma.bomRevision.findFirst({
      where: { mfgProductId: order.mfgProductId, status: BomRevisionStatus.ACTIVE },
      select: { id: true },
    });
    if (!activeRevision) {
      throw new ConflictException(
        `Sản phẩm của lệnh sản xuất ${id} hiện không có bản định mức ACTIVE nào - không có gì để nạp`,
      );
    }
    if (activeRevision.id === order.bomRevisionId) {
      throw new ConflictException(
        `Lệnh sản xuất ${id} đã bám đúng bản định mức ACTIVE hiện tại (revision ${activeRevision.id}) - không cần nạp lại`,
      );
    }

    // Lệnh đã chốt loại dây/nệm: bản định mức mới phải còn đúng lựa chọn đó, nếu không đổi ngầm sẽ
    // làm mất định mức của dây/nệm đã chọn.
    await this.assertChoiceFitsRevision(
      activeRevision.id,
      { wireMaterialId: order.wireMaterialId, cushionMaterialId: order.cushionMaterialId },
      `Lệnh sản xuất ${id}`,
    );

    const oldBomRevisionId = order.bomRevisionId;
    const updated = await this.prisma.productionOrder.update({
      where: { id: bigId },
      data: { bomRevisionId: activeRevision.id },
      include: SALES_ORDER_CODE_INCLUDE,
    });

    const auditLogClient = this.prisma as unknown as Pick<PrismaClient, 'auditLog'>;
    await writeAuditLog(auditLogClient, this.cls, {
      action: AuditAction.UPDATE,
      tableName: 'ProductionOrder',
      recordId: id,
      oldValue: { bomRevisionId: oldBomRevisionId.toString() },
      newValue: { bomRevisionId: activeRevision.id.toString(), reason: dto.reason },
    });

    return this.toResponseDto(
      updated,
      await this.fetchActiveBomRevisionIds([updated.mfgProductId]),
    );
  }
}
