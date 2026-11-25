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
  FloorReportKind,
  MfgRole,
  MfgStage,
  PieceStepBundleStatus,
  Prisma,
  ProcessStep,
  ProductionBatchStatus,
  ProductionOrder,
  SegmentOverageKind,
  StockLedgerRefType,
  WarehouseKind,
  TransferStatus,
} from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { lockBusinessKey, lockBusinessKeyShared } from '../../common/utils/advisory-lock.util';
import {
  FLOOR_REPORT_REVERSED_REPLAY_MESSAGE,
  FloorReportContext,
  FloorReportReplayExpected,
  assertFloorReportReplayMatches,
  findFloorReportByKey,
  isIdempotencyConflict,
  writeFloorReport,
} from '../../common/utils/floor-report.util';
import {
  IdempotencyKeyInUseException,
  lockIdempotencyKey,
} from '../../common/utils/idempotency.util';
import { ProcessStepValue, sortProcessSteps } from '../../common/constants/process-steps.constant';
import {
  assertItemPiHasActiveFloor,
  assertItemPiHasActiveFloorLocked,
  isOrderCancelledById,
} from '../../common/utils/floor-gate.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { NOT_CANCELLED_ORDER } from '../../common/utils/cancelled-order.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { MaterialYieldIssuesService } from '../material-yield-issues/material-yield-issues.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { WorkshopWarehouseResolver } from '../stock/workshop-warehouse.util';
import { SegmentStockService } from '../segment-stock/segment-stock.service';
import {
  isSegmentStockEnabled,
  SEGMENT_LEGACY_CONVERSION_LOCK,
} from '../segment-stock/segment-stock.config';
import {
  compareSegmentCodes,
  normalizeSegmentSteps,
  segmentCodeKey,
} from '../../common/utils/segment-code.util';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { CreatePieceStepBatchDto } from './dto/create-piece-step-batch.dto';
import { CreateProductionBatchDto } from './dto/create-production-batch.dto';
import { ListPieceStepBundlesQueryDto } from './dto/list-piece-step-bundles-query.dto';
import { ListProductionBatchesQueryDto } from './dto/list-production-batches-query.dto';
import { PieceStepBatchResponseDto } from './dto/piece-step-batch-response.dto';
import { ProductionBatchMaterialYieldItemResponseDto } from './dto/production-batch-material-yield-item-response.dto';

/** Đơn vị tính vật tư thành phẩm không gắn mảnh: đủ trường để tính nhu cầu và phân bổ theo PI. */
interface MaterialYieldPlanOrder {
  id: bigint;
  bomRevisionId: bigint;
  quantity: number;
  productionInvoiceId: bigint | null;
}
import { PieceStepBundleResponseDto } from './dto/piece-step-bundle-response.dto';
import { PieceStepProgressDto } from './dto/piece-step-progress.dto';
import { ProductionBatchPlanItemResponseDto } from './dto/production-batch-plan-item-response.dto';
import { ProductionBatchPlanResponseDto } from './dto/production-batch-plan-response.dto';
import { ProductionBatchResponseDto } from './dto/production-batch-response.dto';
import { SubmitPieceStepDto } from './dto/submit-piece-step.dto';
import { PIECE_TRANSFER_LEAVES_FRAME } from '../warehouse-transfers/transfer-routes.constant';
import { processStepLabel } from '../../common/constants/process-steps.constant';

/** Gộp 3 thứ cần cho mỗi piece có PieceMaterialYield ở stage=PHOI trong 1 lần tra bảng
 *  piece_material_yield (thay vì 3 hàm rời nhân round-trip DB): tồn nguyên liệu thô, công đoạn đã
 *  khai (chuẩn hoá thứ tự), tỉ lệ miếng/mảnh cho FE hiện phụ chú. */
type PieceMaterialYieldExtras = {
  rawMaterialOnHand: number;
  processSteps: ProcessStepValue[];
  qtyPerPiece: number | null;
};

const PRODUCTION_BATCH_INCLUDE = {
  productionOrder: {
    include: {
      productionInvoiceItem: {
        select: {
          salesOrder: { select: { orderCode: true } },
          productionInvoice: { select: { code: true } },
        },
      },
    },
  },
  piece: true,
} satisfies Prisma.ProductionBatchInclude;

export type ProductionBatchRow = Prisma.ProductionBatchGetPayload<{
  include: typeof PRODUCTION_BATCH_INCLUDE;
}>;

const PIECE_STEP_BUNDLE_INCLUDE = {
  productionOrder: {
    include: {
      productionInvoiceItem: {
        select: {
          salesOrder: { select: { orderCode: true } },
          productionInvoice: { select: { code: true } },
        },
      },
    },
  },
  piece: true,
} satisfies Prisma.PieceStepBundleInclude;

export type PieceStepBundleRow = Prisma.PieceStepBundleGetPayload<{
  include: typeof PIECE_STEP_BUNDLE_INCLUDE;
}>;

/// Kho của đoạn sắt tồn (đoạn Phôi cắt ra, thủ kho tự đếm/tự nhập qua POST /stock-ledger/adjust - xem
/// docs/quy-doi-doan-phoi.md). Đoạn sắt không phải Material nên không có warehouseId - từ Đợt 7 lấy kho Phôi của XƯỞNG
/// LÀM LỆNH (phoiWarehouseCodeOfOrder), trước đó theo scope người báo.
/// Kho ảo cố định (protected-warehouse-codes.constant.ts) - cùng điểm đến dùng ở
/// MaterialIssuesService/CuttingProposalsService cho mọi luồng "tiêu hao tại xưởng".
const PRODUCTION_WAREHOUSE_CODE = 'PRODUCTION';

/**
 * Lỗi KCS cộng dồn của mảnh Phôi có khai công đoạn (vd pat: Cắt -> Dập), chấm theo PieceStepBundle chứ không qua
 * ProductionBatch (đợt chốt tự sinh không có QcReview). Cộng MỌI công đoạn: mảnh hỏng ở công đoạn nào cũng là 1 mảnh phải
 * làm lại (Cắt lỗi 3, Dập lỗi 2 -> thiếu đúng 5). `failedByStep` khoá `<lệnh>:<mảnh>:<công đoạn>`. 18/11/2026.
 * P1: dùng chung cho cả số THIẾU (shortQty) - truyền map `short` thay cho map `failed`; hai số không bao giờ cộng vào nhau.
 */
function sumStepFailed(
  failedByStep: Map<string, number>,
  orderPieceKey: string,
  processSteps: readonly string[],
): number {
  return processSteps.reduce(
    (s, step) => s + (failedByStep.get(`${orderPieceKey}:${step}`) ?? 0),
    0,
  );
}

/** Nhãn tổ cho câu lỗi người dùng thấy. */
function stageLabelVi(stage: MfgStage): string {
  return stage === MfgStage.HAN ? 'Hàn' : stage === MfgStage.SON ? 'Sơn' : 'Phôi';
}

/**
 * Báo sản lượng Hàn/Sơn (M2, thay san-luong.service.ts mock - phần baoSanLuong()). Append-create,
 * không state machine phức tạp: chỉ AWAITING_QC (khởi tạo) -> QC_DONE (do QcReviewsService cập nhật,
 * không phải service này).
 *
 * P1 (18/11/2026): lúc báo CÓ chặn vượt - Σ reportedQty mọi trạng thái của (lệnh, mảnh, tổ) không được quá
 * qtyPerUnit × SL lệnh (số đợt KCS chấm lỗi / ghi thiếu đã bị trừ vào reportedQty nên được báo bù). Chặn trong khoá
 * production-batch-open để 2 người báo cùng lúc không cùng lọt.
 *
 * Từ 2026-08-14 (xem docs/quy-doi-doan-phoi.md, quyết định nghiệp vụ #4): sản lượng Hàn / Sơn trừ tồn ĐOẠN sắt
 * (segmentSpecId) theo PieceBom.qtyPerPiece - refType SEGMENT_CONSUME. P1: việc trừ dời sang LÚC KCS CHẤM
 * (consumeSegmentsAtReviewInTx, số = báo - thiếu), không còn trừ lúc báo / chốt. Cố ý KHÔNG chặn khi tồn đoạn không
 * đủ - thiếu thì ghi Sổ báo vượt đoạn (StockQuant được phép âm ở cách trừ cũ), tránh chặn oan công nhân vì thủ kho nhập
 * tồn trễ hơn thực tế cắt.
 */
@Injectable()
export class ProductionBatchesService {
  private readonly logger = new Logger(ProductionBatchesService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly stockLedgerService: StockLedgerService,
    private readonly materialYieldIssuesService: MaterialYieldIssuesService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly segmentStock: SegmentStockService,
  ) {}

  /** Phát realtime SAU KHI transaction đã commit (xem RealtimeService). */
  private publishRealtime(
    entityId: bigint | string,
    action: 'CREATED' | 'PROGRESS' | 'FINISHED',
    actorId: string | null,
    productionOrderId: bigint | string,
  ): void {
    this.realtime.publishEntityChanged({
      entity: 'PRODUCTION_BATCH',
      entityId,
      action,
      actorId,
      parentId: productionOrderId,
    });
  }

  /**
   * Báo QLSX khi đợt Hàn / Sơn vừa ghi sổ báo vượt đoạn (quyết định 14/11). P1: việc trừ đoạn xảy ra LÚC KCS CHẤM
   * (consumeSegmentsAtReviewInTx) nên người gọi là QcReviewsService, SAU khi transaction chấm commit; `actorId` = KCS vừa chấm.
   * dedupeKey theo đợt nên gọi lại chỉ cập nhật 1 thông báo. Công tắc tắt hoặc đợt không có dòng chưa đóng -> không gửi.
   * Best-effort: lỗi chỉ log.
   */
  async afterReviewCommitted(batchId: bigint, actorId: string | null): Promise<void> {
    if (!isSegmentStockEnabled()) return;
    try {
      const rows = await this.prisma.segmentOverage.findMany({
        where: { productionBatchId: batchId, resolvedAt: null },
        select: {
          stage: true,
          shortageQty: true,
          extraQty: true,
          extraKind: true,
          productionInvoice: { select: { code: true } },
          productionBatch: { select: { piece: { select: { code: true } } } },
        },
      });
      if (rows.length === 0) return;
      const sum = (f: (r: (typeof rows)[number]) => number) =>
        Math.round(rows.reduce((n, r) => n + f(r), 0) * 1e4) / 1e4;
      await this.notifications.emit('SEGMENT_OVERAGE_REPORTED', {
        entityId: batchId.toString(),
        actorId: actorId ?? undefined,
        dedupeKey: `SEGMENT_OVERAGE_REPORTED:${batchId}`,
        params: {
          piCode: rows[0].productionInvoice.code,
          pieceCode: rows[0].productionBatch.piece.code,
          stageLabel: rows[0].stage === MfgStage.SON ? 'Sơn' : 'Hàn',
          shortageQty: sum((r) => Number(r.shortageQty)),
          extraQty: sum((r) => Number(r.extraQty)),
          rework: rows.some((r) => r.extraKind === SegmentOverageKind.REWORK),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to create SEGMENT_OVERAGE_REPORTED notification (batch ${batchId}): ${(error as Error).message}`,
      );
    }
  }

  /** Best-effort NGOÀI transaction - cùng lý do kỹ thuật đã ghi ở nhiều nơi khác (mục 15.2/16.2/
   *  17.2/19.2 changelog notification). */
  private async notifyBatchToKcs(entityId: bigint, params: Record<string, unknown>): Promise<void> {
    try {
      await this.notifications.emit('BATCH_TO_KCS', { entityId: entityId.toString(), params });
    } catch (error) {
      this.logger.error(
        `Failed to create BATCH_TO_KCS notification (entity ${entityId}): ${(error as Error).message}`,
      );
    }
  }

  async create(
    productionOrderId: string,
    dto: CreateProductionBatchDto,
    reportedById: string,
    callerMfgRole: string | null,
    warehouseScope: string | null,
    idempotencyKey?: string,
  ): Promise<ProductionBatchResponseDto> {
    this.assertConsumableStage(dto.stage);
    this.assertMfgRoleMatchesStage(callerMfgRole, dto.stage);
    // P1: không còn trừ tồn đoạn ở đây (dời sang lúc KCS chấm) nên không cần mã kho Phôi của xưởng, cũng không cần scope.
    void warehouseScope;

    if (idempotencyKey) {
      const existing = await this.prisma.productionBatch.findUnique({
        where: { idempotencyKey },
        include: PRODUCTION_BATCH_INCLUDE,
      });
      if (existing) return this.toResponseDto(existing);
    }

    const order = await this.findOrderOrThrow(productionOrderId);
    await assertItemPiHasActiveFloor(this.prisma, order.productionInvoiceItemId, 'báo sản lượng');
    const pieceBigId = parseBigIntId(dto.pieceId);
    await this.assertPieceInBom(order.bomRevisionId, pieceBigId, dto.stage);
    await this.assertMaterialYieldReceived(order.bomRevisionId, pieceBigId, order.id, dto.stage);

    // P1 (MF3): khoá advisory production-batch-open là khoá nghiệp vụ ĐẦU TIÊN của transaction (cùng thứ tự recordProductionBatch;
    // ở đó khoá chống trùng, nếu có khoá, còn đi trước nó) -
    // FOR UPDATE production_orders của assertItemPiHasActiveFloorLocked lấy SAU, nên không khoá chéo với báo QR / KCS chấm.
    // Timeout 20 giây giữ như trước (DB pooled ở xa, transaction mặc định 5 giây dễ hết hạn - lỗi 500 "Database error").
    const created = await this.prisma.$transaction(
      async (tx) => {
        await lockBusinessKey(tx, `production-batch-open:${order.id}:${pieceBigId}:${dto.stage}`);
        await assertItemPiHasActiveFloorLocked(tx, order.productionInvoiceItemId, 'báo sản lượng');
        await this.assertPieceReportWithinPlanInTx(
          tx,
          order.id,
          pieceBigId,
          dto.stage,
          dto.reportedQty,
        );

        const batch = await tx.productionBatch.create({
          data: {
            stage: dto.stage,
            productionOrderId: order.id,
            pieceId: pieceBigId,
            reportedQty: dto.reportedQty,
            reportedById,
            idempotencyKey,
          },
          include: PRODUCTION_BATCH_INCLUDE,
        });
        return batch;
      },
      { timeout: 20_000 },
    );

    const response = this.toResponseDto(created);
    response.overPlanWarning = null;
    return response;
  }

  /**
   * "Lưu đợt" (2026-09-08, theo yêu cầu người dùng "giống Phôi") - mirror NewCutBundleForm bên Sắt:
   * tích luỹ reportedQty vào 1 ProductionBatch đang OPEN (tối đa 1 dòng OPEN tại 1 thời điểm cho
   * đúng (order, piece, stage), mirror "luôn tối đa 1 đợt CUTTING") thay vì tạo dòng AWAITING_QC
   * ngay như create()/reportProductionBatch() cũ. Ban đầu (2026-09-08 lần 1) CHỈ nhận PHOI (VTTP
   * ChotPanel) - mở rộng NHẬN CẢ 3 stage (2026-09-09, đồng bộ Hàn/Sơn theo yêu cầu người dùng) -
   * validate y hệt create() (assertConsumableStage/assertMfgRoleMatchesStage/assertPieceInBom/
   * assertMaterialYieldReceived, hàm sau tự no-op ngoài PHOI). Chốt (finishProductionBatch(), KCS bấm "Chấm" hoặc tài khoản
   * thống kê bấm "Gửi KCS") mới đóng batch + chuyển AWAITING_QC; tồn đoạn sắt chỉ bị trừ lúc KCS chấm
   * (consumeSegmentsAtReviewInTx), không trừ ở đây cũng không trừ lúc chốt. P1 (18/11/2026): CHẶN vượt - trong khoá
   * production-batch-open, Σ reportedQty mọi trạng thái của (lệnh, mảnh, tổ) + lần này không được quá qtyPerUnit × SL
   * lệnh (assertPieceReportWithinPlanInTx). Idempotency-Key: gửi lại cùng khoá thì trả đợt đã cộng, không cộng lần 2.
   */
  async recordProductionBatch(
    productionOrderId: string,
    dto: { pieceId: string; qty: number; stage: MfgStage },
    reportedById: string,
    callerMfgRole: string | null,
    idempotencyKey?: string | null,
    ctx?: FloorReportContext,
  ): Promise<ProductionBatchResponseDto> {
    this.assertConsumableStage(dto.stage);
    this.assertMfgRoleMatchesStage(callerMfgRole, dto.stage);
    // Gửi lại cùng khoá (mạng chập chờn, bấm Lưu 2 lần) -> trả đợt đã cộng, KHÔNG cộng lần 2
    // (2026-10-12; trước đây cố ý không dedup vì "chỉ cộng dư, dễ nhận ra" - nay công nhân tự báo
    // trên điện thoại ở xưởng nên trùng là chuyện thường, xem FloorReport).
    // Gửi lại: so vân tay (người, máy, mảnh, số, lệnh, tổ) trước khi trả - khác thì 422, không trả đợt của người khác (T4-4, 20/11/2026).
    const pieceBigId = parseBigIntId(dto.pieceId);
    const expected: FloorReportReplayExpected = {
      kind: FloorReportKind.PIECE,
      reportedById,
      workstationId: ctx?.workstationId,
      lines: [{ pieceId: pieceBigId, qty: dto.qty }],
      batch: {
        stage: dto.stage,
        productionOrderId: parseBigIntId(productionOrderId),
        pieceId: pieceBigId,
      },
    };
    const replay = await this.replayRecordedBatch(this.prisma, idempotencyKey, expected);
    if (replay) return replay;
    const order = await this.findOrderOrThrow(productionOrderId);
    await assertItemPiHasActiveFloor(
      this.prisma,
      order.productionInvoiceItemId,
      'ghi nhận sản lượng',
    );
    await this.assertPieceInBom(order.bomRevisionId, pieceBigId, dto.stage);
    await this.assertMaterialYieldReceived(order.bomRevisionId, pieceBigId, order.id, dto.stage);
    const piItem = await this.prisma.productionInvoiceItem.findUniqueOrThrow({
      where: { id: order.productionInvoiceItemId },
      select: { productionInvoiceId: true },
    });

    let updated: ProductionBatchRow;
    try {
      const outcome = await this.prisma.$transaction(
        async (tx) => {
          // Thứ tự khoá (T4-4): try-lock khoá chống trùng TRƯỚC (bản trùng đang chạy -> 409 ngay, không xếp hàng rồi
          // vấp "vượt"), rồi mới khoá nghiệp vụ production-batch-open (P1). Đọc lại theo khoá trong khoá: lần báo vừa
          // commit thì không ghi nữa.
          if (idempotencyKey) {
            await lockIdempotencyKey(tx, 'floor_reports', idempotencyKey);
            if (await findFloorReportByKey(tx, idempotencyKey)) return null;
          }
          await lockBusinessKey(tx, `production-batch-open:${order.id}:${pieceBigId}:${dto.stage}`);
          await assertItemPiHasActiveFloorLocked(
            tx,
            order.productionInvoiceItemId,
            'ghi nhận sản lượng',
          );
          await this.assertPieceReportWithinPlanInTx(tx, order.id, pieceBigId, dto.stage, dto.qty);

          // Mỗi công nhân 1 đợt riêng (2026-10-13, mục 20.5/22): chỉ cộng vào đợt OPEN do CHÍNH người này
          // mở (reportedById = người mở) - KCS chấm đạt/lỗi theo đợt nên biết được của ai.
          const open = await tx.productionBatch.findFirst({
            where: {
              stage: dto.stage,
              productionOrderId: order.id,
              pieceId: pieceBigId,
              status: ProductionBatchStatus.OPEN,
              reportedById,
            },
          });
          const batch = open
            ? await tx.productionBatch.update({
                where: { id: open.id },
                data: { reportedQty: open.reportedQty + dto.qty },
                include: PRODUCTION_BATCH_INCLUDE,
              })
            : await tx.productionBatch.create({
                data: {
                  stage: dto.stage,
                  productionOrderId: order.id,
                  pieceId: pieceBigId,
                  reportedQty: dto.qty,
                  reportedById,
                  status: ProductionBatchStatus.OPEN,
                },
                include: PRODUCTION_BATCH_INCLUDE,
              });
          // Sổ ghi từng lần báo (ai/lúc nào/bao nhiêu) - ProductionBatch.reportedById chỉ là người MỞ đợt,
          // các lần cộng dồn sau không còn dấu vết nếu không có dòng này.
          await writeFloorReport(tx, {
            kind: FloorReportKind.PIECE,
            reportedById,
            idempotencyKey,
            productionBatchId: batch.id,
            workstationId: ctx?.workstationId,
            productionInvoiceId: piItem.productionInvoiceId,
            lines: [{ pieceId: pieceBigId, qty: dto.qty }],
          });
          return batch;
        },
        { maxWait: 10_000, timeout: 20_000 },
      );
      if (!outcome) {
        // Lần báo cùng khoá vừa commit ở request khác: trả kết quả đó, không phát realtime / việc phụ.
        const replayInTx = await this.replayRecordedBatch(this.prisma, idempotencyKey, expected);
        if (replayInTx) return replayInTx;
        throw new IdempotencyKeyInUseException();
      }
      updated = outcome;
    } catch (e) {
      if (isIdempotencyConflict(e)) {
        const replayAfterRace = await this.replayRecordedBatch(
          this.prisma,
          idempotencyKey,
          expected,
        );
        if (replayAfterRace) return replayAfterRace;
      }
      throw e;
    }

    // Bảng mốc / "Theo lệnh" tính phần "chưa gửi KCS" là đã làm - "Lưu đợt" phải báo để các màn đó tự tải lại (test thật
    // 32.27: trước đây chỉ "Gửi KCS" mới phát). Báo QR tại máy (`ctx`) thì KHÔNG phát ở đây: FloorRealtimeInterceptor đã phát
    // FLOOR_REPORT ('floor') cho mỗi lần quét - phát thêm 'production-batches' làm màn KCS / Phôi / Hàn tải lại theo nhịp quét.
    if (!ctx) this.publishRealtime(updated.id, 'PROGRESS', reportedById, updated.productionOrderId);

    // P1: báo vượt nay bị CHẶN lúc báo (không còn chỉ cảnh báo như quyết định 2026-10-06) nên không còn gì để cảnh báo.
    const response = this.toResponseDto(updated);
    response.overPlanWarning = null;
    return response;
  }

  /**
   * Kết quả lần "Lưu đợt" đã ghi với khoá này (null = chưa có). Khoá đã dùng cho loại báo khác / người khác / nội dung
   * khác -> 422 (IdempotencyKeyReusedException, T4-4 20/11/2026; trước đây 409 hoặc trả nhầm đợt cũ).
   */
  private async replayRecordedBatch(
    client: Pick<PrismaTx, 'floorReport'>,
    idempotencyKey: string | null | undefined,
    expected: FloorReportReplayExpected,
  ): Promise<ProductionBatchResponseDto | null> {
    const prev = await findFloorReportByKey(client, idempotencyKey);
    if (!prev) return null;
    assertFloorReportReplayMatches(prev, expected);
    // QLSX đã hủy hết lần báo này (đợt bị xoá, dòng sổ còn lại nhưng không còn gắn đợt): không ghi dòng sổ mới.
    if (!prev.productionBatchId) throw new ConflictException(FLOOR_REPORT_REVERSED_REPLAY_MESSAGE);
    const batch = await this.prisma.productionBatch.findUniqueOrThrow({
      where: { id: prev.productionBatchId },
      include: PRODUCTION_BATCH_INCLUDE,
    });
    return this.toResponseDto(batch);
  }

  /**
   * Chặn báo vượt số cần của mảnh (P1, 18/11/2026) - gọi TRONG transaction, SAU khi đã lấy khoá production-batch-open
   * (đọc số cần + số đã báo ngay trong khoá nên 2 người báo cùng lúc không cùng lọt). Số cần = BomPiece.qtyPerUnit × SL lệnh;
   * số đã báo = Σ reportedQty mọi trạng thái của (lệnh, mảnh, tổ) - đợt QC_DONE đã được ghi đè bằng số đạt (báo - lỗi - thiếu),
   * nên lỗi / thiếu KCS ghi được báo bù. Số cần 0 (mảnh không có trong định mức của lệnh) -> câu "không cần theo định mức".
   */
  private async assertPieceReportWithinPlanInTx(
    tx: PrismaTx,
    orderId: bigint,
    pieceId: bigint,
    stage: MfgStage,
    qty: number,
  ): Promise<void> {
    const order = await tx.productionOrder.findUnique({
      where: { id: orderId },
      select: {
        quantity: true,
        bomRevisionId: true,
        mfgProduct: { select: { factoryCode: true } },
      },
    });
    if (!order) throw new NotFoundException(`Không tìm thấy lệnh xưởng ${orderId}`);
    const [bomPiece, agg] = await Promise.all([
      tx.bomPiece.findUnique({
        where: { bomRevisionId_pieceId: { bomRevisionId: order.bomRevisionId, pieceId } },
        select: { qtyPerUnit: true },
      }),
      tx.productionBatch.aggregate({
        where: { productionOrderId: orderId, pieceId, stage },
        _sum: { reportedQty: true },
      }),
    ]);
    const required = (bomPiece?.qtyPerUnit ?? 0) * order.quantity;
    const reported = agg._sum.reportedQty ?? 0;
    const maxNow = Math.max(0, required - reported);
    if (required > 0 && qty <= maxNow) return;

    const piece = await tx.piece.findUnique({
      where: { id: pieceId },
      select: { name: true, code: true },
    });
    const pieceLabel = piece?.name ?? piece?.code ?? `mảnh ${pieceId}`;
    const sku = order.mfgProduct.factoryCode;
    this.logger.warn(
      `Chặn báo vượt: lệnh ${orderId}, mảnh ${pieceId}, tổ ${stage}, cần ${required}, đã báo ${reported}, nhập ${qty}`,
    );
    if (required <= 0) {
      throw new BadRequestException(
        `Lệnh không cần mảnh ${pieceLabel} theo định mức - báo QLSX để KHSX / Spec kiểm định mức.`,
      );
    }
    throw new BadRequestException(
      `${pieceLabel} (SKU ${sku}, tổ ${stageLabelVi(stage)}): cần ${required} mảnh, đã báo ${reported} (đã trừ mảnh KCS chấm lỗi / ghi thiếu) - lần này báo được tối đa ${maxNow}, bạn nhập ${qty}. Đếm lại số mảnh. Số cần sai thì báo QLSX.`,
    );
  }

  /**
   * Chốt đợt - đóng batch đang OPEN, chuyển AWAITING_QC (mirror finishCutBundle() bên Sắt). P1 (18/11/2026): KCS tự bấm
   * "Chấm" (FloorReviewService.closeProductionBatch, truyền opts { notifyKcs: false, gateLabel: 'chốt để chấm' } và vai của
   * tổ, không truyền 'KCS'); tài khoản thống kê vẫn bấm "Gửi KCS" qua route cũ (opts mặc định). Sau bước này KCS chấm qua
   * QcReviewsService.reviewProductionBatch().
   *
   * KHÔNG trừ tồn đoạn sắt ở đây nữa (trước P1 trừ ở đây): việc trừ dời sang LÚC KCS CHẤM
   * (consumeSegmentsAtReviewInTx, số = báo - thiếu) vì chỉ lúc đó mới biết "Thực có". Lô đã chốt trước khi cập nhật (đã có
   * bút toán SEGMENT_CONSUME hoặc Sổ báo vượt) được bỏ qua ở bước chấm, không trừ lần 2.
   */
  async finishProductionBatch(
    id: string,
    reportedById: string,
    callerMfgRole: string | null,
    warehouseScope: string | null,
    /** allowCancelled: chỉ KCS "chốt để chấm" truyền - câu 4 (24/11/2026), lô của SKU đã huỷ vẫn chốt + chấm nốt. */
    opts: { notifyKcs?: boolean; gateLabel?: string; allowCancelled?: boolean } = {},
  ): Promise<ProductionBatchResponseDto> {
    const notifyKcs = opts.notifyKcs ?? true;
    const gateLabel = opts.gateLabel ?? 'gửi KCS';
    const batch = await this.findOneRowOrThrow(id);
    this.assertMfgRoleMatchesStage(callerMfgRole, batch.stage);
    if (batch.status !== ProductionBatchStatus.OPEN) {
      throw new ConflictException('Lô này vừa được chốt để chấm - tải lại trang.');
    }
    const kcsOnCancelled =
      opts.allowCancelled === true &&
      (await isOrderCancelledById(this.prisma, batch.productionOrderId));
    if (!kcsOnCancelled) {
      await assertItemPiHasActiveFloor(
        this.prisma,
        batch.productionOrder.productionInvoiceItemId,
        gateLabel,
      );
    }
    if (batch.reportedQty <= 0) {
      throw new BadRequestException('Lô này không còn số nào để chấm - tải lại trang.');
    }
    // P1: không còn trừ tồn đoạn ở đây nên không cần mã kho Phôi / scope người gửi.
    void warehouseScope;

    const updated = await this.prisma.$transaction(
      async (tx) => {
        // Đính chính audit độc lập 09/09 (Cao, H3) - xác nhận có thật qua test trực tiếp trên
        // server+DB dev đang chạy (12/13 lần tái hiện được, không phải ca hiếm): trước đây update()
        // vô điều kiện, KHÔNG cùng khoá với recordProductionBatch() ("Lưu đợt") - nếu 1 request
        // "Lưu đợt" đang xử lý gần như đồng thời (đã acquire lock, đã findFirst thấy OPEN, CHƯA
        // kịp ghi) thì request chốt này vẫn đóng batch bình thường, rồi request "Lưu đợt" kia
        // tiếp tục ghi tăng reportedQty lên đúng batch VỪA ĐÓNG (update theo id, không lọc status).
        // Khoá CÙNG key với recordProductionBatch() để 2 thao tác tự loại trừ lẫn nhau, rồi updateMany lọc kèm status
        // OPEN + so count - cùng idiom mọi race-guard khác trong session này.
        // Rà soát 14/11 TĐ5: khoá chuyển đổi tồn đoạn (dùng chung) TRƯỚC khoá đợt - giữ thứ tự cũ (lockBatchKeysInTx) để lượt
        // chuyển đổi (độc quyền), chốt và KCS chấm lô không khoá chéo nhau.
        await this.lockBatchKeysInTx(tx, batch);
        const { count } = await tx.productionBatch.updateMany({
          where: { id: batch.id, status: ProductionBatchStatus.OPEN, reportedQty: { gt: 0 } },
          data: { status: ProductionBatchStatus.AWAITING_QC },
        });
        if (count === 0) {
          // P1 (AC52): đọc lại trong transaction để phân biệt "QLSX vừa hủy hết số" (lô mất / còn 0) với "vừa được chốt".
          const now = await tx.productionBatch.findUnique({
            where: { id: batch.id },
            select: { reportedQty: true },
          });
          if (!now || now.reportedQty <= 0) {
            throw new ConflictException(
              'Lô này vừa bị QLSX hủy hết số - không còn gì để chấm, tải lại trang.',
            );
          }
          throw new ConflictException('Lô này vừa được chốt để chấm - tải lại trang.');
        }
        return tx.productionBatch.findUniqueOrThrow({
          where: { id: batch.id },
          include: PRODUCTION_BATCH_INCLUDE,
        });
      },
      { timeout: 20_000 },
    );
    // KCS tự chấm (notifyKcs = false) thì không báo "gửi KCS" - chính KCS vừa bấm.
    if (notifyKcs) {
      await this.notifyBatchToKcs(updated.id, {
        piCode: updated.productionOrder.productionInvoiceItem.productionInvoice?.code ?? '?',
        stage: updated.stage,
      });
    }
    this.publishRealtime(updated.id, 'FINISHED', reportedById, updated.productionOrderId);
    return this.toResponseDto(updated);
  }

  /** Đợt 7: kho Phôi của xưởng làm lệnh (đoạn sắt/mảnh của lệnh Phước An ở kho Phôi Phước An). `db` = tx khi gọi trong transaction. */
  private async phoiWarehouseCodeOfOrder(
    productionOrderId: bigint,
    db: PrismaTx = this.prisma,
  ): Promise<string> {
    const order = await db.productionOrder.findUnique({
      where: { id: productionOrderId },
      select: { productionInvoiceItem: { select: { productionInvoiceId: true } } },
    });
    const w = await new WorkshopWarehouseResolver(db).phoiWarehouseOfPi(
      order?.productionInvoiceItem.productionInvoiceId ?? null,
    );
    return w.code;
  }

  /**
   * Khoá của 1 lô mảnh, theo thứ tự cố định (MF3 - khoá advisory trước, FOR UPDATE sau cùng): khoá CHIA SẺ chuyển đổi tồn
   * đoạn (chỉ khi công tắc bật - lượt chuyển đổi giữ độc quyền) rồi `production-batch-open:{lệnh}:{mảnh}:{tổ}` (độc quyền,
   * cùng khoá với báo / hủy / chốt). Gọi lại trong cùng transaction không chờ. Người gọi (KCS chấm lô) lấy khoá này TRƯỚC khi
   * chạm dòng lô hay ô tồn đoạn.
   */
  async lockBatchKeysInTx(
    tx: PrismaTx,
    key: { productionOrderId: bigint; pieceId: bigint; stage: MfgStage },
  ): Promise<void> {
    if (isSegmentStockEnabled()) await lockBusinessKeyShared(tx, SEGMENT_LEGACY_CONVERSION_LOCK);
    await lockBusinessKey(
      tx,
      `production-batch-open:${key.productionOrderId}:${key.pieceId}:${key.stage}`,
    );
  }

  /**
   * Trừ tồn đoạn LÚC KCS CHẤM lô Hàn / Sơn (P1) - QcReviewsService gọi TRONG transaction chấm, SAU khi ghi
   * reportedQty = consumedQty (= báo - thiếu) cho lô. Tự lấy lại 2 khoá của lockBatchKeysInTx (gọi lại không chờ).
   * Bỏ qua (không trừ lần 2) khi lô ĐÃ trừ đoạn: có bút toán SEGMENT_CONSUME refId = id lô (khoá chống trùng bất kỳ: kiểu
   * cũ không có bộ công đoạn, kiểu mới, công tắc nào lúc gửi) hoặc đã có dòng Sổ báo vượt đoạn. Chưa thì trừ theo công tắc
   * (bật: theo mã đoạn + Sổ báo vượt; tắt: cách cũ). Dòng Sổ báo vượt ghi người báo của lô (reportedById), không phải KCS -
   * `actorId` (KCS) chỉ dùng khi lô thiếu người báo; tin SEGMENT_OVERAGE_REPORTED do afterReviewCommitted phát với KCS.
   */
  async consumeSegmentsAtReviewInTx(
    tx: PrismaTx,
    batchId: bigint,
    consumedQty: number,
    actorId: string,
  ): Promise<void> {
    const batch = await tx.productionBatch.findUniqueOrThrow({
      where: { id: batchId },
      select: {
        id: true,
        pieceId: true,
        productionOrderId: true,
        stage: true,
        reportedById: true,
        productionOrder: { select: { bomRevisionId: true } },
      },
    });
    await this.lockBatchKeysInTx(tx, batch);
    if (consumedQty <= 0) return;
    const [consumed, overage] = await Promise.all([
      tx.stockLedger.findFirst({
        where: { refType: StockLedgerRefType.SEGMENT_CONSUME, refId: batch.id.toString() },
        select: { id: true },
      }),
      tx.segmentOverage.findFirst({ where: { productionBatchId: batch.id }, select: { id: true } }),
    ]);
    if (consumed || overage) return;
    // Mã kho Phôi của xưởng làm lệnh tra bằng chính tx (đọc thuần) - không mở thêm kết nối ngoài transaction đang giữ khoá.
    const sourceWarehouseCode = await this.phoiWarehouseCodeOfOrder(batch.productionOrderId, tx);
    await this.postSegmentConsumeEntries(
      tx,
      {
        id: batch.id,
        pieceId: batch.pieceId,
        reportedQty: consumedQty,
        bomRevisionId: batch.productionOrder.bomRevisionId,
        stage: batch.stage,
      },
      batch.reportedById ?? actorId,
      sourceWarehouseCode,
    );
  }

  /**
   * Phôi báo "vừa {step} xong N mảnh" cho vật tư thành phẩm (PieceMaterialYield.processSteps,
   * thêm 2026-09-04) - trước khi chốt lô ProductionBatch thật qua create() để gửi KCS. Khuôn chép
   * MaterialIssuesService.create() (Idempotency-Key + $transaction + lockBusinessKey), KHÔNG chép
   * SteelIssuesService.recordStepBatch() (hàm đó thiếu cả 3 thứ này - khe TOCTOU thật khi 2 người
   * báo cùng lúc, xem comment process-steps.constant.ts).
   *
   * KHÔNG còn chặn "bước sau vượt bước liền trước" (2026-09-07, BỎ so với bản gốc 2026-09-04) -
   * quyết định nghiệp vụ của Sếp Trương Văn Nhân (chat nội bộ): "để cho đơn giản thì không cần
   * ràng buộc, cứ để thoải mái, xảy ra vấn đề mình sẽ xử lí" - công đoạn nào xong trước cứ báo
   * trước, không cần đợi công đoạn "trước" nó theo processSteps. Piece không có PieceMaterialYield
   * hoặc processSteps rỗng vẫn ⇒ BadRequest, bắt buộc dùng luồng cũ (báo thẳng qua create()) - đây
   * là biên tương thích ngược bắt buộc, KHÔNG được nới lỏng (khác hẳn ràng buộc thứ tự vừa bỏ).
   *
   * Đánh đổi đã ghi nhận (không tự dò lại được nữa sau khi bỏ chặn): mất khả năng ép "step N+1
   * không vượt step N" tại thời điểm ghi - CHỈ còn hiện CẢNH BÁO (không chặn) ở getBatchPlan() khi
   * doneQty của step sau > passedQty (qua PieceStepBundle đã QC_PASSED) của step liền trước, để
   * QLSX/KCS thấy bất thường mà tự xử lý, đúng tinh thần "xảy ra vấn đề mình xử lý" của Sếp.
   *
   * KHÔNG chặn "chốt lô mà chưa báo đủ công đoạn" ở create() - quyết định nghiệp vụ 2026-09-04,
   * cùng triết lý "không chặn oan công nhân, KCS mới là bước kiểm soát" đã lặp lại nhiều lần trong
   * module này. FE tự cảnh báo (không chặn) dựa trên stepProgress trả về từ getBatchPlan().
   *
   * P1: báo vượt số cần của công đoạn pat ĐƯỢC PHÉP (quyết định 19/11, Câu 6) - chỉ ghi log (logPieceStepOverPlanInTx),
   * giữ khoá piece-step-batch và mọi luật khác.
   */
  async recordPieceStepBatch(
    productionOrderId: string,
    dto: CreatePieceStepBatchDto,
    reportedById: string,
    callerMfgRole: string | null,
    idempotencyKey?: string,
  ): Promise<PieceStepBatchResponseDto> {
    if (dto.stage !== MfgStage.PHOI) {
      throw new BadRequestException(
        `Báo tiến độ công đoạn chỉ áp dụng cho PHOI, nhận được '${dto.stage}'`,
      );
    }
    this.assertMfgRoleMatchesStage(callerMfgRole, dto.stage);

    if (idempotencyKey) {
      const existing = await this.prisma.pieceStepBatch.findUnique({ where: { idempotencyKey } });
      if (existing) return this.toPieceStepBatchResponseDto(existing);
    }

    const order = await this.findOrderOrThrow(productionOrderId);
    await assertItemPiHasActiveFloor(this.prisma, order.productionInvoiceItemId, 'báo công đoạn');
    const pieceBigId = parseBigIntId(dto.pieceId);

    // 2026-10-03: piece có thể có NHIỀU dòng Tự tính (khác material, vd Pat vừa Tấm sắt la vừa
    // Sắt phi) - TẤT CẢ phải đã nhận, và công đoạn hợp lệ là HỢP của mọi dòng (piece báo "Cắt" 1
    // lần cho cả piece, không tách riêng theo từng material).
    const yieldRows = await this.prisma.pieceMaterialYield.findMany({
      where: { bomRevisionId: order.bomRevisionId, pieceId: pieceBigId },
    });
    if (yieldRows.length === 0) {
      throw new BadRequestException(
        `Mảnh ${dto.pieceId} không có định mức vật tư thành phẩm - không báo công đoạn ở đây`,
      );
    }
    for (const yieldRow of yieldRows) {
      const received = await this.materialYieldIssuesService.sumReceived(
        order.id,
        yieldRow.materialId,
      );
      if (received <= 0) {
        throw new BadRequestException(
          `Mảnh ${dto.pieceId} dùng vật tư thành phẩm chưa được xác nhận nhận từ kho - xác nhận nhận (Xác nhận nhận sắt) trước khi báo công đoạn`,
        );
      }
    }
    const orderedSteps = this.mergeYieldProcessSteps(yieldRows);
    if (orderedSteps.length === 0) {
      throw new BadRequestException(
        `Mảnh ${dto.pieceId} chưa khai công đoạn nào theo định mức - báo thẳng sản lượng`,
      );
    }
    if (!orderedSteps.includes(dto.step)) {
      throw new BadRequestException(
        `Mảnh ${dto.pieceId} không có công đoạn ${processStepLabel(dto.step)} theo định mức`,
      );
    }
    const created = await this.prisma.$transaction(
      async (tx) => {
        await lockBusinessKey(tx, `piece-step-batch:${order.id}:${pieceBigId}:${dto.step}`);
        await assertItemPiHasActiveFloorLocked(tx, order.productionInvoiceItemId, 'báo công đoạn');
        await this.logPieceStepOverPlanInTx(tx, order.id, pieceBigId, dto.step, dto.qty);

        return tx.pieceStepBatch.create({
          data: {
            productionOrderId: order.id,
            pieceId: pieceBigId,
            step: dto.step,
            qty: dto.qty,
            reportedById,
            idempotencyKey,
          },
        });
      },
      { maxWait: 10_000, timeout: 20_000 },
    );

    // Bảng mốc / màn Phôi tính phần báo chưa gửi KCS là đã làm - báo để các màn đó tự tải lại (cùng "Lưu đợt").
    this.publishRealtime(created.id, 'PROGRESS', reportedById, order.id);
    return this.toPieceStepBatchResponseDto(created);
  }

  /**
   * Ghi log khi báo vượt số cần của 1 công đoạn mảnh có khai công đoạn (pat) - KHÔNG chặn (quyết định 19/11, Câu 6). Gọi
   * TRONG transaction sau khoá piece-step-batch. Số cần = BomPiece.qtyPerUnit × SL lệnh; đã tính = Σ PieceStepBatch.qty - Σ (lỗi +
   * thiếu) của các lần KCS chấm đúng công đoạn này. Vượt hoặc số cần 0 -> logger.log rồi cho tạo bình thường.
   */
  private async logPieceStepOverPlanInTx(
    tx: PrismaTx,
    orderId: bigint,
    pieceId: bigint,
    step: ProcessStep,
    qty: number,
  ): Promise<void> {
    const order = await tx.productionOrder.findUnique({
      where: { id: orderId },
      select: { quantity: true, bomRevisionId: true },
    });
    if (!order) throw new NotFoundException(`Không tìm thấy lệnh xưởng ${orderId}`);
    const [bomPiece, reportedAgg, reviewAgg] = await Promise.all([
      tx.bomPiece.findUnique({
        where: { bomRevisionId_pieceId: { bomRevisionId: order.bomRevisionId, pieceId } },
        select: { qtyPerUnit: true },
      }),
      tx.pieceStepBatch.aggregate({
        where: { productionOrderId: orderId, pieceId, step },
        _sum: { qty: true },
      }),
      tx.qcReview.aggregate({
        where: { pieceStepBundle: { productionOrderId: orderId, pieceId, step } },
        _sum: { failedQty: true, shortQty: true },
      }),
    ]);
    const required = (bomPiece?.qtyPerUnit ?? 0) * order.quantity;
    const counted =
      (reportedAgg._sum.qty ?? 0) -
      (reviewAgg._sum.failedQty ?? 0) -
      (reviewAgg._sum.shortQty ?? 0);
    const maxNow = Math.max(0, required - counted);
    if (required > 0 && qty <= maxNow) return;

    // Quyết định 19/11 (Câu 6): pat được báo vượt số cần (kể cả số cần 0) - không chặn, chỉ ghi log.
    this.logger.log(
      `Báo vượt pat: lệnh ${orderId}, mảnh ${pieceId}, ${step}, cần ${required}, đã tính ${counted}, nhập ${qty} (cho phép, quyết định 19/11)`,
    );
  }

  /**
   * Phôi gom mọi PieceStepBatch CHƯA gửi (pieceStepBundleId NULL) của (order, piece, step) thành
   * 1 "đợt gửi KCS" (2026-09-07, xem PieceStepBundle doc comment) - KCS duyệt qua
   * QcReviewsService.reviewPieceStep(). KHÔNG re-validate BOM/định mức ở đây (đã validate lúc
   * recordPieceStepBatch() tạo từng dòng) - việc DUY NHẤT ở đây là gom + khoá lại các dòng đã gom,
   * cùng khuôn lockBusinessKey tránh 2 người gửi trùng lúc.
   *
   * P1 (18/11/2026): KCS cũng chốt nhóm này (FloorReviewService.closePieceStepGroup, truyền vai 'PHOI' và
   * opts.gateLabel = 'chốt để chấm' cho cổng lệnh dừng, kiểm cả ngoài lẫn trong khoá). Chỉ MỘT bên (KCS "Chấm" hoặc nút
   * "Gửi KCS" của tài khoản thống kê) chốt được cùng một nhóm: bên sau không còn dòng nào chưa gom nên nhận câu chung 400.
   * Không phát tin (pat không có tin *_TO_KCS).
   */
  async submitPieceStep(
    productionOrderId: string,
    dto: SubmitPieceStepDto,
    submittedById: string,
    callerMfgRole: string | null,
    /** allowCancelled: chỉ KCS "chốt để chấm" truyền - câu 4 (24/11/2026), pat của SKU đã huỷ vẫn chốt + chấm nốt. */
    opts: { gateLabel?: string; allowCancelled?: boolean } = {},
  ): Promise<PieceStepBundleResponseDto> {
    const gateLabel = opts.gateLabel ?? 'gửi KCS công đoạn';
    this.assertMfgRoleMatchesStage(callerMfgRole, MfgStage.PHOI);
    const order = await this.findOrderOrThrow(productionOrderId);
    const kcsOnCancelled =
      opts.allowCancelled === true && (await isOrderCancelledById(this.prisma, order.id));
    if (!kcsOnCancelled) {
      await assertItemPiHasActiveFloor(this.prisma, order.productionInvoiceItemId, gateLabel);
    }
    const pieceBigId = parseBigIntId(dto.pieceId);

    const created = await this.prisma.$transaction(
      async (tx) => {
        await lockBusinessKey(tx, `piece-step-bundle:${order.id}:${pieceBigId}:${dto.step}`);
        if (!kcsOnCancelled) {
          await assertItemPiHasActiveFloorLocked(tx, order.productionInvoiceItemId, gateLabel);
        }
        // Câu chung khi không còn lần báo nào chưa chấm (vừa được chốt bởi bên kia) - dùng mã mảnh, không id thô.
        const noPendingMessage = async (): Promise<string> => {
          const piece = await tx.piece.findUnique({
            where: { id: pieceBigId },
            select: { code: true },
          });
          return `Pat ${piece?.code ?? dto.pieceId} công đoạn ${processStepLabel(dto.step)}: không còn lần báo nào chưa chấm (có thể vừa được chốt) - tải lại trang.`;
        };

        const pending = await tx.pieceStepBatch.findMany({
          where: {
            productionOrderId: order.id,
            pieceId: pieceBigId,
            step: dto.step,
            pieceStepBundleId: null,
          },
        });
        const qty = pending.reduce((s, b) => s + b.qty, 0);
        if (qty <= 0) throw new BadRequestException(await noPendingMessage());

        const bundle = await tx.pieceStepBundle.create({
          data: {
            productionOrderId: order.id,
            pieceId: pieceBigId,
            step: dto.step,
            qty,
            submittedById,
          },
          include: PIECE_STEP_BUNDLE_INCLUDE,
        });
        // Điều kiện "chưa gom" + so số dòng: dòng nào đã bị bên khác gom thì không gom lần 2 (transaction rollback, không bundle rỗng).
        const { count } = await tx.pieceStepBatch.updateMany({
          where: { id: { in: pending.map((b) => b.id) }, pieceStepBundleId: null },
          data: { pieceStepBundleId: bundle.id },
        });
        if (count !== pending.length) throw new BadRequestException(await noPendingMessage());
        return bundle;
      },
      { maxWait: 10_000, timeout: 20_000 },
    );

    return this.toPieceStepBundleResponseDto(created);
  }

  /** Dùng bởi QcReviewsService.reviewPieceStep() - cùng idiom findOneRowOrThrow() (ProductionBatch). */
  async findOnePieceStepBundleRowOrThrow(id: string): Promise<PieceStepBundleRow> {
    const bigId = parseBigIntId(id);
    const bundle = await this.prisma.pieceStepBundle.findUnique({
      where: { id: bigId },
      include: PIECE_STEP_BUNDLE_INCLUDE,
    });
    if (!bundle) {
      throw new NotFoundException(`Không tìm thấy đợt gửi KCS ${id}`);
    }
    return bundle;
  }

  /**
   * Bỏ hẳn "Chốt & gửi KCS" thủ công cho mảnh VTTP CÓ khai processSteps (2026-09-08) - gọi từ
   * QcReviewsService.reviewPieceStep() NGAY TRONG transaction duyệt, sau khi bundle chuyển
   * QC_PASSED. Nếu step vừa duyệt là CÔNG ĐOẠN CUỐI theo processSteps (sortProcessSteps) của mảnh,
   * tự sinh thẳng ProductionBatch (stage=PHOI, status=QC_DONE - KHÔNG qua AWAITING_QC/duyệt KCS lần
   * 2 nữa) - đây là điểm sinh "sản lượng thật" DUY NHẤT cho các mảnh này (ChotPanel/reportProductionBatch
   * đã bị chặn từ recordPieceStepBatch() nếu processSteps rỗng, và FE không còn tab "Chốt & gửi KCS"
   * nữa cho mảnh có khai bước - xem VatTuTpDetail.tsx).
   *
   * Tính theo CỘNG DỒN vì công đoạn cuối có thể được gửi KCS + duyệt NHIỀU LẦN (nhiều bundle riêng,
   * vd báo dở rồi Bù đủ sau) - so tổng ĐÃ ĐẠT (QC_PASSED, trừ đúng failedQty của mỗi bundle qua
   * QcReview - "PASSED" ở PieceStepBundle nghĩa là "đã qua tay KCS", KHÔNG phải "0 lỗi", xem doc
   * comment reviewPieceStep()) của bước cuối với tổng đã sinh ProductionBatch trước đó cho đúng mảnh
   * này - chỉ sinh thêm phần CHÊNH LỆCH khi > 0, tránh sinh trùng lần gọi sau không có gì mới.
   * postSegmentConsumeEntries() KHÔNG cần gọi ở đây - đã xác nhận luôn no-op cho mảnh dùng
   * PieceMaterialYield (không có PieceBom), xem method đó.
   */
  /**
   * Đợt 7 (user chốt 09/11): ghi MẢNH vào kho khi KCS đạt ở công đoạn cuối của mảnh (trước đây mảnh không vào kho nào ở khâu sản
   * xuất - chỉ phiếu chuyển sang Phụ kiện ghi sổ, kho nguồn bị âm). Hàn và Sơn báo song song nên KHÔNG ghi mảnh chuyển từng công
   * đoạn trong cùng xưởng (không phiếu giấy) - chỉ ghi 1 lần vào kho của công đoạn cuối:
   *   - cần sơn -> kho Sơn; chỉ cần hàn -> kho Hàn của xưởng; không hàn/sơn (vật tư thành phẩm) -> kho Phôi của xưởng.
   *   - xưởng không có kho Sơn (Phước An) mà mảnh cần sơn: ghi vào kho Hàn của xưởng lúc KCS Hàn đạt; thủ kho lập phiếu chuyển
   *     Hàn Phước An -> Sơn Phú An (getPieceTransferPlan leg 'TO_PAINT'); KCS Sơn sau đó KHÔNG ghi thêm.
   * Gọi TRONG transaction duyệt KCS, ngay sau khi batch thành QC_DONE. Idempotent theo batch. Không đổi bất kỳ cách đếm nào hiện có
   * (các màn đếm mảnh theo lô QC_DONE / phiếu chuyển, không đọc tồn mảnh).
   */
  async postPieceOutputIfFinal(
    tx: PrismaTx,
    batch: { id: bigint; productionOrderId: bigint; pieceId: bigint; stage: MfgStage; qty: number },
    createdById: string,
  ): Promise<void> {
    if (batch.qty <= 0) return;
    const order = await tx.productionOrder.findUnique({
      where: { id: batch.productionOrderId },
      select: {
        bomRevisionId: true,
        productionInvoiceItem: { select: { productionInvoiceId: true } },
      },
    });
    if (!order) return;
    const bp = await tx.bomPiece.findUnique({
      where: {
        bomRevisionId_pieceId: { bomRevisionId: order.bomRevisionId, pieceId: batch.pieceId },
      },
      select: { needsHan: true, needsSon: true },
    });
    if (!bp || (!bp.needsHan && bp.needsSon)) return;
    const resolver = new WorkshopWarehouseResolver(tx);
    const workshopId = await resolver.workshopIdOfPi(
      order.productionInvoiceItem.productionInvoiceId,
    );
    let creditStage: MfgStage = !bp.needsHan
      ? MfgStage.PHOI
      : bp.needsSon
        ? MfgStage.SON
        : MfgStage.HAN;
    if (creditStage === MfgStage.SON && !(await resolver.workshopHasPaint(workshopId))) {
      creditStage = MfgStage.HAN;
    }
    if (batch.stage !== creditStage) return;
    const kind =
      creditStage === MfgStage.PHOI
        ? WarehouseKind.PHOI
        : creditStage === MfgStage.HAN
          ? WarehouseKind.HAN
          : WarehouseKind.SON;
    const target = await resolver.kindWarehouseOf(kind, workshopId);
    if (!target) {
      this.logger.warn(
        `Không có kho ${kind} cho xưởng ${workshopId ?? '-'} - bỏ qua ghi mảnh batch ${batch.id}`,
      );
      return;
    }
    const production = await tx.warehouse.findUniqueOrThrow({
      where: { code: PRODUCTION_WAREHOUSE_CODE },
    });
    await this.stockLedgerService.postEntry(
      {
        fromWarehouseId: production.id,
        toWarehouseId: target.id,
        pieceId: batch.pieceId,
        qty: batch.qty,
        refType: StockLedgerRefType.FRAME_OUTPUT,
        refId: batch.id.toString(),
        createdById,
        idempotencyKey: `piece-output:${batch.id}`,
      },
      tx,
    );
  }

  async autoFinalizePieceOutputIfLastStepComplete(
    tx: PrismaTx,
    bomRevisionId: bigint,
    productionOrderId: bigint,
    pieceId: bigint,
    step: ProcessStep,
    reportedById: string,
  ): Promise<void> {
    // 2026-10-03: piece có thể có NHIỀU dòng Tự tính - "công đoạn cuối" của piece giờ là công đoạn
    // cuối trong HỢP của mọi dòng material (mirror cách recordPieceStepBatch xác định công đoạn
    // hợp lệ).
    const yieldRows = await tx.pieceMaterialYield.findMany({ where: { bomRevisionId, pieceId } });
    if (yieldRows.length === 0) return;
    const orderedSteps = this.mergeYieldProcessSteps(yieldRows);
    if (orderedSteps.length === 0 || orderedSteps[orderedSteps.length - 1] !== step) return;

    await lockBusinessKey(tx, `piece-auto-finalize:${productionOrderId}:${pieceId}`);
    // P1: lô QC_DONE tự sinh cũng tính vào "đã báo" của mảnh Phôi (chặn vượt ở recordProductionBatch / create) nên phải loại
    // trừ với báo mảnh Phôi qua QR / thống kê - lấy khoá production-batch-open SAU piece-auto-finalize (thứ tự cố định).
    await lockBusinessKey(
      tx,
      `production-batch-open:${productionOrderId}:${pieceId}:${MfgStage.PHOI}`,
    );

    const [passedBundles, existingBatches] = await Promise.all([
      tx.pieceStepBundle.findMany({
        where: {
          productionOrderId,
          pieceId,
          step,
          status: PieceStepBundleStatus.QC_PASSED,
        },
        select: { qty: true, qcReviews: { select: { failedQty: true, shortQty: true } } },
      }),
      tx.productionBatch.findMany({
        where: { stage: MfgStage.PHOI, productionOrderId, pieceId },
        select: { reportedQty: true },
      }),
    ]);
    // Số đạt = báo - lỗi - thiếu (KCS ghi thiếu cũng là mảnh không có thật, không vào kho).
    const totalPassed = passedBundles.reduce((sum, b) => {
      const notPassed = b.qcReviews.reduce((fs, r) => fs + r.failedQty + r.shortQty, 0);
      return sum + Math.max(b.qty - notPassed, 0);
    }, 0);
    const alreadyFinalized = existingBatches.reduce((sum, b) => sum + b.reportedQty, 0);
    const delta = totalPassed - alreadyFinalized;
    if (delta <= 0) return;

    const finalized = await tx.productionBatch.create({
      data: {
        stage: MfgStage.PHOI,
        productionOrderId,
        pieceId,
        reportedQty: delta,
        reportedById,
        status: ProductionBatchStatus.QC_DONE,
      },
    });
    // Đợt 7: mảnh PHOI-cuối (vật tư thành phẩm) vào kho Phôi của xưởng.
    await this.postPieceOutputIfFinal(
      tx,
      { id: finalized.id, productionOrderId, pieceId, stage: MfgStage.PHOI, qty: delta },
      reportedById,
    );
  }

  /** Phôi xem lại bundle CỦA CHÍNH order này (mọi status) - dùng để hiện trạng thái "chờ KCS/đã
   *  duyệt/lỗi" theo từng công đoạn + tìm đúng bundleId để gọi Bù đủ (VatTuTpDetail.tsx). Không
   *  phân trang (1 order hiếm khi có quá vài chục bundle) - khác findAllPieceStepBundles() (KCS,
   *  flat, có phân trang). */
  async findPieceStepBundlesForOrder(
    productionOrderId: string,
  ): Promise<PieceStepBundleResponseDto[]> {
    const bigId = parseBigIntId(productionOrderId);
    const rows = await this.prisma.pieceStepBundle.findMany({
      where: { productionOrderId: bigId },
      include: PIECE_STEP_BUNDLE_INCLUDE,
      orderBy: { submittedAt: 'desc' },
    });
    return rows.map((r) => this.toPieceStepBundleResponseDto(r));
  }

  /** Flat, không cần productionOrderId - cùng lý do ListProductionBatchesQueryDto tồn tại (KCS
   *  không tự resolve productionOrderId được). */
  async findAllPieceStepBundles(
    query: ListPieceStepBundlesQueryDto,
  ): Promise<Paginated<PieceStepBundleResponseDto>> {
    const where: Prisma.PieceStepBundleWhereInput = {
      ...(query.status ? { status: query.status } : {}),
    };
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.pieceStepBundle.findMany({ ...args, include: PIECE_STEP_BUNDLE_INCLUDE }),
        count: (args) => this.prisma.pieceStepBundle.count(args),
      },
      query,
      where,
      { submittedAt: 'desc' as const },
    );
    return {
      data: result.data.map((r) => this.toPieceStepBundleResponseDto(r)),
      meta: result.meta,
    };
  }

  private toPieceStepBundleResponseDto(bundle: PieceStepBundleRow): PieceStepBundleResponseDto {
    return new PieceStepBundleResponseDto({
      id: bundle.id.toString(),
      productionOrderId: bundle.productionOrderId.toString(),
      poNumber: bundle.productionOrder.poNumber,
      salesOrderCode: bundle.productionOrder.productionInvoiceItem.salesOrder?.orderCode ?? null,
      piCode: bundle.productionOrder.productionInvoiceItem.productionInvoice?.code ?? null,
      pieceId: bundle.pieceId.toString(),
      pieceCode: bundle.piece.code,
      pieceName: bundle.piece.name,
      step: bundle.step,
      qty: bundle.qty,
      status: bundle.status,
      submittedAt: bundle.submittedAt,
      submittedById: bundle.submittedById,
    });
  }

  /**
   * Trừ tồn ĐOẠN sắt (StockQuant.segmentSpecId) theo PieceBom.qtyPerPiece của mảnh vừa báo sản
   * lượng - 1 dòng StockLedger/segmentSpecId (1 mảnh có thể ghép từ nhiều cỡ đoạn khác nhau).
   * idempotencyKey theo (batchId, segmentSpecId) - khác 1 key duy nhất cho cả batch, vì mỗi batch
   * có thể sinh N dòng ledger (N segmentSpecId của mảnh đó), cần key riêng từng dòng để
   * postEntry() resolve-or-return đúng khi gọi lại 1 phần đã lỡ ghi. Gọi NGOÀI transaction tạo
   * production_batch, cùng idiom MaterialIssuesService.postLedgerEntry() - retry (cùng
   * Idempotency-Key header) sẽ tìm lại đúng batch rồi gọi lại hàm này, tự resolve-or-return theo
   * key riêng từng dòng.
   */
  private async postSegmentConsumeEntries(
    tx: PrismaTx | undefined,
    batch: {
      id: bigint;
      pieceId: bigint;
      reportedQty: number;
      bomRevisionId: bigint;
      stage: MfgStage;
    },
    reportedById: string,
    sourceWarehouseCode: string,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const pieceBoms = await db.pieceBom.findMany({
      where: { bomRevisionId: batch.bomRevisionId, pieceId: batch.pieceId },
    });
    if (pieceBoms.length > 0) {
      // Mảnh cần CẢ Hàn+Sơn (BomPiece.needsHan/needsSon) báo sản lượng ở CẢ 2 stage (chạy song
      // song hoàn toàn từ lúc QLSX "Bắt đầu", dù vật lý Sơn luôn sau Hàn - xem floor-gate.util.ts),
      // nhưng đoạn sắt chỉ được LẮP RÁP (tiêu thụ thật) đúng 1 LẦN lúc Hàn - Sơn chỉ sơn lên mảnh
      // đã hàn xong, không tiêu thêm đoạn nào. Trước đây hàm này trừ tồn ở MỌI stage báo, không
      // phân biệt - mảnh cần cả 2 công đoạn bị trừ đoạn sắt 2 LẦN cho cùng 1 lượng vật lý (phát
      // hiện qua rà code 2026-09-03, chưa từng gặp qua vận hành thật). Trừ ĐÚNG 1 lần: ưu tiên Hàn
      // nếu mảnh cần Hàn (đúng lúc lắp ráp), else Sơn nếu chỉ cần Sơn (mảnh 1 đoạn, không cần hàn).
      // Mảnh không cần CẢ 2 (needsHan=false VÀ needsSon=false nhưng vẫn có PieceBom - ca hiếm, chưa
      // xác nhận có xảy ra thật) giữ nguyên hành vi cũ, trừ ở bất kỳ stage nào báo (PHOI chẳng hạn)
      // - không đủ dữ liệu để quyết định stage nào đúng cho ca này.
      const bomPiece = await db.bomPiece.findUnique({
        where: {
          bomRevisionId_pieceId: { bomRevisionId: batch.bomRevisionId, pieceId: batch.pieceId },
        },
      });
      const consumeStage = bomPiece?.needsHan
        ? MfgStage.HAN
        : bomPiece?.needsSon
          ? MfgStage.SON
          : batch.stage;
      if (batch.stage !== consumeStage) return;

      const [fromWarehouse, toWarehouse] = await Promise.all([
        db.warehouse.findUniqueOrThrow({ where: { code: sourceWarehouseCode } }),
        db.warehouse.findUniqueOrThrow({ where: { code: PRODUCTION_WAREHOUSE_CODE } }),
      ]);

      // Tồn đoạn theo lệnh (13/11/2026, bật bằng SEGMENT_STOCK_ENABLED): trừ theo MÃ ĐOẠN (cỡ + bộ công đoạn) từ phần giữ
      // của lệnh rồi tới dư; thiếu thì KHÔNG chặn, ghi sổ báo vượt. Tắt công tắc thì giữ cách trừ cũ bên dưới.
      if (isSegmentStockEnabled()) {
        const run = (t: PrismaTx) =>
          this.consumeSegmentsByCode(
            t,
            batch,
            pieceBoms,
            bomPiece?.qtyPerUnit ?? null,
            fromWarehouse.id,
            reportedById,
          );
        if (tx) await run(tx);
        else await this.prisma.$transaction(run, { timeout: 20_000 });
        return;
      }

      // 13/11/2026: từ 19/10 1 mảnh được có NHIỀU dòng định mức cùng cỡ đoạn khác công đoạn (vd "460 mm có Dập" + "460 mm
      // trơn" - processSteps nằm trong khoá duy nhất PieceBom). Khoá chống trùng bút toán theo (đợt, cỡ đoạn) nên trước đây dòng
      // thứ 2 bị coi là trùng và KHÔNG được trừ -> gộp số đoạn theo cỡ đoạn trước khi ghi.
      const qtyPerPieceBySpec = new Map<string, { segmentSpecId: bigint; qtyPerPiece: number }>();
      for (const pb of pieceBoms) {
        const key = pb.segmentSpecId.toString();
        const cur = qtyPerPieceBySpec.get(key);
        if (cur) cur.qtyPerPiece += pb.qtyPerPiece;
        else
          qtyPerPieceBySpec.set(key, {
            segmentSpecId: pb.segmentSpecId,
            qtyPerPiece: pb.qtyPerPiece,
          });
      }
      for (const pb of qtyPerPieceBySpec.values()) {
        await this.stockLedgerService.postEntry(
          {
            fromWarehouseId: fromWarehouse.id,
            toWarehouseId: toWarehouse.id,
            segmentSpecId: pb.segmentSpecId,
            qty: pb.qtyPerPiece * batch.reportedQty,
            refType: StockLedgerRefType.SEGMENT_CONSUME,
            refId: batch.id.toString(),
            createdById: reportedById,
            idempotencyKey: `production-batch-segment-consume:${batch.id}:${pb.segmentSpecId}`,
          },
          tx,
        );
      }
      return;
    }

    // Không có PieceBom (không cắt từ đoạn sắt bin-packing) = piece dùng PieceMaterialYield (vd
    // thanh nhôm → chân nhôm, tấm Sắt La → pat) - KHÔNG còn trừ tồn ở đây nữa (2026-09-04). Tồn
    // nguyên liệu thô giờ trừ NGAY LÚC THỦ KHO XUẤT (MaterialYieldIssuesService.create()), không
    // phải lúc Phôi báo sản lượng - mirror đúng cách Sắt hoạt động (SteelIssuesService.create() trừ
    // tồn lúc xuất, recordCutBatch() báo cắt không đụng StockLedger nguyên liệu nữa). Hàm cũ
    // postMaterialYieldConsumeEntry() đã bị XOÁ - giữ lại sẽ trừ tồn 2 LẦN cho cùng 1 lượng vật lý
    // (đã xác nhận stock_ledger chưa có dòng MATERIAL_YIELD_CONSUME nào trong DB thật trước khi xoá).
  }

  /**
   * Phía trừ tồn đoạn theo lệnh (13/11/2026, anh Nhân - lựa chọn D + 11 câu). Mỗi MÃ ĐOẠN (cỡ đoạn + bộ công đoạn đã chuẩn hoá) của
   * mảnh: SegmentStockService.consumeForOrder lấy phần giữ của lệnh, thiếu thì lấy dư, còn thiếu trả shortageQty (KHÔNG ghi sổ kho -
   * tồn không âm). Hàn / Sơn KHÔNG bị chặn (câu 2, 7): ghi 1 dòng sổ báo vượt (segment_overages) khi
   *  - thiếu đoạn (shortageQty > 0), và / hoặc
   *  - đợt này làm số mảnh vượt số lượng tổng của lệnh SX cho (mảnh, công đoạn) - "số lấy thêm" (extraQty); trước đó đã có KCS
   *    chấm lỗi cho mảnh / công đoạn này thì coi là làm lại (REWORK, câu 6), không thì báo vượt (OVER_REPORT).
   * Chống ghi đôi khi gọi lại cùng đợt: bút toán có idempotencyKey; đợt đã có dòng sổ báo vượt cho mã đoạn thì bỏ qua (lần đầu
   * không trừ được gì thì không có bút toán để nhận ra trùng).
   */
  private async consumeSegmentsByCode(
    tx: PrismaTx,
    batch: {
      id: bigint;
      pieceId: bigint;
      reportedQty: number;
      stage: MfgStage;
      productionOrderId?: bigint;
    },
    pieceBoms: { segmentSpecId: bigint; qtyPerPiece: number; processSteps: readonly string[] }[],
    qtyPerUnit: number | null,
    warehouseId: bigint,
    reportedById: string,
    opts: { recordOverage?: boolean } = {},
  ): Promise<{ takenQty: number; shortageQty: number }> {
    const recordOverage = opts.recordOverage ?? true;
    const total = { takenQty: 0, shortageQty: 0 };
    // Rà soát 14/11 TĐ5: chờ lượt chuyển đổi dữ liệu cũ (giữ độc quyền) chạy xong - trước đây phía trừ không lấy khoá này, Hàn / Sơn
    // gửi KCS đúng lúc chuyển đổi đang chạy làm lệch tồn ô.
    await lockBusinessKeyShared(tx, SEGMENT_LEGACY_CONVERSION_LOCK);
    const row = await tx.productionBatch.findUniqueOrThrow({
      where: { id: batch.id },
      select: {
        productionOrderId: true,
        reworkOfId: true,
        productionOrder: {
          select: {
            quantity: true,
            productionInvoiceItem: { select: { productionInvoiceId: true } },
          },
        },
      },
    });
    const productionInvoiceId = row.productionOrder.productionInvoiceItem.productionInvoiceId;
    if (!productionInvoiceId) return total;

    // Số mảnh đợt này làm vượt số lượng tổng của lệnh (cho mảnh + công đoạn này).
    // Rà soát 14/11 TĐ3: cộng dồn theo THỨ TỰ GỬI KCS, không theo id - trước đây lấy đợt id <= đợt này nên gửi đợt id lớn trước thì
    // mỗi đợt chỉ thấy chính nó (kế hoạch 10, 2 đợt 8: không ghi vượt). Khoá đợt của (lệnh, mảnh, công đoạn) - cùng khoá Gửi KCS /
    // Lưu đợt đang giữ (gọi lại trong cùng transaction không chờ) - nên mọi đợt khác đã rời OPEN lúc đọc là đợt gửi TRƯỚC đợt này.
    await lockBusinessKey(
      tx,
      `production-batch-open:${row.productionOrderId}:${batch.pieceId}:${batch.stage}`,
    );
    const plannedPieces = (qtyPerUnit ?? 0) * row.productionOrder.quantity;
    // P1 (phản biện 10): trừ đoạn dời sang lúc KCS chấm nên "đợt trước" = đợt ĐÃ TRỪ đoạn: chính đợt này, đợt QC_DONE (đã chấm),
    // hoặc đợt gửi KCS trước khi cập nhật mà đã có bút toán SEGMENT_CONSUME / dòng Sổ báo vượt. Đợt khác đang chờ chấm chưa trừ gì
    // thì KHÔNG cộng (2 lô 60 cho kế hoạch 100: chỉ lô chấm sau ghi vượt 20, không phải lô nào cũng ghi 40).
    const candidates = await tx.productionBatch.findMany({
      where: {
        productionOrderId: row.productionOrderId,
        pieceId: batch.pieceId,
        stage: batch.stage,
        status: { not: ProductionBatchStatus.OPEN },
        id: { not: batch.id },
      },
      select: { id: true, reportedQty: true, status: true },
    });
    const undecided = candidates
      .filter((b) => b.status !== ProductionBatchStatus.QC_DONE)
      .map((b) => b.id);
    const consumedIds = new Set<string>();
    if (undecided.length > 0) {
      const [ledgers, overages] = await Promise.all([
        tx.stockLedger.findMany({
          where: {
            refType: StockLedgerRefType.SEGMENT_CONSUME,
            refId: { in: undecided.map((id) => id.toString()) },
          },
          select: { refId: true },
        }),
        tx.segmentOverage.findMany({
          where: { productionBatchId: { in: undecided } },
          select: { productionBatchId: true },
        }),
      ]);
      for (const l of ledgers) if (l.refId) consumedIds.add(l.refId);
      for (const o of overages) consumedIds.add(o.productionBatchId.toString());
    }
    const siblings = candidates.filter(
      (b) => b.status === ProductionBatchStatus.QC_DONE || consumedIds.has(b.id.toString()),
    );
    const before = siblings.reduce((s, b) => s + b.reportedQty, 0);
    const cumulative = before + batch.reportedQty;
    const overPieces =
      plannedPieces > 0
        ? Math.max(0, cumulative - plannedPieces) - Math.max(0, before - plannedPieces)
        : 0;
    let extraKind: SegmentOverageKind | null = null;
    if (overPieces > 0) {
      const failed = await tx.qcReview.aggregate({
        where: {
          productionBatchId: { in: siblings.map((b) => b.id) },
        },
        _sum: { failedQty: true },
      });
      extraKind =
        row.reworkOfId != null || (failed._sum.failedQty ?? 0) > 0
          ? SegmentOverageKind.REWORK
          : SegmentOverageKind.OVER_REPORT;
    }

    // Gộp theo mã đoạn: 2 dòng định mức cùng cỡ + cùng bộ công đoạn (sau chuẩn hoá) cộng số đoạn / mảnh.
    const byCode = new Map<
      string,
      { segmentSpecId: bigint; segmentSteps: string; qtyPerPiece: number }
    >();
    for (const pb of pieceBoms) {
      const segmentSteps = normalizeSegmentSteps(pb.processSteps);
      const key = segmentCodeKey(pb.segmentSpecId, segmentSteps);
      const cur = byCode.get(key);
      if (cur) cur.qtyPerPiece += pb.qtyPerPiece;
      else
        byCode.set(key, {
          segmentSpecId: pb.segmentSpecId,
          segmentSteps,
          qtyPerPiece: pb.qtyPerPiece,
        });
    }

    // Rà soát 14/11 TĐ2: khoá ô theo thứ tự mã đoạn cố định (cùng thứ tự phía cộng SegmentStockService.syncOrderProduction) -
    // trước đây theo thứ tự pieceBom.findMany trả về, 2 lượt trừ / trừ với cộng có thể khoá chéo.
    const codes = [...byCode.values()].sort(compareSegmentCodes);
    for (const code of codes) {
      const seen = await tx.segmentOverage.findUnique({
        where: {
          productionBatchId_segmentSpecId_segmentSteps: {
            productionBatchId: batch.id,
            segmentSpecId: code.segmentSpecId,
            segmentSteps: code.segmentSteps,
          },
        },
        select: { id: true },
      });
      if (seen) continue;
      const neededQty = code.qtyPerPiece * batch.reportedQty;
      const result = await this.segmentStock.consumeForOrder(tx, {
        warehouseId,
        productionInvoiceId,
        segmentSpecId: code.segmentSpecId,
        segmentSteps: code.segmentSteps,
        qty: neededQty,
        refId: batch.id.toString(),
        idempotencyKey: `production-batch-segment-consume:${batch.id}:${code.segmentSpecId}:${code.segmentSteps}`,
        actorId: reportedById,
        note: `Báo sản lượng ${batch.stage} đợt ${batch.id}`,
      });
      if (result.duplicate) continue;
      total.takenQty += result.takenQty;
      total.shortageQty += result.shortageQty;
      const extraQty = overPieces * code.qtyPerPiece;
      if (!recordOverage || (result.shortageQty <= 0 && extraQty <= 0)) continue;
      await tx.segmentOverage.create({
        data: {
          productionInvoiceId,
          productionOrderId: row.productionOrderId,
          productionBatchId: batch.id,
          pieceId: batch.pieceId,
          stage: batch.stage,
          warehouseId,
          segmentSpecId: code.segmentSpecId,
          segmentSteps: code.segmentSteps,
          neededQty,
          takenQty: result.takenQty,
          shortageQty: result.shortageQty,
          overPieces: Math.max(0, overPieces),
          extraQty,
          extraKind: extraQty > 0 ? extraKind : null,
          reportedById,
        },
      });
    }
    return total;
  }

  /**
   * Chuyển đổi dữ liệu tồn đoạn cũ (anh Nhân 13/11 câu 10, SegmentLegacyConversionService): trừ lại theo MÃ ĐOẠN phần đoạn 1 đợt
   * Hàn / Sơn cũ đã trừ theo cách cũ (vào dòng trơn). Không ghi sổ báo vượt (thiếu của dữ liệu cũ trả về để báo cáo). Đợt không
   * dùng đoạn sắt (không có PieceBom) hoặc không phải công đoạn trừ đoạn của mảnh thì trả 0.
   */
  async replayLegacySegmentConsume(
    tx: PrismaTx,
    batchId: bigint,
    actorId: string,
  ): Promise<{
    productionInvoiceId: bigint | null;
    neededQty: number;
    takenQty: number;
    shortageQty: number;
  }> {
    const batch = await tx.productionBatch.findUniqueOrThrow({
      where: { id: batchId },
      select: {
        id: true,
        pieceId: true,
        reportedQty: true,
        stage: true,
        reportedById: true,
        productionOrder: {
          select: {
            id: true,
            bomRevisionId: true,
            productionInvoiceItem: { select: { productionInvoiceId: true } },
          },
        },
      },
    });
    const productionInvoiceId = batch.productionOrder.productionInvoiceItem.productionInvoiceId;
    const empty = { productionInvoiceId, neededQty: 0, takenQty: 0, shortageQty: 0 };
    const bomRevisionId = batch.productionOrder.bomRevisionId;
    const pieceBoms = await tx.pieceBom.findMany({
      where: { bomRevisionId, pieceId: batch.pieceId },
    });
    if (pieceBoms.length === 0 || !productionInvoiceId) return empty;
    const bomPiece = await tx.bomPiece.findUnique({
      where: { bomRevisionId_pieceId: { bomRevisionId, pieceId: batch.pieceId } },
    });
    const consumeStage = bomPiece?.needsHan
      ? MfgStage.HAN
      : bomPiece?.needsSon
        ? MfgStage.SON
        : batch.stage;
    if (batch.stage !== consumeStage) return empty;
    const code = await this.phoiWarehouseCodeOfOrder(batch.productionOrder.id, tx);
    const wh = await tx.warehouse.findUniqueOrThrow({ where: { code }, select: { id: true } });
    const neededQty = pieceBoms.reduce((n, pb) => n + pb.qtyPerPiece, 0) * batch.reportedQty;
    const r = await this.consumeSegmentsByCode(
      tx,
      batch,
      pieceBoms,
      bomPiece?.qtyPerUnit ?? null,
      wh.id,
      batch.reportedById ?? actorId,
      { recordOverage: false },
    );
    return { productionInvoiceId, neededQty, ...r };
  }

  async findAllForOrder(
    productionOrderId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<ProductionBatchResponseDto>> {
    const bigId = parseBigIntId(productionOrderId);
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.productionBatch.findMany({ ...args, include: PRODUCTION_BATCH_INCLUDE }),
        count: (args) => this.prisma.productionBatch.count(args),
      },
      query,
      { productionOrderId: bigId },
      { reportedAt: 'desc' as const },
    );
    return { data: result.data.map((r) => this.toResponseDto(r)), meta: result.meta };
  }

  async findOne(id: string): Promise<ProductionBatchResponseDto> {
    return this.toResponseDto(await this.findOneOrThrow(id));
  }

  /** Flat, KHÔNG cần productionOrderId - xem ListProductionBatchesQueryDto tại sao endpoint này
   *  tồn tại riêng (permission KCS không đủ để tự resolve productionOrderId). */
  async findAll(
    query: ListProductionBatchesQueryDto,
  ): Promise<Paginated<ProductionBatchResponseDto>> {
    const where: Prisma.ProductionBatchWhereInput = {
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.productionBatch.findMany({ ...args, include: PRODUCTION_BATCH_INCLUDE }),
        count: (args) => this.prisma.productionBatch.count(args),
      },
      query,
      where,
      { reportedAt: 'desc' as const },
    );
    return { data: result.data.map((r) => this.toResponseDto(r)), meta: result.meta };
  }

  /** Dùng bởi QcReviewsService.reviewProductionBatch() - cùng idiom
   *  SteelIssuesService.findOneRowOrThrow(). */
  async findOneRowOrThrow(id: string): Promise<ProductionBatchRow> {
    return this.findOneOrThrow(id);
  }

  /**
   * "Còn phải báo bao nhiêu" theo mảnh - cho PHOI_STAFF/HAN_STAFF/SON_STAFF tự tra pieceId thật để
   * báo sản lượng, không cần BOM_REVISION:VIEW (chỉ cần biết trước productionOrderId, xem
   * PRODUCTION_ORDER:VIEW mới cấp cho các role này). Chỉ trả mảnh khớp đúng stage - PHOI dùng
   * findPhoiEligibleBomPieces() (needsHan=false HOẶC có PieceMaterialYield dù needsHan=true, vd
   * "pat"), HAN/SON dùng stageNeedsFilter() (needsHan/needsSon=true) - mảnh không cần qua công
   * đoạn này thì không hiện ra để báo nhầm; awaitingQcQty/passedQty tính riêng theo đúng stage từ
   * ProductionBatch, cùng idiom MaterialIssuesService.getIssuePlan().
   */
  async getBatchPlan(
    productionOrderId: string,
    stage: MfgStage,
  ): Promise<ProductionBatchPlanResponseDto> {
    this.assertConsumableStage(stage);
    const order = await this.findOrderWithProductOrThrow(productionOrderId);

    const [bomPieces, batches, reviewedByOrderPiece] = await Promise.all([
      stage === MfgStage.PHOI
        ? this.findPhoiEligibleBomPieces(order.bomRevisionId)
        : this.prisma.bomPiece.findMany({
            where: { bomRevisionId: order.bomRevisionId, ...this.stageNeedsFilter(stage) },
            include: { piece: true },
          }),
      this.prisma.productionBatch.findMany({
        where: { productionOrderId: order.id, stage },
        select: { pieceId: true, status: true, reportedQty: true },
      }),
      this.getReviewQtyByOrderPiece([order.id], stage),
    ]);

    const awaitingByPiece = new Map<string, number>();
    const passedByPiece = new Map<string, number>();
    const openByPiece = new Map<string, number>();
    for (const b of batches) {
      // status OPEN (2026-09-08, ChotPanel "Lưu đợt" chưa gửi KCS) - không phải "chờ KCS" (chưa gửi)
      // cũng không phải "đã chốt" (chưa qua duyệt) -> cộng riêng vào openQty (2026-10-16).
      if (b.status === ProductionBatchStatus.OPEN) {
        const k = b.pieceId.toString();
        openByPiece.set(k, (openByPiece.get(k) ?? 0) + b.reportedQty);
        continue;
      }
      const key = b.pieceId.toString();
      const target =
        b.status === ProductionBatchStatus.AWAITING_QC ? awaitingByPiece : passedByPiece;
      target.set(key, (target.get(key) ?? 0) + b.reportedQty);
    }

    // Cảnh báo "còn nguyên liệu chưa cắt hết" + tiến độ công đoạn (chỉ hiển thị, không chặn -
    // quyết định nghiệp vụ 2026-08-22 và 2026-09-04) - chỉ tính cho stage=PHOI, chỉ cho piece có
    // PieceMaterialYield.
    const [extrasByPiece, stepBatchDoneMap, stepBundleMaps] =
      stage === MfgStage.PHOI
        ? await Promise.all([
            this.getPieceMaterialYieldExtrasByPiece(
              order.bomRevisionId,
              bomPieces.map((bp) => bp.pieceId),
            ),
            this.getStepBatchDoneMap([order.id]),
            this.getStepBundleMaps([order.id]),
          ])
        : [
            new Map<string, PieceMaterialYieldExtras>(),
            new Map<string, number>(),
            {
              submitted: new Map<string, number>(),
              passed: new Map<string, number>(),
              failed: new Map<string, number>(),
              short: new Map<string, number>(),
            },
          ];

    const items = bomPieces.map((bp) => {
      const key = bp.pieceId.toString();
      const plannedQty = bp.qtyPerUnit * order.quantity;
      const extras = extrasByPiece.get(key);
      const processSteps = extras?.processSteps ?? [];
      return new ProductionBatchPlanItemResponseDto({
        pieceId: key,
        pieceCode: bp.piece.code,
        pieceName: bp.piece.name,
        qtyPerUnit: bp.qtyPerUnit,
        plannedQty,
        awaitingQcQty: awaitingByPiece.get(key) ?? 0,
        passedQty: passedByPiece.get(key) ?? 0,
        failedQty:
          (reviewedByOrderPiece.failed.get(`${order.id}:${key}`) ?? 0) +
          sumStepFailed(stepBundleMaps.failed, `${order.id}:${key}`, processSteps),
        shortQty:
          (reviewedByOrderPiece.short.get(`${order.id}:${key}`) ?? 0) +
          sumStepFailed(stepBundleMaps.short, `${order.id}:${key}`, processSteps),
        openQty: openByPiece.get(key) ?? 0,
        rawMaterialOnHand: extras?.rawMaterialOnHand ?? null,
        processSteps,
        stepProgress: processSteps.map((step) => {
          const stepKey = `${order.id}:${key}:${step}`;
          return new PieceStepProgressDto({
            step,
            requiredQty: plannedQty,
            doneQty: stepBatchDoneMap.get(stepKey) ?? 0,
            submittedQty: stepBundleMaps.submitted.get(stepKey) ?? 0,
            passedQty: stepBundleMaps.passed.get(stepKey) ?? 0,
            failedQty: stepBundleMaps.failed.get(stepKey) ?? 0,
            shortQty: stepBundleMaps.short.get(stepKey) ?? 0,
          });
        }),
        qtyPerPiece: extras?.qtyPerPiece ?? null,
      });
    });

    const materialYieldItems =
      stage === MfgStage.PHOI
        ? ((await this.getMaterialYieldPlanBatch([this.toMaterialYieldOrder(order)])).get(
            order.id.toString(),
          ) ?? [])
        : [];

    return new ProductionBatchPlanResponseDto({
      poNumber: order.poNumber,
      salesOrderCode: order.productionInvoiceItem.salesOrder?.orderCode ?? null,
      productName: order.mfgProduct.name,
      quantity: order.quantity,
      items,
      materialYieldItems,
    });
  }

  private toMaterialYieldOrder(order: {
    id: bigint;
    bomRevisionId: bigint;
    quantity: number;
    productionInvoiceItem: { productionInvoiceId: bigint | null };
  }): MaterialYieldPlanOrder {
    return {
      id: order.id,
      bomRevisionId: order.bomRevisionId,
      quantity: order.quantity,
      productionInvoiceId: order.productionInvoiceItem.productionInvoiceId,
    };
  }

  /**
   * Vật tư thành phẩm KHÔNG gắn mảnh (vd chân nhôm, MaterialYieldRecipe) cho stage PHOI. Nhu cầu của
   * từng SKU = Σ (BomPiece.qtyPerUnit × PieceMaterialItem.qtyPerPiece × SL SKU) với các dòng
   * FINISHED_COMPONENT đã tick includeInWeaving. Tiến độ lấy theo PI từ đợt KCS CÔNG ĐOẠN CUỐI của
   * recipe (đã cộng vào tồn qua StockLedger MATERIAL_YIELD_RECIPE_OUTPUT, refId = id đợt) và phân bổ
   * cho từng SKU theo tỷ lệ nhu cầu trong cùng PI. PI có 1 SKU thì phân bổ = toàn bộ.
   */
  private async getMaterialYieldPlanBatch(
    orders: MaterialYieldPlanOrder[],
  ): Promise<Map<string, ProductionBatchMaterialYieldItemResponseDto[]>> {
    const result = new Map<string, ProductionBatchMaterialYieldItemResponseDto[]>();
    const withPi = orders.filter(
      (o): o is MaterialYieldPlanOrder & { productionInvoiceId: bigint } =>
        o.productionInvoiceId !== null,
    );
    if (withPi.length === 0) return result;

    const piIds = [...new Set(withPi.map((o) => o.productionInvoiceId))];
    // Huỷ lệnh theo SKU (23/11/2026): SKU đã huỷ không giữ phần tiến độ chân nhôm của PI (không thì SKU còn lại không bao giờ đủ).
    const piOrders = await this.prisma.productionOrder.findMany({
      where: {
        productionInvoiceItem: { productionInvoiceId: { in: piIds } },
        ...NOT_CANCELLED_ORDER,
      },
      select: {
        id: true,
        bomRevisionId: true,
        quantity: true,
        productionInvoiceItem: { select: { productionInvoiceId: true } },
      },
    });
    const recipes = await this.prisma.materialYieldRecipe.findMany({
      where: { isActive: true },
      include: { outputMaterial: { select: { id: true, code: true, name: true, spec: true } } },
    });
    if (recipes.length === 0) return result;

    const revisionIds = [...new Set(piOrders.map((o) => o.bomRevisionId))];
    const outputMaterialIds = recipes.map((r) => r.outputMaterialId);
    const [lines, bomPieces] = await Promise.all([
      this.prisma.pieceMaterialItem.findMany({
        where: {
          bomRevisionId: { in: revisionIds },
          materialId: { in: outputMaterialIds },
          includeInWeaving: true,
        },
        select: { bomRevisionId: true, pieceId: true, materialId: true, qtyPerPiece: true },
      }),
      this.prisma.bomPiece.findMany({
        where: { bomRevisionId: { in: revisionIds } },
        select: { bomRevisionId: true, pieceId: true, qtyPerUnit: true },
      }),
    ]);
    if (lines.length === 0) return result;

    const qtyPerUnitByRevPiece = new Map(
      bomPieces.map((bp) => [`${bp.bomRevisionId}:${bp.pieceId}`, bp.qtyPerUnit]),
    );
    // Định mức vật tư ra / 1 đơn vị SKU, key `${revisionId}:${materialId}`
    const perUnitByRevMaterial = new Map<string, number>();
    for (const line of lines) {
      const qtyPerUnit = qtyPerUnitByRevPiece.get(`${line.bomRevisionId}:${line.pieceId}`);
      if (qtyPerUnit == null) continue;
      const key = `${line.bomRevisionId}:${line.materialId}`;
      perUnitByRevMaterial.set(
        key,
        (perUnitByRevMaterial.get(key) ?? 0) + qtyPerUnit * line.qtyPerPiece.toNumber(),
      );
    }
    const requiredOf = (revisionId: bigint, quantity: number, materialId: bigint): number =>
      (perUnitByRevMaterial.get(`${revisionId}:${materialId}`) ?? 0) * quantity;

    // Tiến độ PI: chỉ đợt của CÔNG ĐOẠN CUỐI (theo processSteps đã sắp xếp của recipe) mới cộng tồn.
    const lastStepByRecipe = new Map(
      recipes.map((r) => {
        const sorted = sortProcessSteps(r.processSteps);
        return [r.id.toString(), sorted[sorted.length - 1]];
      }),
    );
    const bundles = await this.prisma.materialYieldStepBundle.findMany({
      where: { productionInvoiceId: { in: piIds }, recipeId: { in: recipes.map((r) => r.id) } },
      select: {
        id: true,
        productionInvoiceId: true,
        recipeId: true,
        step: true,
        qty: true,
        status: true,
        submittedAt: true,
      },
    });
    const finalBundles = bundles.filter(
      (b) => b.step === lastStepByRecipe.get(b.recipeId.toString()),
    );
    const passedRows = finalBundles.length
      ? await this.prisma.stockLedger.findMany({
          where: {
            refType: StockLedgerRefType.MATERIAL_YIELD_RECIPE_OUTPUT,
            refId: { in: finalBundles.map((b) => b.id.toString()) },
          },
          select: { refId: true, qty: true },
        })
      : [];
    const passedByBundle = new Map(passedRows.map((r) => [r.refId ?? '', r.qty.toNumber()]));
    const piProgressKey = (piId: bigint, recipeId: bigint) => `${piId}:${recipeId}`;
    const passedByPi = new Map<string, number>();
    const awaitingByPi = new Map<string, number>();
    // Mốc cập nhật gần nhất của khối vật tư (đợt KCS công đoạn cuối mới nhất của PI/recipe).
    const lastUpdatedByPi = new Map<string, Date>();
    for (const b of finalBundles) {
      const key = piProgressKey(b.productionInvoiceId, b.recipeId);
      const prev = lastUpdatedByPi.get(key);
      if (!prev || b.submittedAt > prev) lastUpdatedByPi.set(key, b.submittedAt);
    }
    for (const b of finalBundles) {
      const key = piProgressKey(b.productionInvoiceId, b.recipeId);
      if (b.status === PieceStepBundleStatus.AWAITING_QC) {
        awaitingByPi.set(key, (awaitingByPi.get(key) ?? 0) + b.qty);
      } else {
        passedByPi.set(
          key,
          (passedByPi.get(key) ?? 0) + (passedByBundle.get(b.id.toString()) ?? 0),
        );
      }
    }

    // Tổng nhu cầu PI (mọi SKU trong PI, không chỉ các SKU đang xem) để phân bổ đúng tỷ lệ.
    const requiredByPi = new Map<string, number>();
    for (const o of piOrders) {
      const piId = o.productionInvoiceItem.productionInvoiceId;
      if (piId === null) continue;
      for (const recipe of recipes) {
        const key = piProgressKey(piId, recipe.id);
        const req = requiredOf(o.bomRevisionId, o.quantity, recipe.outputMaterialId);
        requiredByPi.set(key, (requiredByPi.get(key) ?? 0) + req);
      }
    }

    const liveOrderIds = new Set(piOrders.map((o) => o.id.toString()));
    for (const order of withPi) {
      const items: ProductionBatchMaterialYieldItemResponseDto[] = [];
      for (const recipe of recipes) {
        const planned = requiredOf(order.bomRevisionId, order.quantity, recipe.outputMaterialId);
        if (planned <= 0) continue;
        const key = piProgressKey(order.productionInvoiceId, recipe.id);
        // Xem lại SKU đã huỷ: tính tỷ lệ như thể SKU vẫn trong PI (chỉ hiển thị, không ảnh hưởng SKU còn chạy).
        const piRequired =
          (requiredByPi.get(key) ?? 0) + (liveOrderIds.has(order.id.toString()) ? 0 : planned);
        const share = piRequired > 0 ? planned / piRequired : 0;
        items.push(
          new ProductionBatchMaterialYieldItemResponseDto({
            materialId: recipe.outputMaterialId.toString(),
            materialCode: recipe.outputMaterial.code,
            materialName: recipe.outputMaterial.name,
            materialSpec: recipe.outputMaterial.spec,
            lastUpdatedAt: lastUpdatedByPi.get(key)?.toISOString() ?? null,
            plannedQty: planned,
            awaitingQcQty: Math.round((awaitingByPi.get(key) ?? 0) * share),
            passedQty: Math.round((passedByPi.get(key) ?? 0) * share),
          }),
        );
      }
      result.set(order.id.toString(), items);
    }
    return result;
  }

  /**
   * Gộp nhiều ProductionOrder 1 lần, CÙNG stage - "Bảng thống kê" (ThongKePagePlan.tsx) tải tiến
   * độ Hàn/Sơn cho nhiều SKU cùng lúc (2 lệnh gọi, 1 cho HAN 1 cho SON, thay vì 2×N). Giữ nguyên
   * getBatchPlan() cho luồng báo sản lượng thật của tổ Hàn/Sơn/Phôi (HAN_STAFF/SON_STAFF/
   * PHOI_STAFF chỉ tra 1 order/lần) - hàm này chỉ phục vụ nhu cầu XEM gộp nhiều order, không dùng
   * lại logic thẳng để tránh rủi ro sửa nhầm đường thật đang chạy. Mỗi order có thể có
   * bomRevisionId khác nhau (khác mfgProduct/khác revision tại thời điểm duyệt) nên bomPieces/
   * rawMaterialOnHand phải nhóm theo revision, không nhóm thẳng theo order.
   */
  async getBatchPlanBatch(
    productionOrderIds: string[],
    stage: MfgStage,
  ): Promise<Record<string, ProductionBatchPlanResponseDto>> {
    this.assertConsumableStage(stage);
    const result: Record<string, ProductionBatchPlanResponseDto> = {};
    if (productionOrderIds.length === 0) return result;

    const orderBigIds = productionOrderIds.map((id) => parseBigIntId(id));
    const orders = await this.prisma.productionOrder.findMany({
      where: { id: { in: orderBigIds } },
      include: {
        mfgProduct: true,
        productionInvoiceItem: {
          select: { productionInvoiceId: true, salesOrder: { select: { orderCode: true } } },
        },
      },
    });
    const revisionIds = [...new Set(orders.map((o) => o.bomRevisionId))];
    const materialYieldByOrder =
      stage === MfgStage.PHOI
        ? await this.getMaterialYieldPlanBatch(orders.map((o) => this.toMaterialYieldOrder(o)))
        : new Map<string, ProductionBatchMaterialYieldItemResponseDto[]>();

    const [
      bomPiecesByRevision,
      extrasByRevision,
      batches,
      stepBatchDoneMap,
      stepBundleMaps,
      reviewedByOrderPiece,
    ] = await Promise.all([
      stage === MfgStage.PHOI
        ? this.findPhoiEligibleBomPiecesBatch(revisionIds)
        : this.findBomPiecesByStageBatch(revisionIds, stage),
      stage === MfgStage.PHOI
        ? this.getPieceMaterialYieldExtrasByPieceBatch(revisionIds)
        : Promise.resolve(new Map<string, Map<string, PieceMaterialYieldExtras>>()),
      this.prisma.productionBatch.findMany({
        where: { productionOrderId: { in: orders.map((o) => o.id) }, stage },
        select: { productionOrderId: true, pieceId: true, status: true, reportedQty: true },
      }),
      stage === MfgStage.PHOI
        ? this.getStepBatchDoneMap(orders.map((o) => o.id))
        : Promise.resolve(new Map<string, number>()),
      stage === MfgStage.PHOI
        ? this.getStepBundleMaps(orders.map((o) => o.id))
        : Promise.resolve({
            submitted: new Map<string, number>(),
            passed: new Map<string, number>(),
            failed: new Map<string, number>(),
            short: new Map<string, number>(),
          }),
      this.getReviewQtyByOrderPiece(
        orders.map((o) => o.id),
        stage,
      ),
    ]);

    const awaitingByOrderPiece = new Map<string, number>();
    const passedByOrderPiece = new Map<string, number>();
    const openByOrderPiece = new Map<string, number>();
    for (const b of batches) {
      // status OPEN (2026-09-08, ChotPanel "Lưu đợt" chưa gửi KCS) -> openQty, xem getBatchPlan() ở trên.
      const key = `${b.productionOrderId}:${b.pieceId}`;
      if (b.status === ProductionBatchStatus.OPEN) {
        openByOrderPiece.set(key, (openByOrderPiece.get(key) ?? 0) + b.reportedQty);
        continue;
      }
      const target =
        b.status === ProductionBatchStatus.AWAITING_QC ? awaitingByOrderPiece : passedByOrderPiece;
      target.set(key, (target.get(key) ?? 0) + b.reportedQty);
    }

    for (const order of orders) {
      const revisionKey = order.bomRevisionId.toString();
      const bomPieces = bomPiecesByRevision.get(revisionKey) ?? [];
      const extrasByPiece =
        extrasByRevision.get(revisionKey) ?? new Map<string, PieceMaterialYieldExtras>();

      const items = bomPieces.map((bp) => {
        const pieceKey = bp.pieceId.toString();
        const orderPieceKey = `${order.id}:${pieceKey}`;
        const plannedQty = bp.qtyPerUnit * order.quantity;
        const extras = extrasByPiece.get(pieceKey);
        const processSteps = extras?.processSteps ?? [];
        return new ProductionBatchPlanItemResponseDto({
          pieceId: pieceKey,
          pieceCode: bp.piece.code,
          pieceName: bp.piece.name,
          qtyPerUnit: bp.qtyPerUnit,
          plannedQty,
          awaitingQcQty: awaitingByOrderPiece.get(orderPieceKey) ?? 0,
          passedQty: passedByOrderPiece.get(orderPieceKey) ?? 0,
          failedQty:
            (reviewedByOrderPiece.failed.get(orderPieceKey) ?? 0) +
            sumStepFailed(stepBundleMaps.failed, orderPieceKey, processSteps),
          shortQty:
            (reviewedByOrderPiece.short.get(orderPieceKey) ?? 0) +
            sumStepFailed(stepBundleMaps.short, orderPieceKey, processSteps),
          openQty: openByOrderPiece.get(orderPieceKey) ?? 0,
          rawMaterialOnHand: extras?.rawMaterialOnHand ?? null,
          processSteps,
          stepProgress: processSteps.map((step) => {
            const stepKey = `${orderPieceKey}:${step}`;
            return new PieceStepProgressDto({
              step,
              requiredQty: plannedQty,
              doneQty: stepBatchDoneMap.get(stepKey) ?? 0,
              submittedQty: stepBundleMaps.submitted.get(stepKey) ?? 0,
              passedQty: stepBundleMaps.passed.get(stepKey) ?? 0,
              failedQty: stepBundleMaps.failed.get(stepKey) ?? 0,
              shortQty: stepBundleMaps.short.get(stepKey) ?? 0,
            });
          }),
          qtyPerPiece: extras?.qtyPerPiece ?? null,
        });
      });

      result[order.id.toString()] = new ProductionBatchPlanResponseDto({
        poNumber: order.poNumber,
        salesOrderCode: order.productionInvoiceItem.salesOrder?.orderCode ?? null,
        productName: order.mfgProduct.name,
        quantity: order.quantity,
        items,
        materialYieldItems: materialYieldByOrder.get(order.id.toString()) ?? [],
      });
    }
    return result;
  }

  /** Σ QcReview.failedQty (lỗi KCS cộng dồn, bất biến) VÀ Σ QcReview.shortQty (KCS ghi thiếu, P1) của các đợt ProductionBatch
   *  đã chấm (QC_DONE) theo khoá `${orderId}:${pieceId}` - 1 truy vấn gộp, không N+1. Mỗi đợt chỉ được chấm 1 lần
   *  (updateMany guard AWAITING_QC -> QC_DONE) nên không đếm lặp; đợt bù là đợt mới, tự có QcReview riêng.
   *  failed GIỮ ĐÚNG nghĩa N1 (chỉ lỗi, kế hoạch mảnh "lỗi chưa bù" dựa vào đây) - thiếu ghi riêng ở short, không cộng vào failed. */
  private async getReviewQtyByOrderPiece(
    orderIds: bigint[],
    stage: MfgStage,
  ): Promise<{ failed: Map<string, number>; short: Map<string, number> }> {
    const reviews = await this.prisma.qcReview.findMany({
      where: {
        productionBatch: {
          productionOrderId: { in: orderIds },
          stage,
          status: ProductionBatchStatus.QC_DONE,
        },
      },
      select: {
        failedQty: true,
        shortQty: true,
        productionBatch: { select: { productionOrderId: true, pieceId: true } },
      },
    });
    const failed = new Map<string, number>();
    const short = new Map<string, number>();
    for (const r of reviews) {
      if (!r.productionBatch) continue;
      const key = `${r.productionBatch.productionOrderId}:${r.productionBatch.pieceId}`;
      failed.set(key, (failed.get(key) ?? 0) + r.failedQty);
      short.set(key, (short.get(key) ?? 0) + r.shortQty);
    }
    return { failed, short };
  }

  /** Batch của stageNeedsFilter()+bomPiece.findMany() trong getBatchPlan(), nhóm theo revision -
   *  dùng cho getBatchPlanBatch() stage HAN/SON. */
  private async findBomPiecesByStageBatch(revisionIds: bigint[], stage: Exclude<MfgStage, 'PHOI'>) {
    type Row = Prisma.BomPieceGetPayload<{ include: { piece: true } }>;
    const map = new Map<string, Row[]>();
    if (revisionIds.length === 0) return map;
    const rows = await this.prisma.bomPiece.findMany({
      where: { bomRevisionId: { in: revisionIds }, ...this.stageNeedsFilter(stage) },
      include: { piece: true },
    });
    for (const r of rows) {
      const key = r.bomRevisionId.toString();
      const arr = map.get(key);
      if (arr) arr.push(r);
      else map.set(key, [r]);
    }
    return map;
  }

  /** Batch của findPhoiEligibleBomPieces(), nhóm theo revision - dùng cho getBatchPlanBatch()
   *  stage PHOI. Cùng logic gộp needsHan=false + PieceMaterialYield như bản đơn, chỉ khác truy
   *  vấn 1 lần cho nhiều revision rồi tách lại theo đúng revision của từng dòng (PK
   *  bomRevisionId+pieceId nên không lẫn giữa các revision dù cùng pieceId). */
  private async findPhoiEligibleBomPiecesBatch(revisionIds: bigint[]) {
    type Row = Prisma.BomPieceGetPayload<{ include: { piece: true } }>;
    const map = new Map<string, Row[]>();
    if (revisionIds.length === 0) return map;

    const [needsHanFalseRows, yieldRows] = await Promise.all([
      this.prisma.bomPiece.findMany({
        where: { bomRevisionId: { in: revisionIds }, needsHan: false },
        include: { piece: true },
      }),
      this.prisma.pieceMaterialYield.findMany({
        where: { bomRevisionId: { in: revisionIds } },
        select: { bomRevisionId: true, pieceId: true },
      }),
    ]);

    const includedByRevision = new Map<string, Set<string>>();
    for (const r of needsHanFalseRows) {
      const key = r.bomRevisionId.toString();
      const arr = map.get(key);
      if (arr) arr.push(r);
      else map.set(key, [r]);
      const included = includedByRevision.get(key);
      if (included) included.add(r.pieceId.toString());
      else includedByRevision.set(key, new Set([r.pieceId.toString()]));
    }

    const extraPieceIdsByRevision = new Map<string, Set<bigint>>();
    for (const y of yieldRows) {
      const key = y.bomRevisionId.toString();
      if (includedByRevision.get(key)?.has(y.pieceId.toString())) continue;
      const extra = extraPieceIdsByRevision.get(key);
      if (extra) extra.add(y.pieceId);
      else extraPieceIdsByRevision.set(key, new Set([y.pieceId]));
    }

    const allExtraPieceIds = [
      ...new Set([...extraPieceIdsByRevision.values()].flatMap((s) => [...s])),
    ];
    if (allExtraPieceIds.length > 0) {
      const extraRows = await this.prisma.bomPiece.findMany({
        where: { bomRevisionId: { in: revisionIds }, pieceId: { in: allExtraPieceIds } },
        include: { piece: true },
      });
      for (const r of extraRows) {
        const key = r.bomRevisionId.toString();
        // Query IN không tách theo revision - chỉ giữ dòng thật sự nằm trong tập "extra" của
        // ĐÚNG revision đó (khớp cả bomRevisionId lẫn pieceId, PK 2 cột nên không lẫn revision khác).
        if (!extraPieceIdsByRevision.get(key)?.has(r.pieceId)) continue;
        const arr = map.get(key);
        if (arr) arr.push(r);
        else map.set(key, [r]);
      }
    }
    return map;
  }

  /** Batch của getPieceMaterialYieldExtrasByPiece(), nhóm theo revision - dùng cho
   *  getBatchPlanBatch() stage PHOI. */
  private async getPieceMaterialYieldExtrasByPieceBatch(
    revisionIds: bigint[],
  ): Promise<Map<string, Map<string, PieceMaterialYieldExtras>>> {
    const result = new Map<string, Map<string, PieceMaterialYieldExtras>>();
    if (revisionIds.length === 0) return result;
    const yields = await this.prisma.pieceMaterialYield.findMany({
      where: { bomRevisionId: { in: revisionIds } },
    });
    if (yields.length === 0) return result;

    const materialIds = [...new Set(yields.map((y) => y.materialId))];
    const quants = await this.prisma.stockQuant.findMany({
      where: { materialId: { in: materialIds } },
    });
    const onHandByMaterial = new Map<string, number>();
    for (const q of quants) {
      const key = q.materialId!.toString();
      onHandByMaterial.set(key, (onHandByMaterial.get(key) ?? 0) + q.qty.toNumber());
    }

    // 2026-10-03: 1 piece có thể có NHIỀU dòng Tự tính - gộp theo (revision, piece) thay vì ghi đè
    // (trước đây `inner.set(pieceId, {...})` lặp lại trong for sẽ mất hết trừ dòng CUỐI nếu piece có
    // ≥2 material). Gộp qua mergeYieldExtrasGroup() - xem doc comment hàm đó.
    const rowsByRevisionPiece = new Map<string, (typeof yields)[number][]>();
    for (const y of yields) {
      const key = `${y.bomRevisionId}:${y.pieceId}`;
      const arr = rowsByRevisionPiece.get(key);
      if (arr) arr.push(y);
      else rowsByRevisionPiece.set(key, [y]);
    }
    for (const [key, rows] of rowsByRevisionPiece) {
      const [revKey, pieceKey] = key.split(':');
      const inner = result.get(revKey) ?? new Map<string, PieceMaterialYieldExtras>();
      inner.set(pieceKey, this.mergeYieldExtrasGroup(rows, onHandByMaterial));
      result.set(revKey, inner);
    }
    return result;
  }

  /** Σ PieceStepBatch.qty theo (order, piece, step) - key `${orderId}:${pieceId}:${step}`. Dùng
   *  để build stepProgress[].doneQty ở getBatchPlan()/getBatchPlanBatch(). CHỈ gọi khi stage=PHOI
   *  (nơi duy nhất PieceStepBatch có ý nghĩa). */
  private async getStepBatchDoneMap(orderIds: bigint[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (orderIds.length === 0) return result;
    const rows = await this.prisma.pieceStepBatch.groupBy({
      by: ['productionOrderId', 'pieceId', 'step'],
      where: { productionOrderId: { in: orderIds } },
      _sum: { qty: true },
    });
    for (const r of rows) {
      result.set(`${r.productionOrderId}:${r.pieceId}:${r.step}`, r._sum.qty ?? 0);
    }
    return result;
  }

  /** Σ PieceStepBundle.qty theo (order, piece, step), tách 2 map trong 1 lần groupBy(status) -
   *  `submitted` = MỌI status (dùng để tính "còn chưa gửi KCS" = doneQty - submittedQty ở FE),
   *  `passed` = CHỈ status=QC_PASSED (cảnh báo "vượt bước trước", xem PieceStepProgressDto doc
   *  comment). `failed` (2026-09-07 lần 2, xem changelog "Bù đủ dồn về bảng tổng") = Σ
   *  QcReview.failedQty CỘNG DỒN LỊCH SỬ (không trừ gì, mirror getStepProgress() bên Sắt) - "Lỗi"
   *  không tự giảm, Phôi bù bằng cách báo thêm rồi gửi KCS như đợt mới. `short` (P1) = Σ QcReview.shortQty cùng cách - KCS ghi
   *  thiếu, ghi riêng, không cộng vào `failed`. CHỈ gọi khi stage=PHOI, cùng khuôn getStepBatchDoneMap(). */
  private async getStepBundleMaps(orderIds: bigint[]): Promise<{
    submitted: Map<string, number>;
    passed: Map<string, number>;
    failed: Map<string, number>;
    short: Map<string, number>;
  }> {
    const submitted = new Map<string, number>();
    const passed = new Map<string, number>();
    const failed = new Map<string, number>();
    const short = new Map<string, number>();
    if (orderIds.length === 0) return { submitted, passed, failed, short };
    const [rows, failedRows] = await Promise.all([
      this.prisma.pieceStepBundle.groupBy({
        by: ['productionOrderId', 'pieceId', 'step', 'status'],
        where: { productionOrderId: { in: orderIds } },
        _sum: { qty: true },
      }),
      this.prisma.qcReview.findMany({
        where: { pieceStepBundle: { productionOrderId: { in: orderIds } } },
        select: {
          failedQty: true,
          shortQty: true,
          pieceStepBundle: { select: { productionOrderId: true, pieceId: true, step: true } },
        },
      }),
    ]);
    for (const r of rows) {
      const key = `${r.productionOrderId}:${r.pieceId}:${r.step}`;
      const qty = r._sum.qty ?? 0;
      submitted.set(key, (submitted.get(key) ?? 0) + qty);
      if (r.status === PieceStepBundleStatus.QC_PASSED) {
        passed.set(key, (passed.get(key) ?? 0) + qty);
      }
    }
    for (const r of failedRows) {
      if (!r.pieceStepBundle) continue;
      const key = `${r.pieceStepBundle.productionOrderId}:${r.pieceStepBundle.pieceId}:${r.pieceStepBundle.step}`;
      failed.set(key, (failed.get(key) ?? 0) + r.failedQty);
      short.set(key, (short.get(key) ?? 0) + r.shortQty);
    }
    return { submitted, passed, failed, short };
  }

  /**
   * Tổng "sẵn sàng nhưng chưa chuyển kho" của các piece báo ở PHOI (needsHan=false "vật tư thành
   * phẩm" truyền thống, HOẶC needsHan=true có PieceMaterialYield vd "pat" - đã cắt xong ở PHOI,
   * dù còn phải qua Hàn riêng), quét TOÀN BỘ ProductionBatch(stage=PHOI, status=QC_DONE) - KHÔNG lọc theo productionOrderId
   * hay PI, khác hẳn công thức readyQty trong WarehouseTransfersService.getPieceTransferPlan()
   * (cái đó cố ý CHỈ tính theo đúng 1 đơn hàng, để biết "được chuyển bao nhiêu cho đơn NÀY").
   * Dùng cho PieceMaterialYieldPurchaseService tính nhu cầu mua nguyên liệu: chân "dư" từ đơn
   * hàng/PI khác vẫn được coi là tồn dùng chung (quyết định nghiệp vụ 2026-08-22 - không ghi
   * StockLedger thật lúc KCS duyệt, chỉ tính pool ảo tại thời điểm kiểm tồn).
   */
  async getReadyPoolQty(pieceIds: bigint[], tx?: PrismaTx): Promise<Map<string, number>> {
    const db = tx ?? this.prisma;
    if (pieceIds.length === 0) return new Map();

    const [batches, transferredItems] = await Promise.all([
      db.productionBatch.findMany({
        where: {
          pieceId: { in: pieceIds },
          status: ProductionBatchStatus.QC_DONE,
          stage: MfgStage.PHOI,
        },
        select: { pieceId: true, reportedQty: true },
      }),
      db.warehouseTransferPieceItem.findMany({
        where: {
          pieceId: { in: pieceIds },
          transfer: {
            status: { in: [TransferStatus.PENDING, TransferStatus.CONFIRMED] },
            ...PIECE_TRANSFER_LEAVES_FRAME,
          },
        },
        select: { pieceId: true, quantity: true },
      }),
    ]);

    const readyByPiece = new Map<string, number>();
    for (const b of batches) {
      const key = b.pieceId.toString();
      readyByPiece.set(key, (readyByPiece.get(key) ?? 0) + b.reportedQty);
    }
    for (const t of transferredItems) {
      const key = t.pieceId.toString();
      readyByPiece.set(key, (readyByPiece.get(key) ?? 0) - t.quantity);
    }
    for (const [key, qty] of readyByPiece) {
      readyByPiece.set(key, Math.max(0, qty));
    }
    return readyByPiece;
  }

  /** Tồn material (vd thanh nhôm) hiện có tại kho của material đó + processSteps (chuẩn hoá thứ
   *  tự) + qtyPerPiece, theo từng piece có PieceMaterialYield trên revision này - dùng cho banner
   *  cảnh báo và tiến độ công đoạn ở getBatchPlan() stage=PHOI. */
  private async getPieceMaterialYieldExtrasByPiece(
    bomRevisionId: bigint,
    pieceIds: bigint[],
  ): Promise<Map<string, PieceMaterialYieldExtras>> {
    if (pieceIds.length === 0) return new Map();
    const yields = await this.prisma.pieceMaterialYield.findMany({
      where: { bomRevisionId, pieceId: { in: pieceIds } },
    });
    if (yields.length === 0) return new Map();

    const materialIds = [...new Set(yields.map((y) => y.materialId))];
    const quants = await this.prisma.stockQuant.findMany({
      where: { materialId: { in: materialIds } },
    });
    const onHandByMaterial = new Map<string, number>();
    for (const q of quants) {
      const key = q.materialId!.toString();
      onHandByMaterial.set(key, (onHandByMaterial.get(key) ?? 0) + q.qty.toNumber());
    }

    // 2026-10-03: gộp theo piece thay vì ghi đè - xem doc comment mergeYieldExtrasGroup().
    const rowsByPiece = new Map<string, typeof yields>();
    for (const y of yields) {
      const key = y.pieceId.toString();
      const arr = rowsByPiece.get(key);
      if (arr) arr.push(y);
      else rowsByPiece.set(key, [y]);
    }
    const result = new Map<string, PieceMaterialYieldExtras>();
    for (const [pieceKey, rows] of rowsByPiece) {
      result.set(pieceKey, this.mergeYieldExtrasGroup(rows, onHandByMaterial));
    }
    return result;
  }

  /** Gộp nhiều dòng PieceMaterialYield của CÙNG 1 piece thành 1 `PieceMaterialYieldExtras` hiển thị
   *  (2026-10-03, từ khi 1 piece có thể có nhiều dòng Tự tính khác material). processSteps = HỢP
   *  mọi dòng (piece báo công đoạn chung, xem mergeYieldProcessSteps). rawMaterialOnHand lấy tồn
   *  THẤP NHẤT trong các material (cảnh báo đúng tinh thần "còn thiếu nguyên liệu" - vật tư nào cạn
   *  trước là nút thắt thật). qtyPerPiece chỉ còn ý nghĩa hiển thị phụ chú khi piece có ĐÚNG 1
   *  material (giữ nguyên hành vi cũ) - piece có ≥2 material trả về null, KHÔNG đoán mò hiện nhầm tỉ
   *  lệ của 1 material cho người đọc hiểu lầm là áp dụng chung; FE cần bản chi tiết theo material thì
   *  làm riêng sau nếu phát sinh nhu cầu thật (cả 2 field ở đây chỉ dùng hiển thị cảnh báo, KHÔNG
   *  chặn nghiệp vụ nào - xem doc comment PieceMaterialYieldExtras). */
  private mergeYieldExtrasGroup(
    rows: { materialId: bigint; processSteps: ProcessStep[]; qtyPerPiece: number }[],
    onHandByMaterial: Map<string, number>,
  ): PieceMaterialYieldExtras {
    const onHandValues = rows.map((r) => onHandByMaterial.get(r.materialId.toString()) ?? 0);
    return {
      rawMaterialOnHand: Math.min(...onHandValues),
      processSteps: this.mergeYieldProcessSteps(rows),
      qtyPerPiece: rows.length === 1 ? rows[0].qtyPerPiece : null,
    };
  }

  private assertConsumableStage(stage: MfgStage): void {
    if (stage !== MfgStage.HAN && stage !== MfgStage.SON && stage !== MfgStage.PHOI) {
      throw new BadRequestException(
        `Báo sản lượng chỉ áp dụng cho công đoạn PHOI, HAN hoặc SON, nhận được '${stage}'`,
      );
    }
  }

  /** null = quản lý/tổng (PRODUCTION_MANAGER/BOSS/ADMIN) - không có gì để chặn, cùng idiom
   *  MaterialIssuesService.assertMfgRoleMatchesStage(). Khác null: đúng tổ Phôi/Hàn/Sơn mới báo
   *  được sản lượng công đoạn mình, không báo hộ nhau. PHOI ở đây là "Phôi tự báo cắt xong" theo
   *  định mức PieceMaterialYield (needsHan=false như chân nhôm, HOẶC needsHan=true như "pat" -
   *  vẫn còn báo Hàn riêng ở HAN sau đó) - khác hẳn STEEL_ISSUE:UPDATE (báo cắt sắt bin-packing
   *  cho mảnh không có PieceMaterialYield, xem SteelIssuesService.completeCutting()). */
  private assertMfgRoleMatchesStage(mfgRole: string | null, stage: MfgStage): void {
    if (!mfgRole) return;
    const expected =
      stage === MfgStage.PHOI ? MfgRole.PHOI : stage === MfgStage.HAN ? MfgRole.HAN : MfgRole.SON;
    if (mfgRole !== expected) {
      throw new ForbiddenException(
        `Tài khoản có mfgRole '${mfgRole}', không được báo sản lượng công đoạn ${stage}`,
      );
    }
  }

  /** { needsHan: true } (HAN) hoặc { needsSon: true } (SON) - CHỈ dùng cho 2 stage này.
   *  PHOI không dùng hàm này nữa (xem findPhoiEligibleBomPieces/assertPieceInBom): điều kiện báo
   *  ở PHOI không còn suy thẳng 1-1 từ 1 field needsHan - piece needsHan=true VẪN báo được ở PHOI
   *  nếu có PieceMaterialYield (vd "pat" cắt từ tấm sắt lá, cần Hàn sau khi cắt - khác chân nhôm
   *  needsHan=false không cần Hàn). Quyết định nghiệp vụ 2026-08-22. */
  private stageNeedsFilter(stage: Exclude<MfgStage, 'PHOI'>): Prisma.BomPieceWhereInput {
    return stage === MfgStage.HAN ? { needsHan: true } : { needsSon: true };
  }

  /** BomPiece đủ điều kiện báo ở PHOI: needsHan=false ("vật tư thành phẩm" truyền thống, vd chân
   *  nhôm - không cần Hàn) HOẶC có PieceMaterialYield dù needsHan=true (vd "pat" cắt từ tấm sắt
   *  lá - báo cắt ở PHOI xong vẫn phải báo Hàn riêng ở HAN như mảnh thường, PHOI+HAN là 2 bước
   *  độc lập). Không suy được bằng 1 Prisma where đơn (PieceMaterialYield không có FK ngược trên
   *  BomPiece) nên tra riêng rồi gộp ở tầng ứng dụng. */
  private async findPhoiEligibleBomPieces(bomRevisionId: bigint) {
    const [needsHanFalse, yields] = await Promise.all([
      this.prisma.bomPiece.findMany({
        where: { bomRevisionId, needsHan: false },
        include: { piece: true },
      }),
      this.prisma.pieceMaterialYield.findMany({
        where: { bomRevisionId },
        select: { pieceId: true },
      }),
    ]);
    const alreadyIncluded = new Set(needsHanFalse.map((bp) => bp.pieceId.toString()));
    const extraPieceIds = [...new Set(yields.map((y) => y.pieceId))].filter(
      (id) => !alreadyIncluded.has(id.toString()),
    );
    if (extraPieceIds.length === 0) return needsHanFalse;

    const extra = await this.prisma.bomPiece.findMany({
      where: { bomRevisionId, pieceId: { in: extraPieceIds } },
      include: { piece: true },
    });
    return [...needsHanFalse, ...extra];
  }

  private async assertPieceInBom(
    bomRevisionId: bigint,
    pieceId: bigint,
    stage: MfgStage,
  ): Promise<void> {
    const bomPiece = await this.prisma.bomPiece.findUnique({
      where: { bomRevisionId_pieceId: { bomRevisionId, pieceId } },
    });
    if (!bomPiece) {
      throw new NotFoundException(
        `Mảnh ${pieceId} không thuộc định mức (BOM) của lệnh sản xuất này`,
      );
    }
    let needsStage: boolean;
    if (stage === MfgStage.PHOI) {
      // 2026-10-03: findFirst thay findUnique - 1 piece giờ có thể có NHIỀU dòng Tự tính (khác
      // material), chỉ cần biết piece này CÓ dòng nào không, không cần đúng 1 dòng cụ thể.
      needsStage =
        !bomPiece.needsHan ||
        (await this.prisma.pieceMaterialYield.findFirst({
          where: { bomRevisionId, pieceId },
          select: { id: true },
        })) !== null;
    } else {
      needsStage = stage === MfgStage.HAN ? bomPiece.needsHan : bomPiece.needsSon;
    }
    if (!needsStage) {
      throw new BadRequestException(
        `Mảnh ${pieceId} không cần qua công đoạn ${stage} theo định mức (BOM) này`,
      );
    }
  }

  /**
   * Chặn "chưa nhận vật tư thành phẩm thì chưa báo được" (2026-09-04, mirror SteelIssue chặn báo
   * cắt khi status khác RECEIVED) - CHỈ áp dụng piece có PieceMaterialYield ở stage=PHOI (piece Sắt
   * thường/Hàn/Sơn không đụng). Áp dụng cho CẢ piece processSteps rỗng lẫn có khai, vì cả 2 đều
   * dùng chung nguyên liệu (Sắt La/thanh nhôm) phải xuất/nhận trước khi sản xuất - không chỉ riêng
   * piece có tick công đoạn.
   */
  /** HỢP (dedup) các processSteps của mọi dòng PieceMaterialYield thuộc 1 piece, sắp theo đúng thứ
   *  tự công đoạn chuẩn - dùng khi 1 piece có nhiều dòng Tự tính (2026-10-03), piece báo công đoạn
   *  1 lần cho cả piece chứ không tách riêng theo từng material. */
  private mergeYieldProcessSteps(yieldRows: { processSteps: ProcessStep[] }[]): ProcessStep[] {
    const set = new Set<ProcessStep>();
    for (const y of yieldRows) {
      for (const s of y.processSteps) set.add(s);
    }
    return sortProcessSteps([...set]);
  }

  private async assertMaterialYieldReceived(
    bomRevisionId: bigint,
    pieceId: bigint,
    productionOrderId: bigint,
    stage: MfgStage,
  ): Promise<void> {
    if (stage !== MfgStage.PHOI) return;
    const yieldRows = await this.prisma.pieceMaterialYield.findMany({
      where: { bomRevisionId, pieceId },
    });
    if (yieldRows.length === 0) return;
    // 2026-10-03: piece có thể có NHIỀU dòng Tự tính (khác material) - TẤT CẢ phải được nhận trước
    // khi báo sản lượng, thiếu bất kỳ dòng nào cũng chặn (giống hệt cần đủ NGUYÊN LIỆU đầu vào mới
    // sản xuất ra được, dù là 1 hay nhiều loại).
    for (const yieldRow of yieldRows) {
      const received = await this.materialYieldIssuesService.sumReceived(
        productionOrderId,
        yieldRow.materialId,
      );
      if (received <= 0) {
        throw new BadRequestException(
          `Mảnh ${pieceId} dùng vật tư thành phẩm chưa được xác nhận nhận từ kho - xác nhận nhận (Xác nhận nhận sắt) trước khi báo sản lượng`,
        );
      }
    }
  }

  private async findOrderOrThrow(id: string): Promise<ProductionOrder> {
    const bigId = parseBigIntId(id);
    const order = await this.prisma.productionOrder.findUnique({ where: { id: bigId } });
    if (!order) {
      throw new NotFoundException(`Không tìm thấy lệnh xưởng ${id}`);
    }
    return order;
  }

  /** Chỉ dùng bởi getBatchPlan() - cần thêm mfgProduct.name cho ProductionBatchPlanResponseDto,
   *  không đụng tới findOrderOrThrow() (create() không cần include này). */
  private async findOrderWithProductOrThrow(id: string) {
    const bigId = parseBigIntId(id);
    const order = await this.prisma.productionOrder.findUnique({
      where: { id: bigId },
      include: {
        mfgProduct: true,
        productionInvoiceItem: {
          select: { productionInvoiceId: true, salesOrder: { select: { orderCode: true } } },
        },
      },
    });
    if (!order) {
      throw new NotFoundException(`Không tìm thấy lệnh xưởng ${id}`);
    }
    return order;
  }

  private async findOneOrThrow(id: string): Promise<ProductionBatchRow> {
    const bigId = parseBigIntId(id);
    const batch = await this.prisma.productionBatch.findUnique({
      where: { id: bigId },
      include: PRODUCTION_BATCH_INCLUDE,
    });
    if (!batch) {
      throw new NotFoundException(`Không tìm thấy đợt sản xuất ${id}`);
    }
    return batch;
  }

  private toResponseDto(batch: ProductionBatchRow): ProductionBatchResponseDto {
    return new ProductionBatchResponseDto({
      id: batch.id.toString(),
      productionOrderId: batch.productionOrderId.toString(),
      poNumber: batch.productionOrder.poNumber,
      salesOrderCode: batch.productionOrder.productionInvoiceItem.salesOrder?.orderCode ?? null,
      piCode: batch.productionOrder.productionInvoiceItem.productionInvoice?.code ?? null,
      stage: batch.stage,
      pieceId: batch.pieceId.toString(),
      pieceCode: batch.piece.code,
      pieceName: batch.piece.name,
      reportedQty: batch.reportedQty,
      status: batch.status,
      reportedAt: batch.reportedAt,
      reportedById: batch.reportedById,
      reworkOfId: batch.reworkOfId?.toString() ?? null,
    });
  }

  private toPieceStepBatchResponseDto(row: {
    id: bigint;
    productionOrderId: bigint;
    pieceId: bigint;
    step: ProcessStep;
    qty: number;
    reportedAt: Date;
    reportedById: string;
  }): PieceStepBatchResponseDto {
    return new PieceStepBatchResponseDto({
      id: row.id.toString(),
      productionOrderId: row.productionOrderId.toString(),
      pieceId: row.pieceId.toString(),
      step: row.step,
      qty: row.qty,
      reportedAt: row.reportedAt,
      reportedById: row.reportedById,
    });
  }
}
