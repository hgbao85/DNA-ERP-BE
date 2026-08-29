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
  TransferStatus,
} from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { CreateProductionBatchDto } from './dto/create-production-batch.dto';
import { ListProductionBatchesQueryDto } from './dto/list-production-batches-query.dto';
import { ProductionBatchPlanItemResponseDto } from './dto/production-batch-plan-item-response.dto';
import { ProductionBatchPlanResponseDto } from './dto/production-batch-plan-response.dto';
import { ProductionBatchResponseDto } from './dto/production-batch-response.dto';

const PRODUCTION_BATCH_INCLUDE = {
  productionOrder: {
    include: { productionInvoiceItem: { select: { salesOrder: { select: { code: true } } } } },
  },
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
          undefined,
          { ...existing, bomRevisionId: existing.productionOrder.bomRevisionId },
          reportedById,
        );
        return this.toResponseDto(existing);
      }
    }

    const order = await this.findOrderOrThrow(productionOrderId);
    const pieceBigId = parseBigIntId(dto.pieceId);
    await this.assertPieceInBom(order.bomRevisionId, pieceBigId, dto.stage);

    // Tạo batch + ghi toàn bộ dòng StockLedger đoạn sắt tiêu thụ trong CÙNG 1 transaction - trước
    // đây 2 bước này chạy rời nhau, 1 dòng ledger lỗi giữa chừng (mất kết nối, timeout) để lại
    // batch đã tồn tại nhưng tồn đoạn sắt chỉ bị trừ 1 phần, không có gì phát hiện batch "dở dang".
    const created = await this.prisma.$transaction(async (tx) => {
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
      );
      return batch;
    });

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
    tx: PrismaTx | undefined,
    batch: {
      id: bigint;
      pieceId: bigint;
      reportedQty: number;
      bomRevisionId: bigint;
      stage: MfgStage;
    },
    reportedById: string,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const pieceBoms = await db.pieceBom.findMany({
      where: { bomRevisionId: batch.bomRevisionId, pieceId: batch.pieceId },
    });
    if (pieceBoms.length > 0) {
      const [fromWarehouse, toWarehouse] = await Promise.all([
        db.warehouse.findUniqueOrThrow({ where: { code: STEEL_WAREHOUSE_CODE } }),
        db.warehouse.findUniqueOrThrow({ where: { code: PRODUCTION_WAREHOUSE_CODE } }),
      ]);

      for (const pb of pieceBoms) {
        await this.stockLedgerService.postEntry(
          {
            fromWarehouseId: fromWarehouse.id,
            toWarehouseId: toWarehouse.id,
            segmentSpecId: pb.segmentSpecId,
            stockLengthMm: 0,
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

    // Không có PieceBom (không cắt từ đoạn sắt bin-packing) - kiểm định mức nguyên liệu vật tư
    // thành phẩm (PieceMaterialYield, vd thanh nhôm → chân nhôm, hoặc tấm sắt lá → pat). CHỈ trừ
    // tồn lúc PHOI báo cắt (tiêu thụ nguyên liệu thô) - piece có needsHan=true VÀ có
    // PieceMaterialYield (vd "pat", cần Hàn sau khi cắt) còn báo lại ở HAN, lúc đó KHÔNG được trừ
    // tồn nguyên liệu lần 2 (Hàn tiêu thụ output đã cắt xong, không tiêu thụ tấm sắt lá gốc).
    // Trừ THEO PHÂN SỐ cây (reportedQty / piecesPerBar, Decimal - KHÔNG làm tròn) để nhiều lần báo
    // nhỏ cộng dồn khớp chính xác; làm tròn số cây chỉ xảy ra lúc tính mua
    // (PieceMaterialYieldPurchaseService).
    if (batch.stage !== MfgStage.PHOI) return;
    await this.postMaterialYieldConsumeEntry(db, tx, batch, reportedById);
  }

  private async postMaterialYieldConsumeEntry(
    db: PrismaTx | PrismaServiceType,
    tx: PrismaTx | undefined,
    batch: { id: bigint; pieceId: bigint; reportedQty: number; bomRevisionId: bigint },
    reportedById: string,
  ): Promise<void> {
    const yieldRow = await db.pieceMaterialYield.findUnique({
      where: {
        bomRevisionId_pieceId: { bomRevisionId: batch.bomRevisionId, pieceId: batch.pieceId },
      },
      include: { material: { include: { warehouse: true } } },
    });
    if (!yieldRow || !yieldRow.material.warehouse) return;

    const toWarehouse = await db.warehouse.findUniqueOrThrow({
      where: { code: PRODUCTION_WAREHOUSE_CODE },
    });

    await this.stockLedgerService.postEntry(
      {
        fromWarehouseId: yieldRow.material.warehouse.id,
        toWarehouseId: toWarehouse.id,
        materialId: yieldRow.materialId,
        stockLengthMm: 0,
        qty: batch.reportedQty / yieldRow.piecesPerBar,
        refType: StockLedgerRefType.MATERIAL_YIELD_CONSUME,
        refId: batch.id.toString(),
        createdById: reportedById,
        idempotencyKey: `production-batch-material-yield-consume:${batch.id}:${yieldRow.materialId}`,
      },
      tx,
    );
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

    // Cảnh báo "còn nguyên liệu chưa cắt hết" (chỉ hiển thị, không chặn - quyết định nghiệp vụ
    // 2026-08-22) - chỉ tính cho stage=PHOI, chỉ cho piece có PieceMaterialYield.
    const rawMaterialOnHandByPiece =
      stage === MfgStage.PHOI
        ? await this.getRawMaterialOnHandByPiece(
            order.bomRevisionId,
            bomPieces.map((bp) => bp.pieceId),
          )
        : new Map<string, number>();

    const items = bomPieces.map((bp) => {
      const key = bp.pieceId.toString();
      return new ProductionBatchPlanItemResponseDto({
        pieceId: key,
        pieceCode: bp.piece.code,
        pieceName: bp.piece.name,
        plannedQty: bp.qtyPerUnit * order.quantity,
        awaitingQcQty: awaitingByPiece.get(key) ?? 0,
        passedQty: passedByPiece.get(key) ?? 0,
        rawMaterialOnHand: rawMaterialOnHandByPiece.get(key) ?? null,
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

  /** Tồn material (vd thanh nhôm) hiện có tại kho của material đó, theo từng piece có
   *  PieceMaterialYield trên revision này - dùng cho banner cảnh báo ở getBatchPlan() stage=PHOI. */
  private async getRawMaterialOnHandByPiece(
    bomRevisionId: bigint,
    pieceIds: bigint[],
  ): Promise<Map<string, number>> {
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

    const result = new Map<string, number>();
    for (const y of yields) {
      result.set(y.pieceId.toString(), onHandByMaterial.get(y.materialId.toString()) ?? 0);
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
}
