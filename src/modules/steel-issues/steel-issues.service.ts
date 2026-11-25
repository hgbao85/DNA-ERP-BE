import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CUTTING_RECHECK_MESSAGE,
  isCuttingRecheckPending,
} from '../warehouse-transfers/cutting-recheck.util';
import {
  AuditAction,
  CutBundleStatus,
  CuttingProposalStatus,
  FloorReportKind,
  Prisma,
  ProcessStep,
  ProductionOrderFloorStage,
  SolverMachine,
  StepBundleStatus,
  StockLedgerRefType,
  SteelIssueStatus,
  ProductionOrderStatus,
} from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  assertLoadedOrderNotCancelled,
  assertOrderNotCancelled,
  isOrderCancelledById,
  isCutContinuedForOrder,
  piHasCancelledSku,
  assertPiHasActiveFloor,
  assertPiHasActiveFloorLocked,
} from '../../common/utils/floor-gate.util';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { assertWorkshopUnchanged, lockPisForIssue } from '../../common/utils/pi-workshop-lock.util';
import {
  IdempotencyKeyInUseException,
  lockIdempotencyKey,
} from '../../common/utils/idempotency.util';
import {
  FLOOR_REPORT_REVERSED_REPLAY_MESSAGE,
  FloorReportContext,
  FloorReportReplayExpected,
  assertFloorReportReplayMatches,
  findFloorReportByKey,
  isIdempotencyConflict,
  writeFloorReport,
} from '../../common/utils/floor-report.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { NOT_CANCELLED_ORDER } from '../../common/utils/cancelled-order.util';
import { paginate } from '../../common/utils/paginate.util';
import { isFamilyScope } from '../../common/utils/warehouse-family.util';
import { WorkshopWarehouseResolver } from '../stock/workshop-warehouse.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { processStepLabel } from '../../common/constants/process-steps.constant';
import {
  PhoiNeedIndex,
  PhoiNeedInput,
  PhoiStep,
  buildCutBlockMessage,
  buildPhoiNeedIndex,
  buildStepBlockMessage,
  computePhoiStep,
  phoiOrderKey,
  pickPhoiBlock,
  stepsOverCutCap,
} from './phoi-need.util';
import { loadPlanSurplus } from './plan-surplus.util';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { RecordCutBatchDto } from './dto/record-cut-batch.dto';
import {
  PhoiProgressItemResponseDto,
  PhoiSteelBalanceDto,
  PhoiProgressOrderSegmentDto,
  PhoiProgressSegmentDto,
  PhoiStepProgressDto,
} from './dto/phoi-progress-response.dto';
import { CreateSteelIssueDto } from './dto/create-steel-issue.dto';
import { CutBundleResponseDto, CutPatternSegmentResponseDto } from './dto/cut-bundle-response.dto';
import { ListStepBundlesQueryDto } from './dto/list-step-bundles-query.dto';
import { ListSteelIssuesQueryDto } from './dto/list-steel-issues-query.dto';
import { PiOrderSummaryResponseDto } from './dto/pi-order-summary-response.dto';
import { RecordStepBatchDto } from './dto/record-step-batch.dto';
import { SteelIssuePlanItemResponseDto } from './dto/steel-issue-plan-item-response.dto';
import { SteelIssueResponseDto } from './dto/steel-issue-response.dto';
import { StepBatchResponseDto, StepBatchSegmentResponseDto } from './dto/step-batch-response.dto';
import { barsByStockLength } from '../cutting-proposals/pattern-stock-length.util';
import {
  StepBundleResponseDto,
  StepBundleSegmentResponseDto,
} from './dto/step-bundle-response.dto';

/** "Cần xuất" 1 loại sắt trong PI; barsByLength = số cây theo từng chiều dài kiểu cắt (CS2 20/11/2026). */
type RequiredSteel = {
  requiredBars: number;
  bestStockLengthMm: number | null;
  barsByLength: Map<number, number>;
};
type StockInfo = {
  remainingToIssue: number | null;
  physicalStockQty: number | null;
  physicalByLength: Map<number, number>;
};

const PROCESS_CAT = ProcessStep.CAT;

const EMPTY_NEED_INPUT: PhoiNeedInput = { baseByStep: {}, lineSteps: [], counts: {} };

const USER_NAME_SELECT = { select: { firstName: true, lastName: true, username: true } } as const;

const STEEL_ISSUE_INCLUDE = {
  productionInvoice: { select: { code: true, salesOrder: { select: { orderCode: true } } } },
  material: true,
  receivedBy: USER_NAME_SELECT,
} satisfies Prisma.SteelIssueInclude;

/** Tên hiển thị "Họ Tên" (cùng thứ tự system-config.service.ts), rỗng thì username. */
function userName(
  u: { firstName: string; lastName: string; username: string } | null | undefined,
): string | null {
  if (!u) return null;
  return `${u.lastName} ${u.firstName}`.trim() || u.username;
}

/** Ai đã báo vào đợt cắt (sổ FloorReport, 2026-10-12) - chỉ lần báo gốc, bỏ lần đã bị Hoàn tác. */
const BUNDLE_REPORTERS_INCLUDE = {
  floorReports: {
    where: { reversalOfId: null },
    select: { reportedBy: USER_NAME_SELECT, reversedBy: { select: { id: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.CutBundleInclude;

const STEEL_ISSUE_DETAIL_INCLUDE = {
  ...STEEL_ISSUE_INCLUDE,
  bundles: {
    include: { segments: { include: { segmentSpec: true } }, ...BUNDLE_REPORTERS_INCLUDE },
  },
} satisfies Prisma.SteelIssueInclude;

export type SteelIssueRow = Prisma.SteelIssueGetPayload<{ include: typeof STEEL_ISSUE_INCLUDE }>;

/** Kết quả prepareIssue() - đủ để ghi 1 lần xuất sắt trong transaction của caller (Đợt 6, phiếu xuất XK). */
export interface PreparedSteelIssue {
  productionInvoiceId: bigint;
  materialId: bigint;
  barLengthMm: number;
  barCount: number;
  isPostCutover: boolean;
  /** Đợt 7 (chia 9 kho): kho Phôi của xưởng làm lệnh - sắt PHẢI xuất từ đúng kho này. */
  warehouse: { id: bigint; code: string };
  /** Xưởng của lệnh lúc tra `warehouse` - createInTx() so lại SAU khoá dòng lệnh (rà soát 14/11 CK6). */
  workshopId: bigint | null;
  /** CS2: số cây phương án cần theo từng chiều dài khi loại sắt có cây lẻ - createInTx() kiểm lại SAU khoá dòng lệnh (review Sang
   *  21/11: kiểm ở prepareIssue nằm ngoài transaction, 2 người xuất cùng lúc / 1 phiếu 2 dòng trùng đều lọt). null = không kiểm. */
  lengthCap?: Map<number, number> | null;
}
type SteelIssueDetail = Prisma.SteelIssueGetPayload<{ include: typeof STEEL_ISSUE_DETAIL_INCLUDE }>;
type BaseInputs = {
  orders: OrderForBom[];
  bomPieces: Prisma.BomPieceGetPayload<object>[];
  pieceBoms: Prisma.PieceBomGetPayload<{
    include: { segmentSpec: { include: { material: true } } };
  }>[];
  /** MỌI đợt xuất của PI (kể cả rework). issuedBarCount chỉ cộng đợt gốc (reworkOfId null); đối chiếu
   *  sắt vào - đoạn ra cộng mọi đợt ĐÃ NHẬN (status != ISSUED) theo số thực nhận. */
  issues: {
    materialId: bigint;
    barCount: number;
    barLengthMm: number;
    status: SteelIssueStatus;
    receivedBarCount: number | null;
    reworkOfId: bigint | null;
  }[];
};
type CutSegmentRow = {
  segmentSpecId: bigint;
  qty: number;
  cutBundle: { productionOrderId: bigint | null; status: CutBundleStatus };
};
type CutQcRow = {
  segmentSpecId: bigint;
  failedQty: number;
  /** P1: KCS ghi thiếu (không tính lỗi, không làm bù). */
  shortQty: number;
  qcReview: { cutBundle: { productionOrderId: bigint | null } | null };
};
type StepSegmentRow = {
  segmentSpecId: bigint;
  qty: number;
  /** `bundleStatus` null = dòng đã báo nhưng CHƯA gom vào đợt gửi KCS nào. */
  stepBatch: {
    productionOrderId: bigint | null;
    step: ProcessStep;
    bundleStatus: StepBundleStatus | null;
  };
};
type StepQcRow = {
  segmentSpecId: bigint;
  failedQty: number;
  /** P1: KCS ghi thiếu / bỏ (cắt lại). */
  shortQty: number;
  scrapQty: number;
  qcReview: { stepBundle: { productionOrderId: bigint | null; step: ProcessStep } | null };
};
/** Dữ liệu tính tiến độ CẮT của 1 PI (đã chia sẵn theo PI bởi loadPhoiInputs). */
type CutInputs = BaseInputs & {
  /** Máy cắt của phương án đã duyệt, theo loại sắt (2026-10-23): quyết định dùng tề đầu/lưỡi của máy nào để
   *  đối chiếu sắt vào - đoạn ra. Thiếu khoá = MC Laser (phương án cũ chưa ghi máy). */
  machineByMaterial: Map<string, SolverMachine>;
  cutSegments: CutSegmentRow[];
  qcSegments: CutQcRow[];
  /** P1: cùng mảng với StepInputs - số cần của Cắt cộng cả phần BỎ ở công đoạn phụ nên Cắt cần cả dữ liệu công đoạn. */
  stepSegments: StepSegmentRow[];
  stepQcSegments: StepQcRow[];
  /** P1: giữ chỗ sắt ACTIVE còn lại theo loại sắt (gợi ý sắt còn xuất được). */
  reservations: { materialId: bigint; remaining: number; stockLengthMm: number }[];
  /** Huỷ lệnh đợt 2 - Q3: mm sắt tổ cắt đã nhập trả kho (SteelReturn) theo loại sắt - trừ khỏi sắt đã nhận. */
  returnedMmByMaterial: Map<string, number>;
};
/** Dữ liệu tính tiến độ CÔNG ĐOẠN PHỤ của 1 PI (mọi công đoạn, lọc theo `step` khi tính). */
type StepInputs = BaseInputs & {
  stepSegments: StepSegmentRow[];
  qcSegments: StepQcRow[];
  /** P1: cùng mảng với CutInputs - vế vật lý của công đoạn phụ cần số đoạn cắt thực có. */
  cutSegments: CutSegmentRow[];
  cutQcSegments: CutQcRow[];
};

type OrderForBom = {
  id: bigint;
  bomRevisionId: bigint;
  quantity: number;
  floorStage: ProductionOrderFloorStage;
  /** Huỷ lệnh theo SKU (23/11/2026). Mock cũ có thể thiếu -> coi như chưa huỷ. */
  status?: ProductionOrderStatus;
};

/// Kho vật lý duy nhất liên quan (cat_sat_iea chỉ tính vật tư sắt) - cùng giá trị
/// STEEL_WAREHOUSE_CODE trong cutting-proposals.service.ts, không tách file constant riêng vì
/// đúng convention đã có (giữ local, hardcode có chú thích) ở chính module nguồn đó.
const STEEL_WAREHOUSE_CODE = 'phoi-son-han';

/// Kho ảo cố định - điểm đến của bút toán "sắt xuất dùng cho sản xuất" (STEEL_ISSUE), chuyển từ
/// CuttingProposalsService.approve() sang đây ở B4 Đợt 2 (xem STEEL_ISSUE_RESERVATION_CUTOVER).
const PRODUCTION_WAREHOUSE_CODE = 'PRODUCTION';

/**
 * B4 Đợt 2 (Sếp chốt 2026-08-17, changelog mục 13) - mốc CHUYỂN ĐỔI cơ chế trừ tồn kho sắt.
 *
 * TRƯỚC mốc này: CuttingProposalsService.approve() trừ tồn thật (StockLedger) ngay lúc duyệt
 * phương án cắt (quyết định Sếp 2026-08-07). Mọi CuttingProposal có `approvedAt` TRƯỚC mốc này
 * ĐÃ bị trừ tồn theo cơ chế đó rồi - create() ở dưới KHÔNG được trừ lần 2 cho chúng, chỉ theo dõi
 * thực thi như hành vi cũ.
 *
 * TỪ mốc này trở đi: approve() chỉ GIỮ CHỖ (StockReservation), KHÔNG trừ tồn thật nữa - create()
 * mới là nơi trừ tồn thật + tiêu giữ chỗ tương ứng.
 *
 * Chọn mốc cố định (không phải "check trạng thái nào") để không cần viết script backfill dữ liệu
 * cũ - an toàn hơn (không có rủi ro script tự sai mà không ai biết), đổi lại code phải giữ nhánh
 * rẽ này cho tới khi mọi CuttingProposal duyệt trước mốc đã được Phôi xuất hết (dọn sau, không
 * cấp bách). QUAN TRỌNG: giá trị dưới đây là mốc dev/test của phiên viết code này - PHẢI cập nhật
 * đúng ngày/giờ deploy thật lên production trước khi release, nếu không mọi phương án duyệt giữa
 * lúc code này viết và lúc deploy thật sẽ bị hiểu sai cơ chế.
 */
const STEEL_ISSUE_RESERVATION_CUTOVER = new Date('2026-08-18T00:00:00.000Z');

/**
 * Xuất sắt cho Phôi (M2, thay phoi-sat.service.ts mock) - lớp theo dõi THỰC THI vật lý dưới 1
 * CuttingProposal đã APPROVED cho 1 (production_invoice, material).
 *
 * B4 Đợt 3d (2026-08-19, changelog 2026-08-18-xuat-sat-po-pi-vat-tu.md mục 2) - gộp theo CẢ PI
 * thay vì theo (production_order, piece): 1 PI có thể có nhiều SKU/PO (xem memory
 * project_pi_multi_sku_multi_po), phần mềm đề xuất mua/cắt sắt vốn đã tính gộp ở cấp PI, và Phôi
 * tự phân bổ vật lý theo mảnh nào khi cắt thật - hệ thống không cần (và không thể) biết trước
 * "cây này cho mảnh nào" vì SegmentSpec dùng chung toàn hệ thống, không thuộc riêng 1 mảnh. Hệ
 * quả: `requiredSteps` (công đoạn ngoài Cắt như uốn/dập) giờ là HỢP (union) của mọi mảnh dùng
 * material này trong cả PI, không còn suy theo đúng 1 mảnh - xem resolveRequiredSteps().
 *
 * Hệ quả khác đã xử lý riêng: WarehouseTransfersService.getPieceTransferPlan() trước đây đếm số
 * mảnh "vật tư thành phẩm" (needsHan=false) đã xong qua SteelIssue.pieceId - không còn tính được
 * nữa, đã CHẶN CỨNG (throw) nhánh đó vì thực tế nghiệp vụ hiện tại mọi mảnh đều needsHan=true.
 *
 * B4 Đợt 2 (2026-08-17): create() giờ CÓ THỂ ghi StockLedger - xem STEEL_ISSUE_RESERVATION_CUTOVER
 * ở trên. TRƯỚC đây (2026-08-07 - 2026-08-17) cố ý KHÔNG ghi vì CuttingProposalsService.approve()
 * đã trừ tồn 1 lần gộp ngay lúc duyệt - comment cũ vẫn đúng cho nhánh "trước cutover" bên dưới.
 * State machine 1 chiều ISSUED -> RECEIVED -> AWAITING_QC -> QC_PASSED.
 *
 * Lệch tài liệu gốc điểm 2: tài liệu phác thảo thêm 1 endpoint riêng `POST
 * /steel-issues/:id/rework`, tách khỏi qc-review. Nhưng mô tả transition của chính qc-review
 * trong cùng tài liệu ("AWAITING_QC -> QC_PASSED hoặc -> RECEIVED tuỳ failedQty") mâu thuẫn với
 * việc có 1 rework issue MỚI (rework_of) - không rõ ràng dòng nào là dòng "còn dở". Đã bỏ hẳn
 * endpoint rework riêng.
 *
 * ĐÍNH CHÍNH 09/09/2026 (audit toàn diện): đoạn trên mô tả THIẾT KẾ GỐC, KHÔNG còn đúng với code
 * hiện tại. `createReworkIssue()` (tự sinh SteelIssue con khi QC bắt sửa) đã bị bỏ khỏi
 * QcReviewsService.review() từ commit "Fix phoi" (25/08/2026) khi luồng KCS chuyển hẳn sang chấm
 * theo segments (QcReviewSegment + reportSegmentDone()/recheck()) - hàm đó đã bị xoá vì là code
 * mồ côi, không còn endpoint/service nào gọi tới. Rework ở luồng hiện hành = người dùng tự tạo
 * đợt/lô hoàn toàn mới qua API tạo bình thường, không có "rework issue" tự sinh riêng. Field
 * `reworkOfId` trên model vẫn giữ (đang được dùng để lọc loại đợt rework cũ ra khỏi tính sản
 * lượng/kế hoạch ở getIssuePlan() và các hàm liên quan) dù không còn ai ghi giá trị mới vào đó.
 */
@Injectable()
export class SteelIssuesService {
  private readonly logger = new Logger(SteelIssuesService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly stockLedgerService: StockLedgerService,
    private readonly stockReservationsService: StockReservationsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Phát realtime SAU KHI transaction đã commit (xem RealtimeService). */
  private publishRealtime(
    entityId: bigint | string,
    action: 'CREATED' | 'RECEIVED' | 'PROGRESS',
    actorId: string | null,
    productionInvoiceId: bigint | string,
  ): void {
    this.realtime.publishEntityChanged({
      entity: 'STEEL_ISSUE',
      entityId,
      action,
      actorId,
      parentId: productionInvoiceId,
    });
  }

  /** Best-effort NGOÀI transaction - cùng lý do kỹ thuật đã ghi ở nhiều nơi khác (mục 15.2/16.2/17.2
   *  changelog notification): catch bên trong 1 Prisma interactive transaction không cứu được
   *  transaction đó nếu lỗi. */
  private async notifySteelIssue(
    type: 'STEEL_ISSUE_TO_PHOI' | 'CUT_BUNDLE_TO_KCS',
    entityId: bigint,
    params: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.notifications.emit(type, { entityId: entityId.toString(), params });
    } catch (error) {
      this.logger.error(
        `Failed to create ${type} notification (entity ${entityId}): ${(error as Error).message}`,
      );
    }
  }

  /** Best-effort, ngoài transaction - cùng lý do notifySteelIssue(). */
  private async notifyReceivedMismatch(
    issue: SteelIssueRow,
    receivedBarCount: number,
  ): Promise<void> {
    try {
      await this.notifications.emit('STEEL_ISSUE_RECEIVED_MISMATCH', {
        entityId: issue.id.toString(),
        actorId: issue.receivedById ?? undefined,
        params: {
          piCode: issue.productionInvoice.code,
          materialCode: issue.material.code,
          barCount: issue.barCount,
          receivedBarCount,
          receiverName: userName(issue.receivedBy) ?? 'Phôi',
          issuedById: issue.issuedById,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to create STEEL_ISSUE_RECEIVED_MISMATCH (entity ${issue.id}): ${(error as Error).message}`,
      );
    }
  }

  private async resolveSteelIssueToPhoi(entityId: bigint): Promise<void> {
    try {
      await this.notifications.resolve({
        entityType: 'STEEL_ISSUE',
        entityId: entityId.toString(),
        types: ['STEEL_ISSUE_TO_PHOI'],
      });
    } catch (error) {
      this.logger.error(
        `Failed to resolve STEEL_ISSUE_TO_PHOI (entity ${entityId}): ${(error as Error).message}`,
      );
    }
  }

  async create(
    productionInvoiceId: string,
    dto: CreateSteelIssueDto,
    issuedById: string,
    warehouseScope: string | null,
    idempotencyKey?: string,
  ): Promise<SteelIssueResponseDto> {
    // null = tổng kho (BOSS/ADMIN) - không có gì để chặn. Gate theo GIA ĐÌNH phoi-son-han (không
    // phải instance cụ thể) - trừ tồn thật đã đúng theo Material.warehouseId từ trước ở
    // CuttingProposalsService.approve() (StockReservation), gate này chỉ xác nhận caller là nhân
    // sự thuộc "phía Phôi", 2026-09-03 mở rộng cho cả kho phoi-son-han PHỤ (isFamilyScope).
    if (warehouseScope && !isFamilyScope(warehouseScope, 'phoi-son-han')) {
      throw new ForbiddenException(
        `Bạn bị giới hạn ở kho '${warehouseScope}', không được xuất sắt kho '${STEEL_WAREHOUSE_CODE}'`,
      );
    }

    if (idempotencyKey) {
      const existing = await this.prisma.steelIssue.findUnique({
        where: { idempotencyKey },
        include: STEEL_ISSUE_INCLUDE,
      });
      if (existing) {
        return this.toResponseDto(
          existing,
          await this.resolveRequiredSteps(existing.productionInvoiceId, existing.materialId),
        );
      }
    }

    const prepared = await this.prepareIssue(productionInvoiceId, dto);
    this.assertWarehouseScope(prepared, warehouseScope);
    const created = await this.prisma.$transaction(
      (tx) => this.createInTx(tx, prepared, issuedById, idempotencyKey),
      { timeout: 15_000 },
    );
    await this.afterCreate(created, issuedById);
    return this.toResponseDto(
      created,
      await this.resolveRequiredSteps(prepared.productionInvoiceId, prepared.materialId),
    );
  }

  /**
   * Phần kiểm tra TRƯỚC transaction của 1 lần xuất sắt (đọc qua this.prisma) - tách riêng (Đợt 6, phiếu xuất XK nhiều dòng)
   * để IssueSlipsService kiểm từng dòng trước rồi ghi mọi dòng trong 1 transaction chung.
   */
  async prepareIssue(
    productionInvoiceId: string,
    dto: CreateSteelIssueDto,
  ): Promise<PreparedSteelIssue> {
    const invoice = await this.findInvoiceOrThrow(productionInvoiceId);
    const materialId = parseBigIntId(dto.materialId);
    const orders = await this.findOrdersForInvoice(invoice.id);
    this.assertOrdersHaveActiveFloor(orders, invoice.id);
    // Đổi xưởng (anh Nhân 10/11/2026): KHSX chưa bấm "Đã kiểm" phương án cắt thì chưa xuất sắt.
    if (await isCuttingRecheckPending(this.prisma, invoice.id)) {
      throw new ConflictException(CUTTING_RECHECK_MESSAGE);
    }
    await this.assertMaterialUsedInInvoice(orders, materialId, invoice.id);
    const poIds = orders.map((o) => o.id);
    const { approvedAt, stockLengthsMm, requiredBarsByLength, usesLeftover } =
      await this.assertMaterialInApprovedProposal(invoice.id, poIds, materialId);
    // Rà soát 14/11 XK4: cây xuất phải đúng chiều dài phương án đã duyệt (Phôi cắt theo phương án đó; tồn bị trừ ở đúng ô chiều dài
    // xuất). Phương án cũ chưa lưu chiều dài (trước 26/08) thì không kiểm.
    if (stockLengthsMm.length > 0 && !stockLengthsMm.includes(dto.barLengthMm)) {
      throw new BadRequestException(
        `Phương án cắt đã duyệt dùng cây dài ${stockLengthsMm.join(' / ')}mm - không xuất cây ${dto.barLengthMm}mm cho lệnh này`,
      );
    }
    // CS2 (anh Nhân 20/11/2026): phương án dùng cả cây lẻ kho Phôi lẫn cây chiều dài mua -> mỗi chiều dài chỉ xuất tới đúng số
    // cây phương án cần. Giữ chỗ rút theo TỔNG cây nên không tự chặn được: xuất dư chiều dài này sẽ ăn mất phần của chiều dài
    // kia. Cũng áp dụng khi CẢ loại sắt chỉ cắt cây lẻ (1 chiều dài nhưng khác chiều dài mua) - không xuất cây chiều dài mua
    // không được giữ chỗ cho lệnh. Phương án 1 chiều dài mua (cũ) giữ nguyên như trước (giữ chỗ chặn tổng).
    const lengthCap = requiredBarsByLength.size > 1 || usesLeftover ? requiredBarsByLength : null;
    if (lengthCap) {
      // Báo sớm (trước khi lập phiếu); createInTx() kiểm lại dưới khoá dòng lệnh.
      await this.assertLengthCap(
        this.prisma,
        invoice.id,
        materialId,
        dto.barLengthMm,
        dto.barCount,
        lengthCap,
      );
    }
    // approvedAt null về lý thuyết không xảy ra (status đã lọc APPROVED ở query trên, field này
    // luôn được set cùng lúc chuyển status) - coi như "trước cutover" nếu có, an toàn hơn (không
    // trừ tồn lần 2) là sai theo chiều ngược lại.
    const isPostCutover = (approvedAt ?? new Date(0)) >= STEEL_ISSUE_RESERVATION_CUTOVER;
    const material = await this.prisma.material.findUnique({
      where: { id: materialId },
      select: {
        code: true,
        warehouse: { select: { id: true, code: true, kind: true, workshopId: true } },
      },
    });
    if (!material?.warehouse) {
      throw new BadRequestException(`Vật tư ${material?.code ?? materialId} chưa được gán kho`);
    }
    const resolver = new WorkshopWarehouseResolver(this.prisma);
    const warehouse = await resolver.resolveForPi(material.warehouse, invoice.id);
    return {
      productionInvoiceId: invoice.id,
      materialId,
      barLengthMm: dto.barLengthMm,
      barCount: dto.barCount,
      isPostCutover,
      warehouse: { id: warehouse.id, code: warehouse.code },
      // Cùng resolver (đã nhớ xưởng lúc tra kho ở trên) - đúng xưởng đã dùng để ra `warehouse`.
      workshopId: await resolver.workshopIdOfPi(invoice.id),
      lengthCap,
    };
  }

  /**
   * CS2 (anh Nhân 20/11/2026): phương án dùng cả cây lẻ kho Phôi lẫn cây chiều dài mua (hoặc chỉ cây lẻ) -> mỗi chiều dài chỉ xuất tới
   * đúng số cây phương án cần. Giữ chỗ giờ rút đúng chiều dài (drainPool stockLengthMm) nhưng phần giữ cây mua còn gồm hàng mua về
   * cho cả lệnh, nên vẫn chặn theo số cây phương án ở đây. `db` = tx khi gọi từ createInTx (đếm cả dòng vừa ghi trong cùng phiếu).
   */
  private async assertLengthCap(
    db: PrismaTx | PrismaServiceType,
    productionInvoiceId: bigint,
    materialId: bigint,
    barLengthMm: number,
    barCount: number,
    requiredBarsByLength: Map<number, number>,
  ): Promise<void> {
    const need = requiredBarsByLength.get(barLengthMm) ?? 0;
    const agg = await db.steelIssue.aggregate({
      where: { productionInvoiceId, materialId, barLengthMm, reworkOfId: null },
      _sum: { barCount: true },
    });
    const issued = agg._sum.barCount ?? 0;
    if (issued + barCount <= need) return;
    // 23/11/2026 (thử sống cây lẻ): nêu số cây CÒN PHẢI xuất ở chiều dài khác (trừ phần đã xuất) - trước đây nêu tổng phương án
    // cần nên báo "còn 1 cây 5800" dù cây 5800 đã xuất đủ.
    const issuedByLength = new Map(
      (
        await db.steelIssue.groupBy({
          by: ['barLengthMm'],
          where: { productionInvoiceId, materialId, reworkOfId: null },
          _sum: { barCount: true },
        })
      ).map((g) => [g.barLengthMm, g._sum.barCount ?? 0]),
    );
    const others = [...requiredBarsByLength]
      .filter(([len]) => len !== barLengthMm)
      .map(([len, bars]) => [len, bars - (issuedByLength.get(len) ?? 0)] as const)
      .filter(([, left]) => left > 0)
      .map(([len, left]) => `${left} cây ${len}mm`)
      .join(', ');
    throw new BadRequestException(
      `Phương án cắt cần ${need} cây ${barLengthMm}mm (đã xuất ${issued}) - chỉ còn xuất được ${Math.max(0, need - issued)} cây chiều dài này.` +
        (others ? `\nPhần còn lại của loại sắt này xuất theo chiều dài khác: ${others}` : ''),
    );
  }

  /** Đợt 7: thủ kho chỉ xuất sắt ở đúng kho Phôi của xưởng làm lệnh (trước đây cả họ phoi-son-han). null = tổng kho. */
  assertWarehouseScope(p: PreparedSteelIssue, warehouseScope: string | null): void {
    if (warehouseScope && warehouseScope !== p.warehouse.code) {
      throw new ForbiddenException(
        `Bạn phụ trách kho '${warehouseScope}', sắt của lệnh này xuất từ kho '${p.warehouse.code}'`,
      );
    }
  }

  /** Phần ghi TRONG transaction (caller mở transaction) - không gửi thông báo, xem afterCreate(). */
  async createInTx(
    tx: PrismaTx,
    p: PreparedSteelIssue,
    issuedById: string,
    idempotencyKey?: string,
  ): Promise<SteelIssueRow> {
    // Rà soát 14/11 CK6: khoá dòng lệnh (chung với đổi xưởng) TRƯỚC mọi khoá khác, rồi kiểm lại SAU khoá - đổi xưởng commit giữa
    // lúc prepareIssue() tra kho và lúc ghi thì không còn xuất ở kho xưởng cũ, không lách cờ "cần kiểm lại phương án cắt".
    const locked = (await lockPisForIssue(tx, [p.productionInvoiceId])).get(
      p.productionInvoiceId.toString(),
    );
    if (locked?.cuttingRecheckRequired) {
      throw new ConflictException(CUTTING_RECHECK_MESSAGE);
    }
    assertWorkshopUnchanged(locked, p.workshopId);
    await assertPiHasActiveFloorLocked(tx, p.productionInvoiceId, 'xuất sắt');
    if (p.lengthCap) {
      await this.assertLengthCap(
        tx,
        p.productionInvoiceId,
        p.materialId,
        p.barLengthMm,
        p.barCount,
        p.lengthCap,
      );
    }

    const issue = await tx.steelIssue.create({
      data: {
        productionInvoiceId: p.productionInvoiceId,
        materialId: p.materialId,
        barLengthMm: p.barLengthMm,
        barCount: p.barCount,
        issuedById,
        idempotencyKey,
      },
      include: STEEL_ISSUE_INCLUDE,
    });

    if (p.isPostCutover) {
      await this.consumeReservationAndDeduct(tx, {
        // L5 (2026-08-26): rút từ POOL của cả PI+vật tư, không còn 1 cuttingProposalId cụ thể
        // - xem StockReservationsService.drainPool và docstring hàm dưới đây.
        productionInvoiceId: p.productionInvoiceId,
        materialId: p.materialId,
        barLengthMm: p.barLengthMm,
        barCount: p.barCount,
        steelIssueId: issue.id,
        issuedById,
        expectedWarehouseId: p.warehouse.id,
      });
    }
    return issue;
  }

  /** Sau khi transaction đã commit: báo Phôi + realtime (best-effort). */
  async afterCreate(created: SteelIssueRow, issuedById: string): Promise<void> {
    await this.notifySteelIssue('STEEL_ISSUE_TO_PHOI', created.id, {
      piCode: created.productionInvoice.code,
      materialCode: created.material.code,
      barCount: created.barCount,
    });
    this.publishRealtime(created.id, 'CREATED', issuedById, created.productionInvoiceId);
  }

  /**
   * B4 Đợt 2 - phần "tiêu hao" thật của thiết kế đặt-giữ/tiêu-hao (changelog mục 13). Chỉ gọi cho
   * phương án duyệt SAU STEEL_ISSUE_RESERVATION_CUTOVER (xem create()).
   *
   * L5 (2026-08-26): rút từ POOL giữ chỗ của (PI, vật tư) qua StockReservationsService.drainPool()
   * - KHÔNG còn khoá cứng vào 1 cuttingProposalId cụ thể. Trước đây tra đúng 1 dòng theo
   * cuttingProposalId do assertMaterialInApprovedProposal() TÌM NGẪU NHIÊN (findFirst không
   * orderBy) trong số các phương án cắt riêng lẻ của từng SKU cùng PI - trong khi hàng mua về lại
   * luôn cộng vào phương án duyệt SAU CÙNG (PurchaseProposal.cuttingProposalId bị ghi đè mỗi lần
   * merge). 2 quy tắc lệch nhau nghĩa là: SKU nào KHÔNG trùng con số `findFirst` chọn được thì
   * giữ chỗ của nó không bao giờ lớn lên dù hàng đã về kho, rồi kẹt cứng (ConflictException) khi
   * Phôi xuất, dù PI đó rõ ràng đã đủ sắt. drainPool() gộp mọi dòng giữ chỗ của PI+vật tư thành 1
   * pool và rút theo tổng - đường lệch đó không còn tồn tại.
   */
  private async consumeReservationAndDeduct(
    tx: PrismaTx,
    input: {
      productionInvoiceId: bigint;
      materialId: bigint;
      barLengthMm: number;
      barCount: number;
      steelIssueId: bigint;
      issuedById: string;
      expectedWarehouseId: bigint;
    },
  ): Promise<void> {
    // Rà soát 14/11 CK3 (nhóm B 16/11): chỉ rút giữ chỗ ở ĐÚNG kho Phôi của xưởng làm lệnh (kho trừ tồn). Trước đây rút cả
    // pool rồi so kho của dòng đầu - lệnh có giữ chỗ ở 2 kho (đổi xưởng, hàng mua về kho mới) bị báo lỗi oan. Còn giữ ở kho
    // xưởng khác thì drainPool báo rõ cần phiếu chuyển hàng của lệnh.
    const { warehouseId } = await this.stockReservationsService.drainPool(tx, {
      productionInvoiceId: input.productionInvoiceId,
      materialId: input.materialId,
      qty: input.barCount,
      warehouseId: input.expectedWarehouseId,
      // CS2 (review Sang 21/11): rút đúng giữ chỗ của chiều dài cây đang xuất (cây lẻ / cây mua tách riêng).
      stockLengthMm: input.barLengthMm,
    });

    // Chặn tồn âm cục bộ (lỗ #2, mục 13.4) - không sửa StockLedgerService.postEntry() dùng chung
    // (nhiều luồng khác hợp lệ phải cho âm, vd kho ảo SUPPLIER) - chặn ngay tại đây, cùng khoá.
    // Phòng ca hiếm: tồn vật lý bị điều chỉnh tay (Admin > Sửa nhanh tồn kho) lệch khỏi giữ chỗ.
    // Lọc ĐÚNG bucket chiều dài đang xuất (2026-09-05) - không cộng lẫn tồn của chiều dài KHÁC
    // (kho có thể có nhiều lô cùng vật tư khác chiều dài, mua ở PI/thời điểm khác nhau).
    const [stockRow] = await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
      SELECT "qty" FROM "stock_quant"
      WHERE "warehouseId" = ${warehouseId} AND "materialId" = ${input.materialId}
        AND "stockLengthMm" = ${input.barLengthMm}
      FOR UPDATE
    `;
    const onHand = Math.floor(stockRow?.qty.toNumber() ?? 0);
    if (onHand < input.barCount) {
      throw new ConflictException(
        `Tồn kho vật lý cây dài ${input.barLengthMm}mm (${onHand} cây) không đủ xuất ${input.barCount} cây cho vật tư ${input.materialId} - có thể đã bị điều chỉnh tay (Admin > Sửa nhanh tồn kho) hoặc kho chỉ còn chiều dài khác, kiểm tra lại trước khi xuất`,
      );
    }

    const productionWarehouse = await tx.warehouse.findUniqueOrThrow({
      where: { code: PRODUCTION_WAREHOUSE_CODE },
    });
    await this.stockLedgerService.postEntry(
      {
        fromWarehouseId: warehouseId,
        toWarehouseId: productionWarehouse.id,
        materialId: input.materialId,
        qty: input.barCount,
        refType: StockLedgerRefType.STEEL_ISSUE,
        refId: input.steelIssueId.toString(),
        createdById: input.issuedById,
        idempotencyKey: `steel-issue:${input.steelIssueId}:consume`,
        stockLengthMm: input.barLengthMm,
      },
      tx,
    );
  }

  /** Flat, KHÔNG cần productionInvoiceId - xem ListSteelIssuesQueryDto tại sao endpoint này tồn
   *  tại riêng (permission PHOI_STAFF/KCS_STAFF không đủ để tự resolve productionInvoiceId). */
  async findAll(query: ListSteelIssuesQueryDto): Promise<Paginated<SteelIssueResponseDto>> {
    const where: Prisma.SteelIssueWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      // Xem comment ở ListSteelIssuesQueryDto.activeOnly - chỉ áp dụng khi FE chủ động truyền,
      // không ảnh hưởng các nơi khác đang gọi chung endpoint (Xác nhận nhận sắt, KcsPhoiPage).
      ...(query.activeOnly === 'true'
        ? { productionInvoice: { items: { some: { productionOrder: { floorStage: 'ACTIVE' } } } } }
        : {}),
    };
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.steelIssue.findMany({ ...args, include: STEEL_ISSUE_INCLUDE }),
        count: (args) => this.prisma.steelIssue.count(args),
      },
      query,
      where,
      { issuedAt: 'desc' as const },
    );
    const requiredStepsMap = await this.attachRequiredStepsMap(result.data);
    return {
      data: result.data.map((r) =>
        this.toResponseDto(
          r,
          requiredStepsMap.get(`${r.productionInvoiceId}:${r.materialId}`) ?? [ProcessStep.CAT],
        ),
      ),
      meta: result.meta,
    };
  }

  async findAllForInvoice(
    productionInvoiceId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<SteelIssueResponseDto>> {
    const bigId = parseBigIntId(productionInvoiceId);
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.steelIssue.findMany({ ...args, include: STEEL_ISSUE_INCLUDE }),
        count: (args) => this.prisma.steelIssue.count(args),
      },
      query,
      { productionInvoiceId: bigId },
      { issuedAt: 'desc' as const },
    );
    const requiredStepsMap = await this.attachRequiredStepsMap(result.data);
    return {
      data: result.data.map((r) =>
        this.toResponseDto(
          r,
          requiredStepsMap.get(`${r.productionInvoiceId}:${r.materialId}`) ?? [ProcessStep.CAT],
        ),
      ),
      meta: result.meta,
    };
  }

  /**
   * Gộp nhiều PI 1 lần, không phân trang (limit=100 FE vốn đã dùng để "lấy hết" cho 1 PI - gộp
   * nhiều PI cùng lúc còn ít hơn) - "Bảng thống kê" (ThongKePagePlan.tsx) tải tiến độ Phôi cho
   * nhiều SKU cùng lúc, nhiều SKU có thể chung 1 PI (đợt gộp) nên trước đây tải trùng lặp cùng 1
   * PI nhiều lần. attachRequiredStepsMap() đã tự hỗ trợ nhiều invoiceId từ trước (không đổi gì ở
   * đó) - cùng mẫu GET /packaging-issues/plan (PackagingIssuesService.getBulkPlan()).
   */
  async findAllForInvoiceBatch(
    productionInvoiceIds: string[],
  ): Promise<Record<string, SteelIssueResponseDto[]>> {
    const result: Record<string, SteelIssueResponseDto[]> = {};
    for (const id of productionInvoiceIds) result[id] = [];
    if (productionInvoiceIds.length === 0) return result;

    const bigIds = productionInvoiceIds.map((id) => parseBigIntId(id));
    const rows = await this.prisma.steelIssue.findMany({
      where: { productionInvoiceId: { in: bigIds } },
      include: STEEL_ISSUE_INCLUDE,
      orderBy: { issuedAt: 'desc' },
    });
    const requiredStepsMap = await this.attachRequiredStepsMap(rows);
    for (const r of rows) {
      const dto = this.toResponseDto(
        r,
        requiredStepsMap.get(`${r.productionInvoiceId}:${r.materialId}`) ?? [ProcessStep.CAT],
      );
      result[r.productionInvoiceId.toString()].push(dto);
    }
    return result;
  }

  async findOne(id: string): Promise<SteelIssueResponseDto> {
    const issue = await this.findOneOrThrow(id);
    return this.toResponseDto(
      issue,
      await this.resolveRequiredSteps(issue.productionInvoiceId, issue.materialId),
    );
  }

  async getBundles(id: string): Promise<CutBundleResponseDto[]> {
    const detail = await this.findDetailOrThrow(id);
    const requiredSteps = await this.resolveRequiredSteps(
      detail.productionInvoiceId,
      detail.materialId,
    );
    return detail.bundles.map((b) => this.toBundleResponseDto(b, requiredSteps));
  }

  /**
   * Mọi đợt cắt của 1 PI (2026-09-05) - nguồn dữ liệu cho màn Phôi sau khi GỘP hiển thị theo loại
   * sắt: 1 loại sắt giờ chỉ còn 1 mục dù kho giao làm nhiều lần, bên trong liệt kê các đợt cắt
   * (mỗi đợt mang trạng thái riêng). FE tự gom theo materialId - ở đây trả phẳng kèm đủ thông tin
   * lô cha để gom.
   *
   * `status` (tuỳ chọn) để màn KCS lọc thẳng AWAITING_QC mà không phải tải hết rồi lọc ở client.
   */
  async findAllBundles(
    productionInvoiceId?: string,
    status?: CutBundleStatus,
  ): Promise<CutBundleResponseDto[]> {
    const bundles = await this.prisma.cutBundle.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(productionInvoiceId
          ? { steelIssue: { productionInvoiceId: parseBigIntId(productionInvoiceId) } }
          : {}),
      },
      include: {
        segments: { include: { segmentSpec: true } },
        steelIssue: true,
        ...BUNDLE_REPORTERS_INCLUDE,
      },
      orderBy: { id: 'desc' },
    });

    // resolveRequiredSteps() truy vấn theo (PI, vật tư) - gom 1 lần cho mỗi cặp thay vì gọi lại
    // cho từng đợt (1 PI thường chỉ vài loại sắt nhưng hàng chục đợt cắt).
    const stepsByKey = new Map<string, ProcessStep[]>();
    for (const b of bundles) {
      const key = `${b.steelIssue.productionInvoiceId}:${b.steelIssue.materialId}`;
      if (!stepsByKey.has(key)) {
        stepsByKey.set(
          key,
          await this.resolveRequiredSteps(
            b.steelIssue.productionInvoiceId,
            b.steelIssue.materialId,
          ),
        );
      }
    }
    return bundles.map((b) =>
      this.toBundleResponseDto(
        b,
        stepsByKey.get(`${b.steelIssue.productionInvoiceId}:${b.steelIssue.materialId}`) ?? [],
      ),
    );
  }

  /**
   * Xác nhận đã nhận 1 đợt sắt (2026-10-12): người nhận ĐẾM rồi tự điền số cây thực nhận
   * (`receivedBarCount`, bỏ trống = đúng bằng `barCount`), hệ thống lưu số + người + giờ nhận. Lệch
   * `barCount` (thiếu/thừa) VẪN nhận - báo thủ kho đã xuất + QLSX (STEEL_ISSUE_RECEIVED_MISMATCH), KHÔNG
   * tự ghi StockLedger: kho đã trừ tồn lúc xuất, chênh lệch thật nằm ở đâu (đếm nhầm, rơi dọc đường, giao
   * nhầm PI) chỉ kho kiểm mới biết. `updateMany` có điều kiện status chống 2 người bấm nhận cùng lúc.
   */
  async receive(
    id: string,
    receivedById: string,
    receivedBarCountInput?: number,
  ): Promise<SteelIssueResponseDto> {
    const issue = await this.findOneOrThrow(id);
    if (issue.status !== SteelIssueStatus.ISSUED) {
      throw new ConflictException(
        `Phiếu xuất sắt ${id} đang ở trạng thái ${issue.status} - chỉ ISSUED mới xác nhận nhận được`,
      );
    }
    // Q3 (24/11/2026): PI có SKU đã huỷ thì tổ cắt vẫn xác nhận nhận được (lệnh có thể không còn SKU chạy).
    if (!(await piHasCancelledSku(this.prisma, issue.productionInvoiceId))) {
      await assertPiHasActiveFloor(this.prisma, issue.productionInvoiceId, 'xác nhận nhận sắt');
    }
    const receivedBarCount = receivedBarCountInput ?? issue.barCount;
    // XK8 (rà soát 14/11): update có điều kiện - audit-log ghi được ai nhận / nhận bao nhiêu cây (updateMany không ghi).
    try {
      await this.prisma.steelIssue.update({
        where: { id: issue.id, status: SteelIssueStatus.ISSUED },
        data: {
          status: SteelIssueStatus.RECEIVED,
          receivedBarCount,
          receivedAt: new Date(),
          receivedById,
        },
      });
    } catch (e) {
      // Không còn dòng đúng trạng thái (P2025) = 1 yêu cầu khác vừa xử lý.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new ConflictException(`Đợt sắt ${id} vừa được người khác xác nhận nhận`);
      }
      throw e;
    }
    const updated = await this.prisma.steelIssue.findUniqueOrThrow({
      where: { id: issue.id },
      include: STEEL_ISSUE_INCLUDE,
    });
    await this.resolveSteelIssueToPhoi(updated.id);
    if (receivedBarCount !== issue.barCount) {
      await this.notifyReceivedMismatch(updated, receivedBarCount);
    }
    this.publishRealtime(updated.id, 'RECEIVED', null, updated.productionInvoiceId);
    return this.toResponseDto(
      updated,
      await this.resolveRequiredSteps(updated.productionInvoiceId, updated.materialId),
    );
  }

  /**
   * Nhập số đoạn đã cắt cho ĐỢT ĐANG MỞ của lô - "Lưu đợt cắt" (2026-09-06).
   *
   * Cộng dồn vào đợt CUTTING gần nhất của CHÍNH lô này nếu có (Phôi bấm lưu nhiều lần trong ngày,
   * mỗi lần khai thêm vài cỡ đoạn, vẫn tính là 1 đợt) - CHỈ tạo đợt mới khi không còn đợt nào đang
   * mở (đợt trước đã "Báo cắt xong" qua `finishCutBundle()`, hoặc đây là lần khai đầu tiên của lô).
   * Trước 2026-09-06 mỗi lần lưu luôn tạo 1 `CutBundle` mới - đúng ý người dùng khi cắt/khai 1 lần
   * xong hẳn, nhưng bắt Phôi tạo nhiều đợt rời rạc nếu chỉ muốn khai rải trong ngày cho 1 đợt.
   *
   * Số đoạn là số Phôi ĐẾM THẬT, không suy từ `CuttingProposalPattern` (kế hoạch của solver).
   * Không còn cân bằng vật chất/chặn "vượt số cây kho giao" (bỏ cùng lúc bỏ 2 ô nhập "số cây đã
   * dùng"/"mẩu nguyên", 2026-09-05) - kiểm soát dồn hết về KCS, duyệt theo từng đợt cắt.
   *
   * CHỈ chạy khi lô đang RECEIVED - phần bù đoạn không đạt sau KCS đi qua
   * `QcReviewsService.reportSegmentDone`/`recheck`, không qua đây.
   */
  async recordCutBatch(
    id: string,
    dto: RecordCutBatchDto,
    reportedById: string,
    idempotencyKey?: string | null,
    ctx?: FloorReportContext,
  ): Promise<CutBundleResponseDto> {
    // Gửi lại cùng khoá -> trả đợt đã cộng, không cộng lần 2 (2026-10-12, xem FloorReport). Từ 20/11/2026 (T4-4) có so vân
    // tay (người, máy, cỡ đoạn + số, lô sắt trên route): khác thì 422, không trả đợt của người / lần báo khác.
    const expectedCut: FloorReportReplayExpected = {
      kind: FloorReportKind.CUT,
      reportedById,
      workstationId: ctx?.workstationId,
      lines: dto.segments.map((seg) => ({
        segmentSpecId: parseBigIntId(seg.segmentSpecId),
        qty: seg.qty,
      })),
      cutIssueId: parseBigIntId(id),
    };
    const replay = await this.replayFloorReport(idempotencyKey, expectedCut);
    if (replay) return this.replayCutReport(replay.cutBundleId);
    const issue = await this.findOneOrThrow(id);
    // CHỈ chặn khi CHƯA từng xác nhận nhận (ISSUED) - 1 lô có DUY NHẤT 1 đợt cắt thì ngay khi đợt
    // đó "Báo cắt xong", roll-up (syncIssueStatusFromBundles) đẩy issue.status lên
    // AWAITING_QC/QC_PASSED để 2 màn cũ hiện đúng tiến độ, NHƯNG đó chỉ là hiển thị - vẫn phải cho
    // Phôi mở đợt cắt MỚI cho cùng lô này (vd sắt kho giao thiếu, cắt xong lại phát hiện cần bù
    // thêm trước khi KCS kịp duyệt). Trước 2026-09-06 so `!== RECEIVED` vô tình biến giá trị
    // ROLL-UP thành điều kiện CHẶN THẬT - đúng lỗ hổng mà việc tách CutBundle khỏi SteelIssue
    // (2026-09-05) định giải quyết nhưng bỏ sót trường hợp lô chỉ có 1 đợt cắt.
    if (issue.status === SteelIssueStatus.ISSUED) {
      throw new ConflictException(
        `Phiếu xuất sắt ${id} chưa được xác nhận nhận - xác nhận ở "Xác nhận nhận sắt" trước khi nhập đợt cắt`,
      );
    }
    // 1 đợt cắt = đúng 1 SKU (2026-09-21) - SKU phải thuộc đúng PI của lô sắt này.
    const orderId = parseBigIntId(dto.productionOrderId);
    const piOrders = await this.findOrdersForInvoice(issue.productionInvoiceId);
    const order = piOrders.find((o) => o.id === orderId);
    if (!order) {
      throw new BadRequestException(
        `SKU (lệnh sản xuất ${dto.productionOrderId}) không thuộc PI của lô sắt này`,
      );
    }
    // Q3 (24/11/2026): SKU đã huỷ mà QLSX cho cắt tiếp - qua cổng xưởng, cắt tới số cần cũ của SKU, đoạn ra vào dư kho Phôi.
    const continuedCut =
      order.status === 'CANCELLED' && (await isCutContinuedForOrder(this.prisma, order.id));
    if (!continuedCut) {
      await assertPiHasActiveFloor(this.prisma, issue.productionInvoiceId, 'nhập đợt cắt');
      // Huỷ lệnh theo SKU (23/11/2026): cổng trên theo PI - SKU đã huỷ không nhận đợt cắt mới.
      assertLoadedOrderNotCancelled(order, 'nhập đợt cắt');
    }

    const specIds = dto.segments.map((seg) => parseBigIntId(seg.segmentSpecId));
    if (new Set(specIds.map(String)).size !== specIds.length) {
      throw new BadRequestException(
        'Cùng một cỡ đoạn khai làm nhiều dòng - gộp lại thành 1 dòng (UNIQUE cutBundleId+segmentSpecId)',
      );
    }

    const [specs, allowedSpecIds] = await Promise.all([
      this.prisma.segmentSpec.findMany({ where: { id: { in: specIds } } }),
      this.findBomSegmentSpecIds(issue.productionInvoiceId, order.bomRevisionId),
    ]);

    const specById = new Map(specs.map((sp) => [sp.id.toString(), sp]));
    for (const seg of dto.segments) {
      const spec = specById.get(parseBigIntId(seg.segmentSpecId).toString());
      if (!spec) {
        throw new NotFoundException(`Cỡ đoạn ${seg.segmentSpecId} không tồn tại`);
      }
      // Chặn khai nhầm cỡ của LOẠI SẮT KHÁC vào đợt này - đợt xuất gắn đúng 1 materialId, khai
      // lẫn sang vật tư khác làm hỏng cả tiến độ lẫn cân bằng mà không lộ ra ở đâu.
      if (spec.materialId !== issue.materialId) {
        throw new BadRequestException(
          `Cỡ đoạn ${spec.cutLengthMm.toString()}mm không thuộc loại sắt của đợt xuất này`,
        );
      }
      // Sếp chốt: Phôi chỉ được khai cỡ ĐÃ CÓ TRONG ĐỊNH MỨC. Cắt ra cỡ lạ thì phần sắt đó tự rơi
      // vào phế liệu qua phép trừ cân bằng - đúng về kế toán (sắt không thành chi tiết theo định
      // mức thì không phải thành phẩm).
      if (!allowedSpecIds.has(spec.id.toString())) {
        throw new BadRequestException(
          `Cỡ đoạn ${spec.cutLengthMm.toString()}mm không có trong định mức của SKU đã chọn`,
        );
      }
    }

    // Cân bằng vật chất (barCount × barLengthMm = tề đầu + đoạn + mạch cưa + mẩu nguyên + phế) đã
    // BỎ từ 2026-09-05 cùng lúc bỏ 2 ô nhập "số cây đã dùng"/"mẩu nguyên": không còn vế trái thì
    // không có gì để cân, cũng không suy ra được phế liệu. `barCount`/`mauNguyenMm` giữ lại trong model để dữ
    // liệu CŨ không mất, dòng mới ghi 0.
    // P1 (18/11/2026): KCS không còn là chốt kiểm soát duy nhất - báo CẮT vượt SỐ CẦN của (SKU, cỡ) bị chặn ngay lúc
    // báo (phoi-need.util: số cần = định mức + phần cắt lại cho đoạn KCS bỏ; số đã tính = thô - lỗi - thiếu). Số
    // cần đọc TRONG khoá cut-cap:{PI}:{sắt}:{SKU} gom mọi người, mọi lô sắt của PI, nên 2 người báo cùng lúc chỉ 1
    // người qua. Đoạn cắt dư vật lý để riêng dưới xưởng, không báo.
    //
    // Đợt đang mở (CUTTING) của lô này, nếu có, nhận thêm số đoạn lần này (cộng dồn qty theo
    // UNIQUE cutBundleId+segmentSpecId) - xem doc comment trên hàm. Không có thì mới tạo đợt mới.
    // Chỉ gộp vào đợt đang mở CỦA CÙNG SKU (đợt của SKU khác là đợt riêng).
    // Mỗi công nhân 1 đợt riêng (2026-10-13, mục 20.5/22): chỉ cộng vào đợt CỦA CHÍNH người báo, để KCS
    // chấm đạt/lỗi biết của ai. Đợt cũ chưa có người mở (openedById NULL, tạo trước cột này) thì người
    // báo đầu tiên nhận luôn đợt đó - không bỏ dở số đã khai.
    // Việc chọn đợt đang mở làm TRONG transaction, sau khi khoá (xem bên dưới) - đọc ngoài transaction
    // sẽ cộng nhầm vào đợt vừa được gửi KCS / vừa bị hủy hết bởi lời gọi khác chạy cùng lúc.
    const reportLines = dto.segments.map((seg) => ({
      segmentSpecId: parseBigIntId(seg.segmentSpecId),
      qty: seg.qty,
    }));
    let bundleId: bigint;
    try {
      const cutOutcome = await this.prisma.$transaction(
        async (tx) => {
          // 20/11/2026 (QA): try-lock khoá chống trùng là câu ĐẦU (trước cut-cap): bản trùng đang chạy -> 409 ngay, không xếp hàng
          // rồi vấp "vượt". Có khoá thì đọc lại trong khoá: lần báo vừa commit thì trả dấu 'trả lại', không ghi lần 2.
          if (idempotencyKey) {
            await lockIdempotencyKey(tx, 'floor_reports', idempotencyKey);
            if (await findFloorReportByKey(tx, idempotencyKey)) return null;
          }
          // Thứ tự khoá: cut-cap (gom mọi người) -> cut-report (của riêng người báo) -> FOR UPDATE các đợt ứng viên.
          await lockBusinessKey(
            tx,
            `cut-cap:${issue.productionInvoiceId}:${issue.materialId}:${order.id}`,
          );
          // Xếp hàng các lần báo của CÙNG người cho CÙNG lô + SKU, để không mở 2 đợt song song.
          await lockBusinessKey(tx, `cut-report:${issue.id}:${order.id}:${reportedById}`);
          await this.assertCutWithinNeedInTx(tx, {
            piId: issue.productionInvoiceId,
            materialId: issue.materialId,
            order,
            piOrders,
            lines: dto.segments.map((seg) => ({
              specId: parseBigIntId(seg.segmentSpecId),
              qty: seg.qty,
              mm: specById.get(parseBigIntId(seg.segmentSpecId).toString())!.cutLengthMm.toString(),
            })),
          });
          // Khoá mọi đợt ứng viên (không LIMIT: LIMIT + FOR UPDATE có thể trả thiếu dòng khi Postgres
          // kiểm lại dòng vừa bị đổi). Sau khi khoá, đợt vừa sang AWAITING_QC / vừa bị xoá tự bị loại.
          const candidates = await tx.$queryRaw<{ id: bigint; openedById: string | null }[]>`
          SELECT "id", "openedById", "createdAt" FROM "cut_bundles"
          WHERE "steelIssueId" = ${issue.id}
            AND "productionOrderId" = ${order.id}
            AND "status" = 'CUTTING'::"CutBundleStatus"
            AND ("openedById" = ${reportedById} OR "openedById" IS NULL)
          ORDER BY ("openedById" IS NULL), "createdAt" DESC, "id" DESC
          FOR UPDATE`;
          // Đợt CỦA CHÍNH người báo (mới nhất) trước; không có thì đợt chưa có người mở (tạo trước cột này).
          const openBundle = candidates.find((c) => c.openedById === reportedById) ?? candidates[0];
          if (openBundle) {
            if (!openBundle.openedById) {
              await tx.cutBundle.update({
                where: { id: openBundle.id },
                data: { openedById: reportedById },
              });
            }
            for (const seg of dto.segments) {
              await tx.cutPatternSegment.upsert({
                where: {
                  cutBundleId_segmentSpecId: {
                    cutBundleId: openBundle.id,
                    segmentSpecId: parseBigIntId(seg.segmentSpecId),
                  },
                },
                update: { qty: { increment: seg.qty } },
                create: {
                  cutBundleId: openBundle.id,
                  segmentSpecId: parseBigIntId(seg.segmentSpecId),
                  qty: seg.qty,
                },
              });
            }
            await writeFloorReport(tx, {
              kind: FloorReportKind.CUT,
              reportedById,
              idempotencyKey,
              cutBundleId: openBundle.id,
              workstationId: ctx?.workstationId,
              productionInvoiceId: issue.productionInvoiceId,
              lines: reportLines,
            });
            return openBundle.id;
          }

          const created = await tx.cutBundle.create({
            data: {
              steelIssueId: issue.id,
              productionOrderId: order.id,
              openedById: reportedById,
              proposalPatternId: dto.proposalPatternId
                ? parseBigIntId(dto.proposalPatternId)
                : undefined,
              barCount: dto.barCount ?? 0,
              mauNguyenMm: dto.mauNguyenMm ?? 0,
              // Đợt cắt mới bắt đầu vòng đời riêng của nó (2026-09-05) - CAT tính là xong ngay khi khai
              // số đoạn; công đoạn phụ (Uốn/Dập...) đánh dấu tiếp qua completeStep().
              status: CutBundleStatus.CUTTING,
              completedSteps: [ProcessStep.CAT],
              segments: {
                create: dto.segments.map((seg) => ({
                  segmentSpecId: parseBigIntId(seg.segmentSpecId),
                  qty: seg.qty,
                })),
              },
            },
          });
          await writeFloorReport(tx, {
            kind: FloorReportKind.CUT,
            reportedById,
            idempotencyKey,
            cutBundleId: created.id,
            workstationId: ctx?.workstationId,
            productionInvoiceId: issue.productionInvoiceId,
            lines: reportLines,
          });
          return created.id;
        },
        { timeout: 20_000 },
      );
      if (cutOutcome === null) {
        // Lần báo cùng khoá vừa commit ở request khác: so vân tay rồi trả kết quả đó, không phát realtime / việc phụ.
        const replayInTx = await this.replayFloorReport(idempotencyKey, expectedCut);
        if (replayInTx) return this.replayCutReport(replayInTx.cutBundleId);
        throw new IdempotencyKeyInUseException();
      }
      bundleId = cutOutcome;
    } catch (e) {
      if (isIdempotencyConflict(e)) {
        const raced = await this.replayFloorReport(idempotencyKey, expectedCut);
        if (raced) return this.replayCutReport(raced.cutBundleId);
      }
      throw e;
    }

    return this.toBundleResponseDto(await this.findBundleOrThrow(bundleId.toString()));
  }

  /** Kết quả cho lần gửi lại cùng khoá của 1 lần báo cắt đã ghi. Đợt của lần báo đó đã bị xoá (QLSX hủy
   *  hết số, FK sổ về NULL) thì báo rõ thay vì ghi lại lần 2 rồi vấp khoá trùng. */
  private async replayCutReport(cutBundleId: bigint | null): Promise<CutBundleResponseDto> {
    if (!cutBundleId) throw new ConflictException(FLOOR_REPORT_REVERSED_REPLAY_MESSAGE);
    return this.toBundleResponseDto(await this.findBundleOrThrow(cutBundleId.toString()));
  }

  /** Kết quả cho lần gửi lại cùng khoá của 1 lần báo công đoạn phụ đã ghi. Lần báo đó đã bị QLSX hủy hết (dòng báo bị
   *  xoá, FK sổ về NULL) thì báo câu lời thường, không ghi lại lần 2 rồi vấp khoá trùng (P1, AC53). */
  private async replayStepReport(stepBatchId: bigint | null): Promise<StepBatchResponseDto> {
    if (!stepBatchId) throw new ConflictException(FLOOR_REPORT_REVERSED_REPLAY_MESSAGE);
    return this.toStepBatchResponse(stepBatchId);
  }

  /** Mã SKU (nhãn người dùng thấy) của 1 lệnh sản xuất - chỉ dùng khi dựng câu lỗi, lỗi tra cứu thì rơi về mã lệnh. */
  private async skuLabelOf(db: PrismaTx, orderId: bigint): Promise<string> {
    try {
      const row = await db.productionOrder.findUnique({
        where: { id: orderId },
        select: { mfgProduct: { select: { factoryCode: true } } },
      });
      return row?.mfgProduct.factoryCode ?? `lệnh ${orderId}`;
    } catch {
      return `lệnh ${orderId}`;
    }
  }

  /**
   * Dữ liệu của MỘT SKU (theo skuScope) cho các cỡ `specIds` dựng thành chỉ mục số cần (phoi-need.util) - dùng cho phép
   * chặn lúc báo, X3 và gán SKU. Gọi TRONG transaction, SAU khi đã lấy khoá, để đọc đúng số mới nhất.
   * `excludeStepBundleId`: bỏ đợt công đoạn này khỏi số liệu (đang cân nhắc gán nó cho SKU khác).
   */
  private async loadNeedIndex(
    db: PrismaTx,
    p: {
      piId: bigint;
      materialId: bigint;
      order: { id: bigint; bomRevisionId: bigint };
      piOrders: readonly { id: bigint; bomRevisionId: bigint; quantity: number }[];
      specIds: bigint[];
      excludeStepBundleId?: bigint;
    },
  ): Promise<PhoiNeedIndex> {
    const { piId, materialId, order, piOrders, specIds, excludeStepBundleId } = p;
    const ofSku = this.skuScope(piOrders, order.id);
    const [bomPieces, pieceBoms, cut, cutQc, step, stepQc, planSurplus] = await Promise.all([
      db.bomPiece.findMany({
        where: { bomRevisionId: order.bomRevisionId },
        select: { bomRevisionId: true, pieceId: true, qtyPerUnit: true },
      }),
      db.pieceBom.findMany({
        where: { bomRevisionId: order.bomRevisionId, segmentSpecId: { in: specIds } },
        select: {
          bomRevisionId: true,
          pieceId: true,
          segmentSpecId: true,
          qtyPerPiece: true,
          processSteps: true,
        },
      }),
      db.cutPatternSegment.findMany({
        where: {
          segmentSpecId: { in: specIds },
          cutBundle: { steelIssue: { productionInvoiceId: piId, materialId }, ...ofSku },
        },
        select: {
          segmentSpecId: true,
          qty: true,
          cutBundle: { select: { productionOrderId: true } },
        },
      }),
      db.qcReviewSegment.findMany({
        where: {
          segmentSpecId: { in: specIds },
          // Giống loadPhoiInputs: lọc theo lô sắt, KHÔNG đòi đợt cắt tồn tại (phiếu chấm cả lô kiểu cũ có cutBundleId NULL);
          // SKU gán ở buildPhoiNeedIndex (phoiOrderKey). Loại phiếu công đoạn (stepBundleId) khỏi phần Cắt.
          qcReview: { steelIssue: { productionInvoiceId: piId, materialId }, stepBundleId: null },
        },
        select: {
          segmentSpecId: true,
          failedQty: true,
          shortQty: true,
          qcReview: { select: { cutBundle: { select: { productionOrderId: true } } } },
        },
      }),
      db.stepBatchSegment.findMany({
        where: {
          segmentSpecId: { in: specIds },
          stepBatch: {
            productionInvoiceId: piId,
            materialId,
            ...ofSku,
            ...(excludeStepBundleId
              ? {
                  AND: [
                    {
                      OR: [{ stepBundleId: null }, { stepBundleId: { not: excludeStepBundleId } }],
                    },
                  ],
                }
              : {}),
          },
        },
        select: {
          segmentSpecId: true,
          qty: true,
          stepBatch: { select: { productionOrderId: true, step: true } },
        },
      }),
      db.qcReviewSegment.findMany({
        where: {
          segmentSpecId: { in: specIds },
          qcReview: {
            stepBundle: {
              productionInvoiceId: piId,
              materialId,
              ...ofSku,
              ...(excludeStepBundleId ? { id: { not: excludeStepBundleId } } : {}),
            },
          },
        },
        select: {
          segmentSpecId: true,
          failedQty: true,
          shortQty: true,
          scrapQty: true,
          qcReview: { select: { stepBundle: { select: { productionOrderId: true, step: true } } } },
        },
      }),
      // Câu 12b/13a (24/11/2026): đoạn dư theo phương án được báo thêm (cắt + công đoạn phụ).
      loadPlanSurplus(db, [order.id]),
    ]);
    return buildPhoiNeedIndex({
      orders: piOrders,
      planSurplus,
      bomPieces,
      pieceBoms,
      cut: cut.map((r) => ({
        segmentSpecId: r.segmentSpecId,
        productionOrderId: r.cutBundle.productionOrderId,
        qty: r.qty,
      })),
      cutQc: cutQc.map((r) => ({
        segmentSpecId: r.segmentSpecId,
        productionOrderId: r.qcReview.cutBundle?.productionOrderId ?? null,
        failedQty: r.failedQty,
        shortQty: r.shortQty,
      })),
      step: step.map((r) => ({
        segmentSpecId: r.segmentSpecId,
        productionOrderId: r.stepBatch.productionOrderId,
        step: r.stepBatch.step,
        qty: r.qty,
      })),
      stepQc: stepQc.flatMap((r) =>
        r.qcReview.stepBundle
          ? [
              {
                segmentSpecId: r.segmentSpecId,
                productionOrderId: r.qcReview.stepBundle.productionOrderId,
                step: r.qcReview.stepBundle.step,
                failedQty: r.failedQty,
                shortQty: r.shortQty,
                scrapQty: r.scrapQty,
              },
            ]
          : [],
      ),
    });
  }

  /** Chặn báo CẮT vượt số cần (hợp đồng v2 mục 11): lần báo > maxNow của (SKU, cỡ) -> 400 + ghi log cảnh báo. */
  private async assertCutWithinNeedInTx(
    tx: PrismaTx,
    p: {
      piId: bigint;
      materialId: bigint;
      order: { id: bigint; bomRevisionId: bigint };
      piOrders: readonly { id: bigint; bomRevisionId: bigint; quantity: number }[];
      lines: { specId: bigint; qty: number; mm: string }[];
    },
  ): Promise<void> {
    const index = await this.loadNeedIndex(tx, { ...p, specIds: p.lines.map((l) => l.specId) });
    for (const line of p.lines) {
      const input = index.get(p.order.id.toString(), line.specId.toString()) ?? EMPTY_NEED_INPUT;
      const n = computePhoiStep(input, 'CAT');
      if (line.qty <= n.maxNow) continue;
      const sku = await this.skuLabelOf(tx, p.order.id);
      this.logger.warn(
        `Chặn báo vượt (cắt): PI ${p.piId}, SKU ${sku}, cỡ ${line.mm}mm, cần ${n.required}, đã tính ${n.counted}, số nhập ${line.qty}`,
      );
      throw new BadRequestException(
        buildCutBlockMessage(n, { cutLengthMm: line.mm, skuLabel: sku, qty: line.qty }),
      );
    }
  }

  /** Chặn báo CÔNG ĐOẠN PHỤ vượt (vế số cần + vế vật lý, hợp đồng v2 mục 11). */
  private async assertStepWithinNeedInTx(
    tx: PrismaTx,
    p: {
      piId: bigint;
      materialId: bigint;
      step: PhoiStep;
      order: { id: bigint; bomRevisionId: bigint };
      piOrders: readonly { id: bigint; bomRevisionId: bigint; quantity: number }[];
      lines: { specId: bigint; qty: number; mm: string }[];
    },
  ): Promise<void> {
    const index = await this.loadNeedIndex(tx, { ...p, specIds: p.lines.map((l) => l.specId) });
    for (const line of p.lines) {
      const input = index.get(p.order.id.toString(), line.specId.toString()) ?? EMPTY_NEED_INPUT;
      const n = computePhoiStep(input, p.step);
      const kind = pickPhoiBlock(n, line.qty);
      if (!kind) continue;
      const sku = await this.skuLabelOf(tx, p.order.id);
      this.logger.warn(
        `Chặn báo vượt (${processStepLabel(p.step)}, vế ${kind === 'NEED' ? 'số cần' : 'vật lý'}): PI ${p.piId}, SKU ${sku}, cỡ ${line.mm}mm, cần ${n.required}, đã tính ${n.counted}, số nhập ${line.qty}`,
      );
      throw new BadRequestException(
        buildStepBlockMessage(n, kind, { cutLengthMm: line.mm, skuLabel: sku, qty: line.qty }),
      );
    }
  }

  /**
   * Các công đoạn phụ đã dùng NHIỀU HƠN số đoạn cắt thực có của (SKU, cỡ) - xảy ra khi KCS ghi THIẾU ở Cắt sau khi
   * công đoạn sau đã báo (KCS lưu kết quả không khoá step-batch, chấp nhận được). Chỉ đọc; BE-1 gọi SAU commit để dựng
   * notes[] của kết quả chấm. `productionOrderId` null: PI 1 SKU tính cho SKU duy nhất, PI nhiều SKU thì trả [].
   */
  async stepOveruseAfterCutShortage(
    productionInvoiceId: bigint,
    materialId: bigint,
    productionOrderId: bigint | null,
    segmentSpecIds: bigint[],
  ): Promise<Array<{ step: ProcessStep; cutLengthMm: number; overBy: number; cutCap: number }>> {
    if (segmentSpecIds.length === 0) return [];
    const piOrders = await this.findOrdersForInvoice(productionInvoiceId);
    const order =
      piOrders.find((o) => o.id === productionOrderId) ??
      (productionOrderId == null && piOrders.length === 1 ? piOrders[0] : undefined);
    if (!order) return [];
    const [index, specs] = await Promise.all([
      this.loadNeedIndex(this.prisma, {
        piId: productionInvoiceId,
        materialId,
        order,
        piOrders,
        specIds: segmentSpecIds,
      }),
      this.prisma.segmentSpec.findMany({
        where: { id: { in: segmentSpecIds } },
        select: { id: true, cutLengthMm: true },
      }),
    ]);
    const out: Array<{ step: ProcessStep; cutLengthMm: number; overBy: number; cutCap: number }> =
      [];
    for (const spec of specs) {
      const input = index.get(order.id.toString(), spec.id.toString());
      if (!input) continue;
      for (const o of stepsOverCutCap(input)) {
        out.push({
          step: o.step,
          cutLengthMm: spec.cutLengthMm.toNumber(),
          overBy: o.overBy,
          cutCap: o.cutCap,
        });
      }
    }
    return out;
  }

  /** Lần báo đã ghi với khoá này (null = chưa có). Khoá đã dùng cho loại báo khác / người khác / nội dung khác -> 422
   *  (IdempotencyKeyReusedException, T4-4 20/11/2026; trước đây 409 hoặc trả nhầm đợt cũ). */
  private async replayFloorReport(
    idempotencyKey: string | null | undefined,
    expected: FloorReportReplayExpected,
  ) {
    const prev = await findFloorReportByKey(this.prisma, idempotencyKey);
    if (prev) assertFloorReportReplayMatches(prev, expected);
    return prev;
  }

  /**
   * Gán SKU cho đợt cắt CŨ (productionOrderId null, tạo trước 2026-09-21) - chỉ cần khi PI có NHIỀU SKU (PI 1 SKU
   * đã tự tính cho SKU duy nhất). Gán thường CHỈ 1 lần (phía Phôi); ADMIN sửa được đợt đã gắn nhầm qua
   * `reassign = true` (kiểm tra thêm: chuyển đi không làm SKU cũ có công đoạn phụ vượt số đã cắt còn lại).
   * SKU phải thuộc đúng PI của lô sắt; mọi cỡ đoạn của đợt phải nằm trong định mức của SKU đó. Không đổi trạng
   * thái/số lượng - chỉ đổi việc đợt này tính cho SKU nào. Mọi lần gán/sửa đều ghi audit log.
   */
  async assignCutBundleOrder(
    bundleId: string,
    productionOrderId: string,
    actorId: string,
    reassign = false,
  ): Promise<CutBundleResponseDto> {
    const bundle = await this.findBundleOrThrow(bundleId);
    if (!reassign && bundle.productionOrderId !== null) {
      throw new ConflictException(
        `Đợt cắt ${bundleId} đã gắn SKU - chỉ ADMIN sửa được (reassign-order)`,
      );
    }
    if (reassign && bundle.productionOrderId === null) {
      throw new BadRequestException(`Đợt cắt ${bundleId} chưa gắn SKU - dùng chức năng gán thường`);
    }
    const piId = bundle.steelIssue.productionInvoiceId;
    const piOrders = await this.findOrdersForInvoice(piId);
    const order = piOrders.find((o) => o.id === parseBigIntId(productionOrderId));
    if (!order) {
      throw new BadRequestException(
        `SKU (lệnh sản xuất ${productionOrderId}) không thuộc PI của đợt này`,
      );
    }
    if (reassign && bundle.productionOrderId === order.id) {
      throw new BadRequestException('SKU mới trùng SKU hiện tại của đợt');
    }
    const allowed = await this.findBomSegmentSpecIds(piId, order.bomRevisionId);
    // Khoá theo thứ tự cố định: cut-cap (SKU đích và SKU cũ khi sửa, id SKU tăng dần) -> dòng đợt cắt FOR UPDATE ->
    // (X3 tự lấy) step-batch. Không chặn VƯỢT ở SKU đích (Q6 A): đợt cũ là số đã cắt thật, chỉ chuyển nhãn SKU.
    const capIds = [
      order.id,
      ...(reassign && bundle.productionOrderId ? [bundle.productionOrderId] : []),
    ]
      .filter((id, i, arr) => arr.indexOf(id) === i)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    await this.prisma.$transaction(
      async (tx) => {
        for (const id of capIds) {
          await lockBusinessKey(tx, `cut-cap:${piId}:${bundle.steelIssue.materialId}:${id}`);
        }
        const [locked] = await tx.$queryRaw<
          { status: CutBundleStatus; productionOrderId: bigint | null }[]
        >`
          SELECT "status", "productionOrderId" FROM "cut_bundles" WHERE "id" = ${bundle.id} FOR UPDATE`;
        if (!locked) {
          throw new ConflictException('Đợt cắt này vừa bị QLSX hủy hết số - tải lại trang');
        }
        if ((locked.productionOrderId ?? null) !== bundle.productionOrderId) {
          throw new ConflictException(`Đợt cắt ${bundleId} vừa được gắn SKU bởi người khác`);
        }
        // Đọc lại đoạn TRONG transaction: người báo thêm cỡ mới vào đợt đang mở lúc ta chờ khoá thì thấy ngay.
        const segments = await tx.cutPatternSegment.findMany({
          where: { cutBundleId: bundle.id },
          include: { segmentSpec: true },
        });
        for (const seg of segments) {
          if (!allowed.has(seg.segmentSpecId.toString())) {
            throw new BadRequestException(
              `Cỡ đoạn ${seg.segmentSpec.cutLengthMm.toString()}mm không có trong định mức của SKU đã chọn`,
            );
          }
        }
        // Sửa SKU: chuyển đợt đi khỏi SKU cũ không được làm Uốn/Dập... của SKU cũ vượt số đoạn cắt thực có còn lại (X3).
        if (reassign && bundle.productionOrderId !== null) {
          await this.assertStepsWithinCutAfterReduceInTx(
            tx,
            bundle.id,
            segments.map((sg) => ({ segmentSpecId: sg.segmentSpecId, qty: sg.qty })),
            { reassign: true },
          );
        }
        // updateMany kèm điều kiện SKU hiện tại: phòng khi chen ngang, người sau nhận 409.
        const res = await tx.cutBundle.updateMany({
          where: { id: bundle.id, productionOrderId: bundle.productionOrderId },
          data: { productionOrderId: order.id },
        });
        if (res.count === 0) {
          throw new ConflictException(`Đợt cắt ${bundleId} vừa được gắn SKU bởi người khác`);
        }
      },
      { timeout: 20_000 },
    );
    await this.writeAssignAudit(
      actorId,
      'CutBundle',
      bundleId,
      bundle.productionOrderId,
      order.id,
      reassign,
    );
    return this.toBundleResponseDto(await this.findBundleOrThrow(bundleId));
  }

  /**
   * Gán SKU cho đợt công đoạn phụ CŨ (Uốn/Dập/..., productionOrderId null) - cùng quy tắc assignCutBundleOrder()
   * (kể cả `reassign` cho ADMIN sửa nhầm và audit log), thêm: giữ bất biến "đã làm công đoạn phụ <= đã cắt" của
   * SKU đích (nên gán các đợt Cắt trước rồi mới gán đợt Uốn).
   */
  async assignStepBundleOrder(
    stepBundleId: string,
    productionOrderId: string,
    actorId: string,
    reassign = false,
  ): Promise<StepBundleResponseDto> {
    const sb = await this.prisma.stepBundle.findUnique({
      where: { id: parseBigIntId(stepBundleId) },
      include: {
        material: true,
        batches: { include: { segments: { include: { segmentSpec: true } } } },
      },
    });
    if (!sb) throw new NotFoundException(`Không tìm thấy đợt gửi KCS ${stepBundleId}`);
    if (!reassign && sb.productionOrderId !== null) {
      throw new ConflictException(
        `Đợt ${stepBundleId} đã gắn SKU - chỉ ADMIN sửa được (reassign-order)`,
      );
    }
    if (reassign && sb.productionOrderId === null) {
      throw new BadRequestException(`Đợt ${stepBundleId} chưa gắn SKU - dùng chức năng gán thường`);
    }
    const piOrders = await this.findOrdersForInvoice(sb.productionInvoiceId);
    const order = piOrders.find((o) => o.id === parseBigIntId(productionOrderId));
    if (!order) {
      throw new BadRequestException(
        `SKU (lệnh sản xuất ${productionOrderId}) không thuộc PI của đợt này`,
      );
    }
    if (reassign && sb.productionOrderId === order.id) {
      throw new BadRequestException('SKU mới trùng SKU hiện tại của đợt');
    }
    const allowed = await this.findStepSegmentSpecIds(
      sb.productionInvoiceId,
      sb.step,
      order.bomRevisionId,
    );
    const qtyBySpec = new Map<string, number>();
    const mmBySpec = new Map<string, string>(); // in số mm trong câu lỗi thay vì id cỡ đoạn (17/11/2026)
    for (const batch of sb.batches) {
      for (const seg of batch.segments) {
        const k = seg.segmentSpecId.toString();
        mmBySpec.set(k, seg.segmentSpec.cutLengthMm.toString());
        if (!allowed.has(k)) {
          throw new BadRequestException(
            `Cỡ đoạn ${seg.segmentSpec.cutLengthMm.toString()}mm không cần công đoạn ${processStepLabel(sb.step)} theo định mức của SKU đã chọn`,
          );
        }
        qtyBySpec.set(k, (qtyBySpec.get(k) ?? 0) + seg.qty);
      }
    }
    const specIds = [...qtyBySpec.keys()].map((k) => BigInt(k));

    await this.prisma.$transaction(
      async (tx) => {
        await lockBusinessKey(
          tx,
          `step-batch:${sb.productionInvoiceId}:${sb.materialId}:${sb.step}:${order.id}`,
        );
        // P1: cùng công thức vật lý với recordStepBatch - số đã dùng của SKU đích (không tính đợt đang gán) cộng số đã
        // dùng của CHÍNH đợt này (thô - thiếu - (lỗi - bỏ)) không được vượt số đoạn cắt thực có của SKU đích.
        const [index, ownQc] = await Promise.all([
          this.loadNeedIndex(tx, {
            piId: sb.productionInvoiceId,
            materialId: sb.materialId,
            order,
            piOrders,
            specIds,
            excludeStepBundleId: sb.id,
          }),
          tx.qcReviewSegment.findMany({
            where: { qcReview: { stepBundleId: sb.id } },
            select: { segmentSpecId: true, failedQty: true, shortQty: true, scrapQty: true },
          }),
        ]);
        for (const [k, qty] of qtyBySpec) {
          const base = index.get(order.id.toString(), k) ?? EMPTY_NEED_INPUT;
          const own = { raw: qty, failed: 0, short: 0, scrap: 0 };
          for (const r of ownQc.filter((x) => x.segmentSpecId.toString() === k)) {
            own.failed += r.failedQty;
            own.short += r.shortQty;
            own.scrap += r.scrapQty;
          }
          const cur = base.counts[sb.step] ?? { raw: 0, failed: 0, short: 0, scrap: 0 };
          const merged: PhoiNeedInput = {
            ...base,
            counts: {
              ...base.counts,
              [sb.step]: {
                raw: cur.raw + own.raw,
                failed: cur.failed + own.failed,
                short: cur.short + own.short,
                scrap: cur.scrap + own.scrap,
              },
            },
          };
          const n = computePhoiStep(merged, sb.step);
          if (n.physicalLeft != null && n.physicalLeft < 0) {
            throw new BadRequestException(
              `Gán đợt này cho SKU đã chọn sẽ làm số đã ${processStepLabel(sb.step)} vượt số đã cắt của SKU (cỡ đoạn ${mmBySpec.has(k) ? `${mmBySpec.get(k)}mm` : k}) - gán các đợt Cắt của SKU trước`,
            );
          }
        }
        const res = await tx.stepBundle.updateMany({
          where: { id: sb.id, productionOrderId: sb.productionOrderId },
          data: { productionOrderId: order.id },
        });
        if (res.count === 0) {
          throw new ConflictException(`Đợt ${stepBundleId} vừa được gắn SKU bởi người khác`);
        }
        await tx.stepBatch.updateMany({
          where: { stepBundleId: sb.id },
          data: { productionOrderId: order.id },
        });
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
    await this.writeAssignAudit(
      actorId,
      'StepBundle',
      stepBundleId,
      sb.productionOrderId,
      order.id,
      reassign,
    );
    return this.toStepBundleResponseDto(
      { ...sb, productionOrderId: order.id },
      sb.batches,
      sb.material,
    );
  }

  /** Ghi audit log việc gán/sửa SKU của 1 đợt (2026-09-21) - việc này không hoàn tác được từ giao diện Phôi nên
   *  phải truy được ai đổi, lúc nào, từ SKU nào sang SKU nào. */
  private async writeAssignAudit(
    actorId: string,
    tableName: 'CutBundle' | 'StepBundle',
    recordId: string,
    fromOrderId: bigint | null,
    toOrderId: bigint,
    reassign: boolean,
  ): Promise<void> {
    this.logger.log(
      `${reassign ? 'Sửa' : 'Gán'} SKU ${fromOrderId ?? 'null'} -> ${toOrderId} cho ${tableName} ${recordId} (user ${actorId})`,
    );
    await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: AuditAction.UPDATE,
        tableName,
        recordId,
        oldValue: { productionOrderId: fromOrderId?.toString() ?? null },
        newValue: { productionOrderId: toOrderId.toString(), reassign },
      },
    });
  }

  /**
   * "Báo cắt xong" cho ĐÚNG 1 ĐỢT CẮT (2026-09-05) - thay finishCutting() cũ (XOÁ 2026-09-07, dead
   * code từ trước - gate `status === RECEIVED` không còn nơi nào set được nữa sau khi vòng đời hạ
   * xuống CutBundle).
   *
   * Vì sao tách khỏi lô nhận: trạng thái đặt ở lô (SteelIssue) buộc Phôi phải cắt hết TOÀN BỘ số
   * cây kho giao mới gửi KCS được, và sắt kho giao bù sau đó không cắt tiếp được (recordCutBatch
   * chặn status != RECEIVED, không có đường quay lại). Giờ mỗi đợt cắt tự đi CUTTING ->
   * AWAITING_QC, các đợt còn lại của cùng lô vẫn cắt bình thường - đúng yêu cầu nghiệp vụ
   * "cắt xong đợt nào gửi KCS đợt đó".
   *
   * SteelIssue.status vẫn được cập nhật, nhưng CHỈ NHƯ ROLL-UP HIỂN THỊ (2026-09-05) - xem
   * syncIssueStatusFromBundles(): các màn KHÔNG đổi (XacNhanNhanSatPage.tsx, ThongKePagePlan.tsx)
   * vẫn đọc issue.status/completedAt/actualBarCount để suy tiến độ tổng quan, phải tiếp tục thấy
   * đúng dù giờ nguồn sự thật THẬT SỰ (chặn hành động, KCS chấm) nằm ở CutBundle.status.
   *
   * KHÔNG còn chặn theo "công đoạn phụ chưa xong" (2026-09-07, BỎ so với bản gốc 2026-09-05) -
   * quyết định nghiệp vụ của Sếp Trương Văn Nhân: "Cắt xong thì qua KCS, qua từng công đoạn thì
   * đều phải qua KCS" - Cắt (đợt này) tự gửi KCS ngay khi Phôi báo xong, KHÔNG chờ Uốn/Dập/Tán...
   * xong trước. Các công đoạn phụ giờ tự gửi KCS riêng qua submitStepBundle() (xem StepBundle doc
   * comment schema), độc lập hoàn toàn với vòng đời CutBundle này.
   */
  async finishCutBundle(
    bundleId: string,
    /** allowCancelled: chỉ KCS "chốt để chấm" truyền - câu 4 (24/11/2026), đợt của SKU đã huỷ vẫn chốt + chấm nốt. */
    opts?: { notifyKcs?: boolean; gateLabel?: string; allowCancelled?: boolean },
  ): Promise<CutBundleResponseDto> {
    // P1: KCS tự chốt (notifyKcs = false, gateLabel = 'chốt để chấm') - không phát tin "gửi KCS" vì KCS tự thấy đợt.
    const notifyKcs = opts?.notifyKcs ?? true;
    const gateLabel = opts?.gateLabel ?? 'báo cắt xong';
    const bundle = await this.findBundleOrThrow(bundleId);
    if (bundle.status !== CutBundleStatus.CUTTING) {
      throw new ConflictException('Đợt cắt này vừa được chốt để chấm - tải lại trang.');
    }
    const orderCancelled = await isOrderCancelledById(this.prisma, bundle.productionOrderId);
    // KCS chốt để chấm (câu 4) hoặc QLSX cho cắt tiếp SKU đã huỷ (Q3) - bỏ cổng xưởng.
    const kcsOnCancelled =
      orderCancelled &&
      (opts?.allowCancelled === true ||
        (bundle.productionOrderId != null &&
          (await isCutContinuedForOrder(this.prisma, bundle.productionOrderId))));
    if (!kcsOnCancelled) {
      await assertPiHasActiveFloor(this.prisma, bundle.steelIssue.productionInvoiceId, gateLabel);
      if (bundle.productionOrderId != null) {
        await assertOrderNotCancelled(this.prisma, bundle.productionOrderId, gateLabel);
      }
    }

    // Đổi trạng thái CÓ ĐIỀU KIỆN (đang CUTTING): 2 người gửi KCS cùng lúc hoặc đợt vừa bị hủy hết
    // thì chỉ 1 lời gọi đổi được, lời gọi còn lại nhận 409 - không ghi đè completedAt, không báo lần 2.
    const changed = await this.prisma.cutBundle.updateMany({
      where: { id: bundle.id, status: CutBundleStatus.CUTTING },
      data: { status: CutBundleStatus.AWAITING_QC, completedAt: new Date() },
    });
    if (changed.count === 0) {
      const now = await this.prisma.cutBundle.findUnique({
        where: { id: bundle.id },
        select: { status: true },
      });
      if (!now) {
        throw new ConflictException(
          'Đợt cắt này vừa bị QLSX hủy hết số - không còn gì để chấm, tải lại trang.',
        );
      }
      throw new ConflictException('Đợt cắt này vừa được chốt để chấm - tải lại trang.');
    }
    const updated = await this.prisma.cutBundle.findUniqueOrThrow({
      where: { id: bundle.id },
      include: { segments: { include: { segmentSpec: true } }, ...BUNDLE_REPORTERS_INCLUDE },
    });
    await this.syncIssueStatusFromBundles(bundle.steelIssueId);

    if (notifyKcs) {
      const invoice = await this.prisma.productionInvoice.findUnique({
        where: { id: bundle.steelIssue.productionInvoiceId },
        select: { code: true },
      });
      await this.notifySteelIssue('CUT_BUNDLE_TO_KCS', updated.id, {
        piCode: invoice?.code ?? `#${bundle.steelIssue.productionInvoiceId}`,
      });
    }
    // PH1 rà soát 18/11: báo màn KCS tải lại đợt vừa chốt - phát cả khi KCS tự chốt lúc bấm "Chấm" (notifyKcs false).
    this.publishRealtime(
      bundle.steelIssueId,
      'PROGRESS',
      null,
      bundle.steelIssue.productionInvoiceId,
    );

    return this.toBundleResponseDto(updated);
  }

  /**
   * Cập nhật SteelIssue.status/completedAt/actualBarCount THEO ROLL-UP của mọi CutBundle thuộc
   * lô (2026-09-05) - lô nhận không còn tự đổi trạng thái theo hành động Phôi/KCS trực tiếp (đã
   * hạ xuống cấp đợt cắt), nhưng các màn CHỈ XEM TỔNG QUAN, không thao tác chi tiết
   * (XacNhanNhanSatPage.tsx cột trạng thái, ThongKePagePlan.tsx tính done/in-progress theo
   * material) vẫn hoàn toàn hợp lý khi đọc issue.status - không có lý do bắt 2 màn đó tự gộp lại
   * từ danh sách bundle. Quy tắc gộp (ưu tiên theo thứ tự, dừng ở điều kiện đầu tiên khớp):
   *   1. Có bundle nào AWAITING_QC → issue "đang chờ KCS" (dù bundle khác đã QC_PASSED).
   *   2. Không bundle nào AWAITING_QC, có ÍT NHẤT 1 bundle và MỌI bundle đều QC_PASSED → "đã
   *      xong" (completedAt = mới nhất trong các bundle).
   *   3. Còn lại (0 bundle, hoặc có bundle đang CUTTING mà không bundle nào AWAITING_QC) → giữ
   *      RECEIVED ("đã nhận, đang cắt" - không cần phân biệt IN_PROCESS ở cấp lô nữa).
   * Gọi sau MỌI lần đổi CutBundle.status (finishCutBundle ở đây, reviewCutBundle ở
   * QcReviewsService - inject ngược lại module đó sẽ tạo phụ thuộc vòng nên để QcReviewsService
   * tự gọi qua SteelIssuesService đã có sẵn, không thêm phụ thuộc mới).
   */
  async syncIssueStatusFromBundles(steelIssueId: bigint): Promise<void> {
    // P1 (AC54): 2 lần đổi trạng thái đợt cùng lô sắt chạy cùng lúc (KCS chốt đợt A đúng lúc lưu kết quả đợt B) từng
    // đọc cùng danh sách rồi ghi chồng, trạng thái lô lệch. Giờ chạy trong 1 transaction ngắn: khoá advisory (thứ tự
    // khoá: advisory trước) rồi FOR UPDATE dòng steel_issues, SAU ĐÓ mới đọc các đợt - người đến sau chờ rồi thấy số mới.
    await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `steel-issue-rollup:${steelIssueId}`);
      await tx.$queryRaw`SELECT "id" FROM "steel_issues" WHERE "id" = ${steelIssueId} FOR UPDATE`;
      const bundles = await tx.cutBundle.findMany({ where: { steelIssueId } });
      if (bundles.length === 0) return;
      const hasAwaitingQc = bundles.some((b) => b.status === CutBundleStatus.AWAITING_QC);
      const allPassed = bundles.every((b) => b.status === CutBundleStatus.QC_PASSED);
      const status = hasAwaitingQc
        ? SteelIssueStatus.AWAITING_QC
        : allPassed
          ? SteelIssueStatus.QC_PASSED
          : SteelIssueStatus.RECEIVED;
      const completedAt =
        status === SteelIssueStatus.QC_PASSED
          ? (bundles
              .map((b) => b.completedAt)
              .filter((d): d is Date => d != null)
              .sort((a, b) => b.getTime() - a.getTime())[0] ?? new Date())
          : null;
      await tx.steelIssue.update({
        where: { id: steelIssueId },
        data: { status, completedAt },
      });
    });
  }

  /**
   * Phôi gom mọi StepBatch CHƯA gửi (stepBundleId NULL) của (productionInvoiceId, materialId,
   * step) thành 1 "đợt gửi KCS" (2026-09-07, đổi scope lần 2, xem StepBundle doc comment schema) -
   * KHÔNG re-validate định mức ở đây (đã validate lúc recordStepBatch() tạo từng dòng) - việc DUY
   * NHẤT ở đây là gom + khoá lại các dòng đã gom, cùng khuôn
   * ProductionBatchesService.submitPieceStep() (VTTP).
   *
   * ĐÍNH CHÍNH 09/09/2026 (audit toàn diện, mục Thấp): trước đây thiếu lockBusinessKey nên 2 lượt
   * "Gửi KCS" gần như đồng thời cho cùng (invoice, material, step) đều đọc cùng 1 danh sách pending
   * rồi cùng tạo StepBundle riêng + updateMany gán stepBundleId không kiểm tra lại - đợt commit sau
   * ghi đè đợt commit trước, để lại 1 StepBundle rỗng không có StepBatch nào. Vá bằng đúng khuôn
   * lockBusinessKey mà submitPieceStep() (VTTP) đã làm đúng từ trước.
   */
  async submitStepBundle(
    productionInvoiceId: string,
    materialId: string,
    step: ProcessStep,
    submittedById: string,
    productionOrderId: string,
    /**
     * Gom đợt THEO NGƯỜI (2026-10-13, mục 20.5/26): có `worker` -> chỉ gom các lần báo của đúng người đó
     * (`worker.id = null` = đợt cũ chưa biết người), bundle ghi `reportedById` = người đó để KCS chấm biết của ai.
     * Không truyền (màn Phôi cũ - tài khoản tổ) -> gom hết như trước, bundle không gắn người.
     */
    worker?: { id: string | null },
    /** P1: KCS tự chốt truyền gateLabel = 'chốt để chấm' (câu lỗi của cổng lệnh dừng). allowCancelled: câu 4 (24/11/2026) - chỉ
     *  KCS truyền, đợt của SKU đã huỷ vẫn chốt + chấm nốt. */
    opts?: { gateLabel?: string; allowCancelled?: boolean },
  ): Promise<StepBundleResponseDto> {
    const gateLabel = opts?.gateLabel ?? 'gửi KCS công đoạn';
    const invoice = await this.findInvoiceOrThrow(productionInvoiceId);
    const materialBigId = parseBigIntId(materialId);
    const kcsOnCancelled =
      opts?.allowCancelled === true &&
      (await isOrderCancelledById(this.prisma, parseBigIntId(productionOrderId)));
    if (!kcsOnCancelled) await assertPiHasActiveFloor(this.prisma, invoice.id, gateLabel);
    // Gửi KCS theo TỪNG SKU (2026-09-21): chỉ gom các đợt gia công của SKU này.
    const piOrders = await this.findOrdersForInvoice(invoice.id);
    const order = piOrders.find((o) => o.id === parseBigIntId(productionOrderId));
    if (!order) {
      throw new BadRequestException(`SKU (lệnh sản xuất ${productionOrderId}) không thuộc PI này`);
    }

    const created = await this.prisma.$transaction(
      async (tx) => {
        await lockBusinessKey(tx, `step-bundle:${invoice.id}:${materialBigId}:${step}:${order.id}`);
        if (!kcsOnCancelled) await assertPiHasActiveFloorLocked(tx, invoice.id, gateLabel);

        // Khoá từng dòng chờ (FOR UPDATE): QLSX hủy 1 lần báo đúng lúc ta chốt thì 1 bên chờ bên kia - không còn gom
        // dòng vừa bị xoá, không còn step_bundle rỗng (P1, AC7).
        const skuCond =
          piOrders.length === 1
            ? Prisma.sql`("productionOrderId" = ${order.id} OR "productionOrderId" IS NULL)`
            : Prisma.sql`"productionOrderId" = ${order.id}`;
        const workerCond = worker
          ? worker.id === null
            ? Prisma.sql`AND "reportedById" IS NULL`
            : Prisma.sql`AND "reportedById" = ${worker.id}`
          : Prisma.empty;
        const pendingRows = await tx.$queryRaw<{ id: bigint }[]>`
        SELECT "id" FROM "step_batches"
        WHERE "productionInvoiceId" = ${invoice.id}
          AND "materialId" = ${materialBigId}
          AND "step" = ${step}::"ProcessStep"
          AND "stepBundleId" IS NULL
          AND ${skuCond}
          ${workerCond}
        FOR UPDATE`;
        const noneLeft = () =>
          new BadRequestException(
            `Nhóm ${processStepLabel(step)} này không còn lần báo nào chưa chấm (có thể vừa được chốt hoặc vừa bị hủy) - tải lại trang.`,
          );
        if (pendingRows.length === 0) throw noneLeft();

        const stepBundle = await tx.stepBundle.create({
          data: {
            productionInvoiceId: invoice.id,
            materialId: materialBigId,
            step,
            submittedById,
            productionOrderId: order.id,
            reportedById: worker?.id ?? null,
          },
        });
        const pendingIds = pendingRows.map((r) => r.id);
        const assigned = await tx.stepBatch.updateMany({
          where: { id: { in: pendingIds }, stepBundleId: null },
          data: { stepBundleId: stepBundle.id },
        });
        // Chỉ trả các dòng ĐÃ gán thật (đọc lại theo đợt vừa tạo); không gán được dòng nào thì ném để rollback, không
        // để lại step_bundle rỗng.
        const pending = await tx.stepBatch.findMany({
          where: { stepBundleId: stepBundle.id },
          include: { segments: { include: { segmentSpec: true } } },
        });
        if (assigned.count === 0 || pending.length === 0) throw noneLeft();
        return { stepBundle, pending };
      },
      { maxWait: 10_000, timeout: 20_000 },
    );

    const material = await this.prisma.material.findUniqueOrThrow({
      where: { id: materialBigId },
    });
    // PH1 rà soát 18/11: báo màn KCS có đợt công đoạn phụ mới chờ chấm (cùng lý do finishCutBundle).
    this.publishRealtime(
      created.stepBundle.id,
      'PROGRESS',
      submittedById,
      created.stepBundle.productionInvoiceId,
    );
    return this.toStepBundleResponseDto(created.stepBundle, created.pending, material);
  }

  /** Mọi StepBundle của 1 PI (mọi loại sắt/công đoạn) - nguồn dữ liệu "lịch sử" cho màn Phôi (mirror
   *  findPieceStepBundlesForOrder bên VTTP). Không phân trang (1 PI hiếm khi có quá vài chục
   *  bundle). */
  async findStepBundlesForInvoice(productionInvoiceId: string): Promise<StepBundleResponseDto[]> {
    const invoice = await this.findInvoiceOrThrow(productionInvoiceId);
    const stepBundles = await this.prisma.stepBundle.findMany({
      where: { productionInvoiceId: invoice.id },
      include: { material: true },
      orderBy: { submittedAt: 'desc' },
    });
    if (stepBundles.length === 0) return [];
    const batchesByStepBundle = await this.findBatchesByStepBundleIds(stepBundles.map((b) => b.id));
    return stepBundles.map((sb) =>
      this.toStepBundleResponseDto(
        sb,
        batchesByStepBundle.get(sb.id.toString()) ?? [],
        sb.material,
      ),
    );
  }

  /** Flat, không cần productionInvoiceId - cùng lý do ListSteelIssuesQueryDto tồn tại (KCS không tự
   *  resolve productionInvoiceId được). Mirror findAllPieceStepBundles() bên VTTP. */
  async findAllStepBundles(
    query: ListStepBundlesQueryDto,
  ): Promise<Paginated<StepBundleResponseDto>> {
    const where: Prisma.StepBundleWhereInput = {
      ...(query.status ? { status: query.status } : {}),
    };
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.stepBundle.findMany({ ...args, include: { material: true } }),
        count: (args) => this.prisma.stepBundle.count(args),
      },
      query,
      where,
      { submittedAt: 'desc' as const },
    );
    const batchesByStepBundle = await this.findBatchesByStepBundleIds(result.data.map((b) => b.id));
    return {
      data: result.data.map((sb) =>
        this.toStepBundleResponseDto(
          sb,
          batchesByStepBundle.get(sb.id.toString()) ?? [],
          sb.material,
        ),
      ),
      meta: result.meta,
    };
  }

  /** StepBatch (kèm segments) đã gom vào từng StepBundle trong danh sách - dùng chung bởi
   *  submitStepBundle()/findStepBundlesForInvoice()/findAllStepBundles() để tính segments[] gộp
   *  theo segmentSpecId (xem toStepBundleResponseDto()). */
  private async findBatchesByStepBundleIds(stepBundleIds: bigint[]) {
    const batches =
      stepBundleIds.length === 0
        ? []
        : await this.prisma.stepBatch.findMany({
            where: { stepBundleId: { in: stepBundleIds } },
            include: { segments: { include: { segmentSpec: true } } },
          });
    const result = new Map<string, typeof batches>();
    for (const b of batches) {
      const key = b.stepBundleId!.toString();
      const arr = result.get(key) ?? [];
      arr.push(b);
      result.set(key, arr);
    }
    return result;
  }

  private async findBundleOrThrow(id: string) {
    const bundle = await this.prisma.cutBundle.findUnique({
      where: { id: parseBigIntId(id) },
      include: {
        segments: { include: { segmentSpec: true } },
        steelIssue: true,
        ...BUNDLE_REPORTERS_INCLUDE,
      },
    });
    if (!bundle) {
      throw new NotFoundException(`Không tìm thấy đợt cắt ${id}`);
    }
    return bundle;
  }

  /**
   * Tập segmentSpecId hợp lệ để khai cắt cho 1 PI = mọi cỡ đoạn xuất hiện trong định mức của mọi
   * ProductionOrder thuộc PI. Dùng để chặn khai cỡ ngoài định mức (xem recordCutBatch).
   */
  private async findBomSegmentSpecIds(
    productionInvoiceId: bigint,
    onlyBomRevisionId?: bigint,
  ): Promise<Set<string>> {
    const orders = await this.findOrdersForInvoice(productionInvoiceId);
    if (orders.length === 0) return new Set();
    const revisionIds = onlyBomRevisionId
      ? [onlyBomRevisionId]
      : [...new Set(orders.map((o) => o.bomRevisionId))];
    const rows = await this.prisma.pieceBom.findMany({
      where: { bomRevisionId: { in: revisionIds } },
      select: { segmentSpecId: true },
    });
    return new Set(rows.map((r) => r.segmentSpecId.toString()));
  }

  /**
   * Gộp nhiều PI (2026-09-21) - "Tổng hợp lệnh SX" cần tiến độ Phôi = Cắt + MỌI công đoạn phụ của mọi PI. Tải dữ
   * liệu của TẤT CẢ PI trong một lượt truy vấn (không lặp từng PI: DB ở xa, 25 PI từng tốn ~12 giây), rồi tính
   * trong bộ nhớ bằng đúng các hàm của endpoint 1 PI. PI nào LỖI hoặc không tồn tại thì BỎ KHỎI kết quả (KHÔNG trả
   * rỗng) - trả rỗng/thiếu công đoạn phụ sẽ làm Phôi trông như đã xong mà không ai biết; FE thấy thiếu khoá thì báo
   * lỗi tải và coi Phôi của PI đó là "không biết". Lỗi được ghi log.
   */
  async getPhoiProgressBatch(
    productionInvoiceIds: string[],
  ): Promise<Record<string, PhoiProgressItemResponseDto[]>> {
    const result: Record<string, PhoiProgressItemResponseDto[]> = {};
    const ids: bigint[] = [];
    for (const raw of productionInvoiceIds) {
      try {
        ids.push(parseBigIntId(raw));
      } catch {
        this.logger.warn(`getPhoiProgressBatch: id không hợp lệ '${raw}' - bỏ qua`);
      }
    }
    if (ids.length === 0) return result;

    const existing = await this.prisma.productionInvoice.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const existingIds = existing.map((e) => e.id);
    let inputs: Awaited<ReturnType<SteelIssuesService['loadPhoiInputs']>>;
    try {
      inputs = await this.loadPhoiInputs(existingIds);
    } catch (err) {
      this.logger.error(
        'getPhoiProgressBatch: tải dữ liệu lỗi - không trả PI nào',
        err instanceof Error ? err.stack : String(err),
      );
      return result;
    }

    for (const id of existingIds) {
      const key = id.toString();
      try {
        const cutInputs = inputs.cut.get(key);
        const items = cutInputs ? await this.computeCutProgress(cutInputs) : [];
        const stepInputs = inputs.step.get(key);
        if (stepInputs) {
          const steps = new Set<ProcessStep>();
          for (const pb of stepInputs.pieceBoms) {
            for (const st of pb.processSteps) if (st !== ProcessStep.CAT) steps.add(st);
          }
          for (const step of steps) {
            for (const it of await this.computeStepProgress(stepInputs, step)) {
              const target = items.find((m) => m.materialId === it.materialId);
              if (target) {
                target.steps.push(new PhoiStepProgressDto({ step, segments: it.segments }));
              }
            }
          }
        }
        result[key] = items;
      } catch (err) {
        this.logger.error(
          `getPhoiProgressBatch: PI ${key} lỗi - bỏ khỏi kết quả`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
    return result;
  }

  /**
   * Tải MỘT LẦN dữ liệu tiến độ Phôi (Cắt + công đoạn phụ) của nhiều PI, chia sẵn theo PI. Dùng chung cho
   * getPhoiProgress()/getStepProgress() (1 PI) và getPhoiProgressBatch() (nhiều PI) để mọi nơi cùng 1 nguồn số liệu.
   */
  private async loadPhoiInputs(
    invoiceIds: bigint[],
  ): Promise<{ cut: Map<string, CutInputs>; step: Map<string, StepInputs> }> {
    const cut = new Map<string, CutInputs>();
    const step = new Map<string, StepInputs>();
    if (invoiceIds.length === 0) return { cut, step };

    // Huỷ lệnh đợt 2 - Q3: cây tổ cắt đã nhập trả kho.
    const steelReturnRows = await this.prisma.steelReturn.findMany({
      where: { productionInvoiceId: { in: invoiceIds } },
      select: { productionInvoiceId: true, materialId: true, lengthMm: true, bars: true },
    });
    // Huỷ lệnh theo SKU (23/11/2026): bỏ lệnh đã huỷ khỏi số cần. Đoạn đã làm của SKU huỷ vẫn nạp (dòng theo PI) - thành
    // nhóm riêng trong byOrder, không cộng vào số của cỡ đoạn (xem buildPhoiProgress).
    const orderRows = await this.prisma.productionOrder.findMany({
      where: {
        productionInvoiceItem: { productionInvoiceId: { in: invoiceIds } },
        ...NOT_CANCELLED_ORDER,
      },
      select: {
        id: true,
        bomRevisionId: true,
        quantity: true,
        floorStage: true,
        productionInvoiceItem: { select: { productionInvoiceId: true } },
      },
    });
    const ordersByPi = new Map<string, OrderForBom[]>();
    for (const o of orderRows) {
      const key = o.productionInvoiceItem.productionInvoiceId!.toString();
      const arr = ordersByPi.get(key) ?? [];
      arr.push({
        id: o.id,
        bomRevisionId: o.bomRevisionId,
        quantity: o.quantity,
        floorStage: o.floorStage,
      });
      ordersByPi.set(key, arr);
    }
    const revisionIds = [...new Set(orderRows.map((o) => o.bomRevisionId))];

    const [
      bomPieces,
      pieceBoms,
      issues,
      cutSegments,
      cutQc,
      stepSegments,
      stepQc,
      machineLines,
      reservationRows,
    ] = await Promise.all([
      this.prisma.bomPiece.findMany({ where: { bomRevisionId: { in: revisionIds } } }),
      this.prisma.pieceBom.findMany({
        where: { bomRevisionId: { in: revisionIds } },
        include: { segmentSpec: { include: { material: true } } },
      }),
      this.prisma.steelIssue.findMany({
        where: { productionInvoiceId: { in: invoiceIds } },
        select: {
          productionInvoiceId: true,
          materialId: true,
          barCount: true,
          barLengthMm: true,
          status: true,
          receivedBarCount: true,
          reworkOfId: true,
        },
      }),
      this.prisma.cutPatternSegment.findMany({
        where: { cutBundle: { steelIssue: { productionInvoiceId: { in: invoiceIds } } } },
        select: {
          segmentSpecId: true,
          qty: true,
          cutBundle: {
            select: {
              productionOrderId: true,
              status: true,
              steelIssue: { select: { productionInvoiceId: true } },
            },
          },
        },
      }),
      // KCS chấm lỗi theo cỡ đoạn - lỗi CỘNG DỒN LỊCH SỬ (xem doc comment getPhoiProgress()).
      this.prisma.qcReviewSegment.findMany({
        where: {
          // Phiếu công đoạn (stepBundleId) tính ở phần công đoạn, không lẫn vào Cắt (cùng loadNeedIndex).
          qcReview: { steelIssue: { productionInvoiceId: { in: invoiceIds } }, stepBundleId: null },
        },
        select: {
          segmentSpecId: true,
          failedQty: true,
          shortQty: true,
          qcReview: {
            select: {
              steelIssue: { select: { productionInvoiceId: true } },
              cutBundle: { select: { productionOrderId: true } },
            },
          },
        },
      }),
      this.prisma.stepBatchSegment.findMany({
        where: { stepBatch: { productionInvoiceId: { in: invoiceIds } } },
        select: {
          segmentSpecId: true,
          qty: true,
          stepBatch: {
            select: {
              productionOrderId: true,
              step: true,
              productionInvoiceId: true,
              stepBundle: { select: { status: true } },
            },
          },
        },
      }),
      // Lỗi công đoạn phụ lọc qua stepBundle (không còn thuộc đúng 1 SteelIssue) và đúng `step`.
      this.prisma.qcReviewSegment.findMany({
        where: { qcReview: { stepBundle: { productionInvoiceId: { in: invoiceIds } } } },
        select: {
          segmentSpecId: true,
          failedQty: true,
          shortQty: true,
          scrapQty: true,
          qcReview: {
            select: {
              stepBundle: {
                select: { productionOrderId: true, step: true, productionInvoiceId: true },
              },
            },
          },
        },
      }),
      // Máy cắt của các phương án ĐÃ DUYỆT (neo PI hoặc neo lệnh SX của PI) - cùng điều kiện phủ với
      // getIssuePlan(). Một query cho mọi PI, chia theo PI ở dưới.
      this.prisma.cuttingProposalLine.findMany({
        where: {
          feasible: true,
          cuttingProposal: {
            status: CuttingProposalStatus.APPROVED,
            OR: [
              { productionInvoiceId: { in: invoiceIds } },
              {
                productionOrder: {
                  productionInvoiceItem: { productionInvoiceId: { in: invoiceIds } },
                },
              },
            ],
          },
        },
        select: {
          materialId: true,
          machine: true,
          cuttingProposal: {
            select: {
              productionInvoiceId: true,
              productionOrder: {
                select: { productionInvoiceItem: { select: { productionInvoiceId: true } } },
              },
            },
          },
        },
      }),
      // P1: giữ chỗ sắt ACTIVE còn lại (gợi ý "sắt còn xuất được" ở steelBalance).
      this.prisma.stockReservation.findMany({
        where: { productionInvoiceId: { in: invoiceIds }, status: 'ACTIVE' },
        select: {
          productionInvoiceId: true,
          materialId: true,
          quantity: true,
          consumedQty: true,
          stockLengthMm: true,
        },
      }),
    ]);

    for (const [piKey, orders] of ordersByPi) {
      const revs = new Set(orders.map((o) => o.bomRevisionId.toString()));
      const piBomPieces = bomPieces.filter((bp) => revs.has(bp.bomRevisionId.toString()));
      const piPieceBoms = pieceBoms.filter((pb) => revs.has(pb.bomRevisionId.toString()));
      const piIssues = issues
        .filter((i) => i.productionInvoiceId.toString() === piKey)
        .map((i) => ({
          materialId: i.materialId,
          barCount: i.barCount,
          barLengthMm: i.barLengthMm,
          status: i.status,
          receivedBarCount: i.receivedBarCount,
          reworkOfId: i.reworkOfId,
        }));
      // Một loại sắt có thể do nhiều phương án phủ (gộp PI + từng SKU): chỉ cần MỘT dòng cắt bằng MC Tự động là
      // coi cả loại là MC Tự động (trong cùng PI hai máy khác nhau cho cùng loại sắt là ca không thực tế).
      const machineByMaterial = new Map<string, SolverMachine>();
      for (const line of machineLines) {
        const linePi =
          line.cuttingProposal.productionInvoiceId ??
          line.cuttingProposal.productionOrder?.productionInvoiceItem.productionInvoiceId;
        if (linePi?.toString() !== piKey || line.machine !== SolverMachine.tu_dong) continue;
        machineByMaterial.set(line.materialId.toString(), SolverMachine.tu_dong);
      }
      const piCutSegments: CutSegmentRow[] = cutSegments
        .filter((cs) => cs.cutBundle.steelIssue.productionInvoiceId.toString() === piKey)
        .map((cs) => ({
          segmentSpecId: cs.segmentSpecId,
          qty: cs.qty,
          cutBundle: {
            productionOrderId: cs.cutBundle.productionOrderId,
            status: cs.cutBundle.status,
          },
        }));
      const piCutQc: CutQcRow[] = cutQc
        .filter((qs) => qs.qcReview.steelIssue?.productionInvoiceId.toString() === piKey)
        .map((qs) => ({
          segmentSpecId: qs.segmentSpecId,
          failedQty: qs.failedQty,
          shortQty: qs.shortQty,
          qcReview: { cutBundle: qs.qcReview.cutBundle },
        }));
      const piStepSegments: StepSegmentRow[] = stepSegments
        .filter((ss) => ss.stepBatch.productionInvoiceId.toString() === piKey)
        .map((ss) => ({
          segmentSpecId: ss.segmentSpecId,
          qty: ss.qty,
          stepBatch: {
            productionOrderId: ss.stepBatch.productionOrderId,
            step: ss.stepBatch.step,
            bundleStatus: ss.stepBatch.stepBundle?.status ?? null,
          },
        }));
      const piStepQc: StepQcRow[] = stepQc
        .filter((qs) => qs.qcReview.stepBundle?.productionInvoiceId.toString() === piKey)
        .map((qs) => ({
          segmentSpecId: qs.segmentSpecId,
          failedQty: qs.failedQty,
          shortQty: qs.shortQty,
          scrapQty: qs.scrapQty,
          qcReview: {
            stepBundle: qs.qcReview.stepBundle
              ? {
                  productionOrderId: qs.qcReview.stepBundle.productionOrderId,
                  step: qs.qcReview.stepBundle.step,
                }
              : null,
          },
        }));
      const returnedMmByMaterial = new Map<string, number>();
      for (const r of steelReturnRows) {
        if (r.productionInvoiceId.toString() !== piKey) continue;
        const k = r.materialId.toString();
        returnedMmByMaterial.set(k, (returnedMmByMaterial.get(k) ?? 0) + r.lengthMm * r.bars);
      }
      cut.set(piKey, {
        returnedMmByMaterial,
        machineByMaterial,
        orders,
        bomPieces: piBomPieces,
        pieceBoms: piPieceBoms,
        issues: piIssues,
        cutSegments: piCutSegments,
        qcSegments: piCutQc,
        stepSegments: piStepSegments,
        stepQcSegments: piStepQc,
        reservations: reservationRows
          .filter((r) => r.productionInvoiceId?.toString() === piKey)
          .map((r) => ({
            materialId: r.materialId,
            remaining: Math.max(0, r.quantity.toNumber() - r.consumedQty.toNumber()),
            stockLengthMm: r.stockLengthMm,
          })),
      });
      step.set(piKey, {
        orders,
        bomPieces: piBomPieces,
        pieceBoms: piPieceBoms,
        issues: piIssues,
        stepSegments: piStepSegments,
        qcSegments: piStepQc,
        cutSegments: piCutSegments,
        cutQcSegments: piCutQc,
      });
    }
    return { cut, step };
  }

  /**
   * Tiến độ cắt theo (LOẠI SẮT -> CỠ ĐOẠN) cho cả 1 PI - nguồn dữ liệu bảng "Cần / Đã cắt /
   * Còn lại" ở màn Lệnh sản xuất (Phôi).
   *
   * `required` suy từ ĐỊNH MỨC, cố ý KHÔNG lấy từ CuttingProposalPattern: pattern là kế hoạch của
   * solver và thường cắt DƯ (đo thật trên PI-2026-046: dư 26 đoạn ở 11/35 cỡ, vì đoạn ngắn được
   * xếp lấp phần đuôi cây vốn cắt để lấy đoạn dài). Lấy pattern làm mốc thì "Còn lại" không bao
   * giờ về 0 đúng lúc.
   *
   * `done` cộng CẢ đợt rework (không lọc reworkOfId như getIssuePlan): ở đây đang đếm SẢN LƯỢNG
   * thực tế đã cắt ra, mọi đoạn cắt được đều là đoạn thật.
   */
  async getPhoiProgress(productionInvoiceId: string): Promise<PhoiProgressItemResponseDto[]> {
    const invoice = await this.findInvoiceOrThrow(productionInvoiceId);
    const { cut } = await this.loadPhoiInputs([invoice.id]);
    const inputs = cut.get(invoice.id.toString());
    return inputs ? this.computeCutProgress(inputs) : [];
  }

  private async computeCutProgress(inputs: CutInputs): Promise<PhoiProgressItemResponseDto[]> {
    const byMaterial = await this.buildPhoiProgress(
      {
        orders: inputs.orders,
        bomPieces: inputs.bomPieces,
        pieceBoms: inputs.pieceBoms,
        issues: inputs.issues,
        cutSegments: inputs.cutSegments,
        qcSegments: inputs.qcSegments,
        stepSegments: inputs.stepSegments,
        stepQc: inputs.stepQcSegments,
      },
      PROCESS_CAT,
    );
    await this.attachSteelBalance(
      byMaterial,
      inputs.issues,
      inputs.machineByMaterial,
      inputs.reservations,
      inputs.returnedMmByMaterial,
    );
    return [...byMaterial.values()].sort((a, b) => a.materialCode.localeCompare(b.materialCode));
  }

  /**
   * Dựng tiến độ theo (LOẠI SẮT -> CỠ ĐOẠN -> SKU) cho 1 công đoạn (Cắt hoặc công đoạn phụ) - dùng chung cho
   * computeCutProgress / computeStepProgress. Mọi con số (cần / đã tính / còn báo được) lấy từ phoi-need.util, cùng
   * hàm với phép chặn lúc báo (P1, 18/11/2026).
   */
  private async buildPhoiProgress(
    data: {
      orders: OrderForBom[];
      bomPieces: BaseInputs['bomPieces'];
      pieceBoms: BaseInputs['pieceBoms'];
      issues: BaseInputs['issues'];
      cutSegments: CutSegmentRow[];
      qcSegments: CutQcRow[];
      stepSegments: StepSegmentRow[];
      stepQc: StepQcRow[];
    },
    step: PhoiStep,
  ): Promise<Map<string, PhoiProgressItemResponseDto>> {
    const { orders, bomPieces, pieceBoms, issues } = data;
    const byMaterial = new Map<string, PhoiProgressItemResponseDto>();
    if (orders.length === 0) return byMaterial;

    // Khoá (cỡ đoạn, SKU) - SKU 'none' = đợt/đánh giá CŨ chưa gắn SKU ở PI NHIỀU SKU (PI 1 SKU: tính cho SKU duy nhất).
    const orderKey = (id: bigint | null | undefined) => phoiOrderKey(orders, id);
    const liveOrderKeys = new Set(orders.map((o) => o.id.toString()));
    const planSurplus = await loadPlanSurplus(
      this.prisma,
      orders.map((o) => o.id),
    );
    const index = buildPhoiNeedIndex({
      orders,
      planSurplus,
      bomPieces,
      pieceBoms,
      cut: data.cutSegments.map((r) => ({
        segmentSpecId: r.segmentSpecId,
        productionOrderId: r.cutBundle.productionOrderId,
        qty: r.qty,
      })),
      cutQc: data.qcSegments.map((r) => ({
        segmentSpecId: r.segmentSpecId,
        productionOrderId: r.qcReview.cutBundle?.productionOrderId ?? null,
        failedQty: r.failedQty,
        shortQty: r.shortQty,
      })),
      step: data.stepSegments.map((r) => ({
        segmentSpecId: r.segmentSpecId,
        productionOrderId: r.stepBatch.productionOrderId,
        step: r.stepBatch.step,
        qty: r.qty,
      })),
      stepQc: data.stepQc.flatMap((r) =>
        r.qcReview.stepBundle
          ? [
              {
                segmentSpecId: r.segmentSpecId,
                productionOrderId: r.qcReview.stepBundle.productionOrderId,
                step: r.qcReview.stepBundle.step,
                failedQty: r.failedQty,
                shortQty: r.shortQty,
                scrapQty: r.scrapQty,
              },
            ]
          : [],
      ),
    });

    // Chưa gửi KCS (đợt CUTTING / dòng chưa vào đợt) / chờ KCS (đợt AWAITING_QC) - phần của `done`, để 3 màn QLSX hiện cùng số.
    const openBySpecOrder = new Map<string, number>();
    const awaitingBySpecOrder = new Map<string, number>();
    const bump = (m: Map<string, number>, k: string, qty: number) =>
      m.set(k, (m.get(k) ?? 0) + qty);
    const stepDoneSpecs = new Set<string>();
    if (step === PROCESS_CAT) {
      for (const cs of data.cutSegments) {
        stepDoneSpecs.add(cs.segmentSpecId.toString());
        const k = `${cs.segmentSpecId}:${orderKey(cs.cutBundle.productionOrderId)}`;
        if (cs.cutBundle.status === CutBundleStatus.CUTTING) bump(openBySpecOrder, k, cs.qty);
        else if (cs.cutBundle.status === CutBundleStatus.AWAITING_QC) {
          bump(awaitingBySpecOrder, k, cs.qty);
        }
      }
    } else {
      for (const ss of data.stepSegments) {
        if (ss.stepBatch.step !== step) continue;
        stepDoneSpecs.add(ss.segmentSpecId.toString());
        const k = `${ss.segmentSpecId}:${orderKey(ss.stepBatch.productionOrderId)}`;
        if (ss.stepBatch.bundleStatus === null) bump(openBySpecOrder, k, ss.qty);
        else if (ss.stepBatch.bundleStatus === StepBundleStatus.AWAITING_QC) {
          bump(awaitingBySpecOrder, k, ss.qty);
        }
      }
    }

    const issuedByMaterial = new Map<string, number>();
    for (const i of issues) {
      if (i.reworkOfId != null) continue; // chỉ đợt gốc (kế hoạch xuất), như trước khi `issues` gồm cả rework
      const key = i.materialId.toString();
      issuedByMaterial.set(key, (issuedByMaterial.get(key) ?? 0) + i.barCount);
    }

    // Khoá theo segmentSpecId (không phải cutLengthMm): cutLengthMm là Decimal, 2 Decimal cùng giá
    // trị không === nhau nên dùng làm khoá Map sẽ tách nhầm 1 cỡ thành nhiều dòng. segmentSpecId
    // đã @@unique([materialId, cutLengthMm]) nên khoá theo nó là tương đương mà an toàn.
    const specMeta = new Map<
      string,
      { materialId: string; materialCode: string; materialName: string; cutLengthMm: number }
    >();
    // Cắt: mọi dòng định mức (không lọc processSteps, xem resolveRequiredSteps()); công đoạn phụ: chỉ dòng có đúng step.
    const stepRows =
      step === PROCESS_CAT ? pieceBoms : pieceBoms.filter((pb) => pb.processSteps.includes(step));
    for (const row of stepRows) {
      const specKey = row.segmentSpecId.toString();
      if (specMeta.has(specKey)) continue;
      specMeta.set(specKey, {
        materialId: row.segmentSpec.materialId.toString(),
        materialCode: row.segmentSpec.material.code,
        materialName: this.materialLabel(row.segmentSpec.material),
        cutLengthMm: row.segmentSpec.cutLengthMm.toNumber(),
      });
    }

    // Cỡ ĐÃ làm nhưng KHÔNG có trong định mức của PI này vẫn phải hiện ra (required = 0) - giấu đi
    // là giấu luôn dữ liệu sai, thợ sẽ không hiểu vì sao cân đối lệch.
    const orphanSpecIds = [...stepDoneSpecs].filter((k) => !specMeta.has(k));
    if (orphanSpecIds.length > 0) {
      const orphans = await this.prisma.segmentSpec.findMany({
        where: { id: { in: orphanSpecIds.map((k) => BigInt(k)) } },
        include: { material: true },
      });
      for (const o of orphans) {
        specMeta.set(o.id.toString(), {
          materialId: o.materialId.toString(),
          materialCode: o.material.code,
          materialName: this.materialLabel(o.material),
          cutLengthMm: o.cutLengthMm.toNumber(),
        });
      }
    }

    for (const [specKey, meta] of specMeta) {
      let item = byMaterial.get(meta.materialId);
      if (!item) {
        item = new PhoiProgressItemResponseDto({
          materialId: meta.materialId,
          materialCode: meta.materialCode,
          materialName: meta.materialName,
          issuedBarCount: issuedByMaterial.get(meta.materialId) ?? 0,
          segments: [],
        });
        byMaterial.set(meta.materialId, item);
      }
      // Tách theo SKU: mọi SKU có định mức / đã làm / lỗi ở cỡ này, cộng thêm 'none' nếu có đợt cũ ở PI nhiều SKU.
      const byOrder: PhoiProgressOrderSegmentDto[] = [];
      for (const ok of index.orderKeysOf(specKey)) {
        const input = index.get(ok, specKey)!;
        const n = computePhoiStep(input, step);
        const has = n.baseRequired > 0 || n.raw > 0 || n.failed > 0 || n.short > 0 || n.scrap > 0;
        if (!has) continue;
        const none = ok === 'none';
        byOrder.push(
          new PhoiProgressOrderSegmentDto({
            productionOrderId: none ? null : ok,
            required: none ? 0 : n.required,
            baseRequired: none ? 0 : n.baseRequired,
            extraNeed: none ? 0 : n.extraNeed,
            // ĐỔI NGHĨA (P1): đã báo - thiếu (VẪN gồm lỗi); "done - failed" = số đã tính.
            done: n.raw - n.short,
            failed: n.failed,
            shortQty: n.short,
            scrapQty: n.scrap,
            reportedQty: n.raw,
            maxNow: none ? 0 : n.maxNow,
            planSurplus: none ? 0 : n.planSurplus,
            physicalLeft: none ? null : n.physicalLeft,
            openQty: openBySpecOrder.get(`${specKey}:${ok}`) ?? 0,
            awaitingQcQty: awaitingBySpecOrder.get(`${specKey}:${ok}`) ?? 0,
          }),
        );
      }
      byOrder.sort((a, b) =>
        a.productionOrderId === null
          ? 1
          : b.productionOrderId === null
            ? -1
            : Number(a.productionOrderId) - Number(b.productionOrderId),
      );
      // Huỷ lệnh theo SKU (23/11/2026): nhóm của SKU đã huỷ (không có trong `orders`) vẫn hiện trong byOrder nhưng KHÔNG cộng
      // vào số của cỡ đoạn - phần đã làm của SKU huỷ là dư, không bù cho SKU còn chạy.
      const counted = byOrder.filter(
        (o) => o.productionOrderId === null || liveOrderKeys.has(o.productionOrderId),
      );
      const sum = (pick: (o: PhoiProgressOrderSegmentDto) => number) =>
        counted.reduce((t, o) => t + pick(o), 0);
      const concrete = counted.filter((o) => o.productionOrderId !== null);
      item.segments.push(
        new PhoiProgressSegmentDto({
          segmentSpecId: specKey,
          cutLengthMm: meta.cutLengthMm,
          // Σ theo SKU: phần của đợt cũ chưa gắn SKU (ở PI nhiều SKU) không vào số cần của SKU nào (AC60).
          required: sum((o) => o.required),
          baseRequired: sum((o) => o.baseRequired),
          extraNeed: sum((o) => o.extraNeed),
          done: sum((o) => o.done),
          failed: sum((o) => o.failed),
          shortQty: sum((o) => o.shortQty),
          scrapQty: sum((o) => o.scrapQty),
          reportedQty: sum((o) => o.reportedQty),
          maxNow: concrete.reduce((t, o) => t + o.maxNow, 0),
          planSurplus: concrete.reduce((t, o) => t + o.planSurplus, 0),
          physicalLeft:
            step === PROCESS_CAT ? null : concrete.reduce((t, o) => t + (o.physicalLeft ?? 0), 0),
          openQty: sum((o) => o.openQty),
          awaitingQcQty: sum((o) => o.awaitingQcQty),
          byOrder,
        }),
      );
    }

    // Cỡ dài trước - thợ cắt đoạn dài trước để phần đuôi còn lại đủ cho đoạn ngắn, đúng thứ tự
    // solver in ra ở bảng hướng dẫn cắt.
    for (const item of byMaterial.values()) {
      item.segments.sort((a, b) => b.cutLengthMm - a.cutLengthMm);
    }
    return byMaterial;
  }

  /**
   * Đối chiếu sắt vào - đoạn ra theo PI + loại sắt (2026-10-12, phần nền trước QR - changelog
   * 2026-10-08-ke-hoach-tem-qr-bo-sat-phoi.md mục 21). CHỈ CẢNH BÁO, không chặn: Phôi đôi khi cắt bù
   * đoạn lỗi bằng sắt thừa dưới xưởng (không thuộc đợt xuất nào), và "KCS là chốt kiểm soát" (Sếp chốt).
   *   dùng được = Σ đợt ĐÃ NHẬN (số thực nhận, rơi về barCount với đợt nhận trước 2026-10-12)
   *               × (chiều dài cây − tề đầu)
   *   đoạn đã báo = Σ số đoạn đã cắt × (chiều dài đoạn + mạch cắt)
   * Tính theo CẢ PI, không theo từng SteelIssue: kho giao lẻ nhiều đợt, Phôi không cắt hết đợt này mới
   * sang đợt khác (live-test 09/10: báo cả 2 đơn vào lô 20 cây trong khi lô 21 cây cùng PI chưa động).
   * Độ nhạy chỉ bằng phần dư của phương án cắt (0–2,5% trên số thật) - bắt khai khống lớn, không bắt
   * được vài đoạn.
   */
  private async attachSteelBalance(
    byMaterial: Map<string, PhoiProgressItemResponseDto>,
    issues: BaseInputs['issues'],
    machineByMaterial: Map<string, SolverMachine>,
    reservations: CutInputs['reservations'] = [],
    returnedMmByMaterial: Map<string, number> = new Map(),
  ): Promise<void> {
    const config = await this.prisma.systemConfig.findUnique({
      where: { id: 1 },
      select: {
        solverTrimStartMm: true,
        solverBladeWidthMm: true,
        solverMctdTrimStartMm: true,
        solverMctdBladeWidthMm: true,
      },
    });
    for (const item of byMaterial.values()) {
      // Tề đầu/lưỡi theo MÁY của phương án (2026-10-23): MC Tự động có cặp riêng (mặc định 0 / 2,5 mm), dùng
      // cặp của MC Laser sẽ lệch cân bằng sắt vào - đoạn ra. Không có máy ghi nhận = MC Laser.
      const tuDong = machineByMaterial.get(item.materialId) === SolverMachine.tu_dong;
      const trimMm = (tuDong ? config?.solverMctdTrimStartMm : config?.solverTrimStartMm) ?? 0;
      const kerfMm =
        (tuDong ? config?.solverMctdBladeWidthMm : config?.solverBladeWidthMm)?.toNumber() ?? 0;
      const received = issues.filter(
        (i) => i.materialId.toString() === item.materialId && i.status !== SteelIssueStatus.ISSUED,
      );
      if (received.length === 0) continue;
      let receivedBarCount = 0;
      let usableMm = 0;
      for (const i of received) {
        const bars = i.receivedBarCount ?? i.barCount;
        receivedBarCount += bars;
        usableMm += bars * Math.max(i.barLengthMm - trimMm, 0);
      }
      // Q3: cây đã nhập trả kho không còn ở tổ cắt.
      usableMm = Math.max(0, usableMm - (returnedMmByMaterial.get(item.materialId) ?? 0));
      // `done` mới = đã báo - thiếu: đoạn KCS ghi thiếu không có thật nên không tốn sắt.
      // Cộng theo byOrder (gồm cả SKU đã huỷ - sg.done không gồm): đoạn của SKU huỷ cũng đã tốn sắt.
      const reportedMm = item.segments.reduce(
        (t, sg) => t + sg.byOrder.reduce((s, o) => s + o.done, 0) * (sg.cutLengthMm + kerfMm),
        0,
      );
      // Gợi ý cho P1b (chỉ đọc): còn phải cắt bao nhiêu đoạn (theo từng SKU, SKU đã dư không bù cho SKU còn thiếu),
      // trong đó bao nhiêu là cắt LẠI, cần bao nhiêu sắt, sắt đã nhận chưa cắt và sắt còn xuất được theo giữ chỗ.
      let remainingSegments = 0;
      let recutSegments = 0;
      let remainingNeedMm = 0;
      for (const sg of item.segments) {
        let segRemaining = 0;
        for (const o of sg.byOrder) {
          if (o.productionOrderId === null) continue;
          const remaining = Math.max(0, o.required - (o.done - o.failed));
          segRemaining += remaining;
          recutSegments += Math.min(o.extraNeed, remaining);
        }
        remainingSegments += segRemaining;
        remainingNeedMm += segRemaining * (sg.cutLengthMm + kerfMm);
      }
      const held = reservations.filter(
        (r) => r.materialId.toString() === item.materialId && r.remaining > 0,
      );
      // Không rõ chiều dài cây của phần còn giữ chỗ thì không ước được (null), không coi là 0.
      const issuableMm = held.some((r) => r.stockLengthMm <= 0)
        ? null
        : held.reduce((t, r) => t + r.remaining * r.stockLengthMm, 0);
      const leftoverReceivedMm = Math.max(0, Math.round(usableMm) - Math.round(reportedMm));
      item.steelBalance = new PhoiSteelBalanceDto({
        receivedBarCount,
        usableMm: Math.round(usableMm),
        reportedMm: Math.round(reportedMm),
        overMm: Math.max(Math.round(reportedMm - usableMm), 0),
        remainingSegments,
        recutSegments,
        remainingNeedMm: Math.round(remainingNeedMm),
        leftoverReceivedMm,
        issuableMm,
        shortMm: Math.max(0, Math.round(remainingNeedMm) - leftoverReceivedMm - (issuableMm ?? 0)),
      });
    }
  }

  /**
   * Tiến độ 1 công đoạn chi tiết SAU Cắt (Uốn/Dập/...) theo TỪNG cỡ đoạn cho 1 PI - cùng khuôn
   * dạng "Cần/Đã .../Còn lại" như getPhoiProgress(), khác nguồn `done`: đọc từ StepBatchSegment
   * (bảng mirror CutPatternSegment cho step != CAT, xem RecordStepBatchDto) thay vì
   * CutPatternSegment. `required` CHỈ tính những dòng PieceBom có processSteps chứa đúng step
   * này - khác getPhoiProgress (Cắt áp dụng mặc định cho MỌI dòng, không lọc processSteps, xem
   * resolveRequiredSteps()).
   */
  async getStepProgress(
    productionInvoiceId: string,
    step: ProcessStep,
  ): Promise<PhoiProgressItemResponseDto[]> {
    const invoice = await this.findInvoiceOrThrow(productionInvoiceId);
    const { step: stepInputs } = await this.loadPhoiInputs([invoice.id]);
    const inputs = stepInputs.get(invoice.id.toString());
    return inputs ? this.computeStepProgress(inputs, step) : [];
  }

  private async computeStepProgress(
    inputs: StepInputs,
    step: ProcessStep,
  ): Promise<PhoiProgressItemResponseDto[]> {
    const byMaterial = await this.buildPhoiProgress(
      {
        orders: inputs.orders,
        bomPieces: inputs.bomPieces,
        pieceBoms: inputs.pieceBoms,
        issues: inputs.issues,
        cutSegments: inputs.cutSegments,
        qcSegments: inputs.cutQcSegments,
        stepSegments: inputs.stepSegments,
        stepQc: inputs.qcSegments,
      },
      step,
    );
    return [...byMaterial.values()].sort((a, b) => a.materialCode.localeCompare(b.materialCode));
  }

  /**
   * Ghi 1 đợt "đã gia công" cho công đoạn chi tiết SAU Cắt (Uốn/Dập/...) CHO CẢ PI + loại sắt
   * (2026-09-07, đổi scope lần 2 theo Sếp Trương Văn Nhân - xem changelog "Bù đủ dồn về bảng
   * tổng": Phôi làm các công đoạn SONG SONG, không cần biết đúng đợt cắt nào ra đoạn đó, mirror
   * ProductionBatchesService.recordPieceStepBatch() bên VTTP). "Đã cắt" (catDone) đối chiếu giờ
   * tính TỔNG cả PI cho loại sắt này (Σ mọi CutBundle), không còn giới hạn trong 1 đợt cắt cụ thể.
   * Append-only, cộng dồn, KHÔNG có cân bằng vật chất (bước này không tác động lên cây sắt). KHÔNG
   * chặn theo completedSteps (đã xoá hẳn khái niệm đó, xem StepBundle) - báo được bất kỳ lúc nào.
   */
  async recordStepBatch(
    productionInvoiceId: string,
    dto: RecordStepBatchDto,
    reportedById: string,
    idempotencyKey?: string | null,
    ctx?: FloorReportContext,
  ): Promise<StepBatchResponseDto> {
    if (dto.step === ProcessStep.CAT) {
      throw new BadRequestException('Công đoạn Cắt dùng route cut-batches riêng, không qua đây');
    }
    // Gửi lại cùng khoá -> trả đúng đợt đã ghi (2026-10-12, xem FloorReport).
    // Đã hủy hết lần báo đó (stepBatchId về NULL) thì báo câu lời thường, không ghi lại (P1, AC53).
    // T4-4 (20/11/2026): so vân tay - người, máy, cỡ đoạn + số, và PI / vật tư / công đoạn / SKU - trước khi trả đợt cũ.
    const expectedStep: FloorReportReplayExpected = {
      kind: FloorReportKind.STEP,
      reportedById,
      workstationId: ctx?.workstationId,
      lines: dto.segments.map((seg) => ({
        segmentSpecId: parseBigIntId(seg.segmentSpecId),
        qty: seg.qty,
      })),
      step: {
        productionInvoiceId: parseBigIntId(productionInvoiceId),
        materialId: parseBigIntId(dto.materialId),
        step: dto.step,
        productionOrderId: parseBigIntId(dto.productionOrderId),
      },
    };
    const replay = await this.replayFloorReport(idempotencyKey, expectedStep);
    if (replay) return this.replayStepReport(replay.stepBatchId);
    const invoice = await this.findInvoiceOrThrow(productionInvoiceId);
    const materialBigId = parseBigIntId(dto.materialId);
    await assertPiHasActiveFloor(this.prisma, invoice.id, 'nhập công đoạn chi tiết');
    // 1 đợt = đúng 1 SKU (2026-09-21) - SKU phải thuộc PI này.
    const piOrders = await this.findOrdersForInvoice(invoice.id);
    const order = piOrders.find((o) => o.id === parseBigIntId(dto.productionOrderId));
    if (!order) {
      throw new BadRequestException(
        `SKU (lệnh sản xuất ${dto.productionOrderId}) không thuộc PI này`,
      );
    }
    // Huỷ lệnh theo SKU (23/11/2026)
    assertLoadedOrderNotCancelled(order, 'nhập công đoạn chi tiết');
    const requiredSteps = await this.resolveRequiredSteps(invoice.id, materialBigId);
    if (!requiredSteps.includes(dto.step)) {
      throw new BadRequestException(
        `Công đoạn ${processStepLabel(dto.step)} không thuộc danh sách công đoạn đã chọn sẵn của vật tư này`,
      );
    }

    const specIds = dto.segments.map((seg) => parseBigIntId(seg.segmentSpecId));
    if (new Set(specIds.map(String)).size !== specIds.length) {
      throw new BadRequestException('Cùng một cỡ đoạn khai làm nhiều dòng - gộp lại thành 1 dòng');
    }

    const [allowedSpecIds, specs] = await Promise.all([
      this.findStepSegmentSpecIds(invoice.id, dto.step, order.bomRevisionId),
      this.prisma.segmentSpec.findMany({
        where: { id: { in: specIds }, materialId: materialBigId },
      }),
    ]);
    const specById = new Map(specs.map((s) => [s.id.toString(), s]));
    for (const seg of dto.segments) {
      const specKey = parseBigIntId(seg.segmentSpecId).toString();
      const spec = specById.get(specKey);
      if (!spec) {
        throw new BadRequestException(`Cỡ đoạn ${seg.segmentSpecId} không thuộc loại sắt này`);
      }
      if (!allowedSpecIds.has(specKey)) {
        throw new BadRequestException(
          `Cỡ đoạn ${spec.cutLengthMm.toString()}mm không cần công đoạn ${processStepLabel(dto.step)} theo định mức của SKU đã chọn`,
        );
      }
    }

    // Đính chính audit độc lập 09/09 (Nghiêm trọng #6) - số đã báo phải đọc TRONG khoá, không phải ngoài
    // transaction: 2 request báo công đoạn gần như đồng thời cho cùng (invoice, material, step) mà đọc ngoài khoá
    // đều thấy số cũ, đều qua phép chặn, tổng đã báo VƯỢT. Mirror ĐÚNG khuôn
    // ProductionBatchesService.recordPieceStepBatch() (đã làm đúng cho nhánh VTTP): bọc
    // $transaction + lockBusinessKey theo (invoice, material, step) trước khi đọc lại
    // stepDoneSoFar, giữ khoá tới khi ghi xong dòng mới.
    let created: { id: bigint };
    try {
      const stepOutcome = await this.prisma.$transaction(
        async (tx) => {
          // 20/11/2026 (QA): try-lock khoá chống trùng là câu ĐẦU (trước step-batch), giống recordCutBatch.
          if (idempotencyKey) {
            await lockIdempotencyKey(tx, 'floor_reports', idempotencyKey);
            if (await findFloorReportByKey(tx, idempotencyKey)) return null;
          }
          await lockBusinessKey(
            tx,
            `step-batch:${invoice.id}:${materialBigId}:${dto.step}:${order.id}`,
          );
          await assertPiHasActiveFloorLocked(tx, invoice.id, 'nhập công đoạn chi tiết');

          // P1: chặn theo SỐ CẦN (kể cả phần làm bù cho đoạn KCS bỏ) và theo GIỚI HẠN VẬT LÝ (đoạn cắt thực có - đoạn đã
          // dùng), cùng hàm với số "còn báo được" hiện ở màn quét. Đọc ngay trong khoá step-batch.
          await this.assertStepWithinNeedInTx(tx, {
            piId: invoice.id,
            materialId: materialBigId,
            step: dto.step,
            order,
            piOrders,
            lines: dto.segments.map((seg) => ({
              specId: parseBigIntId(seg.segmentSpecId),
              qty: seg.qty,
              mm: specById.get(parseBigIntId(seg.segmentSpecId).toString())!.cutLengthMm.toString(),
            })),
          });

          const batch = await tx.stepBatch.create({
            data: {
              productionInvoiceId: invoice.id,
              materialId: materialBigId,
              step: dto.step,
              productionOrderId: order.id,
              // Người báo (2026-10-13): "Gửi KCS" của QLSX gom đợt THEO NGƯỜI để KCS chấm biết của ai.
              reportedById,
              segments: {
                create: dto.segments.map((seg) => ({
                  segmentSpecId: parseBigIntId(seg.segmentSpecId),
                  qty: seg.qty,
                })),
              },
            },
          });
          // Người báo từng lần nằm ở sổ floor_reports (cùng transaction); cột reportedById trên StepBatch dùng để gom đợt.
          await writeFloorReport(tx, {
            kind: FloorReportKind.STEP,
            reportedById,
            idempotencyKey,
            stepBatchId: batch.id,
            workstationId: ctx?.workstationId,
            productionInvoiceId: invoice.id,
            lines: dto.segments.map((seg) => ({
              segmentSpecId: parseBigIntId(seg.segmentSpecId),
              qty: seg.qty,
            })),
          });
          return batch;
        },
        { timeout: 20_000 },
      );
      if (stepOutcome === null) {
        const replayInTx = await this.replayFloorReport(idempotencyKey, expectedStep);
        if (replayInTx) return this.replayStepReport(replayInTx.stepBatchId);
        throw new IdempotencyKeyInUseException();
      }
      created = stepOutcome;
    } catch (e) {
      if (isIdempotencyConflict(e)) {
        const raced = await this.replayFloorReport(idempotencyKey, expectedStep);
        if (raced) return this.replayStepReport(raced.stepBatchId);
      }
      throw e;
    }

    return this.toStepBatchResponse(created.id);
  }

  private async toStepBatchResponse(stepBatchId: bigint): Promise<StepBatchResponseDto> {
    const batch = await this.prisma.stepBatch.findUniqueOrThrow({
      where: { id: stepBatchId },
      include: { segments: { include: { segmentSpec: true } } },
    });
    return new StepBatchResponseDto({
      id: batch.id.toString(),
      step: batch.step,
      segments: batch.segments.map(
        (s) =>
          new StepBatchSegmentResponseDto({
            segmentSpecId: s.segmentSpecId.toString(),
            cutLengthMm: s.segmentSpec.cutLengthMm.toNumber(),
            qty: s.qty,
          }),
      ),
    });
  }

  /**
   * Điều kiện Prisma "đợt này thuộc SKU `orderId`" (2026-09-21): đợt gắn đúng SKU; riêng PI chỉ có ĐÚNG 1 SKU
   * thì đợt CŨ chưa gắn SKU (productionOrderId null) chắc chắn là của SKU đó nên tính luôn (không mơ hồ).
   * PI nhiều SKU: đợt cũ không biết của SKU nào nên KHÔNG tính cho SKU nào (không chia bừa).
   */
  private skuScope(
    piOrders: readonly unknown[],
    orderId: bigint,
  ): { OR: { productionOrderId: bigint | null }[] } {
    return {
      OR: [
        { productionOrderId: orderId },
        ...(piOrders.length === 1 ? [{ productionOrderId: null }] : []),
      ],
    };
  }

  /**
   * X3 (danh sách lỗi 16/11): trước khi TRỪ số cắt của 1 đợt (QLSX hủy 1 lần báo cắt, hoàn tác), kiểm số đã báo công
   * đoạn phụ (Uốn/Dập/...) của cùng SKU không vượt số cắt còn lại - đúng bất biến recordStepBatch() giữ khi báo thêm.
   * Trước đây hủy báo cắt không kiểm gì nên Uốn/Dập đã báo có thể cao hơn số đã cắt.
   *
   * Gọi TRONG transaction, sau khi đã khoá dòng cut_bundles. Khoá thêm step-batch của MỌI công đoạn (cùng khoá
   * recordStepBatch, theo thứ tự cố định) rồi mới đọc: 1 lần báo công đoạn hay 1 lần hủy báo cắt khác của cùng SKU
   * chạy cùng lúc phải chờ, sau đó đọc được số mới.
   *
   * `opts.reassign` (ADMIN sửa SKU của đợt cắt, P1): đợt đi cả phiếu KCS của nó sang SKU khác nên SKU cũ mất luôn số
   * thô lẫn số thiếu / lỗi của chính đợt đó - trừ cả ba rồi so; câu lỗi nói về việc sửa SKU, không phải hủy.
   */
  async assertStepsWithinCutAfterReduceInTx(
    tx: PrismaTx,
    cutBundleId: bigint,
    reduce: { segmentSpecId: bigint; qty: number }[],
    opts: { reassign?: boolean } = {},
  ): Promise<void> {
    const reduceBySpec = new Map<string, number>();
    for (const r of reduce) {
      if (r.qty <= 0) continue;
      const k = r.segmentSpecId.toString();
      reduceBySpec.set(k, (reduceBySpec.get(k) ?? 0) + r.qty);
    }
    if (reduceBySpec.size === 0) return;
    const bundle = await tx.cutBundle.findUnique({
      where: { id: cutBundleId },
      select: {
        productionOrderId: true,
        steelIssue: { select: { productionInvoiceId: true, materialId: true } },
      },
    });
    if (!bundle) return;
    const { productionInvoiceId: piId, materialId } = bundle.steelIssue;
    const piOrders = await tx.productionOrder.findMany({
      where: { productionInvoiceItem: { productionInvoiceId: piId } },
      select: { id: true, bomRevisionId: true, quantity: true },
    });
    // Đợt chưa gắn SKU ở PI nhiều SKU không tính cho SKU nào (skuScope) - trừ nó không đổi số cắt của SKU nào.
    const orderId = bundle.productionOrderId ?? (piOrders.length === 1 ? piOrders[0].id : null);
    if (orderId == null) return;
    const order = piOrders.find((o) => o.id === orderId);
    if (!order) return;

    for (const step of Object.values(ProcessStep)) {
      if (step === ProcessStep.CAT) continue;
      await lockBusinessKey(tx, `step-batch:${piId}:${materialId}:${step}:${orderId}`);
    }
    const specIds = [...reduceBySpec.keys()].map((k) => BigInt(k));
    const [index, specs] = await Promise.all([
      this.loadNeedIndex(tx, { piId, materialId, order, piOrders, specIds }),
      tx.segmentSpec.findMany({
        where: { id: { in: specIds } },
        select: { id: true, cutLengthMm: true },
      }),
    ]);
    // Sửa SKU: phiếu KCS của chính đợt đi theo đợt sang SKU mới nên cũng bị bỏ khỏi SKU cũ (thiếu / lỗi của Cắt).
    const ownFailedBySpec = new Map<string, number>();
    const ownShortBySpec = new Map<string, number>();
    if (opts.reassign) {
      const ownQc = await tx.qcReviewSegment.findMany({
        where: { segmentSpecId: { in: specIds }, qcReview: { cutBundleId } },
        select: { segmentSpecId: true, failedQty: true, shortQty: true },
      });
      for (const r of ownQc) {
        const k = r.segmentSpecId.toString();
        ownFailedBySpec.set(k, (ownFailedBySpec.get(k) ?? 0) + r.failedQty);
        ownShortBySpec.set(k, (ownShortBySpec.get(k) ?? 0) + r.shortQty);
      }
    }
    for (const [specKey, minus] of reduceBySpec) {
      const base = index.get(orderId.toString(), specKey) ?? EMPTY_NEED_INPUT;
      // P1: vế vật lý = đoạn cắt thực có (thô - thiếu) SAU khi trừ `minus` so với số đoạn đã DÙNG của từng công đoạn
      // (thô - thiếu - phần làm lại) - đoạn KCS cho làm lại không tốn đoạn cắt mới.
      const cutCounts = base.counts.CAT ?? { raw: 0, failed: 0, short: 0, scrap: 0 };
      const after: PhoiNeedInput = {
        ...base,
        counts: {
          ...base.counts,
          CAT: {
            ...cutCounts,
            raw: cutCounts.raw - minus,
            failed: cutCounts.failed - (ownFailedBySpec.get(specKey) ?? 0),
            short: cutCounts.short - (ownShortBySpec.get(specKey) ?? 0),
          },
        },
      };
      for (const step of Object.values(ProcessStep)) {
        if (step === ProcessStep.CAT || !after.counts[step]?.raw) continue;
        const n = computePhoiStep(after, step);
        if (n.used != null && n.cutCap != null && n.used > n.cutCap) {
          const mm =
            specs.find((s) => s.id.toString() === specKey)?.cutLengthMm.toString() ?? specKey;
          if (opts.reassign) {
            throw new BadRequestException(
              `Sửa SKU đợt cắt này làm ${processStepLabel(step)} cỡ ${mm}mm của SKU cũ vượt số đoạn cắt thực có ` +
                `${Math.max(n.cutCap, 0)} đoạn (đã dùng ${n.used}) - hủy bớt lần báo ${processStepLabel(step)} của SKU cũ trước.`,
            );
          }
          throw new BadRequestException(
            `Hủy số cắt này làm cỡ ${mm}mm của SKU chỉ còn ${Math.max(n.cutCap, 0)} đoạn đã cắt, ít hơn ` +
              `${n.used} đoạn đã báo ${processStepLabel(step)} - hủy lần báo ${processStepLabel(step)} trước rồi hủy lần báo cắt`,
          );
        }
      }
    }
  }

  /** Tập segmentSpecId hợp lệ để khai công đoạn `step` cho 1 PI - mirror findBomSegmentSpecIds()
   *  nhưng lọc thêm processSteps chứa đúng step, vì không phải cỡ đoạn nào cũng cần MỌI công đoạn
   *  (khác Cắt, luôn bắt buộc cho mọi cỡ). */
  private async findStepSegmentSpecIds(
    productionInvoiceId: bigint,
    step: ProcessStep,
    onlyBomRevisionId?: bigint,
  ): Promise<Set<string>> {
    const orders = await this.findOrdersForInvoice(productionInvoiceId);
    if (orders.length === 0) return new Set();
    const rows = await this.prisma.pieceBom.findMany({
      where: {
        bomRevisionId: {
          in: onlyBomRevisionId
            ? [onlyBomRevisionId]
            : [...new Set(orders.map((o) => o.bomRevisionId))],
        },
        processSteps: { has: step },
      },
      select: { segmentSpecId: true },
    });
    return new Set(rows.map((r) => r.segmentSpecId.toString()));
  }

  /**
   * Union processSteps của MỌI PieceBom (mọi mảnh, mọi SKU/PO) dùng materialId này trong cả PI +
   * CAT mặc định (công đoạn tối thiểu bắt buộc - luôn xảy ra qua completeCutting).
   *
   * B4 Đợt 3d: trước đây tính theo ĐÚNG 1 mảnh (bomRevisionId, pieceId, materialId) vì mỗi đợt
   * xuất gắn 1 mảnh cụ thể. Từ khi gộp theo cả PI, hệ thống KHÔNG biết trước cây sắt xuất ra sẽ
   * về mảnh nào (Phôi tự phân bổ vật lý lúc cắt) - phải giả định XẤU NHẤT: nếu BẤT KỲ mảnh nào
   * trong PI dùng material này cần 1 công đoạn (vd Uốn), cả đợt xuất phải xác nhận công đoạn đó
   * mới được chuyển AWAITING_QC, dù thực tế phần cắt cho 1 mảnh không cần. Đây không phải giảm độ
   * chính xác mà là điều kiện bắt buộc để không lọt hàng cần xử lý thêm qua KCS mà thiếu bước.
   */
  private async resolveRequiredSteps(
    productionInvoiceId: bigint,
    materialId: bigint,
  ): Promise<ProcessStep[]> {
    // Huỷ lệnh theo SKU (23/11/2026): công đoạn chỉ SKU đã huỷ cần thì không còn phải làm.
    const orders = await this.prisma.productionOrder.findMany({
      where: { productionInvoiceItem: { productionInvoiceId }, ...NOT_CANCELLED_ORDER },
      select: { bomRevisionId: true },
    });
    const set = new Set<ProcessStep>([ProcessStep.CAT]);
    if (orders.length === 0) return [...set];

    const bomRevisionIds = [...new Set(orders.map((o) => o.bomRevisionId))];
    const rows = await this.prisma.pieceBom.findMany({
      where: { bomRevisionId: { in: bomRevisionIds }, segmentSpec: { materialId } },
      select: { processSteps: true },
    });
    for (const row of rows) for (const step of row.processSteps) set.add(step);
    return [...set];
  }

  /** Batch cho findAll/findAllForInvoice - gom theo `${productionInvoiceId}:${materialId}`, 2
   *  query cho cả tập đợt xuất liên quan (tránh N+1). */
  private async attachRequiredStepsMap(
    issues: SteelIssueRow[],
  ): Promise<Map<string, ProcessStep[]>> {
    const invoiceIds = [...new Set(issues.map((i) => i.productionInvoiceId))];
    // Huỷ lệnh theo SKU (23/11/2026): cùng resolveRequiredSteps - bỏ lệnh đã huỷ.
    const orders = await this.prisma.productionOrder.findMany({
      where: {
        productionInvoiceItem: { productionInvoiceId: { in: invoiceIds } },
        ...NOT_CANCELLED_ORDER,
      },
      select: {
        bomRevisionId: true,
        productionInvoiceItem: { select: { productionInvoiceId: true } },
      },
    });

    const bomRevisionIdsByInvoice = new Map<string, Set<bigint>>();
    for (const o of orders) {
      const invoiceId = o.productionInvoiceItem?.productionInvoiceId;
      if (invoiceId == null) continue;
      const key = invoiceId.toString();
      const set = bomRevisionIdsByInvoice.get(key) ?? new Set<bigint>();
      set.add(o.bomRevisionId);
      bomRevisionIdsByInvoice.set(key, set);
    }

    const allBomRevisionIds = [...new Set(orders.map((o) => o.bomRevisionId))];
    const pieceBoms = await this.prisma.pieceBom.findMany({
      where: { bomRevisionId: { in: allBomRevisionIds } },
      select: {
        bomRevisionId: true,
        processSteps: true,
        segmentSpec: { select: { materialId: true } },
      },
    });
    const stepsByRevisionMaterial = new Map<string, ProcessStep[]>();
    for (const pb of pieceBoms) {
      const key = `${pb.bomRevisionId}:${pb.segmentSpec.materialId}`;
      const arr = stepsByRevisionMaterial.get(key) ?? [];
      stepsByRevisionMaterial.set(key, [...new Set([...arr, ...pb.processSteps])]);
    }

    const result = new Map<string, ProcessStep[]>();
    for (const issue of issues) {
      const key = `${issue.productionInvoiceId}:${issue.materialId}`;
      if (result.has(key)) continue;
      const bomRevisionIds = bomRevisionIdsByInvoice.get(issue.productionInvoiceId.toString());
      const set = new Set<ProcessStep>([ProcessStep.CAT]);
      for (const bomRevisionId of bomRevisionIds ?? []) {
        const steps = stepsByRevisionMaterial.get(`${bomRevisionId}:${issue.materialId}`) ?? [];
        for (const s of steps) set.add(s);
      }
      result.set(key, [...set]);
    }
    return result;
  }

  async findOneRowOrThrow(id: string): Promise<SteelIssueRow> {
    return this.findOneOrThrow(id);
  }

  /**
   * Danh sách PO/SKU (ProductionOrder) thuộc 1 PI - khối "tham khảo" cho màn Lệnh sản xuất Phôi.
   * KHÔNG mang số liệu tiến độ (tiến độ chỉ có ở cấp PI × loại sắt, xem getPhoiProgress) - Phôi
   * không biết trước cây sắt về SKU nào lúc cắt (xem changelog
   * 2026-08-19-xuat-sat-theo-pi-hoan-tat.html).
   */
  async getOrderSummary(productionInvoiceId: string): Promise<PiOrderSummaryResponseDto[]> {
    const invoice = await this.findInvoiceOrThrow(productionInvoiceId);
    // Huỷ lệnh theo SKU (23/11/2026): danh sách SKU Phôi làm - bỏ SKU đã huỷ.
    const orders = await this.prisma.productionOrder.findMany({
      where: { productionInvoiceItem: { productionInvoiceId: invoice.id }, ...NOT_CANCELLED_ORDER },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        poNumber: true,
        quantity: true,
        mfgProduct: { select: { name: true, factoryCode: true } },
        productionInvoiceItem: {
          select: {
            salesOrder: { select: { orderCode: true } },
            // Phần A – Đợt 3: lấy thêm mốc Bắt đầu Phôi (PHOI_START) cùng mốc Phôi xong (FRAME_PHOI).
            stages: {
              where: { stageType: { in: ['FRAME_PHOI', 'PHOI_START'] } },
              select: { stageType: true, deadline: true },
            },
          },
        },
      },
    });
    return orders.map(
      (o) =>
        new PiOrderSummaryResponseDto({
          productionOrderId: o.id.toString(),
          sku: o.mfgProduct.factoryCode,
          poNumber: o.poNumber,
          salesOrderCode: o.productionInvoiceItem?.salesOrder?.orderCode ?? null,
          productName: o.mfgProduct.name,
          quantity: o.quantity,
          phoiDeadline:
            o.productionInvoiceItem?.stages.find((st) => st.stageType === 'FRAME_PHOI')?.deadline ??
            null,
          phoiStart:
            o.productionInvoiceItem?.stages.find((st) => st.stageType === 'PHOI_START')?.deadline ??
            null,
        }),
    );
  }

  /**
   * "Cần xuất bao nhiêu" theo LOẠI SẮT cho cả PI - nguồn ĐÚNG là kết quả phần mềm tính cắt sắt
   * (CuttingProposalLine.totalBars/bestStockLengthMm), KHÔNG phải định mức BOM (số đoạn cắt ra) -
   * Mua hàng cũng mua theo đúng con số này nên "Cần" ở đây phải khớp, xem changelog sửa 2026-09-05.
   * requiredBars cộng dồn qua MỌI dòng phủ vật tư này còn hiệu lực (1 PI có thể được phủ bởi 1
   * phương án gộp cả PI, hoặc nhiều phương án riêng từng SKU/PO) - bestStockLengthMm chỉ lấy 1 giá
   * trị vì findConflictingStockLengthReason() đã chặn từ lúc duyệt: không thể có 2 chiều dài khác
   * nhau cho cùng 1 loại sắt trong cùng 1 PI.
   */
  async getIssuePlan(productionInvoiceId: string): Promise<SteelIssuePlanItemResponseDto[]> {
    const invoice = await this.findInvoiceOrThrow(productionInvoiceId);

    const [lines, issues] = await Promise.all([
      this.prisma.cuttingProposalLine.findMany({
        where: {
          feasible: true,
          cuttingProposal: {
            status: CuttingProposalStatus.APPROVED,
            OR: [
              { productionInvoiceId: invoice.id },
              // Huỷ lệnh theo SKU (23/11/2026): phương án neo SKU đã huỷ không còn là "cần xuất". Phương án neo PI (lệnh gộp)
              // giữ nguyên - luồng huỷ đã tính lại hoặc chủ ý giữ (đã xuất sắt thì cắt hết, phần SKU huỷ thành dư).
              {
                productionOrder: {
                  productionInvoiceItem: { productionInvoiceId: invoice.id },
                  ...NOT_CANCELLED_ORDER,
                },
              },
            ],
          },
        },
        select: {
          materialId: true,
          totalBars: true,
          bestStockLengthMm: true,
          patterns: { select: { stockLengthMm: true, barCount: true } },
        },
      }),
      // Chỉ đợt gốc (không tính rework) - đúng cách daXuatOf() bên mock cộng dồn.
      this.prisma.steelIssue.findMany({
        where: { productionInvoiceId: invoice.id, reworkOfId: null },
        select: { materialId: true, barCount: true, barLengthMm: true },
      }),
    ]);

    const issuedByMaterial = new Map<string, number>();
    const issuedByMaterialLength = new Map<string, number>();
    for (const i of issues) {
      const key = i.materialId.toString();
      issuedByMaterial.set(key, (issuedByMaterial.get(key) ?? 0) + i.barCount);
      const lk = `${key}:${i.barLengthMm}`;
      issuedByMaterialLength.set(lk, (issuedByMaterialLength.get(lk) ?? 0) + i.barCount);
    }

    const requiredByMaterial = new Map<string, RequiredSteel>();
    for (const l of lines) {
      const key = l.materialId.toString();
      const entry = requiredByMaterial.get(key) ?? {
        requiredBars: 0,
        bestStockLengthMm: null,
        barsByLength: new Map<number, number>(),
      };
      entry.requiredBars += l.totalBars ?? 0;
      entry.bestStockLengthMm ??= l.bestStockLengthMm ?? null;
      // CS2 (20/11): tách theo chiều dài từng kiểu cắt (cây lẻ kho Phôi + cây chiều dài mua).
      for (const [len, bars] of barsByStockLength(l, l.patterns)) {
        entry.barsByLength.set(len, (entry.barsByLength.get(len) ?? 0) + bars);
      }
      requiredByMaterial.set(key, entry);
    }

    // Hợp với vật tư chỉ còn LỊCH SỬ đã xuất (phương án cắt phủ nó đã bị tính lại/supersede) - để
    // "Đã xuất" không biến mất khỏi màn hình dù "Cần" hiện tại của nó đã về 0.
    const materialIdsUsed = [
      ...new Set([...requiredByMaterial.keys(), ...issuedByMaterial.keys()]),
    ].map((k) => BigInt(k));
    if (materialIdsUsed.length === 0) return [];

    const [stockInfoByMaterial, materials] = await Promise.all([
      this.buildStockInfoByMaterial(invoice.id, materialIdsUsed, requiredByMaterial),
      this.prisma.material.findMany({
        where: { id: { in: materialIdsUsed } },
        select: { id: true, code: true, name: true, spec: true },
      }),
    ]);
    const materialMeta = new Map(materials.map((m) => [m.id.toString(), m]));

    return materialIdsUsed.map((materialId) => {
      const key = materialId.toString();
      const meta = materialMeta.get(key)!;
      const req = requiredByMaterial.get(key);
      const stockInfo = stockInfoByMaterial.get(key);
      return new SteelIssuePlanItemResponseDto({
        materialId: key,
        materialCode: meta.code,
        materialName: this.materialLabel(meta),
        requiredBars: req?.requiredBars ?? 0,
        bestStockLengthMm: req?.bestStockLengthMm ?? null,
        issuedBarCount: issuedByMaterial.get(key) ?? 0,
        remainingToIssue: stockInfo?.remainingToIssue ?? null,
        physicalStockQty: stockInfo?.physicalStockQty ?? null,
        lengths: [...(req?.barsByLength ?? new Map<number, number>())].map(
          ([lengthMm, requiredBars]) => ({
            lengthMm,
            requiredBars,
            issuedBars: issuedByMaterialLength.get(`${key}:${lengthMm}`) ?? 0,
            physicalStockQty: stockInfo?.physicalByLength.get(lengthMm) ?? null,
          }),
        ),
      });
    });
  }

  /**
   * B4 Đợt 3c (mục 13.6 changelog) - 2 con số cho thủ kho biết TRƯỚC khi xuất, thay vì nhập mù:
   *   - remainingToIssue: phần CÒN được xuất theo giữ chỗ (đúng logic
   *     SteelIssuesService.consumeReservationAndDeduct dùng để chặn xuất thừa) - null nếu phương
   *     án duyệt TRƯỚC cutover (không giữ chỗ) hoặc chưa có phương án nào.
   *   - physicalStockQty: tồn vật lý thật (stock_quant) - null nếu vật tư chưa gán Kho.
   * Tính 1 LẦN cho mỗi vật tư trong `materialIds` (không lặp theo mảnh) - xem gọi ở getIssuePlan().
   * physicalStockQty lọc ĐÚNG bucket stockLengthMm mà PI này đang cần (requiredByMaterial) - 1
   * material có thể có nhiều dòng stock_quant khác chiều dài (mua ở PI khác, thời điểm khác), cộng
   * lẫn vào nhau sẽ báo tồn sai (thấy "đủ" trong khi chiều dài cần lại không đủ). Không có chiều dài
   * cụ thể (vật tư chỉ còn lịch sử, xem getIssuePlan) thì fallback cộng mọi bucket.
   */
  private async buildStockInfoByMaterial(
    productionInvoiceId: bigint,
    materialIds: bigint[],
    requiredByMaterial: Map<string, RequiredSteel>,
  ): Promise<Map<string, StockInfo>> {
    const result = new Map<string, StockInfo>();
    if (materialIds.length === 0) return result;

    // L5 (2026-08-26): TỔNG cả pool giữ chỗ ACTIVE của (PI, vật tư) - KHÔNG còn tra qua 1
    // cuttingProposalId "đại diện" chọn bằng Map (GHI ĐÈ khi 2 SKU cùng dùng 1 loại sắt - trước
    // đây chỉ thấy giữ chỗ của SKU nào ghi SAU trong mảng `lines`, "còn lại" hiện sai/thiếu cho
    // SKU kia dù Phôi vẫn xuất được bình thường qua drainPool()). Không cần join qua
    // cuttingProposalLine nữa: "không có dòng giữ chỗ ACTIVE nào" (materialId vắng mặt trong
    // reservations) và "chưa có phương án duyệt nào" là 2 điều kiện LUÔN trùng nhau trong thực tế
    // - reserve() chỉ chạy được từ trong CuttingProposalsService.approve() (đã APPROVED), và
    // releaseByRef() (supersede) đánh RELEASED đúng lúc cuttingProposal đó rời khỏi APPROVED - nên
    // giữ đúng ý nghĩa cũ (remainingToIssue=null khi "chưa có gì để biết", không phải "=0") mà
    // không cần truy vấn cuttingProposalLine thêm 1 lần nữa.
    const [materials, reservations] = await Promise.all([
      this.prisma.material.findMany({
        where: { id: { in: materialIds } },
        select: {
          id: true,
          warehouseId: true,
          warehouse: { select: { id: true, code: true, kind: true, workshopId: true } },
        },
      }),
      this.prisma.stockReservation.findMany({
        where: { productionInvoiceId, materialId: { in: materialIds }, status: 'ACTIVE' },
        select: { materialId: true, quantity: true, consumedQty: true },
      }),
    ]);

    // Đợt 7: tồn vật lý đọc ở kho Phôi của xưởng làm lệnh (không ở kho mặc định của vật tư).
    const resolver = new WorkshopWarehouseResolver(this.prisma);
    for (const m of materials) {
      if (m.warehouse) {
        m.warehouseId = (await resolver.resolveForPi(m.warehouse, productionInvoiceId)).id;
      }
    }
    const warehouseIdByMaterial = new Map(materials.map((m) => [m.id.toString(), m.warehouseId]));

    const remainingByMaterial = new Map<string, number>();
    for (const r of reservations) {
      const key = r.materialId.toString();
      const remaining = Math.max(0, r.quantity.toNumber() - r.consumedQty.toNumber());
      remainingByMaterial.set(key, (remainingByMaterial.get(key) ?? 0) + remaining);
    }

    const warehouseIds = [
      ...new Set(materials.map((m) => m.warehouseId).filter((id): id is bigint => id != null)),
    ];
    const quants =
      warehouseIds.length > 0
        ? await this.prisma.stockQuant.findMany({
            where: { warehouseId: { in: warehouseIds }, materialId: { in: materialIds } },
            select: { warehouseId: true, materialId: true, stockLengthMm: true, qty: true },
          })
        : [];
    // Cộng dồn theo (warehouse, material, chiều dài) - KHÔNG ghi đè, vì 1 material có thể có nhiều
    // dòng khác stockLengthMm (khác PI/thời điểm mua).
    const quantByKey = new Map<string, number>();
    for (const q of quants) {
      const k = `${q.warehouseId}:${q.materialId}:${q.stockLengthMm}`;
      quantByKey.set(k, (quantByKey.get(k) ?? 0) + q.qty.toNumber());
    }

    for (const materialId of materialIds) {
      const key = materialId.toString();
      const warehouseId = warehouseIdByMaterial.get(key) ?? null;
      const length = requiredByMaterial.get(key)?.bestStockLengthMm ?? null;
      let physicalStockQty: number | null = null;
      if (warehouseId != null) {
        if (length != null) {
          physicalStockQty = quantByKey.get(`${warehouseId}:${materialId}:${length}`) ?? 0;
        } else {
          let sum = 0;
          const prefix = `${warehouseId}:${materialId}:`;
          for (const [k, qty] of quantByKey) {
            if (k.startsWith(prefix)) sum += qty;
          }
          physicalStockQty = sum;
        }
      }
      const physicalByLength = new Map<number, number>();
      if (warehouseId != null) {
        for (const len of requiredByMaterial.get(key)?.barsByLength.keys() ?? []) {
          physicalByLength.set(len, quantByKey.get(`${warehouseId}:${materialId}:${len}`) ?? 0);
        }
      }
      result.set(key, {
        remainingToIssue: remainingByMaterial.has(key) ? remainingByMaterial.get(key)! : null,
        physicalStockQty,
        physicalByLength,
      });
    }
    return result;
  }

  /**
   * B4 Đợt 3d: xác thực vật tư client chọn khi xuất thật sự thuộc định mức (BOM) của BẤT KỲ mảnh
   * nào trong PI này - không còn xác thực theo 1 mảnh cụ thể (client không còn khai mảnh khi
   * xuất, xem CreateSteelIssueDto).
   */
  private async assertMaterialUsedInInvoice(
    orders: OrderForBom[],
    materialId: bigint,
    invoiceId: bigint,
  ): Promise<void> {
    if (orders.length === 0) {
      throw new NotFoundException(
        `Production invoice ${invoiceId} chưa có lệnh sản xuất nào được duyệt`,
      );
    }
    const bomRevisionIds = [...new Set(orders.map((o) => o.bomRevisionId))];
    const pieceBoms = await this.prisma.pieceBom.findMany({
      where: { bomRevisionId: { in: bomRevisionIds } },
      include: { segmentSpec: true },
    });
    const materialIds = new Set(pieceBoms.map((pb) => pb.segmentSpec.materialId));
    if (!materialIds.has(materialId)) {
      throw new BadRequestException(
        `Vật tư ${materialId} không thuộc định mức (BOM) của PI ${invoiceId} - chọn đúng 1 trong các loại sắt đang dùng (${[...materialIds].join(', ')})`,
      );
    }
  }

  /**
   * Phương án cắt đã duyệt phủ vật tư này chưa - tính CẢ 2 kiểu neo:
   * - neo thẳng vào PI này (đợt gộp, CuttingProposal.productionInvoiceId), hoặc
   * - neo vào 1 trong các PO thành viên (SKU cắt riêng, đường mặc định).
   *
   * B4 Đợt 2: giờ TRẢ VỀ luôn `cuttingProposal` (id + approvedAt) thay vì chỉ assert/throw - cần
   * `approvedAt` để biết phương án này thuộc "trước" hay "sau" STEEL_ISSUE_RESERVATION_CUTOVER, và
   * cần `id` để tìm đúng StockReservation tương ứng (refType=CUTTING_PROPOSAL, refId=id đó).
   */
  /**
   * Chỉ còn vai trò GUARD (đảm bảo tồn tại ≥1 phương án cắt đã duyệt và cắt được cho vật tư này
   * trong PI) + xác định mốc cutover - KHÔNG còn trả `cuttingProposalId` (L5, 2026-08-26): giữ
   * chỗ giờ tra theo pool của productionInvoiceId (đã có sẵn ở caller, xem
   * StockReservationsService.drainPool), không cần chọn ra 1 phương án cụ thể nữa - loại bỏ hẳn
   * lựa chọn NGẪU NHIÊN cũ của `findFirst` (không orderBy) từng là nguồn gây lệch với
   * PurchaseProposal.cuttingProposalId ở receiveItem() (lỗ #5).
   */
  private async assertMaterialInApprovedProposal(
    productionInvoiceId: bigint,
    productionOrderIds: bigint[],
    materialId: bigint,
  ): Promise<{
    approvedAt: Date | null;
    stockLengthsMm: number[];
    requiredBarsByLength: Map<number, number>;
    usesLeftover: boolean;
  }> {
    const where: Prisma.CuttingProposalLineWhereInput = {
      materialId,
      // `feasible: true` là BẮT BUỘC, không thừa: saveSuccess() tạo dòng cho MỌI vật tư solver
      // trả về, kể cả loại nó báo không cắt được (feasible=false, không có pattern nào). Thiếu
      // điều kiện này thì Phôi được phép xuất sắt cho đúng loại không có phương án cắt để làm
      // theo - mà loại đó cũng bị approve() loại khỏi đề xuất mua nên còn chẳng có sắt để xuất.
      feasible: true,
      cuttingProposal: {
        status: CuttingProposalStatus.APPROVED,
        OR: [
          { productionInvoiceId },
          // Huỷ lệnh theo SKU (23/11/2026): phương án neo SKU đã huỷ không còn cho xuất sắt (cùng getIssuePlan).
          ...(productionOrderIds.length > 0
            ? [
                {
                  productionOrderId: { in: productionOrderIds },
                  productionOrder: NOT_CANCELLED_ORDER,
                },
              ]
            : []),
        ],
      },
    };
    const line = await this.prisma.cuttingProposalLine.findFirst({
      where,
      select: { cuttingProposal: { select: { approvedAt: true } } },
    });
    if (!line) {
      throw new ConflictException(
        `Chưa có phương án cắt (CuttingProposal) đã duyệt và cắt được cho vật tư ${materialId} của PI ${productionInvoiceId} - chưa thể xuất sắt`,
      );
    }
    // CS2 (20/11): chiều dài theo TỪNG kiểu cắt (cây lẻ kho Phôi + cây chiều dài mua); kiểu cắt cũ chưa lưu chiều dài thì theo
    // chiều dài của dòng (1 chiều dài / (lệnh, loại sắt), findConflictingStockLengthReason() chặn từ lúc duyệt).
    const planLines = await this.prisma.cuttingProposalLine.findMany({
      where,
      select: {
        bestStockLengthMm: true,
        totalBars: true,
        patterns: { select: { stockLengthMm: true, barCount: true } },
      },
    });
    const requiredBarsByLength = new Map<number, number>();
    for (const l of planLines) {
      for (const [len, bars] of barsByStockLength(l, l.patterns)) {
        requiredBarsByLength.set(len, (requiredBarsByLength.get(len) ?? 0) + bars);
      }
    }
    // Chiều dài được xuất = chiều dài các kiểu cắt; chỉ khi không tách được số cây nào (dòng thiếu số cây) mới rơi về chiều dài mua.
    const purchaseLengths = new Set(
      planLines.map((l) => l.bestStockLengthMm).filter((v): v is number => v != null),
    );
    const stockLengthsMm = (
      requiredBarsByLength.size > 0 ? [...requiredBarsByLength.keys()] : [...purchaseLengths]
    ).sort((x, y) => x - y);
    // Có kiểu cắt dùng cây lẻ kho Phôi (chiều dài khác chiều dài mua của dòng).
    const usesLeftover = [...requiredBarsByLength.keys()].some((len) => !purchaseLengths.has(len));
    return {
      approvedAt: line.cuttingProposal.approvedAt,
      stockLengthsMm,
      requiredBarsByLength,
      usesLeftover,
    };
  }

  private async findInvoiceOrThrow(id: string) {
    const bigId = parseBigIntId(id);
    const invoice = await this.prisma.productionInvoice.findUnique({ where: { id: bigId } });
    if (!invoice) {
      throw new NotFoundException(`Không tìm thấy lệnh sản xuất ${id}`);
    }
    return invoice;
  }

  /** Mọi ProductionOrder (đã duyệt) thuộc 1 PI - 1 PI có thể có nhiều SKU/PO khác bomRevisionId
   *  (xem memory project_pi_multi_sku_multi_po). */
  private async findOrdersForInvoice(productionInvoiceId: bigint): Promise<OrderForBom[]> {
    return this.prisma.productionOrder.findMany({
      where: { productionInvoiceItem: { productionInvoiceId } },
      select: { id: true, bomRevisionId: true, quantity: true, floorStage: true, status: true },
    });
  }

  /**
   * QLSX phải bấm "Bắt đầu" cho ÍT NHẤT 1 SKU trong PI trước khi kho được xuất sắt (2026-08-31,
   * đồng bộ với luồng Hàn/Sơn/Phôi/vật tư/KCS - xem common/utils/floor-gate.util.ts). Không dùng
   * hàm dùng chung assertPiHasActiveFloor() ở đây vì `orders` đã fetch sẵn từ
   * findOrdersForInvoice() ngay phía trên - kiểm tra thẳng trong mảng đó rẻ hơn (và đồng bộ) so
   * với query lại `productionOrder.findFirst` 1 lần nữa. Không bắt buộc CHÍNH SKU đang xuất sắt
   * phải ACTIVE - PI cắt sắt CHUNG cho mọi SKU trong đó, không tách được theo từng SKU (cùng lý do
   * PiListBoard/activeOnly gộp theo PI thay vì theo SKU).
   */
  private assertOrdersHaveActiveFloor(orders: OrderForBom[], productionInvoiceId: bigint): void {
    // PI chưa có ProductionOrder nào (chưa Sếp duyệt SKU nào) - để assertMaterialUsedInInvoice()
    // ngay sau ném NotFoundException rõ nghĩa hơn ("chưa có lệnh sản xuất nào"), không lấn sang
    // thông báo "chưa Bắt đầu" (dễ hiểu nhầm là ĐÃ có lệnh, chỉ thiếu mỗi bước Bắt đầu).
    if (orders.length === 0) return;
    if (!orders.some((o) => o.floorStage === ProductionOrderFloorStage.ACTIVE)) {
      throw new ConflictException(
        `PI ${productionInvoiceId} chưa có SKU nào được QLSX bấm "Bắt đầu" ở Bảng thống kê - chưa thể xuất sắt`,
      );
    }
  }

  private async findOneOrThrow(id: string): Promise<SteelIssueRow> {
    const bigId = parseBigIntId(id);
    const issue = await this.prisma.steelIssue.findUnique({
      where: { id: bigId },
      include: STEEL_ISSUE_INCLUDE,
    });
    if (!issue) {
      throw new NotFoundException(`Không tìm thấy phiếu xuất sắt ${id}`);
    }
    return issue;
  }

  private async findDetailOrThrow(id: string): Promise<SteelIssueDetail> {
    const bigId = parseBigIntId(id);
    const issue = await this.prisma.steelIssue.findUnique({
      where: { id: bigId },
      include: STEEL_ISSUE_DETAIL_INCLUDE,
    });
    if (!issue) {
      throw new NotFoundException(`Không tìm thấy phiếu xuất sắt ${id}`);
    }
    return issue;
  }

  /** `requiredSteps` truyền từ ngoài (suy theo PI+vật tư của lô cha, xem resolveRequiredSteps) -
   *  bundle row không tự biết. Để trống khi caller không cần (vd lịch sử đợt đã nhập). */
  private toBundleResponseDto(
    bundle: Omit<SteelIssueDetail['bundles'][number], 'floorReports'> & {
      floorReports?: SteelIssueDetail['bundles'][number]['floorReports'];
    },
    requiredSteps: ProcessStep[] = [],
  ): CutBundleResponseDto {
    const reportedByNames = [
      ...new Set(
        (bundle.floorReports ?? [])
          .filter((r) => !r.reversedBy)
          .map((r) => userName(r.reportedBy))
          .filter((n): n is string => !!n),
      ),
    ];
    return new CutBundleResponseDto({
      reportedByNames,
      id: bundle.id.toString(),
      steelIssueId: bundle.steelIssueId.toString(),
      proposalPatternId: bundle.proposalPatternId?.toString() ?? null,
      isOffPlan: bundle.proposalPatternId === null,
      barCount: bundle.barCount,
      mauNguyenMm: bundle.mauNguyenMm,
      scrapMm: bundle.scrapMm,
      status: bundle.status,
      completedSteps: bundle.completedSteps,
      requiredSteps,
      completedAt: bundle.completedAt,
      createdAt: bundle.createdAt,
      productionOrderId: bundle.productionOrderId?.toString() ?? null,
      segments: bundle.segments.map(
        (s) =>
          new CutPatternSegmentResponseDto({
            segmentSpecId: s.segmentSpecId.toString(),
            cutLengthMm: Number(s.segmentSpec.cutLengthMm),
            qty: s.qty,
          }),
      ),
    });
  }

  /** Gộp segments của mọi StepBatch đã gom vào 1 StepBundle (Σ theo segmentSpecId) - dùng cho cả
   *  submitStepBundle() (1 bundle, ngay sau submit) lẫn findStepBundlesForInvoice()/
   *  findAllStepBundles() (N bundle, cho danh sách). */
  private toStepBundleResponseDto(
    bundle: {
      id: bigint;
      productionInvoiceId: bigint;
      materialId: bigint;
      step: ProcessStep;
      status: StepBundleStatus;
      submittedAt: Date;
      submittedById: string;
      productionOrderId: bigint | null;
    },
    batches: {
      segments: {
        segmentSpecId: bigint;
        qty: number;
        segmentSpec: { cutLengthMm: Prisma.Decimal };
      }[];
    }[],
    material: { name: string; spec: string | null; code: string },
  ): StepBundleResponseDto {
    const bySpec = new Map<string, { cutLengthMm: number; qty: number }>();
    for (const batch of batches) {
      for (const seg of batch.segments) {
        const key = seg.segmentSpecId.toString();
        const cur = bySpec.get(key);
        bySpec.set(key, {
          cutLengthMm: seg.segmentSpec.cutLengthMm.toNumber(),
          qty: (cur?.qty ?? 0) + seg.qty,
        });
      }
    }
    return new StepBundleResponseDto({
      id: bundle.id.toString(),
      productionInvoiceId: bundle.productionInvoiceId.toString(),
      materialId: bundle.materialId.toString(),
      materialCode: material.code,
      materialName: this.materialLabel(material),
      step: bundle.step,
      status: bundle.status,
      submittedAt: bundle.submittedAt,
      submittedById: bundle.submittedById,
      productionOrderId: bundle.productionOrderId?.toString() ?? null,
      segments: [...bySpec.entries()].map(
        ([segmentSpecId, v]) =>
          new StepBundleSegmentResponseDto({
            segmentSpecId,
            cutLengthMm: v.cutLengthMm,
            qty: v.qty,
          }),
      ),
    });
  }

  /**
   * "Tên hiển thị" của 1 vật tư = ghép `Material.name` (tên loại, vd "Sắt hộp") với `Material.spec`
   * (quy cách, vd "25x50") thành "Sắt hộp 25x50" (2026-09-07, theo yêu cầu người dùng) - trước đây
   * mọi nơi chỉ hiện `material.name` suông, dữ liệu cũ phải tự nhét quy cách vào thẳng cột `name`
   * ("Sắt hộp 25x50") mới hiện đủ, khiến `name`/`spec` tách rời vô nghĩa dù DB đã có sẵn 2 cột
   * riêng. `spec` rỗng (vật tư không phải Sắt, vd phụ kiện) thì chỉ hiện `name`, không thêm dấu
   * cách thừa.
   */
  private materialLabel(material: { name: string; spec: string | null }): string {
    return material.spec ? `${material.name} ${material.spec}` : material.name;
  }

  private toResponseDto(issue: SteelIssueRow, requiredSteps: ProcessStep[]): SteelIssueResponseDto {
    return new SteelIssueResponseDto({
      id: issue.id.toString(),
      productionInvoiceId: issue.productionInvoiceId.toString(),
      piCode: issue.productionInvoice.code,
      salesOrderCode: issue.productionInvoice.salesOrder?.orderCode ?? null,
      materialId: issue.materialId.toString(),
      materialCode: issue.material.code,
      materialName: this.materialLabel(issue.material),
      barLengthMm: issue.barLengthMm,
      barCount: issue.barCount,
      status: issue.status,
      actualBarCount: issue.actualBarCount,
      receivedBarCount: issue.receivedBarCount,
      receivedAt: issue.receivedAt,
      receivedByName: userName(issue.receivedBy),
      issuedAt: issue.issuedAt,
      issuedById: issue.issuedById,
      completedAt: issue.completedAt,
      reworkOfId: issue.reworkOfId?.toString() ?? null,
      completedSteps: issue.completedSteps,
      requiredSteps,
    });
  }
}
