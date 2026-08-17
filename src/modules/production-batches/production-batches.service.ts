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
  ProductionBatchStatus,
  ProductionOrder,
  StockLedgerRefType,
} from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { CreateProductionBatchDto } from './dto/create-production-batch.dto';
import { ListProductionBatchesQueryDto } from './dto/list-production-batches-query.dto';
import { ProductionBatchPlanItemResponseDto } from './dto/production-batch-plan-item-response.dto';
import { ProductionBatchPlanResponseDto } from './dto/production-batch-plan-response.dto';
import { ProductionBatchResponseDto } from './dto/production-batch-response.dto';

const PRODUCTION_BATCH_INCLUDE = {
  productionOrder: true,
  piece: true,
} satisfies Prisma.ProductionBatchInclude;

export type ProductionBatchRow = Prisma.ProductionBatchGetPayload<{
  include: typeof PRODUCTION_BATCH_INCLUDE;
}>;

/// Kho vật lý duy nhất liên quan đến đoạn sắt tồn - cùng giá trị STEEL_WAREHOUSE_CODE ở
/// steel-issues.service.ts (đoạn Phôi cắt ra nhập vào đây, thủ kho tự đếm/tự nhập qua
/// POST /stock-ledger/adjust - xem docs/quy-doi-doan-phoi.md, KHÔNG tự động từ CuttingProposal).
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
  ) {}

  async create(
    productionOrderId: string,
    dto: CreateProductionBatchDto,
    reportedById: string,
    callerMfgRole: string | null,
    idempotencyKey?: string,
  ): Promise<ProductionBatchResponseDto> {
    this.assertConsumableStage(dto.stage);
    this.assertMfgRoleMatchesStage(callerMfgRole, dto.stage);

    if (idempotencyKey) {
      const existing = await this.prisma.productionBatch.findUnique({
        where: { idempotencyKey },
        include: PRODUCTION_BATCH_INCLUDE,
      });
      if (existing) {
        await this.postSegmentConsumeEntries(
          { ...existing, bomRevisionId: existing.productionOrder.bomRevisionId },
          reportedById,
        );
        return this.toResponseDto(existing);
      }
    }

    const order = await this.findOrderOrThrow(productionOrderId);
    const pieceBigId = parseBigIntId(dto.pieceId);
    await this.assertPieceInBom(order.bomRevisionId, pieceBigId);

    const created = await this.prisma.productionBatch.create({
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
      { ...created, bomRevisionId: order.bomRevisionId },
      reportedById,
    );
    return this.toResponseDto(created);
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
    batch: { id: bigint; pieceId: bigint; reportedQty: number; bomRevisionId: bigint },
    reportedById: string,
  ): Promise<void> {
    const pieceBoms = await this.prisma.pieceBom.findMany({
      where: { bomRevisionId: batch.bomRevisionId, pieceId: batch.pieceId },
    });
    if (pieceBoms.length === 0) return;

    const [fromWarehouse, toWarehouse] = await Promise.all([
      this.prisma.warehouse.findUniqueOrThrow({ where: { code: STEEL_WAREHOUSE_CODE } }),
      this.prisma.warehouse.findUniqueOrThrow({ where: { code: PRODUCTION_WAREHOUSE_CODE } }),
    ]);

    for (const pb of pieceBoms) {
      await this.stockLedgerService.postEntry({
        fromWarehouseId: fromWarehouse.id,
        toWarehouseId: toWarehouse.id,
        segmentSpecId: pb.segmentSpecId,
        qty: pb.qtyPerPiece * batch.reportedQty,
        refType: StockLedgerRefType.SEGMENT_CONSUME,
        refId: batch.id.toString(),
        createdById: reportedById,
        idempotencyKey: `production-batch-segment-consume:${batch.id}:${pb.segmentSpecId}`,
      });
    }
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
   * "Còn phải báo bao nhiêu" theo mảnh - cho HAN_STAFF/SON_STAFF tự tra pieceId thật để báo sản
   * lượng, không cần BOM_REVISION:VIEW (chỉ cần biết trước productionOrderId, xem
   * PRODUCTION_ORDER:VIEW mới cấp cho 2 role này). BomPiece không filter theo stage (không có cột
   * này - 1 mảnh vật lý đi qua cả Hàn rồi Sơn rồi Đan) nên trả TOÀN BỘ mảnh của BOM; awaitingQcQty/
   * passedQty mới tính riêng theo đúng stage từ ProductionBatch, cùng idiom
   * MaterialIssuesService.getIssuePlan().
   */
  async getBatchPlan(
    productionOrderId: string,
    stage: MfgStage,
  ): Promise<ProductionBatchPlanResponseDto> {
    this.assertConsumableStage(stage);
    const order = await this.findOrderWithProductOrThrow(productionOrderId);

    const [bomPieces, batches] = await Promise.all([
      this.prisma.bomPiece.findMany({
        where: { bomRevisionId: order.bomRevisionId },
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

    const items = bomPieces.map((bp) => {
      const key = bp.pieceId.toString();
      return new ProductionBatchPlanItemResponseDto({
        pieceId: key,
        pieceCode: bp.piece.code,
        pieceName: bp.piece.name,
        plannedQty: bp.qtyPerUnit * order.quantity,
        awaitingQcQty: awaitingByPiece.get(key) ?? 0,
        passedQty: passedByPiece.get(key) ?? 0,
      });
    });

    return new ProductionBatchPlanResponseDto({
      poNumber: order.poNumber,
      productName: order.mfgProduct.name,
      quantity: order.quantity,
      items,
    });
  }

  private assertConsumableStage(stage: MfgStage): void {
    if (stage !== MfgStage.HAN && stage !== MfgStage.SON) {
      throw new BadRequestException(
        `Báo sản lượng chỉ áp dụng cho công đoạn HAN hoặc SON, nhận được '${stage}'`,
      );
    }
  }

  /** null = quản lý/tổng (PRODUCTION_MANAGER/BOSS/ADMIN) - không có gì để chặn, cùng idiom
   *  MaterialIssuesService.assertMfgRoleMatchesStage(). Khác null: đúng tổ Hàn/Sơn mới báo được
   *  sản lượng công đoạn mình, HAN không báo hộ SON và ngược lại. */
  private assertMfgRoleMatchesStage(mfgRole: string | null, stage: MfgStage): void {
    if (!mfgRole) return;
    const expected = stage === MfgStage.HAN ? MfgRole.HAN : MfgRole.SON;
    if (mfgRole !== expected) {
      throw new ForbiddenException(
        `Caller có mfgRole '${mfgRole}', không được báo sản lượng công đoạn ${stage}`,
      );
    }
  }

  private async assertPieceInBom(bomRevisionId: bigint, pieceId: bigint): Promise<void> {
    const bomPiece = await this.prisma.bomPiece.findUnique({
      where: { bomRevisionId_pieceId: { bomRevisionId, pieceId } },
    });
    if (!bomPiece) {
      throw new NotFoundException(
        `Mảnh ${pieceId} không thuộc định mức (BOM) của lệnh sản xuất này`,
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
      include: { mfgProduct: true },
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
}
