import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MfgRole,
  MfgStage,
  Prisma,
  ProcessStep,
  ProductionBatchStatus,
  ProductionOrder,
  StockLedgerRefType,
  TransferStatus,
} from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { ProcessStepValue, sortProcessSteps } from '../../common/constants/process-steps.constant';
import {
  assertItemPiHasActiveFloor,
  assertItemPiHasActiveFloorLocked,
} from '../../common/utils/floor-gate.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { isFamilyScope } from '../../common/utils/warehouse-family.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { MaterialYieldIssuesService } from '../material-yield-issues/material-yield-issues.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { CreatePieceStepBatchDto } from './dto/create-piece-step-batch.dto';
import { CreateProductionBatchDto } from './dto/create-production-batch.dto';
import { ListProductionBatchesQueryDto } from './dto/list-production-batches-query.dto';
import { PieceStepBatchResponseDto } from './dto/piece-step-batch-response.dto';
import { PieceStepProgressDto } from './dto/piece-step-progress.dto';
import { ProductionBatchPlanItemResponseDto } from './dto/production-batch-plan-item-response.dto';
import { ProductionBatchPlanResponseDto } from './dto/production-batch-plan-response.dto';
import { ProductionBatchResponseDto } from './dto/production-batch-response.dto';

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
    include: { productionInvoiceItem: { select: { salesOrder: { select: { code: true } } } } },
  },
  piece: true,
} satisfies Prisma.ProductionBatchInclude;

export type ProductionBatchRow = Prisma.ProductionBatchGetPayload<{
  include: typeof PRODUCTION_BATCH_INCLUDE;
}>;

/// Kho vật lý MẶC ĐỊNH liên quan đến đoạn sắt tồn (đoạn Phôi cắt ra nhập vào đây, thủ kho tự
/// đếm/tự nhập qua POST /stock-ledger/adjust - xem docs/quy-doi-doan-phoi.md, KHÔNG tự động từ
/// CuttingProposal). Đoạn sắt (segmentSpecId) KHÔNG phải Material nên không có warehouseId để tra
/// động như MaterialIssuesService/PackagingIssuesService (2026-09-03) - thay vào đó dùng chính
/// warehouseScope của người báo sản lượng (PHOI/HAN, mỗi tài khoản chỉ gắn đúng 1 kho phoi-son-han
/// cụ thể) làm kho nguồn, chỉ fallback về kho gốc khi caller không có scope (PRODUCTION_MANAGER/
/// BOSS/ADMIN báo hộ, hoặc dữ liệu cũ chưa gán warehouseScope).
const STEEL_WAREHOUSE_CODE = 'phoi-son-han';
/// Kho ảo cố định (protected-warehouse-codes.constant.ts) - cùng điểm đến dùng ở
/// MaterialIssuesService/CuttingProposalsService cho mọi luồng "tiêu hao tại xưởng".
const PRODUCTION_WAREHOUSE_CODE = 'PRODUCTION';

/**
 * Báo sản lượng Hàn/Sơn (M2, thay san-luong.service.ts mock - phần baoSanLuong()). Không cap
 * theo BOM lúc báo (mock không kiểm tra) - KCS mới là bước kiểm soát, xem
 * QcReviewsService.reviewProductionBatch(). Append-create, không state machine phức tạp: chỉ
 * AWAITING_QC (khởi tạo) -> QC_DONE (do QcReviewsService cập nhật, không phải service này).
 *
 * Từ 2026-08-14 (xem docs/quy-doi-doan-phoi.md, quyết định nghiệp vụ #4): mỗi lần báo sản lượng
 * cũng tự động ghi StockLedger trừ tồn ĐOẠN sắt (segmentSpecId) theo PieceBom.qtyPerPiece của
 * đúng mảnh vừa báo - refType SEGMENT_CONSUME (enum value có sẵn từ đầu, chưa từng được dùng).
 * Cố ý KHÔNG chặn khi tồn đoạn không đủ (StockQuant được phép âm) - cùng triết lý "không cap
 * theo BOM lúc báo" đã áp dụng cho reportedQty, tránh chặn oan công nhân vì thủ kho nhập tồn
 * trễ hơn thực tế cắt.
 */
@Injectable()
export class ProductionBatchesService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly stockLedgerService: StockLedgerService,
    private readonly materialYieldIssuesService: MaterialYieldIssuesService,
  ) {}

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
    // Kho phoi-son-han CỤ THỂ để trừ tồn đoạn sắt - lấy từ chính scope của người báo (mỗi tài
    // khoản PHOI/HAN chỉ gắn đúng 1 kho), fallback về kho gốc nếu không có scope (quản lý/tổng báo
    // hộ). Không dùng warehouseScope thẳng nếu nó KHÔNG thuộc gia đình phoi-son-han (dữ liệu bất
    // thường) - vẫn fallback an toàn về kho gốc thay vì trừ nhầm kho khác.
    const sourceWarehouseCode = isFamilyScope(warehouseScope, 'phoi-son-han')
      ? warehouseScope!
      : STEEL_WAREHOUSE_CODE;

    if (idempotencyKey) {
      const existing = await this.prisma.productionBatch.findUnique({
        where: { idempotencyKey },
        include: PRODUCTION_BATCH_INCLUDE,
      });
      if (existing) {
        await this.postSegmentConsumeEntries(
          undefined,
          { ...existing, bomRevisionId: existing.productionOrder.bomRevisionId },
          reportedById,
          sourceWarehouseCode,
        );
        return this.toResponseDto(existing);
      }
    }

    const order = await this.findOrderOrThrow(productionOrderId);
    await assertItemPiHasActiveFloor(this.prisma, order.productionInvoiceItemId, 'báo sản lượng');
    const pieceBigId = parseBigIntId(dto.pieceId);
    await this.assertPieceInBom(order.bomRevisionId, pieceBigId, dto.stage);
    await this.assertMaterialYieldReceived(order.bomRevisionId, pieceBigId, order.id, dto.stage);

    // Tạo batch + ghi toàn bộ dòng StockLedger đoạn sắt tiêu thụ trong CÙNG 1 transaction - trước
    // đây 2 bước này chạy rời nhau, 1 dòng ledger lỗi giữa chừng (mất kết nối, timeout) để lại
    // batch đã tồn tại nhưng tồn đoạn sắt chỉ bị trừ 1 phần, không có gì phát hiện batch "dở dang".
    // Timeout tuỳ chỉnh (mặc định Prisma chỉ 5000ms) - postSegmentConsumeEntries() ghi TUẦN TỰ 1
    // dòng StockLedger/segmentSpecId (mảnh có thể ghép từ nhiều cỡ đoạn), đo thực tế với DB pooled
    // remote hết ~3.7s cho 3 dòng - sát mức 5000ms mặc định, phát hiện qua browser thật 2026-08-31
    // (báo sản lượng lỗi 500 "Database error" ngẫu nhiên - Prisma timeout transaction rơi vào
    // nhánh default của AllExceptionsFilter.mapPrismaError(), không phải lỗi nghiệp vụ).
    const created = await this.prisma.$transaction(
      async (tx) => {
        await assertItemPiHasActiveFloorLocked(tx, order.productionInvoiceItemId, 'báo sản lượng');

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

        await this.postSegmentConsumeEntries(
          tx,
          { ...batch, bomRevisionId: order.bomRevisionId },
          reportedById,
          sourceWarehouseCode,
        );
        return batch;
      },
      { timeout: 20_000 },
    );

    return this.toResponseDto(created);
  }

  /**
   * Phôi báo "vừa {step} xong N mảnh" cho vật tư thành phẩm (PieceMaterialYield.processSteps,
   * thêm 2026-09-04) - trước khi chốt lô ProductionBatch thật qua create() để gửi KCS. Khuôn chép
   * MaterialIssuesService.create() (Idempotency-Key + $transaction + lockBusinessKey), KHÔNG chép
   * SteelIssuesService.recordStepBatch() (hàm đó thiếu cả 3 thứ này - khe TOCTOU thật khi 2 người
   * báo cùng lúc, xem comment process-steps.constant.ts).
   *
   * Chặn "bước sau vượt bước liền trước" (giống recordStepBatch chặn vượt catDone) - bước ĐẦU
   * TIÊN trong processSteps KHÔNG bị cap theo plannedQty, nhất quán triết lý "không cap theo BOM
   * lúc báo, KCS mới là bước kiểm soát" (comment đầu file). Piece không có PieceMaterialYield hoặc
   * processSteps rỗng ⇒ BadRequest, bắt buộc dùng luồng cũ (báo thẳng qua create()) - đây là biên
   * tương thích ngược bắt buộc, KHÔNG được nới lỏng.
   *
   * KHÔNG chặn "chốt lô mà chưa báo đủ công đoạn" ở create() - quyết định nghiệp vụ 2026-09-04,
   * cùng triết lý "không chặn oan công nhân, KCS mới là bước kiểm soát" đã lặp lại nhiều lần trong
   * module này. FE tự cảnh báo (không chặn) dựa trên stepProgress trả về từ getBatchPlan().
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

    const yieldRow = await this.prisma.pieceMaterialYield.findUnique({
      where: { bomRevisionId_pieceId: { bomRevisionId: order.bomRevisionId, pieceId: pieceBigId } },
    });
    if (!yieldRow) {
      throw new BadRequestException(
        `Mảnh ${dto.pieceId} không có định mức vật tư thành phẩm - không báo công đoạn ở đây`,
      );
    }
    const received = await this.materialYieldIssuesService.sumReceived(
      order.id,
      yieldRow.materialId,
    );
    if (received <= 0) {
      throw new BadRequestException(
        `Mảnh ${dto.pieceId} dùng vật tư thành phẩm chưa được xác nhận nhận từ kho - xác nhận nhận (Xác nhận nhận sắt) trước khi báo công đoạn`,
      );
    }
    const orderedSteps = sortProcessSteps(yieldRow.processSteps);
    if (orderedSteps.length === 0) {
      throw new BadRequestException(
        `Mảnh ${dto.pieceId} chưa khai công đoạn nào theo định mức - báo thẳng sản lượng`,
      );
    }
    if (!orderedSteps.includes(dto.step)) {
      throw new BadRequestException(
        `Mảnh ${dto.pieceId} không có công đoạn '${dto.step}' theo định mức`,
      );
    }
    const stepIndex = orderedSteps.indexOf(dto.step);
    const prevStep = stepIndex > 0 ? orderedSteps[stepIndex - 1] : null;

    const created = await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `piece-step-batch:${order.id}:${pieceBigId}:${dto.step}`);
      await assertItemPiHasActiveFloorLocked(tx, order.productionInvoiceItemId, 'báo công đoạn');

      if (prevStep) {
        const [donePrevAgg, doneThisAgg] = await Promise.all([
          tx.pieceStepBatch.aggregate({
            where: { productionOrderId: order.id, pieceId: pieceBigId, step: prevStep },
            _sum: { qty: true },
          }),
          tx.pieceStepBatch.aggregate({
            where: { productionOrderId: order.id, pieceId: pieceBigId, step: dto.step },
            _sum: { qty: true },
          }),
        ]);
        const donePrev = donePrevAgg._sum.qty ?? 0;
        const doneThis = doneThisAgg._sum.qty ?? 0;
        if (doneThis + dto.qty > donePrev) {
          throw new BadRequestException(
            `Mảnh ${dto.pieceId}: đã '${prevStep}' ${donePrev} mảnh, đã '${dto.step}' ${doneThis} ` +
              `mảnh - không thể báo thêm ${dto.qty} (vượt bước trước, tối đa còn ${donePrev - doneThis})`,
          );
        }
      }

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
    });

    return this.toPieceStepBatchResponseDto(created);
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

      for (const pb of pieceBoms) {
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

    const [bomPieces, batches] = await Promise.all([
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
    ]);

    const awaitingByPiece = new Map<string, number>();
    const passedByPiece = new Map<string, number>();
    for (const b of batches) {
      const key = b.pieceId.toString();
      const target =
        b.status === ProductionBatchStatus.AWAITING_QC ? awaitingByPiece : passedByPiece;
      target.set(key, (target.get(key) ?? 0) + b.reportedQty);
    }

    // Cảnh báo "còn nguyên liệu chưa cắt hết" + tiến độ công đoạn (chỉ hiển thị, không chặn -
    // quyết định nghiệp vụ 2026-08-22 và 2026-09-04) - chỉ tính cho stage=PHOI, chỉ cho piece có
    // PieceMaterialYield.
    const [extrasByPiece, stepBatchDoneMap] =
      stage === MfgStage.PHOI
        ? await Promise.all([
            this.getPieceMaterialYieldExtrasByPiece(
              order.bomRevisionId,
              bomPieces.map((bp) => bp.pieceId),
            ),
            this.getStepBatchDoneMap([order.id]),
          ])
        : [new Map<string, PieceMaterialYieldExtras>(), new Map<string, number>()];

    const items = bomPieces.map((bp) => {
      const key = bp.pieceId.toString();
      const plannedQty = bp.qtyPerUnit * order.quantity;
      const extras = extrasByPiece.get(key);
      const processSteps = extras?.processSteps ?? [];
      return new ProductionBatchPlanItemResponseDto({
        pieceId: key,
        pieceCode: bp.piece.code,
        pieceName: bp.piece.name,
        plannedQty,
        awaitingQcQty: awaitingByPiece.get(key) ?? 0,
        passedQty: passedByPiece.get(key) ?? 0,
        rawMaterialOnHand: extras?.rawMaterialOnHand ?? null,
        processSteps,
        stepProgress: processSteps.map(
          (step) =>
            new PieceStepProgressDto({
              step,
              requiredQty: plannedQty,
              doneQty: stepBatchDoneMap.get(`${order.id}:${key}:${step}`) ?? 0,
            }),
        ),
        qtyPerPiece: extras?.qtyPerPiece ?? null,
      });
    });

    return new ProductionBatchPlanResponseDto({
      poNumber: order.poNumber,
      salesOrderCode: order.productionInvoiceItem.salesOrder?.code ?? null,
      productName: order.mfgProduct.name,
      quantity: order.quantity,
      items,
    });
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
        productionInvoiceItem: { select: { salesOrder: { select: { code: true } } } },
      },
    });
    const revisionIds = [...new Set(orders.map((o) => o.bomRevisionId))];

    const [bomPiecesByRevision, extrasByRevision, batches, stepBatchDoneMap] = await Promise.all([
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
    ]);

    const awaitingByOrderPiece = new Map<string, number>();
    const passedByOrderPiece = new Map<string, number>();
    for (const b of batches) {
      const key = `${b.productionOrderId}:${b.pieceId}`;
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
          plannedQty,
          awaitingQcQty: awaitingByOrderPiece.get(orderPieceKey) ?? 0,
          passedQty: passedByOrderPiece.get(orderPieceKey) ?? 0,
          rawMaterialOnHand: extras?.rawMaterialOnHand ?? null,
          processSteps,
          stepProgress: processSteps.map(
            (step) =>
              new PieceStepProgressDto({
                step,
                requiredQty: plannedQty,
                doneQty: stepBatchDoneMap.get(`${orderPieceKey}:${step}`) ?? 0,
              }),
          ),
          qtyPerPiece: extras?.qtyPerPiece ?? null,
        });
      });

      result[order.id.toString()] = new ProductionBatchPlanResponseDto({
        poNumber: order.poNumber,
        salesOrderCode: order.productionInvoiceItem.salesOrder?.code ?? null,
        productName: order.mfgProduct.name,
        quantity: order.quantity,
        items,
      });
    }
    return result;
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

    for (const y of yields) {
      const revKey = y.bomRevisionId.toString();
      const inner = result.get(revKey) ?? new Map<string, PieceMaterialYieldExtras>();
      inner.set(y.pieceId.toString(), {
        rawMaterialOnHand: onHandByMaterial.get(y.materialId.toString()) ?? 0,
        processSteps: sortProcessSteps(y.processSteps),
        qtyPerPiece: y.qtyPerPiece,
      });
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
          transfer: { status: { in: [TransferStatus.PENDING, TransferStatus.CONFIRMED] } },
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

    const result = new Map<string, PieceMaterialYieldExtras>();
    for (const y of yields) {
      result.set(y.pieceId.toString(), {
        rawMaterialOnHand: onHandByMaterial.get(y.materialId.toString()) ?? 0,
        processSteps: sortProcessSteps(y.processSteps),
        qtyPerPiece: y.qtyPerPiece,
      });
    }
    return result;
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
        `Caller có mfgRole '${mfgRole}', không được báo sản lượng công đoạn ${stage}`,
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
      needsStage =
        !bomPiece.needsHan ||
        (await this.prisma.pieceMaterialYield.findUnique({
          where: { bomRevisionId_pieceId: { bomRevisionId, pieceId } },
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
  private async assertMaterialYieldReceived(
    bomRevisionId: bigint,
    pieceId: bigint,
    productionOrderId: bigint,
    stage: MfgStage,
  ): Promise<void> {
    if (stage !== MfgStage.PHOI) return;
    const yieldRow = await this.prisma.pieceMaterialYield.findUnique({
      where: { bomRevisionId_pieceId: { bomRevisionId, pieceId } },
    });
    if (!yieldRow) return;
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

  private async findOrderOrThrow(id: string): Promise<ProductionOrder> {
    const bigId = parseBigIntId(id);
    const order = await this.prisma.productionOrder.findUnique({ where: { id: bigId } });
    if (!order) {
      throw new NotFoundException(`Production order ${id} not found`);
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
        productionInvoiceItem: { select: { salesOrder: { select: { code: true } } } },
      },
    });
    if (!order) {
      throw new NotFoundException(`Production order ${id} not found`);
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
      throw new NotFoundException(`Production batch ${id} not found`);
    }
    return batch;
  }

  private toResponseDto(batch: ProductionBatchRow): ProductionBatchResponseDto {
    return new ProductionBatchResponseDto({
      id: batch.id.toString(),
      productionOrderId: batch.productionOrderId.toString(),
      poNumber: batch.productionOrder.poNumber,
      salesOrderCode: batch.productionOrder.productionInvoiceItem.salesOrder?.code ?? null,
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
