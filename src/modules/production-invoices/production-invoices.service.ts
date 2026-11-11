import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  AuditAction,
  CuttingProposalStatus,
  Prisma,
  PrismaClient,
  ProdApprovalStatus,
  ProdItemStageType,
  ProductionInvoiceStatus,
  ProductionOrderFloorStage,
  SolverMachine,
  TransferStatus,
  Workshop,
} from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { nextProductionInvoiceCode } from '../../common/utils/production-invoice-code.util';
import { assertPiHasActiveFloor } from '../../common/utils/floor-gate.util';
import { toMaterialChoiceRef } from '../../common/utils/material-choice-ref.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { checkMergeRules, skuLabel } from '../../common/utils/merge-rules.util';
import { vnDayKey } from '../../common/utils/floor-stats.util';
import { milestoneOrderWarnings } from '../../common/utils/milestone-order.util'; // Phần A – Đợt 9
import {
  DEFAULT_TIMELINE_PARAMS,
  frameDaysOf,
  suggestTimeline,
  TimelineCapacityMode,
  TimelineParams,
} from '../../common/utils/timeline-suggest.util';
import { paginate } from '../../common/utils/paginate.util';
import { auditEvent } from '../../common/utils/audit-event.util';
import {
  isValidLsxCode,
  lenhDisplayCode,
  lenhLsxCodes,
  loadLenhDisplayCodes,
  lsxPrefixOf,
  normalizeLsxCode,
} from '../../common/utils/lenh-code.util';
import { writeAuditLog } from '../../prisma/extensions/audit-log.extension';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { CuttingProposalsService } from '../cutting-proposals/cutting-proposals.service';
import { ProductionOrdersService } from '../production-orders/production-orders.service';
import { CloudinaryService } from '../uploads/cloudinary.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { RealtimeEntity, RealtimeEntityAction } from '../../realtime/realtime.contract';
import {
  NotificationType,
  PackagingCompleteNotificationParams,
  PiNotificationParams,
  TransferCheckDefectNotificationParams,
} from '../notifications/notification-types';
import { ConsumableMaterialPurchaseService } from './consumable-material-purchase.service';
import { MaterialYieldRecipePurchaseService } from './material-yield-recipe-purchase.service';
import { PieceMaterialYieldPurchaseService } from './piece-material-yield-purchase.service';
import { CreateProductionInvoiceDto } from './dto/create-production-invoice.dto';
import { CreateProductionInvoiceItemDto } from './dto/create-production-invoice-item.dto';
import { UpdateItemsDeadlinesDto } from './dto/update-items-deadlines.dto';
import { ClaimSoloDto } from './dto/claim-solo.dto';
import { MergeProductionInvoiceDto } from './dto/merge-production-invoice.dto';
import { PackagingResponseDto } from './dto/packaging-response.dto';
import { ProductionInvoiceItemResponseDto } from './dto/production-invoice-item-response.dto';
import { ProductionInvoiceResponseDto } from './dto/production-invoice-response.dto';
import { CuttingRecheckPendingResponseDto } from './dto/cutting-recheck-pending-response.dto';
import { RecordPackagingDto } from './dto/record-packaging.dto';
import { toContainerLoadDto } from '../../common/dto/container-load.dto';
import { RecordTransferCheckDto } from './dto/record-transfer-check.dto';
import { SolverOverrideDto } from './dto/solver-override.dto';
import { TransferCheckDefectResponseDto } from './dto/transfer-check-defect-response.dto';
import { TransferCheckPieceResponseDto } from './dto/transfer-check-piece-response.dto';
import { UpdateProductionInvoiceDto } from './dto/update-production-invoice.dto';
import { UpdateTransferCheckDefectPhotoDto } from './dto/update-transfer-check-defect-photo.dto';
import { UpdateProductionInvoiceItemDto } from './dto/update-production-invoice-item.dto';
// Phần A – Đợt 9 (YC2)
import { DeadlineChangesService } from './deadline-changes/deadline-changes.service';
import type { DeadlineActor } from './deadline-changes/deadline-changes.port';
import { ORDER_VIOLATION_BLOCKS } from './deadline-changes/deadline-changes.types';
import type {
  DeadlineChangeBatchDto,
  DeadlineEntryCheck,
  DeadlineEntryInput,
  DeadlineFieldKey,
  DeadlineValues,
} from './deadline-changes/deadline-changes.types';
import {
  diffValues,
  FLOOR_STARTED_ERROR,
  pendingRefOf,
  valuesOfItem,
} from './deadline-changes/deadline-values.util';
import { ItemDeadlineWriter } from './item-deadline-writer.service';
import { PIECE_TRANSFER_LEAVES_FRAME } from '../warehouse-transfers/transfer-routes.constant';
import { WorkshopMoveService } from '../warehouse-transfers/workshop-move.service';

type PIWithRefs = Prisma.ProductionInvoiceGetPayload<{
  include: {
    salesOrder: true;
    items: {
      include: {
        mfgProduct: true;
        productVariant: true;
        wireMaterial: true;
        cushionMaterial: true;
        workshop: true;
        stages: true;
        salesOrder: { include: { customer: true } };
      };
    };
  };
}>;
/** SystemConfig là bảng 1 dòng (id = 1) - đọc luật gộp solverMergeWindowDays/solverMergeMaxSkus. */
const SYSTEM_CONFIG_ID = 1;

type PIItemWithRefs = Prisma.ProductionInvoiceItemGetPayload<{
  include: {
    mfgProduct: true;
    productVariant: true;
    wireMaterial: true;
    cushionMaterial: true;
    workshop: true;
    stages: true;
    salesOrder: { include: { customer: true } };
  };
}>;

/** Bọc thêm CuttingProposal mới nhất - CHỈ dùng ở findAll/findOne (chỉ 2 màn thật sự cần hiện
 *  "đang tính phương án cắt"), không lan ra include của 10+ hàm ghi khác vốn không cần dữ liệu này. */
const PROPOSAL_STATUS_INCLUDE = {
  salesOrder: true,
  cuttingProposals: { orderBy: { requestedAt: 'desc' as const }, take: 1 },
  // Phần A: tên người bấm "Đã kiểm" phương án cắt (chỉ trường tên).
  cuttingRecheckedBy: { select: { firstName: true, lastName: true } },
  // Phần A – Đợt 2: cờ "đã xuất vật tư" (hasMaterialIssue) - đếm cùng truy vấn, không thêm truy vấn theo từng PI.
  _count: { select: { steelIssues: true } },
  items: {
    include: {
      mfgProduct: true,
      productVariant: true,
      wireMaterial: true,
      cushionMaterial: true,
      workshop: true,
      stages: true,
      salesOrder: { include: { customer: true } },
      // Phần A – Đợt 9 (YC2): yêu cầu đổi mốc đang chờ (tối đa 1/dòng) - nạp cùng truy vấn, không N+1.
      deadlineChangeRequests: { where: { status: 'PENDING' as const }, take: 1 },
      productionOrder: {
        include: {
          cuttingProposals: { orderBy: { requestedAt: 'desc' as const }, take: 1 },
          // Phần A – Đợt 2
          _count: { select: { materialYieldIssues: true } },
        },
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
    private readonly materialYieldRecipePurchaseService: MaterialYieldRecipePurchaseService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly cloudinaryService: CloudinaryService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    // Phần A – Đợt 9 (YC2)
    private readonly deadlineWriter: ItemDeadlineWriter,
    private readonly deadlineChanges: DeadlineChangesService,
    // Người B (10/11/2026): phần kho/mua khi đổi xưởng.
    private readonly workshopMove: WorkshopMoveService,
  ) {}

  /** Phát realtime SAU KHI transaction đã commit (xem RealtimeService). */
  private publishRealtime(
    entity: RealtimeEntity,
    entityId: bigint | string,
    action: RealtimeEntityAction,
    actorId: string | null,
  ): void {
    this.realtime.publishEntityChanged({ entity, entityId, action, actorId });
  }

  // ─── Notification (Phase 3a, mục 7.2 changelog 2026-09-25) ─────────────────────────────────
  // Best-effort NGOÀI transaction nghiệp vụ chính - cùng lý do đã ghi ở SkusService.notifySku()
  // (mục 14/15.2 changelog): catch bên trong 1 Prisma interactive transaction không cứu được
  // transaction đó, nên luôn gọi SAU KHI phần ghi chính đã xong/commit.
  private async notifyPi(
    type: NotificationType,
    entityId: bigint,
    params: PiNotificationParams,
    dedupeKey: string | undefined,
    actorUserId?: string,
  ): Promise<void> {
    try {
      await this.notifications.emit(type, {
        entityId: entityId.toString(),
        actorId: actorUserId,
        dedupeKey,
        params: { ...params },
      });
    } catch (error) {
      this.logger.error(
        `Failed to create PI notification (${type}, entity ${entityId}): ${(error as Error).message}`,
      );
    }
  }

  private async resolvePiNotifications(
    entityType: string,
    entityId: bigint,
    types: NotificationType[],
  ): Promise<void> {
    try {
      await this.notifications.resolve({
        entityType,
        entityId: entityId.toString(),
        types,
      });
    } catch (error) {
      this.logger.error(
        `Failed to resolve PI notifications (${types.join(',')}, entity ${entityId}): ${(error as Error).message}`,
      );
    }
  }

  // Phase 3b, nhóm 7.5-v (changelog 2026-09-25 mục 24) - best-effort NGOÀI transaction, cùng lý do
  // đã ghi ở notifyPi() (recordTransferCheck() không mở transaction riêng nên đây chỉ là 1 lệnh
  // gọi thêm sau create(), không có gì để "cứu" nếu lỗi).
  private async notifyTransferCheckDefect(
    entityId: bigint,
    params: TransferCheckDefectNotificationParams,
  ): Promise<void> {
    try {
      await this.notifications.emit('TRANSFER_CHECK_DEFECT_FOUND', {
        entityId: entityId.toString(),
        params: { ...params },
      });
    } catch (error) {
      this.logger.error(
        `Failed to create TRANSFER_CHECK_DEFECT_FOUND notification (entity ${entityId}): ${(error as Error).message}`,
      );
    }
  }

  // Phase 3b, nhóm 7.5-vi (changelog 2026-09-25 mục 25) - best-effort NGOÀI transaction, cùng lý
  // do đã ghi ở notifyPi()/notifyTransferCheckDefect() (recordPackaging() không mở transaction
  // riêng nên đây chỉ là 1 lệnh gọi thêm sau create()).
  private async notifyPackagingComplete(
    entityId: bigint,
    params: PackagingCompleteNotificationParams,
  ): Promise<void> {
    try {
      await this.notifications.emit('PI_ITEM_PACKAGING_COMPLETE', {
        entityId: entityId.toString(),
        params: { ...params },
      });
    } catch (error) {
      this.logger.error(
        `Failed to create PI_ITEM_PACKAGING_COMPLETE notification (entity ${entityId}): ${(error as Error).message}`,
      );
    }
  }

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
      // Phần A – Đợt 2: xưởng cơ khí đi cùng vòng đời warehouseCode
      workshopId: item.workshopId?.toString() ?? null,
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
        throw new NotFoundException(`Không tìm thấy đơn hàng ${dto.salesOrderId}`);
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
          include: {
            mfgProduct: true,
            productVariant: true,
            wireMaterial: true,
            cushionMaterial: true,
            workshop: true,
            stages: true,
            salesOrder: { include: { customer: true } },
          },
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
      // Phần A – Đợt 2: tìm theo mã PI HOẶC số LSX của một dòng (AND để giữ điều kiện `items: { some: {} }`).
      ...(query.search
        ? {
            AND: [
              {
                OR: [
                  { code: { contains: query.search, mode: 'insensitive' } },
                  {
                    items: {
                      some: { lsxCode: { contains: query.search, mode: 'insensitive' } },
                    },
                  },
                ],
              },
            ],
          }
        : {}),
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
      data: await Promise.all(result.data.map((pi) => this.toResponseDtoWithProposalStatus(pi))),
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
      throw new NotFoundException(`Không tìm thấy lệnh sản xuất ${id}`);
    }
    return await this.toResponseDtoWithProposalStatus(pi);
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
          include: {
            mfgProduct: true,
            productVariant: true,
            wireMaterial: true,
            cushionMaterial: true,
            workshop: true,
            stages: true,
            salesOrder: { include: { customer: true } },
          },
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
  /**
   * Chụp lại BẰNG CHỨNG cho lời xin ngưỡng đặc cách, tại đúng thời điểm KHSX bấm - loại sắt vướng
   * nhất trong tổ hợp cùng ước tính hao hụt và ngưỡng thường của nó.
   *
   * Vì sao BE tự tính thay vì nhận số FE gửi lên: đây là căn cứ để Sếp duyệt chi thêm tiền sắt,
   * không được để client khai. Vì sao chụp lại thay vì tính lúc hiển thị: solver chỉ chạy SAU khi
   * duyệt (lúc duyệt chưa có số thật), và tính lại về sau có thể ra số khác khi định mức đổi -
   * cái Sếp cần là đúng con số KHSX đã nhìn thấy.
   *
   * PHẢI gọi TRƯỚC transaction gộp: previewBatch chỉ thấy các SKU chưa được gom vào PI nào.
   * Trả null khi không xin đặc cách (khỏi tốn một lượt tính cho đường thường) hoặc khi không tính
   * được - callout bên Sếp chịu được null, chỉ là không có dòng "vì...".
   */
  private async buildOverrideEvidence(
    itemIds: string[],
    solver: SolverOverrideDto | undefined,
    cuttingProposalId?: bigint,
  ): Promise<Prisma.InputJsonValue | undefined> {
    if (solver?.solverMaxWastePctOverride == null) return undefined;
    try {
      const preview = await this.cuttingProposalsService.previewBatch({
        productionInvoiceItemIds: itemIds,
        // PHẢI tính trên ĐÚNG chiều dài cây KHSX chọn cho đợt này (2026-09-16). Thiếu dòng
        // này thì bằng chứng tính trên cây chuẩn 6m trong khi KHSX nhìn số của cây 5m85 rồi
        // mới xin: Sếp đọc được "xin 15% vì ước tính 1.88%" - vô lý, và đúng loại "con số tự
        // mâu thuẫn" đã phải sửa một lần ở mục 11.3 changelog 2026-09-14.
        stockLengthsByMaterial: solver?.solverStockLengthsByMaterial,
        // Cùng máy với đợt (2026-10-23): đổi máy là đổi tề đầu/lưỡi nên đổi cả ước tính hao hụt.
        solverMachine: solver?.solverMachine,
      });
      if (preview.lines.length === 0) return undefined;
      // PI tạo từ phương án ĐÃ TÍNH (luồng solve-trước, 2026-09-30) thì phương án đã có hao hụt THẬT của từng loại:
      // dùng nó thay cho ước tính best-fill. Ước tính chỉ là cận dưới theo 1 cây lý tưởng ("hao ≥ 0,55 %") và lệch
      // xa số thật khi số lượng nhỏ (PI-2026-041, SAT-VUONG-50X50: ước 0,55 % - phương án thật 55,83 %): Sếp duyệt chi
      // thêm tiền sắt trên con số không phải của lượt tính. Đơn vị cả hai đều là % (không phải phân số). Loại không
      // có dòng thật dùng được (vô nghiệm, hoặc không có trong phương án) giữ ước tính.
      let realByCode = new Map<string, { wastePct: number | null; stockLengthMm: number | null }>();
      if (cuttingProposalId !== undefined) {
        realByCode = new Map(
          (await this.cuttingProposalsService.getProposalLineWaste(cuttingProposalId)).map((l) => [
            l.materialCode,
            l,
          ]),
        );
      }
      const lines = preview.lines.map((l) => {
        const real = realByCode.get(l.materialCode);
        if (!real || real.wastePct === null) return { ...l, fromProposal: false };
        return {
          ...l,
          minWastePct: real.wastePct,
          stockLengthMm: real.stockLengthMm ?? l.stockLengthMm,
          meetsThreshold: real.wastePct <= l.thresholdPct,
          fromProposal: true,
        };
      });
      // Loại vướng nhất = hao hụt ước tính cao nhất. Ưu tiên trong nhóm chưa đạt ngưỡng; nếu cả
      // nhóm đều đạt thì vẫn lấy loại cao nhất - Sếp cần thấy "ước tính đã đạt mà vẫn xin" để hỏi
      // lại, chứ không phải giấu đi.
      const missing = lines.filter((l) => !l.meetsThreshold);
      const pool = missing.length > 0 ? missing : lines;
      const worst = [...pool].sort((a, b) => b.minWastePct - a.minWastePct)[0];
      return {
        materialCode: worst.materialCode,
        estimatedWastePct: worst.minWastePct,
        normalThresholdPct: worst.thresholdPct,
        // Cây mà con số trên được tính TRÊN đó (2026-09-16). Trước đây màn duyệt ghi cứng "ở
        // cây chuẩn" - từ khi KHSX chọn được chiều dài riêng thì câu đó SAI, và Sếp không có
        // cách nào biết 13,74% là của cây 5m8 chứ không phải cây 6m.
        stockLengthMm: worst.stockLengthMm,
        // true = số trên là hao hụt THẬT của phương án đã tính, không phải cận dưới ước tính - màn duyệt
        // phải ghi khác ("theo phương án đã tính" thay vì "ước tính ≥"). Bản ghi cũ thiếu trường = ước tính.
        fromProposal: worst.fromProposal,
      };
    } catch (error) {
      // Không có bằng chứng thì vẫn cho gộp - chặn cả thao tác vì một dòng hiển thị là quá tay.
      this.logger.warn(
        `Không dựng được bằng chứng đặc cách cho SKU [${itemIds.join(', ')}]: ${
          (error as Error).message
        }`,
      );
      return undefined;
    }
  }

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
    // Luồng "Solve trước → tạo PI" (2026-09-30): lệnh sản xuất chỉ được tạo từ 1 phương án cắt đã
    // tính xong, dùng được và chưa lỗi thời - thông số cắt lấy từ chính lượt tính đó (không nhận
    // lại từ client: gửi khác với lúc tính là gửi số không khớp với kết quả).
    const proposal = await this.cuttingProposalsService.assertReadyForInvoice(
      dto.cuttingProposalId,
      ids,
    );
    // Chốt máy cắt THỰC SỰ đã dùng vào PI (2026-10-23): KHSX để theo mặc định thì solverOptions không có máy,
    // nhưng lượt tính đã chạy bằng máy mặc định lúc đó - ghi lại để "Tính lại" về sau không đổi máy.
    const solver: SolverOverrideDto = {
      ...(proposal.solverOptions as SolverOverrideDto),
    };
    solver.solverMachine ??= proposal.usedMachine ?? undefined;
    // Trước transaction: sau khi gộp, các SKU này không còn nằm trong danh sách "chưa được gom"
    // mà previewBatch đọc, nên tính sau là ra rỗng.
    const overrideEvidence = await this.buildOverrideEvidence(
      dto.productionInvoiceItemIds,
      solver,
      proposal.id,
    );

    const mergedId = await this.prisma.$transaction(async (tx) => {
      const items = await tx.productionInvoiceItem.findMany({
        where: { id: { in: ids } },
        include: { productionInvoice: true, stages: true, mfgProduct: true, salesOrder: true },
      });
      if (items.length !== ids.length) {
        const found = new Set(items.map((i) => i.id));
        throw new NotFoundException(
          `Không tìm thấy SKU: ${ids.filter((id) => !found.has(id)).join(', ')}`,
        );
      }
      // LUẬT GỘP (2026-10-24, Sếp Nhân: "chỉ được gom các lệnh cách nhau khoảng 3 ngày đổ lại") - kiểm lại dù cutting-batch-solve đã
      // chặn: hạn SKU có thể bị sửa giữa lúc tính và lúc gộp. Xem merge-rules.util.
      const mergeCfg = await tx.systemConfig.findUniqueOrThrow({
        where: { id: SYSTEM_CONFIG_ID },
        select: { solverMergeWindowDays: true, solverMergeMaxSkus: true },
      });
      const rule = checkMergeRules(
        items.map((i) => ({
          materialDeadline: i.materialDeadline,
          stages: i.stages,
          label: skuLabel(i.mfgProduct.factoryCode, i.salesOrder?.orderCode),
        })),
        { windowDays: mergeCfg.solverMergeWindowDays, maxSkus: mergeCfg.solverMergeMaxSkus },
      );
      if (!rule.ok) throw new BadRequestException(rule.reason);

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
          // Thông số cắt KHSX đề nghị cho ĐÚNG đợt này (2026-09-14) - null = không xin gì đặc
          // biệt, chạy ngưỡng thường + mặc định công ty lúc Sếp duyệt (xem
          // CuttingProposalsService.buildInvoiceJob/runSolverAndSave).
          solverMaxWastePctOverride: solver.solverMaxWastePctOverride ?? null,
          solverAllowCustomLength: solver.solverAllowCustomLength ?? null,
          solverMachine: solver.solverMachine ?? null,
          solverOverrideReason: solver.solverOverrideReason ?? null,
          solverTimeLimitSecondsOverride: solver.solverTimeLimitSecondsOverride ?? null,
          solverOverrideEvidence: overrideEvidence,
          // Chiều dài cây theo từng quy cách KHSX chọn cho đợt này (2026-09-16). undefined (không
          // phải null) khi không chọn: cột Json? nullable không default, để Prisma bỏ qua cột thay
          // vì phải dùng Prisma.DbNull - cùng idiom overrideEvidence ở trên.
          solverStockLengthsByMaterial: solver.solverStockLengthsByMaterial ?? undefined,
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
          workshopId: null, // Phần A – Đợt 2 (lsxCode GIỮ - số LSX đi theo dòng SKU)
          qlsxAt: null,
          qlsxById: null,
          decidedAt: null,
          decidedById: null,
        },
      });
      // Gắn phương án đã tính vào PI vừa tạo - cùng transaction nên 2 request tạo PI từ cùng 1
      // phương án thì đúng 1 thắng (updateMany có điều kiện + so count).
      await this.cuttingProposalsService.attachToInvoice(tx, proposal.id, created.id);

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
  async claimSolo(itemId: string, dto: ClaimSoloDto): Promise<ProductionInvoiceResponseDto> {
    const bigId = parseBigIntId(itemId);
    // Luồng "Solve trước → tạo PI" (2026-09-30) - xem mergeItems(): PI chỉ được tạo từ phương án
    // đã tính đúng cho SKU này, thông số cắt lấy từ chính lượt tính.
    const proposal = await this.cuttingProposalsService.assertReadyForInvoice(
      dto.cuttingProposalId,
      [bigId],
    );
    // Chốt máy cắt THỰC SỰ đã dùng vào PI (2026-10-23): KHSX để theo mặc định thì solverOptions không có máy,
    // nhưng lượt tính đã chạy bằng máy mặc định lúc đó - ghi lại để "Tính lại" về sau không đổi máy.
    const solver: SolverOverrideDto = {
      ...(proposal.solverOptions as SolverOverrideDto),
    };
    solver.solverMachine ??= proposal.usedMachine ?? undefined;
    const overrideEvidence = await this.buildOverrideEvidence([itemId], solver, proposal.id);
    const item = await this.prisma.productionInvoiceItem.findUnique({ where: { id: bigId } });
    if (!item) {
      throw new NotFoundException(`Không tìm thấy SKU ${itemId}`);
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
          // Thông số cắt KHSX đề nghị cho ĐÚNG SKU này (2026-09-14) - xem comment ở mergeItems().
          solverMaxWastePctOverride: solver.solverMaxWastePctOverride ?? null,
          solverAllowCustomLength: solver.solverAllowCustomLength ?? null,
          solverMachine: solver.solverMachine ?? null,
          solverOverrideReason: solver.solverOverrideReason ?? null,
          solverTimeLimitSecondsOverride: solver.solverTimeLimitSecondsOverride ?? null,
          solverOverrideEvidence: overrideEvidence,
          solverStockLengthsByMaterial: solver.solverStockLengthsByMaterial ?? undefined,
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
          workshopId: null, // Phần A – Đợt 2 (lsxCode GIỮ)
          qlsxAt: null,
          qlsxById: null,
          decidedAt: null,
          decidedById: null,
        },
      });
      await this.cuttingProposalsService.attachToInvoice(tx, proposal.id, created.id);
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
      throw new NotFoundException(`Không tìm thấy sản phẩm ${dto.mfgProductId}`);
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
      include: {
        mfgProduct: true,
        productVariant: true,
        wireMaterial: true,
        cushionMaterial: true,
        workshop: true,
        stages: true,
        salesOrder: { include: { customer: true } },
      },
    });
    return this.toItemResponseDto(item);
  }

  /**
   * KHSX sửa thời hạn kế hoạch của 1 SKU (LenhSXPage "Sửa thời hạn") - materialDeadline/
   * deliveryDeadline ghi thẳng lên item, còn `stages` (Khung cơ khí/Đan/Đóng gói) upsert theo
   * unique (productionInvoiceItemId, stageType) vì đây là mốc kế hoạch do KHSX đặt, không phải
   * tiến độ thực thi Phôi/Hàn/Sơn thật (domain đó chưa tồn tại - xem ProdItemStageType).
   *
   * Phần A – Đợt 9 (YC2): dòng ĐÃ Sếp duyệt không ghi thẳng - đi qua DeadlineChangesService thành yêu cầu chờ Sếp duyệt lại
   * (bỏ `deliveryDeadline`); PI huỷ → 400. Dòng chưa duyệt giữ đường ghi cũ.
   */
  async updateItem(
    piId: string,
    itemId: string,
    dto: UpdateProductionInvoiceItemDto,
    actor: DeadlineActor,
  ): Promise<ProductionInvoiceItemResponseDto> {
    const pi = await this.findOneOrThrow(piId);
    this.assertPiAllowsDeadlineEdit(pi);
    const item = await this.findItemOrThrow(pi.id, itemId);

    if (item.prodApprovalStatus === ProdApprovalStatus.APPROVED) {
      await this.deadlineChanges.saveEntries(
        actor,
        [{ itemId, newValues: this.deadlineValuesOfDto(dto) }],
        'MANUAL',
        { strict: true },
      );
      const updated = await this.findItemOrThrow(pi.id, itemId);
      const out = this.toItemResponseDto(updated);
      const pending = await this.deadlineChanges.pendingByItem([updated.id]);
      out.pendingDeadlineChange = pending.get(updated.id.toString()) ?? null;
      return out;
    }

    // Đợt 9 phần 2 (Q9-3): lệnh đã bắt đầu sản xuất (cắt phôi) thì không sửa mốc; (Q9-2) thứ tự mốc ngược thì không lưu.
    await this.assertFloorNotStarted(pi, [item]);
    await this.prisma.$transaction(async (tx) => {
      await this.deadlineWriter.applyItemDeadlines(tx, item.id, dto);
      if (pi.isMerged) await this.deadlineWriter.assertMergedPiDeadlineRule(tx, pi.id);
      await this.assertMilestoneOrderAfterWrite(tx, pi, [item]);
    });

    const updated = await this.findItemOrThrow(pi.id, itemId);
    await this.deadlineWriter.auditAndNotifyDeadlineChange(pi.code, item, updated);
    return this.toItemResponseDto(updated);
  }

  /**
   * "Sửa thời hạn" cả PI trong MỘT giao dịch (2026-10-24) - xem UpdateItemsDeadlinesDto. Lệnh gộp: lưu hết rồi kiểm luật gộp (mốc cần
   * sắt các SKU cách nhau ≤ solverMergeWindowDays); vi phạm -> 400 kèm câu báo, KHÔNG lưu gì (rollback).
   *
   * Phần A – Đợt 9 (YC2): tách dòng theo duyệt. Dòng chưa duyệt → đường ghi cũ (gồm `deliveryDeadline`); dòng đã duyệt → yêu cầu chờ Sếp
   * (bỏ `deliveryDeadline`, strict: lỗi dòng nào thì 400 cả lần). Hạn của PI (`dto.deadline`) chỉ ghi khi PI không có dòng đã duyệt.
   * Dòng đã duyệt được kiểm TRƯỚC khi ghi bất cứ gì để lần lưu hỏng thì không lưu dở dòng chưa duyệt.
   */
  async updateItemsDeadlines(
    piId: string,
    dto: UpdateItemsDeadlinesDto,
    actor: DeadlineActor,
  ): Promise<ProductionInvoiceResponseDto> {
    const pi = await this.findOneOrThrow(piId);
    this.assertPiAllowsDeadlineEdit(pi);
    const befores = await Promise.all(dto.items.map((e) => this.findItemOrThrow(pi.id, e.itemId)));

    const plain: { entry: (typeof dto.items)[number]; before: PIItemWithRefs }[] = [];
    const approvedEntries: DeadlineEntryInput[] = [];
    for (const [idx, entry] of dto.items.entries()) {
      if (befores[idx].prodApprovalStatus === ProdApprovalStatus.APPROVED) {
        approvedEntries.push({ itemId: entry.itemId, newValues: this.deadlineValuesOfDto(entry) });
      } else {
        plain.push({ entry, before: befores[idx] });
      }
    }
    if (approvedEntries.length > 0) {
      const checks = await this.deadlineChanges.previewEntries(approvedEntries);
      const errors = checks.flatMap((c) =>
        c.errors.map((e) => `${c.lenhCode} · ${c.skuCode}: ${e}`),
      );
      if (errors.length > 0) throw new BadRequestException(errors.join('\n'));
    }
    // Đợt 9 phần 2 (Q9-3): dòng sửa thẳng mà lệnh đã bắt đầu sản xuất (cắt phôi) → 400, chưa ghi gì.
    await this.assertFloorNotStarted(
      pi,
      plain.map((p) => p.before),
    );
    const hasApprovedItem = pi.items.some(
      (i) => i.prodApprovalStatus === ProdApprovalStatus.APPROVED,
    );

    await this.prisma.$transaction(async (tx) => {
      if (dto.deadline && !hasApprovedItem) {
        await tx.productionInvoice.update({
          where: { id: pi.id },
          data: { deadline: new Date(dto.deadline) },
        });
      }
      for (const { entry, before } of plain) {
        await this.deadlineWriter.applyItemDeadlines(tx, before.id, entry);
      }
      if (pi.isMerged && plain.length > 0) {
        await this.deadlineWriter.assertMergedPiDeadlineRule(tx, pi.id);
      }
      // Đợt 9 phần 2 (Q9-2): thứ tự mốc ngược ở dòng có đổi → 400, rollback cả lần (kể cả hạn PI).
      await this.assertMilestoneOrderAfterWrite(
        tx,
        pi,
        plain.map((p) => p.before),
      );
    });

    const applied: DeadlineEntryCheck[] = [];
    for (const { entry, before } of plain) {
      const updated = await this.findItemOrThrow(pi.id, entry.itemId);
      await this.deadlineWriter.auditAndNotifyDeadlineChange(pi.code, before, updated);
      const changes = diffValues(valuesOfItem(before), valuesOfItem(updated));
      applied.push({
        itemId: updated.id.toString(),
        lenhCode: updated.lsxCode ?? lenhDisplayCode(pi, pi.items),
        skuCode: updated.mfgProduct.factoryCode,
        kind: changes.length > 0 ? 'APPLY' : 'NO_CHANGE',
        changes,
        errors: [],
        // Cảnh báo thứ tự mốc cho cả dòng sửa thẳng - chỉ khi có đổi; khi ORDER_VIOLATION_BLOCKS = true thì đã bị chặn ở
        // giao dịch (Đợt 9 phần 2, Q9-2) nên đến đây không còn câu nào; = false thì chỉ cảnh báo.
        warnings:
          changes.length > 0 && !ORDER_VIOLATION_BLOCKS
            ? milestoneOrderWarnings({
                ...valuesOfItem(updated),
                deliveryDeadline: updated.deliveryDeadline
                  ? vnDayKey(updated.deliveryDeadline)
                  : null,
              })
            : [],
      });
    }

    let batch: DeadlineChangeBatchDto | null = null;
    if (approvedEntries.length > 0) {
      const saved = await this.deadlineChanges.saveEntries(actor, approvedEntries, 'MANUAL', {
        strict: true,
      });
      batch = saved.batch;
    }
    const out = await this.findOne(piId);
    out.deadlineSave = { applied, batch, skipped: [] };
    return out;
  }

  /** Đầu vào "Sửa thời hạn" → mốc dạng `DeadlineValues` ('YYYY-MM-DD' ngày VN). `deliveryDeadline` KHÔNG vào (dòng đã duyệt không đổi hạn giao). */
  private deadlineValuesOfDto(dto: UpdateProductionInvoiceItemDto): DeadlineValues {
    const out: DeadlineValues = {};
    if (dto.materialDeadline) out.materialDeadline = vnDayKey(new Date(dto.materialDeadline));
    if (dto.finishedMaterialDeadline) {
      out.finishedMaterialDeadline = vnDayKey(new Date(dto.finishedMaterialDeadline));
    }
    for (const st of dto.stages ?? []) {
      out[`stage.${st.stageType}` as DeadlineFieldKey] = vnDayKey(new Date(st.deadline));
    }
    return out;
  }

  /** Mã lệnh hiển thị của dòng (số LSX của dòng, không có thì mã gộp của lệnh) - như phần `applied`. */
  private lenhCodeOfItem(
    pi: { code: string; items: readonly { lsxCode?: string | null }[] },
    item: { lsxCode: string | null },
  ): string {
    return item.lsxCode ?? lenhDisplayCode(pi, pi.items);
  }

  /**
   * Phần A – Đợt 9 phần 2 (Q9-3): dòng sửa thẳng mà lệnh SX đã bắt đầu (floorStage khác PENDING) → 400. Chưa có lệnh SX = chưa bắt đầu.
   * Phòng xa: dòng chưa Sếp duyệt thường chưa có lệnh SX.
   */
  private async assertFloorNotStarted(
    pi: { code: string; items: readonly { lsxCode?: string | null }[] },
    items: PIItemWithRefs[],
  ): Promise<void> {
    if (items.length === 0) return;
    const orders = await this.prisma.productionOrder.findMany({
      where: { productionInvoiceItemId: { in: items.map((i) => i.id) } },
      select: { productionInvoiceItemId: true, floorStage: true },
    });
    const started = new Set(
      orders
        .filter((o) => o.floorStage !== ProductionOrderFloorStage.PENDING)
        .map((o) => String(o.productionInvoiceItemId)),
    );
    const lines = items
      .filter((i) => started.has(i.id.toString()))
      .map(
        (i) =>
          `${this.lenhCodeOfItem(pi, i)} · ${i.mfgProduct.factoryCode}: ${FLOOR_STARTED_ERROR}`,
      );
    if (lines.length > 0) throw new BadRequestException(lines.join('\n'));
  }

  /**
   * Phần A – Đợt 9 phần 2 (Q9-2 = B): sau khi ghi dòng sửa thẳng, đọc lại trong giao dịch; dòng CÓ ĐỔI mà thứ tự mốc ngược →
   * 400 (rollback cả lần). Dòng không đổi thì không kiểm (dữ liệu cũ sai thứ tự không chặn dòng không sửa). `ORDER_VIOLATION_BLOCKS`
   * = false thì không chặn (chỉ còn cảnh báo ở kết quả).
   */
  private async assertMilestoneOrderAfterWrite(
    tx: PrismaTx,
    pi: { code: string; deadline: Date | null; items: readonly { lsxCode?: string | null }[] },
    befores: PIItemWithRefs[],
  ): Promise<void> {
    if (!ORDER_VIOLATION_BLOCKS) return;
    const lines: string[] = [];
    for (const before of befores) {
      const after = await tx.productionInvoiceItem.findUniqueOrThrow({
        where: { id: before.id },
        include: { stages: true },
      });
      const valuesChanged = diffValues(valuesOfItem(before), valuesOfItem(after)).length > 0;
      const deliveryChanged =
        (before.deliveryDeadline?.getTime() ?? null) !==
        (after.deliveryDeadline?.getTime() ?? null);
      if (!valuesChanged && !deliveryChanged) continue;
      // Hạn giao riêng của dòng, chưa có thì hạn của lệnh (như form hiện; lõi đổi mốc kiểm cùng cách).
      const delivery = after.deliveryDeadline ?? pi.deadline ?? null;
      const warnings = milestoneOrderWarnings({
        ...valuesOfItem(after),
        deliveryDeadline: delivery ? vnDayKey(delivery) : null,
      });
      for (const w of warnings) {
        lines.push(`${this.lenhCodeOfItem(pi, before)} · ${before.mfgProduct.factoryCode}: ${w}`);
      }
    }
    if (lines.length > 0) throw new BadRequestException(lines.join('\n'));
  }

  /** Đợt 9: PI huỷ không sửa mốc được (lệnh Kết thúc do DeadlineChangesService chặn riêng cho dòng đã duyệt). */
  private assertPiAllowsDeadlineEdit(pi: { status: ProductionInvoiceStatus }): void {
    if (pi.status === ProductionInvoiceStatus.CANCELLED) {
      throw new BadRequestException('Lệnh đã huỷ - không sửa được thời hạn');
    }
  }

  // ─── Phần A – Đợt 2: số LSX + xưởng cơ khí ─────────────────────────────────────

  /**
   * Phần A – Đợt 2: KHSX/Admin nhập-sửa-xoá số LSX của 1 dòng SKU (PATCH :id/items/:itemId/lsx). Số lưu dạng chuẩn hoá,
   * không trùng toàn hệ thống. Dòng đã Sếp duyệt: chỉ được BỔ SUNG khi đang trống, đổi/xoá phải là Admin.
   */
  async updateItemLsx(
    piId: string,
    itemId: string,
    raw: string | null,
    actor: { id: string; roles: string[] },
  ): Promise<ProductionInvoiceItemResponseDto> {
    const pi = await this.findOneOrThrow(piId);
    const item = await this.findItemOrThrow(pi.id, itemId);

    const trimmed = raw === null ? '' : raw.trim();
    const next = trimmed === '' ? null : normalizeLsxCode(trimmed);
    if (next !== null && !isValidLsxCode(next)) {
      throw new BadRequestException(
        'Số LSX phải dạng TIỀN TỐ-SỐ, vd MY-313 (1–6 chữ cái, 1–6 chữ số)',
      );
    }
    if (next === item.lsxCode) return this.toItemResponseDto(item);

    if (next !== null) {
      const config = await this.prisma.systemConfig.findUniqueOrThrow({
        where: { id: SYSTEM_CONFIG_ID },
        select: { lsxPrefixes: true },
      });
      const prefix = lsxPrefixOf(next);
      if (
        config.lsxPrefixes.length > 0 &&
        prefix !== null &&
        !config.lsxPrefixes.includes(prefix)
      ) {
        throw new BadRequestException(
          `Tiền tố ${prefix} chưa có trong Cấu hình hệ thống (đang có: ${config.lsxPrefixes.join(', ')})`,
        );
      }
    }
    if (
      item.prodApprovalStatus === ProdApprovalStatus.APPROVED &&
      item.lsxCode !== null &&
      !actor.roles.includes(DEFAULT_ROLES.ADMIN)
    ) {
      throw new ForbiddenException(
        'Lệnh đã được Sếp duyệt - số LSX chỉ được bổ sung khi đang trống; muốn đổi phải nhờ Admin',
      );
    }
    if (next !== null) await this.assertLsxNotTaken(next, item.id);

    try {
      await this.prisma.productionInvoiceItem.update({
        where: { id: item.id },
        data: { lsxCode: next },
      });
    } catch (error) {
      if (
        next !== null &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // 2 người nhập cùng số cùng lúc: unique index chặn người thứ hai.
        await this.assertLsxNotTaken(next, item.id);
        throw new ConflictException(`Số LSX ${next} đang được dùng ở một lệnh khác`);
      }
      throw error;
    }
    await auditEvent(this.prisma, this.cls, this.logger, {
      action: AuditAction.UPDATE,
      tableName: 'ProductionInvoiceItem',
      recordId: item.id,
      oldValue: { lsxCode: item.lsxCode },
      newValue: { lsxCode: next },
    });
    this.publishRealtime('PRODUCTION_INVOICE', pi.id, 'UPDATED', actor.id);
    return this.toItemResponseDto(await this.findItemOrThrow(pi.id, itemId));
  }

  /** Số LSX đã có ở dòng khác -> 409 kèm mã lệnh đang giữ số. */
  private async assertLsxNotTaken(lsxCode: string, exceptItemId: bigint): Promise<void> {
    const holder = await this.prisma.productionInvoiceItem.findFirst({
      where: { lsxCode, id: { not: exceptItemId } },
      include: { mfgProduct: true },
    });
    if (!holder) return;
    let where = 'SKU chưa gom vào lệnh';
    if (holder.productionInvoiceId !== null) {
      const codes = await loadLenhDisplayCodes(this.prisma, [holder.productionInvoiceId]);
      where = codes.get(holder.productionInvoiceId.toString()) ?? where;
    }
    throw new ConflictException(
      `Số LSX ${lsxCode} đang dùng ở lệnh ${where} (SKU ${holder.mfgProduct.factoryCode})`,
    );
  }

  /**
   * Phần A – Đợt 2: QLSX đổi xưởng cơ khí của CẢ lệnh (PATCH :id/workshop) sau khi đã gửi Sếp/đã duyệt - chỉ được khi chưa xuất
   * sắt / vật tư cho xưởng. Kiểm 2 lần (trước + trong transaction) để chống đua với xuất sắt.
   */
  async changeWorkshop(
    piId: string,
    workshopId: string,
    reason: string,
    actorUserId: string,
  ): Promise<ProductionInvoiceResponseDto> {
    const pi = await this.findOneOrThrow(piId);
    if (pi.items.length === 0) {
      throw new ConflictException(`Lệnh ${pi.code} không còn SKU nào - không đổi xưởng được`);
    }
    const notSent = pi.items.find(
      (it) =>
        it.prodApprovalStatus !== ProdApprovalStatus.WAITING_BOSS &&
        it.prodApprovalStatus !== ProdApprovalStatus.APPROVED,
    );
    if (notSent) {
      throw new ConflictException(
        `Chỉ đổi xưởng khi mọi SKU của lệnh đã gửi Sếp hoặc đã duyệt (còn SKU ${
          notSent.mfgProduct.factoryCode
        }: ${notSent.prodApprovalStatus ?? 'chưa gửi'})`,
      );
    }
    const workshop = await this.prisma.workshop.findUnique({
      where: { id: parseBigIntId(workshopId) },
    });
    if (!workshop || !workshop.isActive) {
      throw new BadRequestException('Xưởng cơ khí không tồn tại hoặc đã ngừng dùng');
    }
    if (pi.items.every((it) => it.workshopId === workshop.id)) {
      throw new BadRequestException(`Lệnh đang ở ${workshop.name} rồi`);
    }
    const displayCode = lenhDisplayCode(pi, pi.items);
    const ids = pi.items.map((it) => it.id);
    await this.assertNoMaterialIssued(this.prisma, pi.id, ids, displayCode);

    let cuttingRecheckFlagged = false;
    const notifyWorkshopMove = await this.prisma.$transaction(async (tx) => {
      await this.assertNoMaterialIssued(tx, pi.id, ids, displayCode);
      const { count } = await tx.productionInvoiceItem.updateMany({
        where: {
          id: { in: ids },
          prodApprovalStatus: {
            in: [ProdApprovalStatus.WAITING_BOSS, ProdApprovalStatus.APPROVED],
          },
        },
        data: { workshopId: workshop.id },
      });
      if (count !== ids.length) {
        throw new ConflictException(
          `Lệnh ${displayCode} đã có thay đổi khác trong lúc đổi xưởng - tải lại trang rồi thử lại`,
        );
      }
      // Phần A: lệnh đã có phương án cắt APPROVED (neo PI - đợt gộp - hoặc neo SKU) -> bật cờ "cần kiểm lại"; đã bật thì giữ bật,
      // cập nhật lại thời điểm. Không tự tính lại / duyệt phương án mới.
      const approvedProposals = await tx.cuttingProposal.count({
        where: {
          status: CuttingProposalStatus.APPROVED,
          OR: [
            { productionInvoiceId: pi.id },
            { productionOrder: { productionInvoiceItem: { productionInvoiceId: pi.id } } },
          ],
        },
      });
      if (approvedProposals > 0) {
        await tx.productionInvoice.update({
          where: { id: pi.id },
          data: {
            cuttingRecheckRequired: true,
            cuttingRecheckRequiredAt: new Date(),
            cuttingRecheckedAt: null,
            cuttingRecheckedById: null,
          },
        });
        cuttingRecheckFlagged = true;
      }
      // Người B (10/11/2026): đổi nơi nhận dòng mua chưa về sang kho xưởng mới, cùng lần lưu; thông báo gửi sau commit.
      return this.workshopMove.afterWorkshopChanged(tx, pi.id, workshop.id, actorUserId);
    });
    await notifyWorkshopMove();

    for (const it of pi.items) {
      await auditEvent(this.prisma, this.cls, this.logger, {
        action: AuditAction.UPDATE,
        tableName: 'ProductionInvoiceItem',
        recordId: it.id,
        oldValue: {
          workshopId: it.workshopId?.toString() ?? null,
          workshopCode: it.workshop?.code ?? null,
        },
        newValue: { workshopId: workshop.id.toString(), workshopCode: workshop.code, reason },
      });
    }
    // Phần A – Đợt 3 (V4-5): đổi sang xưởng làm số ngày khác -> báo KHSX đặt lại mốc.
    await this.notifyTimelineReplanIfNeeded(pi, pi.items, workshop, actorUserId);
    try {
      await this.notifications.emit('PI_WORKSHOP_CHANGED', {
        entityId: pi.id.toString(),
        actorId: actorUserId,
        params: {
          piCode: pi.code,
          displayCode,
          fromWorkshop: pi.items.find((it) => it.workshop)?.workshop?.name ?? null,
          toWorkshop: workshop.name,
          reason,
          count: ids.length,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to create PI_WORKSHOP_CHANGED notification (PI ${pi.id}): ${(error as Error).message}`,
      );
    }
    if (cuttingRecheckFlagged) {
      try {
        await this.notifications.emit('PI_CUTTING_RECHECK_REQUIRED', {
          entityId: pi.id.toString(),
          actorId: actorUserId,
          params: {
            piCode: pi.code,
            displayCode,
            fromWorkshop: pi.items.find((it) => it.workshop)?.workshop?.name ?? null,
            toWorkshop: workshop.name,
          },
        });
      } catch (error) {
        this.logger.error(
          `Failed to create PI_CUTTING_RECHECK_REQUIRED notification (PI ${pi.id}): ${(error as Error).message}`,
        );
      }
    }
    this.publishRealtime('PRODUCTION_INVOICE', pi.id, 'UPDATED', actorUserId);
    return this.findOne(piId);
  }

  /** Phần A: danh sách lệnh đang bật cờ "cần kiểm lại phương án cắt", mới bật nhất trước. */
  async listCuttingRecheckPending(): Promise<CuttingRecheckPendingResponseDto[]> {
    const rows = await this.prisma.productionInvoice.findMany({
      where: { cuttingRecheckRequired: true },
      orderBy: { cuttingRecheckRequiredAt: 'desc' },
      include: { items: { include: { workshop: true } } },
    });
    return rows.map(
      (pi) =>
        new CuttingRecheckPendingResponseDto({
          productionInvoiceId: pi.id.toString(),
          piCode: pi.code,
          displayCode: lenhDisplayCode(pi, pi.items),
          workshopName: pi.items.find((it) => it.workshop)?.workshop?.name ?? null,
          requiredAt: (pi.cuttingRecheckRequiredAt ?? pi.updatedAt).toISOString(),
        }),
    );
  }

  /** Phần A: KHSX bấm "Đã kiểm" -> tắt cờ, ghi ai/lúc nào. Không tính lại / duyệt phương án mới. */
  async confirmCuttingRecheck(
    piId: string,
    actorUserId: string,
  ): Promise<ProductionInvoiceResponseDto> {
    const pi = await this.findOneOrThrow(piId);
    const displayCode = lenhDisplayCode(pi, pi.items);
    const { count } = await this.prisma.productionInvoice.updateMany({
      where: { id: pi.id, cuttingRecheckRequired: true },
      data: {
        cuttingRecheckRequired: false,
        cuttingRecheckedAt: new Date(),
        cuttingRecheckedById: actorUserId,
      },
    });
    if (count === 0) {
      throw new ConflictException(
        `Lệnh ${displayCode} không có phương án cắt cần kiểm lại (có thể người khác vừa bấm Đã kiểm)`,
      );
    }
    await auditEvent(this.prisma, this.cls, this.logger, {
      action: AuditAction.UPDATE,
      tableName: 'ProductionInvoice',
      recordId: pi.id,
      oldValue: { cuttingRecheckRequired: true },
      newValue: { cuttingRecheckRequired: false, cuttingRecheckedById: actorUserId },
    });
    try {
      await this.notifications.resolve({
        entityType: 'PRODUCTION_INVOICE',
        entityId: pi.id.toString(),
        types: ['PI_CUTTING_RECHECK_REQUIRED'],
      });
    } catch (error) {
      this.logger.error(
        `Failed to resolve PI_CUTTING_RECHECK_REQUIRED (PI ${pi.id}): ${(error as Error).message}`,
      );
    }
    this.publishRealtime('PRODUCTION_INVOICE', pi.id, 'UPDATED', actorUserId);
    return this.findOne(piId);
  }

  /** Đã xuất sắt cho PI hoặc xuất vật tư cho xưởng (theo production order của các dòng) -> 409. `client` = prisma hoặc tx. */
  private async assertNoMaterialIssued(
    client: Pick<
      PrismaServiceType,
      'steelIssue' | 'materialYieldIssue' | 'stockReservation' | 'purchaseProposalItem'
    >,
    piId: bigint,
    itemIds: bigint[],
    displayCode: string,
  ): Promise<void> {
    const steel = await client.steelIssue.count({ where: { productionInvoiceId: piId } });
    if (steel > 0) {
      throw new ConflictException(`Lệnh ${displayCode} đã xuất sắt - không đổi xưởng được`);
    }
    const yieldIssues = await client.materialYieldIssue.count({
      where: { productionOrder: { productionInvoiceItemId: { in: itemIds } } },
    });
    if (yieldIssues > 0) {
      throw new ConflictException(
        `Lệnh ${displayCode} đã xuất vật tư cho xưởng - không đổi xưởng được`,
      );
    }
    // Chặn tạm Đợt 7 (lệnh đã giữ chỗ / đang mua ở kho xưởng cũ) ĐÃ GỠ 10/11/2026 - đổi xưởng nay tự đổi nơi nhận dòng mua chưa về
    // và thủ kho xưởng cũ lập phiếu chuyển hàng đang giữ (WorkshopMoveService, người B).
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
    // Phần A – Đợt 2: KHSX phải nhập số LSX trước khi gửi QLSX (lệnh cũ đang chờ sẵn không bị chặn ở bước sau).
    if (!item.lsxCode) {
      throw new BadRequestException(
        `Chưa nhập số LSX cho SKU ${item.mfgProduct.factoryCode} - nhập ở ô 'Số LSX' rồi gửi lại`,
      );
    }
    // Phần A – Đợt 3 (Q2): mốc nào còn trống thì tự lưu ngày đề xuất theo năng lực (vi phạm luật gộp -> 400, chưa đổi trạng thái).
    const autoFilled = await this.autofillSuggestedDeadlines(pi, [item]);

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
        `SKU ${item.id} đã được xử lý bởi 1 yêu cầu khác trong lúc gửi QLSX - không ghi đè`,
      );
    }
    // Đã tự lưu mốc -> đọc lại để phản hồi có đủ mốc mới.
    const fresh = autoFilled > 0 ? await this.findItemOrThrow(pi.id, itemId) : item;
    const updated = { ...fresh, ...data };
    await this.auditItemApprovalTransition(item, { ...item, ...data });
    // "n SKU" = mọi item KHÁC của PI này đang WAITING_QLSX (đọc từ pi.items TRƯỚC lệnh ghi trên,
    // không đổi trạng thái) cộng chính item vừa gửi - dedupeKey gộp các lần gửi liên tiếp trước khi
    // QLSX kịp xử lý thành 1 dòng duy nhất, count tự cập nhật theo lần gọi gần nhất (mục 15.2 style
    // "best-effort NGOÀI tx").
    const waitingQlsx =
      pi.items.filter(
        (it) => it.id !== item.id && it.prodApprovalStatus === ProdApprovalStatus.WAITING_QLSX,
      ).length + 1;
    await this.notifyPi(
      'PI_SENT_TO_QLSX',
      pi.id,
      { piCode: pi.code, count: waitingQlsx },
      `PI_SENT_TO_QLSX:${pi.id}`,
      actorUserId,
    );
    return this.toItemResponseDto(updated);
  }

  /** QLSX chọn kho thành phẩm làm điểm cuối rồi gửi Sếp duyệt - mirror sendItemToBoss() mock. */
  async sendItemToBoss(
    piId: string,
    itemId: string,
    warehouseCode: string,
    warehouseName: string,
    workshopId: string | undefined,
    actorUserId: string,
  ): Promise<ProductionInvoiceItemResponseDto> {
    const pi = await this.findOneOrThrow(piId);
    const item = await this.findItemOrThrow(pi.id, itemId);
    this.assertItemStatus(item, ProdApprovalStatus.WAITING_QLSX);
    // Phần A – Đợt 2: bắt buộc chọn xưởng cơ khí; 1 PI = 1 xưởng.
    const workshop = await this.resolveWorkshopForSend(pi, [item.id], workshopId);

    const data = {
      prodApprovalStatus: ProdApprovalStatus.WAITING_BOSS,
      warehouseCode,
      warehouseName,
      workshopId: workshop.id,
      qlsxAt: new Date(),
      qlsxById: actorUserId,
    };
    const { count } = await this.prisma.productionInvoiceItem.updateMany({
      where: { id: item.id, prodApprovalStatus: ProdApprovalStatus.WAITING_QLSX },
      data,
    });
    if (count === 0) {
      throw new ConflictException(
        `SKU ${item.id} đã được xử lý bởi 1 yêu cầu khác trong lúc gửi Sếp - không ghi đè`,
      );
    }
    await this.auditItemApprovalTransition(item, { ...item, ...data });
    // Phần A – Đợt 3 (V4-5): xưởng QLSX chọn làm số ngày khác xưởng đã dùng để đề xuất mốc -> báo KHSX đặt lại mốc.
    await this.notifyTimelineReplanIfNeeded(pi, [item], workshop, actorUserId);
    // Item vừa rời WAITING_QLSX - nếu KHÔNG còn item nào khác của PI này ở đó, đóng thông báo
    // "chờ QLSX" (mọi SKU trong hàng đợi đã được QLSX xử lý xong).
    const stillWaitingQlsx = pi.items.some(
      (it) => it.id !== item.id && it.prodApprovalStatus === ProdApprovalStatus.WAITING_QLSX,
    );
    if (!stillWaitingQlsx) {
      await this.resolvePiNotifications('PRODUCTION_INVOICE', pi.id, ['PI_SENT_TO_QLSX']);
    }
    const waitingBoss =
      pi.items.filter(
        (it) => it.id !== item.id && it.prodApprovalStatus === ProdApprovalStatus.WAITING_BOSS,
      ).length + 1;
    await this.notifyPi(
      'PI_SENT_TO_BOSS',
      pi.id,
      { piCode: pi.code, count: waitingBoss },
      `PI_SENT_TO_BOSS:${pi.id}`,
      actorUserId,
    );
    // Phần A – Đợt 2: đọc lại từ DB để khối `workshop` là xưởng MỚI (không spread {...item, ...data}).
    return this.toItemResponseDto(await this.findItemOrThrow(pi.id, itemId));
  }

  /**
   * Phần A – Đợt 2: kiểm xưởng cơ khí lúc QLSX gửi Sếp. Thiếu -> 400 (FE bản cũ); không tồn tại/ngừng dùng -> 400;
   * 1 PI = 1 xưởng (xuất sắt/giữ chỗ theo PI): SKU KHÁC của PI (ngoài tập đang gửi) đã WAITING_BOSS/APPROVED ở xưởng khác -> 409.
   */
  private async resolveWorkshopForSend(
    pi: PIWithRefs,
    targetIds: bigint[],
    workshopId: string | undefined,
  ): Promise<Workshop> {
    if (!workshopId || workshopId.trim() === '') {
      throw new BadRequestException(
        'Thiếu xưởng cơ khí - trang đang là phiên bản cũ, hãy tải lại trang (F5) rồi chọn xưởng',
      );
    }
    const workshop = await this.prisma.workshop.findUnique({
      where: { id: parseBigIntId(workshopId) },
    });
    if (!workshop || !workshop.isActive) {
      throw new BadRequestException('Xưởng cơ khí không tồn tại hoặc đã ngừng dùng');
    }
    const targetSet = new Set(targetIds.map((id) => id.toString()));
    const other = pi.items.find(
      (it) =>
        !targetSet.has(it.id.toString()) &&
        (it.prodApprovalStatus === ProdApprovalStatus.WAITING_BOSS ||
          it.prodApprovalStatus === ProdApprovalStatus.APPROVED) &&
        it.workshopId !== null &&
        it.workshopId !== workshop.id,
    );
    if (other) {
      throw new ConflictException(
        `Lệnh ${lenhDisplayCode(pi, pi.items)} đã có SKU gửi Sếp ở ${
          other.workshop?.name ?? 'xưởng khác'
        } - mọi SKU của một lệnh phải cùng 1 xưởng`,
      );
    }
    return workshop;
  }

  // ─── Phần A – Đợt 3 (YC10): mốc đề xuất theo năng lực ──────────────────────────────

  /** Tham số năng lực Admin cấu hình; thiếu/lỗi -> mặc định (1,3 cont/ngày, 4 ngày/cont). */
  private async loadTimelineParams(): Promise<TimelineParams> {
    const cfg = await this.prisma.systemConfig.findUniqueOrThrow({
      where: { id: SYSTEM_CONFIG_ID },
      select: { capacityContPerDay: true, daysPerContPhuocAn: true },
    });
    // Decimal -> number (Number() chạy được cả với Decimal lẫn số thường); thiếu -> mặc định.
    const cap = Number(cfg.capacityContPerDay);
    const days = Number(cfg.daysPerContPhuocAn);
    return {
      capacityContPerDay:
        Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_TIMELINE_PARAMS.capacityContPerDay,
      daysPerContPhuocAn:
        Number.isFinite(days) && days > 0 ? days : DEFAULT_TIMELINE_PARAMS.daysPerContPhuocAn,
    };
  }

  /** "Xưởng dự kiến" khi dòng chưa có xưởng (V4-5): Phú An (code PHU_AN); không có trong bảng -> coi là cont/ngày. */
  private async loadDefaultWorkshop(): Promise<{ name: string; mode: TimelineCapacityMode }> {
    const w = await this.prisma.workshop.findUnique({ where: { code: 'PHU_AN' } });
    return {
      name: w?.name ?? 'Xưởng Phú An',
      mode: w?.capacityMode === 'DAYS_PER_CONT' ? 'DAYS_PER_CONT' : 'CONT_PER_DAY',
    };
  }

  /**
   * Q2: lúc KHSX gửi QLSX, mốc nào còn TRỐNG thì BE tự lưu ngày đề xuất (công thức `suggestTimeline`, xưởng của dòng, chưa có thì Phú An).
   * Không ghi đè mốc đã có, không đụng deliveryDeadline. Chạy trong 1 transaction; PI gộp kiểm lại luật gộp (vi phạm -> 400, không lưu gì).
   * Audit từng dòng có ghi (newValue.source = AUTO_FILL_ON_SEND_QLSX), KHÔNG gửi thông báo. Trả số dòng đã ghi.
   */
  private async autofillSuggestedDeadlines(
    pi: PIWithRefs,
    items: PIItemWithRefs[],
  ): Promise<number> {
    const params = await this.loadTimelineParams();
    const defaultMode = (await this.loadDefaultWorkshop()).mode;

    type Plan = {
      item: PIItemWithRefs;
      itemData: { materialDeadline?: Date; finishedMaterialDeadline?: Date };
      stages: { stageType: ProdItemStageType; deadline: Date }[];
    };
    const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
    const plans: Plan[] = [];
    for (const item of items) {
      const stageDay = (t: ProdItemStageType) => {
        const st = item.stages.find((x) => x.stageType === t);
        return st ? vnDayKey(st.deadline) : null;
      };
      const suggestion = suggestTimeline(
        {
          quantity: item.quantity,
          loadCont: item.mfgProduct.loadCont,
          capacityMode: item.workshop?.capacityMode ?? defaultMode,
          saved: {
            PHOI_START: stageDay('PHOI_START'),
            FRAME_PHOI: stageDay('FRAME_PHOI'),
            FRAME: stageDay('FRAME'),
            PACKAGING_START: stageDay('PACKAGING_START'),
            PACKAGING: stageDay('PACKAGING'),
          },
          delivery: item.deliveryDeadline
            ? vnDayKey(item.deliveryDeadline)
            : pi.deadline
              ? vnDayKey(pi.deadline)
              : null,
        },
        params,
      );
      if (!suggestion) continue;
      const plan: Plan = { item, itemData: {}, stages: [] };
      if (!item.materialDeadline) {
        plan.itemData.materialDeadline = toDate(suggestion.dates.materialDeadline);
      }
      if (!item.finishedMaterialDeadline) {
        plan.itemData.finishedMaterialDeadline = toDate(suggestion.dates.finishedMaterialDeadline);
      }
      const stageTypes: ProdItemStageType[] = [
        'PHOI_START',
        'FRAME_PHOI',
        'FRAME_HAN',
        'FRAME_SON',
        'FRAME',
        'WEAVING',
        'TRANSFER_CHECK',
        'PACKAGING_START',
        'PACKAGING',
      ];
      for (const t of stageTypes) {
        if (item.stages.some((x) => x.stageType === t)) continue;
        plan.stages.push({ stageType: t, deadline: toDate(suggestion.dates[t]) });
      }
      if (Object.keys(plan.itemData).length > 0 || plan.stages.length > 0) plans.push(plan);
    }
    if (plans.length === 0) return 0;

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const plan of plans) {
          if (Object.keys(plan.itemData).length > 0) {
            await tx.productionInvoiceItem.update({
              where: { id: plan.item.id },
              data: plan.itemData,
            });
          }
          for (const st of plan.stages) {
            // update: {} - lỡ có người vừa đặt mốc này giữa chừng thì KHÔNG ghi đè.
            await tx.productionInvoiceItemStage.upsert({
              where: {
                productionInvoiceItemId_stageType: {
                  productionInvoiceItemId: plan.item.id,
                  stageType: st.stageType,
                },
              },
              create: {
                productionInvoiceItemId: plan.item.id,
                stageType: st.stageType,
                deadline: st.deadline,
              },
              update: {},
            });
          }
        }
        if (pi.isMerged) await this.deadlineWriter.assertMergedPiDeadlineRule(tx, pi.id);
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw new BadRequestException(
          `${error.message} - mở "Sửa thời hạn" đặt mốc Mua VT khung & đan của các SKU rồi gửi lại`,
        );
      }
      throw error;
    }

    for (const plan of plans) {
      const oldValue: Record<string, string | null> = {};
      const newValue: Record<string, string | null> = { source: 'AUTO_FILL_ON_SEND_QLSX' };
      for (const [k, v] of Object.entries(plan.itemData)) {
        oldValue[k] = null;
        newValue[k] = v.toISOString();
      }
      for (const st of plan.stages) {
        oldValue[`stage.${st.stageType}`] = null;
        newValue[`stage.${st.stageType}`] = st.deadline.toISOString();
      }
      await auditEvent(this.prisma, this.cls, this.logger, {
        action: AuditAction.UPDATE,
        tableName: 'ProductionInvoiceItem',
        recordId: plan.item.id,
        oldValue,
        newValue,
      });
    }
    return plans.length;
  }

  /**
   * V4-5: QLSX chọn / đổi xưởng mà số ngày X (Phôi = Hàn = Sơn) khác X của xưởng đã dùng để đề xuất mốc (xưởng cũ của dòng, chưa có
   * thì Phú An) -> gom các dòng lệch của PI thành 1 thông báo cho KHSX. Best-effort, KHÔNG chặn thao tác (lỗi chỉ log).
   */
  private async notifyTimelineReplanIfNeeded(
    pi: PIWithRefs,
    items: PIItemWithRefs[],
    newWorkshop: Workshop,
    actorUserId: string,
  ): Promise<void> {
    try {
      const params = await this.loadTimelineParams();
      const fallback = items.some((it) => !it.workshop) ? await this.loadDefaultWorkshop() : null;
      const newMode: TimelineCapacityMode =
        newWorkshop.capacityMode === 'DAYS_PER_CONT' ? 'DAYS_PER_CONT' : 'CONT_PER_DAY';
      const lines: string[] = [];
      for (const it of items) {
        const oldMode = it.workshop?.capacityMode ?? fallback?.mode ?? 'CONT_PER_DAY';
        const oldName = it.workshop?.name ?? fallback?.name ?? 'Xưởng Phú An';
        const oldDays = frameDaysOf(it.quantity, it.mfgProduct.loadCont, oldMode, params);
        const newDays = frameDaysOf(it.quantity, it.mfgProduct.loadCont, newMode, params);
        if (oldDays === newDays) continue;
        lines.push(
          `${it.mfgProduct.factoryCode}: Phôi/Hàn/Sơn cần ${newDays} ngày mỗi công đoạn ở ${newWorkshop.name} (mốc đang đặt theo ${oldName}: ${oldDays} ngày)`,
        );
      }
      if (lines.length === 0) return;
      await this.notifications.emit('PI_TIMELINE_NEEDS_REPLAN', {
        entityId: pi.id.toString(),
        actorId: actorUserId,
        params: {
          piCode: pi.code,
          displayCode: lenhDisplayCode(pi, pi.items),
          workshopName: newWorkshop.name,
          lines,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to create PI_TIMELINE_NEEDS_REPLAN notification (PI ${pi.id}): ${(error as Error).message}`,
      );
    }
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
    // Phần A – Đợt 2: mọi SKU sẽ gửi phải có số LSX - thiếu thì không gửi gì, liệt kê hết.
    const missingLsx = targets.filter((it) => !it.lsxCode);
    if (missingLsx.length > 0) {
      throw new BadRequestException(
        `Chưa nhập số LSX cho SKU ${missingLsx
          .map((it) => it.mfgProduct.factoryCode)
          .join(', ')} - nhập ở ô 'Số LSX' rồi gửi lại`,
      );
    }
    // Phần A – Đợt 3 (Q2): tự lưu ngày đề xuất cho mốc còn trống của mọi SKU sẽ gửi.
    await this.autofillSuggestedDeadlines(pi, targets);

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
    const targetIds = new Set(targets.map((it) => it.id.toString()));
    const waitingQlsx =
      pi.items.filter(
        (it) =>
          !targetIds.has(it.id.toString()) &&
          it.prodApprovalStatus === ProdApprovalStatus.WAITING_QLSX,
      ).length + targets.length;
    await this.notifyPi(
      'PI_SENT_TO_QLSX',
      pi.id,
      { piCode: pi.code, count: waitingQlsx },
      `PI_SENT_TO_QLSX:${pi.id}`,
      actorUserId,
    );
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
    workshopId: string | undefined,
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
    // Phần A – Đợt 2: xưởng cơ khí chung cho cả lần gửi; 1 PI = 1 xưởng.
    const workshop = await this.resolveWorkshopForSend(
      pi,
      targets.map((it) => it.id),
      workshopId,
    );

    const qlsxAt = new Date();
    await this.prisma.productionInvoiceItem.updateMany({
      where: { id: { in: targets.map((it) => it.id) } },
      data: {
        prodApprovalStatus: ProdApprovalStatus.WAITING_BOSS,
        warehouseCode,
        warehouseName,
        workshopId: workshop.id,
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
        workshopId: workshop.id,
        qlsxAt,
        qlsxById: actorUserId,
      });
    }
    // Phần A – Đợt 3 (V4-5): báo KHSX nếu xưởng chọn làm số ngày khác xưởng đã dùng để đề xuất mốc.
    await this.notifyTimelineReplanIfNeeded(pi, targets, workshop, actorUserId);
    const targetIds = new Set(targets.map((it) => it.id.toString()));
    const stillWaitingQlsx = pi.items.some(
      (it) =>
        !targetIds.has(it.id.toString()) &&
        it.prodApprovalStatus === ProdApprovalStatus.WAITING_QLSX,
    );
    if (!stillWaitingQlsx) {
      await this.resolvePiNotifications('PRODUCTION_INVOICE', pi.id, ['PI_SENT_TO_QLSX']);
    }
    const waitingBoss =
      pi.items.filter(
        (it) =>
          !targetIds.has(it.id.toString()) &&
          it.prodApprovalStatus === ProdApprovalStatus.WAITING_BOSS,
      ).length + targets.length;
    await this.notifyPi(
      'PI_SENT_TO_BOSS',
      pi.id,
      { piCode: pi.code, count: waitingBoss },
      `PI_SENT_TO_BOSS:${pi.id}`,
      actorUserId,
    );
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

    // Luồng "Solve trước → tạo PI" (2026-09-30): PI này đã có phương án cắt tính sẵn -> Sếp duyệt
    // ĐÚNG số đó, không chạy solver lại. Kiểm phương án còn đúng (chưa lỗi thời) + vật tư đã có Kho
    // TRƯỚC khi ghi APPROVED/tạo PO; thay cho kiểm BOM active vì cổng đó đã bao gồm việc revision
    // ACTIVE phải trùng revision đã tính.
    const preSolved = await this.cuttingProposalsService.findPreSolvedForInvoice(pi.id);
    let pinnedRevisions: Map<bigint, bigint> | undefined;
    if (preSolved) {
      if (preSolved.status !== CuttingProposalStatus.DRAFT) {
        throw new ConflictException(
          `Phương án cắt ${preSolved.id} của ${pi.code} đã ở trạng thái ${preSolved.status} - không duyệt lại được`,
        );
      }
      pinnedRevisions = (
        await this.cuttingProposalsService.assertReadyForApproval(preSolved.id, pi.id)
      ).revisionByItemId;
    } else {
      // Duyệt SKU luôn kéo theo tạo ProductionOrder (xem dưới) - kiểm BOM active TRƯỚC khi ghi gì,
      // để thiếu BOM chặn đúng hành động duyệt (409, có lý do rõ ràng) thay vì duyệt xong rồi mới
      // âm thầm phát hiện ở bước tạo ProductionOrder - lỗ hổng đã xác nhận, xem
      // assertActiveBomRevisionExists().
      await this.productionOrdersService.assertActiveBomRevisionExists(item.mfgProductId);
    }
    // Loại dây/nệm Sales chọn phải khớp bản định mức sắp ghim - chặn TRƯỚC khi ghi APPROVED.
    await this.productionOrdersService.assertChoiceMatchesRevision(
      item.mfgProductId,
      pinnedRevisions?.get(item.id),
      item,
      `Dòng ${item.id} của ${pi.code}`,
    );

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
        `SKU ${item.id} đã được xử lý bởi 1 yêu cầu khác trong lúc Sếp duyệt - không ghi đè`,
      );
    }
    const updated = { ...item, ...data };
    await this.auditItemApprovalTransition(item, updated);

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
        pinnedRevisions?.get(item.id),
      );
    } catch (error) {
      this.logger.error(
        `ProductionOrder creation failed unexpectedly for PI item ${item.id} despite BOM check: ${(error as Error).message}`,
      );
      // 2026-09-26 (người dùng chốt): báo ADMIN (không phải QLSX - route khắc phục
      // retry-production-order() chỉ ADMIN gọi được, FE chưa có nút, xem notification-types.ts).
      await this.notifyPi(
        'PI_PRODUCTION_ORDER_FAILED',
        item.id,
        { piCode: pi.code, count: 1, errorMessage: (error as Error).message },
        undefined,
        actorUserId,
      );
    }

    // Trigger đề xuất cắt sắt tự động/ngầm - tách try/catch riêng, best-effort thật sự (không có
    // màn hình riêng, không được phép làm hỏng việc duyệt SKU đã ghi ở trên dù ProductionOrder
    // đã tạo thành công). Item kẹt ở APPROVED không có ProductionOrder từ đây có đường phục hồi
    // riêng - xem retryProductionOrder().
    if (productionOrder) {
      if (preSolved) {
        await this.finalizePreSolvedProposal(
          pi.id,
          preSolved.id,
          `PI item ${item.id}`,
          actorUserId,
        );
      } else {
        await this.triggerPostApprovalProposals(pi.id, item.id, productionOrder.id, actorUserId);
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

    // Item vừa rời WAITING_BOSS - đóng thông báo "chờ Sếp" nếu không còn SKU nào khác của PI này
    // ở đó, rồi báo kết quả cho KHSX + QLSX.
    const stillWaitingBoss = pi.items.some(
      (it) => it.id !== item.id && it.prodApprovalStatus === ProdApprovalStatus.WAITING_BOSS,
    );
    if (!stillWaitingBoss) {
      await this.resolvePiNotifications('PRODUCTION_INVOICE', pi.id, ['PI_SENT_TO_BOSS']);
    }
    await this.notifyPi(
      'PI_APPROVED_BY_BOSS',
      pi.id,
      { piCode: pi.code, count: 1 },
      undefined,
      actorUserId,
    );
    this.publishRealtime('PRODUCTION_INVOICE', pi.id, 'APPROVED', actorUserId);

    return this.toItemResponseDto(updated);
  }

  /**
   * Trigger đề xuất cắt sắt (theo ĐÚNG 1 ProductionOrder) + 2 trigger mua VTTP/tiêu hao dồn vào
   * onComplete - dùng chung bởi approveItem() và retryProductionOrder(). Best-effort thật sự:
   * không được phép làm hỏng việc duyệt/tạo lệnh đã ghi xong ở caller, mọi lỗi chỉ log.
   */
  private async triggerPostApprovalProposals(
    piId: bigint,
    itemId: bigint,
    productionOrderId: bigint,
    actorUserId: string,
  ): Promise<void> {
    try {
      // 2 trigger đề xuất mua còn lại (VTTP + tiêu hao phẳng) CỐ Ý dồn vào onComplete - chờ
      // đề xuất mua sắt tính xong (dù thành công/chặn/lỗi) rồi mới tính, thay vì bắn song song
      // như trước 2026-08-24. Steel chạy nền qua solver ngoài (vài chục giây tới vài phút),
      // 2 trigger kia lại tính ngay lập tức - Mua hàng thấy đề xuất vật tư tiêu hao hiện ra
      // trước, đề xuất sắt "CALCULATING" mãi mới tới, rời rạc không đồng bộ. Gộp cả 3 đề xuất
      // mua của 1 PI xuất hiện cùng lúc, sau khi phần chậm nhất (sắt) đã xong.
      await this.cuttingProposalsService.requestForOrder(productionOrderId, {
        requestedById: actorUserId,
        onComplete: () => this.computeNonSteelPurchaseProposals(piId, `PI item ${itemId}`),
      });
    } catch (error) {
      this.logger.error(
        `Auto cutting-proposal trigger failed for PI item ${itemId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * 3 trigger đề xuất mua còn lại của 1 PI (pat/VTTP cũ qua PieceMaterialYield + tiêu hao phẳng +
   * vật tư thành phẩm không gắn piece qua MaterialYieldRecipe, 2026-10-02), chạy SAU đề xuất mua sắt
   * - dùng chung bởi đường cũ (onComplete của solver) và đường "Solve trước" (sau approve() phương
   * án có sẵn). Best-effort, tách try/catch riêng để lỗi nguồn này không che nguồn kia. `context`
   * chỉ để ghi log ("PI item 12" / "merged PI 3").
   */
  private async computeNonSteelPurchaseProposals(
    piId: bigint,
    context: string,
    opts: { rethrow?: boolean } = {},
  ): Promise<void> {
    // Admin bấm "Tạo lại dòng mua ngoài sắt" (opts.rethrow) cần biết nguồn nào vẫn lỗi; đường tự động sau khi Sếp duyệt vẫn chỉ log.
    const failed: string[] = [];
    // Tính lại nhu cầu mua nguyên liệu "vật tư thành phẩm" (PieceMaterialYield, vd thanh nhôm/tấm
    // sắt lá) cho CẢ PI mỗi khi có thêm 1 SKU được duyệt, không phải nút bấm riêng (không có màn
    // hình riêng, xem changelog 2026-08-22 mục 15).
    try {
      await this.pieceMaterialYieldPurchaseService.computeAndUpsertProposals(piId.toString());
    } catch (error) {
      failed.push('pat/vật tư thành phẩm theo mảnh');
      this.logger.error(
        `Auto piece-material-yield-purchase trigger failed for ${context}: ${(error as Error).message}`,
      );
    }

    // Tính nhu cầu mua vật tư tiêu hao phẳng (Dây/Đinh/Tán rút/Nút nhựa/Sơn/Phụ kiện/Bao bì).
    // Quyết định nghiệp vụ 2026-08-22: tự động hoàn toàn, bỏ qua bước kiểm tra kho thủ công -
    // người mua hàng được gán (Material.buyerId) thấy đề xuất ngay khi SKU được duyệt.
    try {
      await this.consumableMaterialPurchaseService.computeAndUpsertProposals(piId.toString());
    } catch (error) {
      failed.push('vật tư tiêu hao');
      this.logger.error(
        `Auto consumable-material-purchase trigger failed for ${context}: ${(error as Error).message}`,
      );
    }

    // Tính nhu cầu mua nguyên liệu đầu vào (vd thanh nhôm) cho "vật tư thành phẩm KHÔNG gắn piece"
    // (vd chân nhôm, MaterialYieldRecipe) - phần Mua hàng còn thiếu của tính năng 2026-10-01, mirror
    // 2 nhánh trên (tự động hoàn toàn, không chờ thao tác thủ công nào).
    try {
      await this.materialYieldRecipePurchaseService.computeAndUpsertProposals(piId.toString());
    } catch (error) {
      failed.push('chân nhôm/vật tư thành phẩm không gắn mảnh');
      this.logger.error(
        `Auto material-yield-recipe-purchase trigger failed for ${context}: ${(error as Error).message}`,
      );
    }
    // Chỉ nêu tên nguồn: câu lỗi gốc (thường tiếng Anh, lộ chi tiết DB) đã nằm trong log ở trên.
    if (opts.rethrow && failed.length > 0) {
      throw new ConflictException(
        `Tạo dòng mua ngoài sắt chưa xong ở: ${failed.join('; ')}. Phần đã xong vẫn được giữ - bấm thử lại sau`,
      );
    }
  }

  /**
   * Bước "sau khi Sếp duyệt" của luồng "Solve trước → tạo PI" (2026-09-30): duyệt phương án cắt đã
   * tính sẵn (giữ chỗ tồn + đề xuất mua sắt, KHÔNG gọi solver) rồi tính 2 nguồn đề xuất mua còn lại.
   * Best-effort như trigger cũ - lỗi chỉ log, không làm hỏng việc duyệt đã ghi; phương án còn DRAFT
   * thì retryProductionOrder() duyệt lại được. 2 nguồn mua kia vẫn chạy dù duyệt phương án lỗi
   * (giống đường cũ: chạy sau đề xuất sắt dù thành công/chặn/lỗi).
   */
  private async finalizePreSolvedProposal(
    piId: bigint,
    proposalId: bigint,
    context: string,
    actorUserId: string,
  ): Promise<void> {
    try {
      await this.cuttingProposalsService.approve(proposalId.toString(), actorUserId);
    } catch (error) {
      this.logger.error(
        `Duyệt phương án cắt ${proposalId} (tính trước) cho ${context} thất bại: ${(error as Error).message}`,
      );
    }
    await this.computeNonSteelPurchaseProposals(piId, context);
  }

  /**
   * Vá điểm kẹt "SKU đã APPROVED nhưng ProductionOrder tạo thất bại -> kẹt vĩnh viễn": approveItem()
   * /approveBatch() ghi `prodApprovalStatus=APPROVED` TRƯỚC, tạo ProductionOrder trong try/catch chỉ
   * log lỗi - nếu tạo thất bại (race hiếm: BOM bị deactivate đúng khoảnh khắc giữa 2 lệnh) thì không
   * có route nào để tạo lại, kẹt vĩnh viễn (downstream Chuyền kiểm/Đóng gói báo "chưa được duyệt" dù
   * UI hiển thị đã duyệt). FE phát hiện ca này qua `prodApprovalStatus=APPROVED && productionOrderId
   * =null` (xem ProductionInvoiceItemResponseDto.productionOrderId).
   *
   * Chỉ chạy khi item ĐÃ APPROVED. Chưa có ProductionOrder thì tạo lệnh. Đã có lệnh thì không tạo lại
   * (`ProductionOrder.productionInvoiceItemId` là `@unique`) mà tính lại 3 nguồn mua ngoài sắt của cả PI
   * - FE gọi qua nút "Tạo lại dòng mua ngoài sắt" (Admin > Lệnh sản xuất). Nguồn nào còn lỗi thì 409 nêu
   * tên nguồn và giữ thông báo lỗi; PI đã huỷ thì 409, không tính.
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
        `SKU ${item.id} đang ở trạng thái ${item.prodApprovalStatus ?? 'chưa gửi'} - chỉ SKU đã APPROVED mới cần tạo lại lệnh sản xuất`,
      );
    }
    const existingOrder = await this.prisma.productionOrder.findUnique({
      where: { productionInvoiceItemId: item.id },
    });
    // Luồng "Solve trước → tạo PI" (2026-09-30): PI có phương án tính sẵn còn DRAFT nghĩa là bước
    // duyệt phương án sau khi Sếp duyệt đã thất bại (hoặc còn thiếu lệnh SX của SKU khác trong đợt)
    // - đường phục hồi là duyệt lại phương án đó, không giải lại.
    const preSolved = await this.cuttingProposalsService.findPreSolvedForInvoice(pi.id);
    if (existingOrder) {
      if (pi.status === ProductionInvoiceStatus.CANCELLED) {
        throw new ConflictException(`${pi.code} đã huỷ - không tính lại đề xuất mua`);
      }
      if (preSolved?.status === CuttingProposalStatus.DRAFT) {
        await this.cuttingProposalsService.approve(preSolved.id.toString(), actorUserId);
      }
      // 10/11/2026: bước tạo dòng mua ngoài sắt sau khi Sếp duyệt có thể đã lỗi (vd transaction quá giờ) hoặc chưa từng chạy
      // (máy chủ khởi động lại khi phương án cắt đường cũ đang tính) - chạy lại 3 nguồn cho mọi trạng thái phương án, kể cả
      // khi không có phương án tính trước. Tự idempotent: chỉ tính lại, không tạo dòng trùng, không đụng dòng đã ký.
      await this.computeNonSteelPurchaseProposals(pi.id, `PI item ${item.id}`, { rethrow: true });
      await this.resolvePiNotifications('PRODUCTION_INVOICE_ITEM', item.id, [
        'PI_PRODUCTION_ORDER_FAILED',
      ]);
      return this.toItemResponseDto(item);
    }
    let pinnedRevisionId: bigint | undefined;
    if (preSolved?.status === CuttingProposalStatus.DRAFT) {
      // Cổng kiểm phương án còn đúng (gồm cả revision ACTIVE trùng revision đã tính) - thay cho kiểm
      // BOM active bên dưới.
      const { revisionByItemId } = await this.cuttingProposalsService.assertReadyForApproval(
        preSolved.id,
        pi.id,
      );
      pinnedRevisionId = revisionByItemId.get(item.id);
    } else {
      // Kiểm lại BOM active trước khi thử - trả 409 rõ ràng nếu vẫn thiếu, thay vì để
      // createFromApproval() ném NotFoundException khó hiểu hơn.
      await this.productionOrdersService.assertActiveBomRevisionExists(item.mfgProductId);
    }
    await this.productionOrdersService.assertChoiceMatchesRevision(
      item.mfgProductId,
      pinnedRevisionId,
      item,
      `Dòng ${item.id} của ${pi.code}`,
    );

    const productionOrder = await this.productionOrdersService.createFromApproval(
      item.id,
      item.mfgProductId,
      item.quantity,
      pinnedRevisionId,
    );
    if (preSolved?.status === CuttingProposalStatus.DRAFT) {
      await this.finalizePreSolvedProposal(pi.id, preSolved.id, `PI item ${item.id}`, actorUserId);
    } else {
      await this.triggerPostApprovalProposals(pi.id, item.id, productionOrder.id, actorUserId);
    }
    await this.resolvePiNotifications('PRODUCTION_INVOICE_ITEM', item.id, [
      'PI_PRODUCTION_ORDER_FAILED',
    ]);

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
          `SKU ${item.id} đã được xử lý bởi 1 yêu cầu khác trong lúc QLSX từ chối - không ghi đè`,
        );
      }
      const remaining = await tx.productionInvoiceItem.count({
        where: { productionInvoiceId: pi.id },
      });
      if (remaining === 0) {
        // Phương án cắt tính trước (nếu có) trỏ FK vào PI - gỡ ra (SUPERSEDED) trước khi xoá PI.
        await this.cuttingProposalsService.releaseForInvoice(tx, pi.id);
        await tx.productionInvoice.delete({ where: { id: pi.id } });
      }
      return { ...item, ...data };
    });
    await this.auditItemApprovalTransition(item, updated);
    // Item vừa rời WAITING_QLSX (kéo theo có thể đã xoá luôn PI ở trên nếu hết SKU) - `pi.id` vẫn
    // dùng được để đóng/tạo thông báo dù PI đã bị xoá (Notification không ràng buộc khoá ngoại tới
    // PlanForm/ProductionInvoice, chỉ lưu id dạng chuỗi).
    const stillWaitingQlsx = pi.items.some(
      (it) => it.id !== item.id && it.prodApprovalStatus === ProdApprovalStatus.WAITING_QLSX,
    );
    if (!stillWaitingQlsx) {
      await this.resolvePiNotifications('PRODUCTION_INVOICE', pi.id, ['PI_SENT_TO_QLSX']);
    }
    await this.notifyPi(
      'PI_REJECTED_BY_QLSX',
      pi.id,
      { piCode: pi.code, count: 1, reason },
      undefined,
      actorUserId,
    );
    this.publishRealtime('PRODUCTION_INVOICE', pi.id, 'REJECTED', actorUserId);
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

    // updateMany lọc kèm đúng trạng thái kỳ vọng + so count, thay vì vòng lặp update() không điều
    // kiện: chặn race với 1 yêu cầu khác vừa ghi đè status của 1/nhiều item này đúng lúc request
    // này đang chạy (VD sendBatchToBoss() gửi tiếp 1 item sang Sếp), tránh xoá PI mà kéo nhầm 1
    // item không còn ở WAITING_QLSX ra theo.
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
          `${pi.code} đã bị 1 yêu cầu khác xử lý một phần trong lúc QLSX từ chối cả phiếu - không ghi đè`,
        );
      }
      await this.cuttingProposalsService.releaseForInvoice(tx, pi.id);
      await tx.productionInvoice.delete({ where: { id: pi.id } });
    });
    for (const t of transitions) {
      await this.auditItemApprovalTransition(t.before, t.after);
    }

    // Đòi MỌI item đang WAITING_QLSX mới cho xoá cả phiếu (guard ở đầu hàm) nên hàng đợi "chờ
    // QLSX" của PI này luôn về 0 sau bước này - resolve() không điều kiện, khác rejectItemByQlsx().
    await this.resolvePiNotifications('PRODUCTION_INVOICE', pi.id, ['PI_SENT_TO_QLSX']);
    await this.notifyPi(
      'PI_REJECTED_BY_QLSX',
      pi.id,
      { piCode: pi.code, count: itemIds.length, reason },
      undefined,
      actorUserId,
    );
    this.publishRealtime('PRODUCTION_INVOICE', pi.id, 'REJECTED', actorUserId);

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
          `SKU ${item.id} đã được xử lý bởi 1 yêu cầu khác trong lúc Sếp từ chối - không ghi đè`,
        );
      }
      const remaining = await tx.productionInvoiceItem.count({
        where: { productionInvoiceId: pi.id },
      });
      if (remaining === 0) {
        // Phương án cắt tính trước (nếu có) trỏ FK vào PI - gỡ ra (SUPERSEDED) trước khi xoá PI.
        await this.cuttingProposalsService.releaseForInvoice(tx, pi.id);
        await tx.productionInvoice.delete({ where: { id: pi.id } });
      }
      return { ...item, ...data };
    });
    await this.auditItemApprovalTransition(item, updated);
    const stillWaitingBoss = pi.items.some(
      (it) => it.id !== item.id && it.prodApprovalStatus === ProdApprovalStatus.WAITING_BOSS,
    );
    if (!stillWaitingBoss) {
      await this.resolvePiNotifications('PRODUCTION_INVOICE', pi.id, ['PI_SENT_TO_BOSS']);
    }
    await this.notifyPi(
      'PI_REJECTED_BY_BOSS',
      pi.id,
      { piCode: pi.code, count: 1, reason },
      undefined,
      actorUserId,
    );
    this.publishRealtime('PRODUCTION_INVOICE', pi.id, 'REJECTED', actorUserId);
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
    // Luồng "Solve trước → tạo PI" (2026-09-30) - xem approveItem(): có phương án tính sẵn thì kiểm
    // nó còn đúng (thay cho kiểm BOM từng SKU) và duyệt ĐÚNG số đó, không chạy solver lại.
    const preSolved = await this.cuttingProposalsService.findPreSolvedForInvoice(pi.id);
    let pinnedRevisions: Map<bigint, bigint> | undefined;
    if (preSolved) {
      if (preSolved.status !== CuttingProposalStatus.DRAFT) {
        throw new ConflictException(
          `Phương án cắt ${preSolved.id} của ${pi.code} đã ở trạng thái ${preSolved.status} - không duyệt lại được`,
        );
      }
      pinnedRevisions = (
        await this.cuttingProposalsService.assertReadyForApproval(preSolved.id, pi.id)
      ).revisionByItemId;
    } else {
      // Kiểm BOM của MỌI SKU trước khi ghi bất cứ thứ gì: thiếu BOM 1 SKU là cả nhóm không cắt chung
      // được, dừng sớm với 409 rõ ràng còn hơn duyệt được nửa nhóm rồi kẹt.
      for (const item of pi.items) {
        await this.productionOrdersService.assertActiveBomRevisionExists(item.mfgProductId);
      }
    }
    // Loại dây/nệm của MỌI dòng phải khớp bản định mức sẽ ghim - dừng sớm nếu 1 dòng sai lệch.
    for (const item of pi.items) {
      await this.productionOrdersService.assertChoiceMatchesRevision(
        item.mfgProductId,
        pinnedRevisions?.get(item.id),
        item,
        `Dòng ${item.id} của ${pi.code}`,
      );
    }

    // updateMany PHẢI lọc kèm đúng trạng thái kỳ vọng (WAITING_BOSS) + so count, cùng idiom
    // approveItem()/rejectItem() - trước đây ghi vô điều kiện theo productionInvoiceId, không có
    // gì chặn rejectBatch() ghi đè ngược lại đồng thời trên cùng PI (2 request "duyệt cả cụm" /
    // "từ chối cả cụm" race nhau): request nào commit trước thắng, request thua khớp 0 dòng
    // (status đã đổi) và ConflictException - không còn ca ProductionOrder mồ côi (duyệt xong rồi
    // bị từ chối ghi đè ngay sau, hoặc ngược lại).
    const itemIds = pi.items.map((item) => item.id);
    const decidedAt = new Date();
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
          `${pi.code} đã bị 1 yêu cầu khác xử lý (duyệt/từ chối) một phần trong lúc Sếp duyệt cả cụm - không ghi đè`,
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
          pinnedRevisions?.get(item.id),
        );
      } catch (error) {
        this.logger.error(
          `ProductionOrder creation failed unexpectedly for PI item ${item.id} despite BOM check: ${(error as Error).message}`,
        );
        await this.notifyPi(
          'PI_PRODUCTION_ORDER_FAILED',
          item.id,
          { piCode: pi.code, count: 1, errorMessage: (error as Error).message },
          undefined,
          actorUserId,
        );
      }
    }

    await this.prisma.productionInvoice.update({
      where: { id: pi.id },
      data: { status: ProductionInvoiceStatus.PRODUCING },
    });

    // assertMergedPi() + assertItemStatus() ở đầu hàm đòi MỌI item đang WAITING_BOSS mới cho duyệt
    // cả cụm - hàng đợi "chờ Sếp" của PI này luôn về 0 sau bước này, resolve() không điều kiện.
    await this.resolvePiNotifications('PRODUCTION_INVOICE', pi.id, ['PI_SENT_TO_BOSS']);
    await this.notifyPi(
      'PI_APPROVED_BY_BOSS',
      pi.id,
      { piCode: pi.code, count: pi.items.length },
      undefined,
      actorUserId,
    );

    this.publishRealtime('PRODUCTION_INVOICE', pi.id, 'APPROVED', actorUserId);

    // Best-effort như trigger đơn lẻ: không được phép làm hỏng việc duyệt đã ghi ở trên. Cùng
    // idiom approveItem() (2026-08-24) - 2 trigger mua VTTP/tiêu hao dồn vào onComplete, chỉ chạy
    // SAU khi đề xuất mua sắt của cả cụm gộp tính xong. Trước đây PI gộp KHÔNG có 2 trigger này
    // (chỉ trigger sắt) - người mua hàng phụ trách VTTP/tiêu hao không bao giờ thấy đề xuất nào
    // cho PI gộp dù SKU đã duyệt và có định mức thật.
    if (preSolved) {
      await this.finalizePreSolvedProposal(pi.id, preSolved.id, `merged PI ${pi.id}`, actorUserId);
      return this.toResponseDto(await this.findOneOrThrow(piId));
    }
    try {
      await this.cuttingProposalsService.requestForInvoice(pi.id, {
        requestedById: actorUserId,
        onComplete: () => this.computeNonSteelPurchaseProposals(pi.id, `merged PI ${pi.id}`),
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
    // updateMany lọc kèm đúng trạng thái kỳ vọng (WAITING_BOSS - trạng thái DUY NHẤT hợp lệ cho
    // item còn gắn PI gộp chưa xử lý, xem assertMergedPi) + so count, cùng idiom
    // approveItem()/rejectItem(): trước đây vòng lặp gọi update() KHÔNG ĐIỀU KIỆN theo id - không
    // chặn được approveBatch() ghi APPROVED xong (kèm tạo ProductionOrder thật) đúng lúc request
    // này đang chạy: update() vẫn ghi đè thành REJECTED + xoá PI, để lại ProductionOrder mồ côi
    // trỏ vào 1 item đã REJECTED. Request nào commit trước thắng, request thua khớp 0 dòng và
    // rollback toàn bộ (kể cả xoá PI bên dưới).
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
          `${pi.code} đã bị 1 yêu cầu khác xử lý (duyệt/từ chối) một phần trong lúc Sếp từ chối cả cụm - không ghi đè`,
        );
      }
      await this.cuttingProposalsService.releaseForInvoice(tx, pi.id);
      await tx.productionInvoice.delete({ where: { id: pi.id } });
    });
    for (const t of transitions) {
      await this.auditItemApprovalTransition(t.before, t.after);
    }

    // updateMany ở trên đòi MỌI item đang WAITING_BOSS mới cho từ chối cả cụm - hàng đợi "chờ Sếp"
    // của PI này luôn về 0 sau bước này, resolve() không điều kiện.
    await this.resolvePiNotifications('PRODUCTION_INVOICE', pi.id, ['PI_SENT_TO_BOSS']);
    await this.notifyPi(
      'PI_REJECTED_BY_BOSS',
      pi.id,
      { piCode: pi.code, count: itemIds.length, reason },
      undefined,
      actorUserId,
    );
    this.publishRealtime('PRODUCTION_INVOICE', pi.id, 'REJECTED', actorUserId);

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

    const [bomPieces, results, receiptSums, transferSums] = await Promise.all([
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
      // Mảnh không đan (Pat, Chân nhôm...) về kho qua phiếu chuyển kho nội bộ đã xác nhận.
      this.prisma.warehouseTransferPieceItem.groupBy({
        by: ['pieceId'],
        where: {
          productionOrderId: productionOrder.id,
          transfer: { status: TransferStatus.CONFIRMED, ...PIECE_TRANSFER_LEAVES_FRAME },
        },
        _sum: { quantity: true },
      }),
    ]);

    const receivedByPiece = new Map<string, number>(
      receiptSums.map((r) => [r.pieceId.toString(), r._sum.qty ?? 0]),
    );
    const transferredByPiece = new Map<string, number>(
      transferSums.map((r) => [r.pieceId.toString(), r._sum.quantity ?? 0]),
    );

    return bomPieces.map((bp) => {
      const pieceResults = results.filter((r) => r.pieceId === bp.pieceId);
      return new TransferCheckPieceResponseDto({
        pieceId: bp.pieceId.toString(),
        pieceName: bp.piece.name,
        totalQty: bp.qtyPerUnit * productionOrder.quantity,
        readyQty:
          (bp.isWoven ? receivedByPiece : transferredByPiece).get(bp.pieceId.toString()) ?? 0,
        checkedQty: pieceResults.reduce((sum, r) => sum + r.checkedQty, 0),
        defectCount: pieceResults.reduce((sum, r) => sum + r.defects.length, 0),
      });
    });
  }

  /**
   * Gộp nhiều ProductionInvoiceItem 1 lần - "Bảng thống kê" (ThongKePagePlan.tsx) tải tiến độ
   * Chuyền kiểm cho nhiều SKU cùng lúc. ProductionOrder có quan hệ 1-1 với
   * productionInvoiceItemId nên chỉ cần itemId (không cần piId riêng như bản đơn) để tra ra đúng
   * order - item nào chưa có ProductionOrder (chưa duyệt) thì trả mảng rỗng thay vì lỗi 409 như
   * bản đơn (khớp cách buildOrderRow FE đã tự coi "chưa có gì" là an toàn).
   */
  async listTransferCheckPiecesBatch(
    itemIds: string[],
  ): Promise<Record<string, TransferCheckPieceResponseDto[]>> {
    const result: Record<string, TransferCheckPieceResponseDto[]> = {};
    for (const id of itemIds) result[id] = [];
    if (itemIds.length === 0) return result;

    const itemBigIds = itemIds.map((id) => parseBigIntId(id));
    const orders = await this.prisma.productionOrder.findMany({
      where: { productionInvoiceItemId: { in: itemBigIds } },
    });
    if (orders.length === 0) return result;
    const orderByItemId = new Map(orders.map((o) => [o.productionInvoiceItemId.toString(), o]));
    const revisionIds = [...new Set(orders.map((o) => o.bomRevisionId))];
    const orderIds = orders.map((o) => o.id);

    const [bomPieces, results, receiptSums, transferSums] = await Promise.all([
      this.prisma.bomPiece.findMany({
        where: { bomRevisionId: { in: revisionIds } },
        include: { piece: true },
      }),
      this.prisma.transferCheckResult.findMany({
        where: { productionInvoiceItemId: { in: itemBigIds } },
        include: { defects: true },
      }),
      // Nhóm theo CẢ pieceId lẫn productionOrderId - khác bản đơn (1 order/lần nên chỉ cần
      // pieceId) vì ở đây nhiều order trộn chung 1 query.
      this.prisma.weavingReceipt.groupBy({
        by: ['pieceId', 'productionOrderId'],
        where: { productionOrderId: { in: orderIds } },
        _sum: { qty: true },
      }),
      this.prisma.warehouseTransferPieceItem.groupBy({
        by: ['pieceId', 'productionOrderId'],
        where: {
          productionOrderId: { in: orderIds },
          transfer: { status: TransferStatus.CONFIRMED, ...PIECE_TRANSFER_LEAVES_FRAME },
        },
        _sum: { quantity: true },
      }),
    ]);

    const bomPiecesByRevision = new Map<string, typeof bomPieces>();
    for (const bp of bomPieces) {
      const key = bp.bomRevisionId.toString();
      const arr = bomPiecesByRevision.get(key);
      if (arr) arr.push(bp);
      else bomPiecesByRevision.set(key, [bp]);
    }
    const receivedByOrderPiece = new Map<string, number>();
    for (const r of receiptSums) {
      receivedByOrderPiece.set(`${r.productionOrderId}:${r.pieceId}`, r._sum.qty ?? 0);
    }
    const transferredByOrderPiece = new Map<string, number>();
    for (const r of transferSums) {
      transferredByOrderPiece.set(`${r.productionOrderId}:${r.pieceId}`, r._sum.quantity ?? 0);
    }

    for (const itemId of itemIds) {
      const order = orderByItemId.get(itemId);
      if (!order) continue;
      const bomPiecesForOrder = bomPiecesByRevision.get(order.bomRevisionId.toString()) ?? [];
      const itemResults = results.filter(
        (r) => r.productionInvoiceItemId === order.productionInvoiceItemId,
      );
      result[itemId] = bomPiecesForOrder.map((bp) => {
        const pieceResults = itemResults.filter((r) => r.pieceId === bp.pieceId);
        return new TransferCheckPieceResponseDto({
          pieceId: bp.pieceId.toString(),
          pieceName: bp.piece.name,
          totalQty: bp.qtyPerUnit * order.quantity,
          readyQty:
            (bp.isWoven ? receivedByOrderPiece : transferredByOrderPiece).get(
              `${order.id}:${bp.pieceId}`,
            ) ?? 0,
          checkedQty: pieceResults.reduce((sum, r) => sum + r.checkedQty, 0),
          defectCount: pieceResults.reduce((sum, r) => sum + r.defects.length, 0),
        });
      });
    }
    return result;
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
    await assertPiHasActiveFloor(this.prisma, pi.id, 'ghi nhận chuyền kiểm');
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
        `Mảnh ${dto.pieceId} không thuộc định mức (BOM) của SKU ${itemId}`,
      );
    }

    // Chỉ được kiểm tối đa bằng số "Hiện có": mảnh có đan = đã nhập đan về, mảnh không đan = đã
    // nhập nội bộ (phiếu chuyển kho CONFIRMED).
    const [received, checked] = await Promise.all([
      bomPiece.isWoven
        ? this.prisma.weavingReceipt
            .aggregate({
              where: { productionOrderId: productionOrder.id, pieceId: pieceBigId },
              _sum: { qty: true },
            })
            .then((r) => r._sum.qty ?? 0)
        : this.prisma.warehouseTransferPieceItem
            .aggregate({
              where: {
                productionOrderId: productionOrder.id,
                pieceId: pieceBigId,
                transfer: { status: TransferStatus.CONFIRMED, ...PIECE_TRANSFER_LEAVES_FRAME },
              },
              _sum: { quantity: true },
            })
            .then((r) => r._sum.quantity ?? 0),
      this.prisma.transferCheckResult.aggregate({
        where: { productionInvoiceItemId: item.id, pieceId: pieceBigId },
        _sum: { checkedQty: true },
      }),
    ]);
    const available = received - (checked._sum.checkedQty ?? 0);
    if (dto.checkedQty > available) {
      throw new BadRequestException(
        `Số lượng kiểm (${dto.checkedQty}) vượt quá số hiện có (${Math.max(0, available)}) - chỉ kiểm được phần đã nhập về kho`,
      );
    }

    const created = await this.prisma.transferCheckResult.create({
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
    const result = pieces.find((p) => p.pieceId === dto.pieceId)!;

    if (dto.defects?.length) {
      await this.notifyTransferCheckDefect(created.id, {
        piCode: pi.code,
        pieceName: result.pieceName,
        defectCount: dto.defects.length,
        reason: dto.defects[0].reason,
      });
    }

    return result;
  }

  /**
   * Admin quản lý ảnh lỗi (2026-09-11) - liệt kê PHẲNG mọi TransferCheckDefect có ảnh, không theo
   * từng item/PI (khác listTransferCheckPieces ở trên, dùng cho màn nghiệp vụ theo đúng 1 item).
   * Chấp nhận trả ID thô (productionInvoiceItemId/pieceId), không join sang tên PI/SKU - xem doc
   * comment TransferCheckDefectResponseDto.
   */
  async listTransferCheckDefects(
    query: PaginationQueryDto,
  ): Promise<Paginated<TransferCheckDefectResponseDto>> {
    const where: Prisma.TransferCheckDefectWhereInput = { imageUrl: { not: null } };
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.transferCheckDefect.findMany({
            ...args,
            include: { transferCheckResult: true },
          }),
        count: (args) => this.prisma.transferCheckDefect.count(args),
      },
      query,
      where,
      { id: 'desc' as const },
    );
    return {
      data: result.data.map(
        (d) =>
          new TransferCheckDefectResponseDto({
            id: d.id.toString(),
            transferCheckResultId: d.transferCheckResultId.toString(),
            productionInvoiceItemId: d.transferCheckResult.productionInvoiceItemId.toString(),
            pieceId: d.transferCheckResult.pieceId.toString(),
            reason: d.reason,
            imageUrl: d.imageUrl,
            checkedById: d.transferCheckResult.checkedById,
            checkedAt: d.transferCheckResult.checkedAt,
          }),
      ),
      meta: result.meta,
    };
  }

  /**
   * Sửa/xóa CHỈ `imageUrl` của 1 TransferCheckDefect - cùng lý do/cùng ràng buộc
   * QcReviewsService.updatePhoto() (xem doc comment UpdateTransferCheckDefectPhotoDto).
   * TransferCheckDefect KHÔNG nằm trong AUDITED_MODELS (dòng con, append-only - xem
   * audit-log.extension.ts) nên phải tự ghi `writeAuditLog()`, cùng pattern
   * auditItemApprovalTransition() ở trên.
   *
   * 2026-09-11 lần 2 (theo Sếp Trương Văn Nhân: "cho người nhập được sửa luôn"): mở thêm cho
   * CHÍNH người đã ghi lần kiểm này (`transferCheckResult.checkedById === actorUserId`), KHÔNG chỉ
   * ADMIN - route bỏ `@RequireRole(ADMIN)`, check chuyển vào service vì cần đọc dữ liệu record.
   */
  async updateTransferCheckDefectPhoto(
    id: string,
    dto: UpdateTransferCheckDefectPhotoDto,
    actorUserId: string,
    actorRoles: string[],
  ): Promise<TransferCheckDefectResponseDto> {
    const bigId = parseBigIntId(id);
    const existing = await this.prisma.transferCheckDefect.findUnique({
      where: { id: bigId },
      include: { transferCheckResult: true },
    });
    if (!existing) {
      throw new NotFoundException(`Không tìm thấy lỗi kiểm chuyển kho ${id}`);
    }
    if (
      existing.transferCheckResult.checkedById !== actorUserId &&
      !actorRoles.includes(DEFAULT_ROLES.ADMIN)
    ) {
      throw new ForbiddenException('Chỉ người đã ghi lần kiểm này hoặc Admin mới sửa được ảnh');
    }
    const newImageUrl = dto.imageUrl ?? null;

    const updated = await this.prisma.transferCheckDefect.update({
      where: { id: bigId },
      data: { imageUrl: newImageUrl },
      include: { transferCheckResult: true },
    });

    const auditLogClient = this.prisma as unknown as Pick<PrismaClient, 'auditLog'>;
    await writeAuditLog(auditLogClient, this.cls, {
      action: AuditAction.UPDATE,
      tableName: 'TransferCheckDefect',
      recordId: id,
      oldValue: { imageUrl: existing.imageUrl },
      newValue: { imageUrl: newImageUrl },
    });

    if (existing.imageUrl && existing.imageUrl !== newImageUrl) {
      await this.cloudinaryService.deleteByUrl(existing.imageUrl);
    }

    return new TransferCheckDefectResponseDto({
      id: updated.id.toString(),
      transferCheckResultId: updated.transferCheckResultId.toString(),
      productionInvoiceItemId: updated.transferCheckResult.productionInvoiceItemId.toString(),
      pieceId: updated.transferCheckResult.pieceId.toString(),
      reason: updated.reason,
      imageUrl: updated.imageUrl,
      checkedById: updated.transferCheckResult.checkedById,
      checkedAt: updated.transferCheckResult.checkedAt,
    });
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

  /**
   * Gộp nhiều ProductionInvoiceItem 1 lần - "Bảng thống kê" (ThongKePagePlan.tsx) tải tiến độ
   * Đóng gói cho nhiều SKU cùng lúc. Cùng cách bỏ qua item chưa có ProductionOrder như
   * listTransferCheckPiecesBatch() (trả 0/0/0 thay vì lỗi 409).
   */
  async getPackagingBatch(itemIds: string[]): Promise<Record<string, PackagingResponseDto>> {
    const result: Record<string, PackagingResponseDto> = {};
    if (itemIds.length === 0) return result;

    const itemBigIds = itemIds.map((id) => parseBigIntId(id));
    const orders = await this.prisma.productionOrder.findMany({
      where: { productionInvoiceItemId: { in: itemBigIds } },
    });
    const orderByItemId = new Map(orders.map((o) => [o.productionInvoiceItemId.toString(), o]));

    const packedSums = await this.prisma.packagingRecord.groupBy({
      by: ['productionInvoiceItemId'],
      where: { productionInvoiceItemId: { in: itemBigIds } },
      _sum: { boxesPacked: true },
    });
    const packedByItem = new Map(
      packedSums.map((p) => [p.productionInvoiceItemId.toString(), p._sum.boxesPacked ?? 0]),
    );

    for (const itemId of itemIds) {
      const order = orderByItemId.get(itemId);
      if (!order) {
        result[itemId] = new PackagingResponseDto({ totalQty: 0, packedQty: 0, remainingQty: 0 });
        continue;
      }
      const packedQty = packedByItem.get(itemId) ?? 0;
      result[itemId] = new PackagingResponseDto({
        totalQty: order.quantity,
        packedQty,
        remainingQty: order.quantity - packedQty,
      });
    }
    return result;
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
    await assertPiHasActiveFloor(this.prisma, pi.id, 'ghi nhận đóng gói');
    const packedSoFar = await this.sumPacked(item.id);
    if (packedSoFar + dto.boxesPacked > productionOrder.quantity) {
      throw new BadRequestException(
        `Số thùng đóng (${dto.boxesPacked}) vượt quá số còn có thể đóng cho SKU ${itemId} ` +
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

    // Chỉ báo khi vừa đóng ĐỦ (không phải mỗi lần ghi) VÀ item có gắn đơn hàng (SalesOrder không có
    // cột "người phụ trách"/người tạo - báo cả role Sales, cùng lý do mục 15.2). Tự nhiên chỉ bắn
    // đúng 1 lần: gọi lại sau khi đã đủ luôn bị chặn 400 ở guard phía trên, không cần dedupe thêm.
    if (packedSoFar + dto.boxesPacked === productionOrder.quantity && item.salesOrder) {
      await this.notifyPackagingComplete(item.id, {
        piCode: pi.code,
        factoryCode: item.mfgProduct.factoryCode,
        productName: item.mfgProduct.name,
        salesOrderCode: item.salesOrder.orderCode,
      });
    }

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
        `SKU ${itemId} chưa có lệnh xưởng (chưa được Sếp duyệt) - chưa có mảnh nào để kiểm`,
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
          include: {
            mfgProduct: true,
            productVariant: true,
            wireMaterial: true,
            cushionMaterial: true,
            workshop: true,
            stages: true,
            salesOrder: { include: { customer: true } },
          },
        },
      },
    });
    if (!pi) {
      throw new NotFoundException(`Không tìm thấy lệnh sản xuất ${id}`);
    }
    return pi;
  }

  private async findItemOrThrow(piId: bigint, id: string): Promise<PIItemWithRefs> {
    const idBigId = parseBigIntId(id);
    const item = await this.prisma.productionInvoiceItem.findUnique({
      where: { id: idBigId },
      include: {
        mfgProduct: true,
        productVariant: true,
        wireMaterial: true,
        cushionMaterial: true,
        workshop: true,
        stages: true,
        salesOrder: { include: { customer: true } },
      },
    });
    if (!item || item.productionInvoiceId !== piId) {
      throw new NotFoundException(`Không tìm thấy SKU ${id} trong lệnh ${piId}`);
    }
    return item;
  }

  /** sendItemToQlsx: gửi lại được khi chưa từng gửi hoặc vừa bị Sếp từ chối - mirror mock. */
  private assertNoApprovalOrRejected(item: PIItemWithRefs): void {
    if (item.prodApprovalStatus && item.prodApprovalStatus !== ProdApprovalStatus.REJECTED) {
      throw new ConflictException(
        `SKU ${item.id} đang ở trạng thái ${item.prodApprovalStatus}, không thể gửi lại QLSX`,
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
        `SKU ${item.id} phải ở trạng thái ${expected} (đang là ${item.prodApprovalStatus ?? 'chưa gửi'})`,
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
  private async toResponseDtoWithProposalStatus(
    pi: PIWithProposalStatus,
  ): Promise<ProductionInvoiceResponseDto> {
    const dto = this.toResponseDto(pi);
    dto.cuttingRecheckedByName = pi.cuttingRecheckedBy
      ? `${pi.cuttingRecheckedBy.lastName} ${pi.cuttingRecheckedBy.firstName}`.trim()
      : null;
    // Phần A – Đợt 2: đã xuất sắt cho PI hoặc xuất vật tư cho xưởng ở production order của dòng nào -> khoá đổi xưởng.
    dto.hasMaterialIssue =
      (pi._count?.steelIssues ?? 0) > 0 ||
      pi.items.some((it) => (it.productionOrder?._count?.materialYieldIssues ?? 0) > 0);
    // Phương án neo PI: PI gộp (luồng cũ) HOẶC bất kỳ PI nào tạo từ phương án tính trước (luồng
    // "Solve trước", 2026-09-30, kể cả PI cắt riêng). PI cắt riêng theo luồng cũ không có phương án
    // neo PI (chúng neo PO) nên mảng rỗng -> rơi về nhánh productionOrder như trước.
    const piLevelProposal = pi.cuttingProposals?.[0];
    dto.cuttingPlan = piLevelProposal
      ? {
          proposalId: piLevelProposal.id.toString(),
          status: piLevelProposal.status,
          totalBars: piLevelProposal.totalBarsAll ?? null,
          wastePercentage: piLevelProposal.wastePercentage
            ? Number(piLevelProposal.wastePercentage)
            : null,
          hasOverThreshold: piLevelProposal.hasOverThreshold ?? false,
          // Máy THỰC SỰ đã dùng ở lượt tính (2026-10-23), khác `solverMachine` của PI vốn null khi KHSX
          // để theo mặc định công ty. Nguồn đáng tin nhất là requestParams.machine: runSolverAndSave ghi
          // body ĐÃ resolve (đợt ?? mặc định công ty) ngay trước khi gọi solver, nên có cả khi đang
          // tính. Thiếu (phương án tính trước khi có máy cắt) -> máy của PI -> MC Laser, vì mọi phương
          // án trước tính năng này đều là MC Laser.
          machine: this.machineOfProposal(piLevelProposal.requestParams, pi.solverMachine),
        }
      : null;

    // 1 query duy nhất cho CẢ PI (không lặp theo từng item) - tái dùng đúng hàm
    // ProductionOrdersService dùng cho GET /production-orders (xem doc comment hàm đó về vì sao
    // hết `private`). mfgProductId lấy từ chính ProductionOrder đã include sẵn, không phải từ
    // PIItemWithRefs.mfgProduct (2 nguồn khác nhau - SKU có thể đổi mfgProduct sau khi
    // ProductionOrder đã ghim, hiếm nhưng đúng nguồn phải là cái ProductionOrder đang xét).
    const orderMfgProductIds = pi.items
      .map((it) => it.productionOrder?.mfgProductId)
      .filter((id): id is bigint => id != null);
    const activeRevisionByProduct =
      await this.productionOrdersService.fetchActiveBomRevisionIds(orderMfgProductIds);

    dto.items.forEach((itemDto, i) => {
      const productionOrder = pi.items[i].productionOrder;
      const proposal = piLevelProposal ?? productionOrder?.cuttingProposals[0];
      itemDto.cuttingProposalStatus = proposal?.status ?? null;
      itemDto.cuttingProposalRequestedAt = proposal?.requestedAt ?? null;
      itemDto.productionOrderId = productionOrder?.id?.toString() ?? null;
      // Bảng thống kê (ThongKePagePlan.tsx) cần floorStage để hiện nút Bắt đầu/Kết thúc (QLSX) và
      // badge trạng thái xưởng (Boss/KHSX chỉ xem) - null khi item chưa có ProductionOrder.
      itemDto.floorStage = productionOrder?.floorStage ?? null;
      // "Nạp lại định mức" (Việc 3b, changelog-2026-09-11-bom-revision-ghim-cu-canh-bao.md mục 8)
      // - null khi chưa có ProductionOrder, cùng idiom floorStage ở trên.
      itemDto.bomOutOfDate = productionOrder
        ? activeRevisionByProduct.get(productionOrder.mfgProductId.toString()) !==
          productionOrder.bomRevisionId
        : null;
    });
    return dto;
  }

  private machineOfProposal(
    requestParams: unknown,
    piMachine: SolverMachine | null,
  ): SolverMachine {
    const used = (requestParams as { machine?: unknown } | null)?.machine;
    if (used === SolverMachine.laser || used === SolverMachine.tu_dong) return used;
    return piMachine ?? SolverMachine.laser;
  }

  private toResponseDto(pi: PIWithRefs): ProductionInvoiceResponseDto {
    return new ProductionInvoiceResponseDto({
      id: pi.id.toString(),
      code: pi.code,
      // Phần A – Đợt 2: mã lệnh hiển thị (số LSX nối " + ", chưa có thì mã PI)
      displayCode: lenhDisplayCode(pi, pi.items),
      lsxCodes: lenhLsxCodes(pi.items),
      salesOrderId: pi.salesOrderId?.toString() ?? null,
      salesOrderCode: pi.salesOrder?.orderCode ?? null,
      status: pi.status,
      isMerged: pi.isMerged,
      deadline: pi.deadline,
      solverMaxWastePctOverride: pi.solverMaxWastePctOverride?.toNumber() ?? null,
      solverAllowCustomLength: pi.solverAllowCustomLength,
      solverMachine: pi.solverMachine,
      solverOverrideReason: pi.solverOverrideReason,
      solverTimeLimitSecondsOverride: pi.solverTimeLimitSecondsOverride ?? null,
      cuttingRecheckRequired: pi.cuttingRecheckRequired,
      cuttingRecheckRequiredAt: pi.cuttingRecheckRequiredAt,
      cuttingRecheckedAt: pi.cuttingRecheckedAt,
      cuttingRecheckedByName: null,
      solverStockLengthsByMaterial:
        (pi.solverStockLengthsByMaterial as Record<string, number> | null) ?? null,
      solverOverrideEvidence: pi.solverOverrideEvidence as {
        materialCode: string;
        estimatedWastePct: number;
        normalThresholdPct: number;
        stockLengthMm?: number | null;
        fromProposal?: boolean;
      } | null,
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
      salesOrderCode: item.salesOrder?.orderCode ?? null,
      customerName: item.salesOrder?.customer?.name ?? null,
      mfgProductId: item.mfgProductId.toString(),
      factoryCode: item.mfgProduct.factoryCode,
      productName: item.mfgProduct.name,
      containerLoad: toContainerLoadDto(item.mfgProduct),
      productVariantId: item.productVariantId?.toString() ?? null,
      colorCode: item.productVariant?.colorCode ?? null,
      wireMaterial: item.wireMaterial ? toMaterialChoiceRef(item.wireMaterial) : null,
      cushionMaterial: item.cushionMaterial ? toMaterialChoiceRef(item.cushionMaterial) : null,
      quantity: item.quantity,
      materialDeadline: item.materialDeadline,
      finishedMaterialDeadline: item.finishedMaterialDeadline,
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
      // Phần A – Đợt 2
      lsxCode: item.lsxCode ?? null,
      workshop: item.workshop
        ? { id: item.workshop.id.toString(), code: item.workshop.code, name: item.workshop.name }
        : null,
      stages: item.stages.map((s) => ({
        stageType: s.stageType,
        deadline: s.deadline,
      })),
      // Phần A – Đợt 9 (YC2): chỉ có khi truy vấn nạp `deadlineChangeRequests` (findAll / findOne); nơi khác để undefined.
      pendingDeadlineChange: this.pendingRefOfItem(item),
    });
  }

  private pendingRefOfItem(item: PIItemWithRefs) {
    const reqs = (item as { deadlineChangeRequests?: Parameters<typeof pendingRefOf>[0][] })
      .deadlineChangeRequests;
    if (!reqs) return undefined;
    return reqs[0] ? pendingRefOf(reqs[0]) : null;
  }
}
