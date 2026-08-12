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
} from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CreateProductionBatchDto } from './dto/create-production-batch.dto';
import { ListProductionBatchesQueryDto } from './dto/list-production-batches-query.dto';
import { ProductionBatchPlanItemResponseDto } from './dto/production-batch-plan-item-response.dto';
import { ProductionBatchPlanResponseDto } from './dto/production-batch-plan-response.dto';
import { ProductionBatchResponseDto } from './dto/production-batch-response.dto';

const PRODUCTION_BATCH_INCLUDE = {
  productionOrder: true,
  part: true,
} satisfies Prisma.ProductionBatchInclude;

export type ProductionBatchRow = Prisma.ProductionBatchGetPayload<{
  include: typeof PRODUCTION_BATCH_INCLUDE;
}>;

/**
 * Báo sản lượng Hàn/Sơn (M2, thay san-luong.service.ts mock - phần baoSanLuong()). Không cap
 * theo BOM lúc báo (mock không kiểm tra) - KCS mới là bước kiểm soát, xem
 * QcReviewsService.reviewProductionBatch(). Append-create, không state machine phức tạp: chỉ
 * AWAITING_QC (khởi tạo) -> QC_DONE (do QcReviewsService cập nhật, không phải service này).
 */
@Injectable()
export class ProductionBatchesService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

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
        return this.toResponseDto(existing);
      }
    }

    const order = await this.findOrderOrThrow(productionOrderId);
    const partBigId = parseBigIntId(dto.partId);
    await this.assertPartInBom(order.bomRevisionId, partBigId);

    const created = await this.prisma.productionBatch.create({
      data: {
        stage: dto.stage,
        productionOrderId: order.id,
        partId: partBigId,
        reportedQty: dto.reportedQty,
        reportedById,
        idempotencyKey,
      },
      include: PRODUCTION_BATCH_INCLUDE,
    });

    return this.toResponseDto(created);
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
   * "Còn phải báo bao nhiêu" theo part - cho HAN_STAFF/SON_STAFF tự tra partId thật để báo sản
   * lượng, không cần BOM_REVISION:VIEW (chỉ cần biết trước productionOrderId, xem
   * PRODUCTION_ORDER:VIEW mới cấp cho 2 role này). BomPart không filter theo stage (không có cột
   * này - 1 Part vật lý đi qua cả Hàn rồi Sơn) nên trả TOÀN BỘ part của BOM; awaitingQcQty/
   * passedQty mới tính riêng theo đúng stage từ ProductionBatch, cùng idiom
   * MaterialIssuesService.getIssuePlan().
   */
  async getBatchPlan(
    productionOrderId: string,
    stage: MfgStage,
  ): Promise<ProductionBatchPlanResponseDto> {
    this.assertConsumableStage(stage);
    const order = await this.findOrderWithProductOrThrow(productionOrderId);

    const [bomParts, batches] = await Promise.all([
      this.prisma.bomPart.findMany({
        where: { bomRevisionId: order.bomRevisionId },
        include: { part: true },
      }),
      this.prisma.productionBatch.findMany({
        where: { productionOrderId: order.id, stage },
        select: { partId: true, status: true, reportedQty: true },
      }),
    ]);

    const awaitingByPart = new Map<string, number>();
    const passedByPart = new Map<string, number>();
    for (const b of batches) {
      const key = b.partId.toString();
      const target = b.status === ProductionBatchStatus.AWAITING_QC ? awaitingByPart : passedByPart;
      target.set(key, (target.get(key) ?? 0) + b.reportedQty);
    }

    const items = bomParts.map((bp) => {
      const key = bp.partId.toString();
      return new ProductionBatchPlanItemResponseDto({
        partId: key,
        partCode: bp.part.code,
        partName: bp.part.name,
        plannedQty: bp.qtyPerUnit * order.quantity,
        awaitingQcQty: awaitingByPart.get(key) ?? 0,
        passedQty: passedByPart.get(key) ?? 0,
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

  private async assertPartInBom(bomRevisionId: bigint, partId: bigint): Promise<void> {
    const bomPart = await this.prisma.bomPart.findUnique({
      where: { bomRevisionId_partId: { bomRevisionId, partId } },
    });
    if (!bomPart) {
      throw new NotFoundException(
        `Chi tiết ${partId} không thuộc định mức (BOM) của lệnh sản xuất này`,
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
      partId: batch.partId.toString(),
      partCode: batch.part.code,
      partName: batch.part.name,
      reportedQty: batch.reportedQty,
      status: batch.status,
      reportedAt: batch.reportedAt,
      reportedById: batch.reportedById,
      reworkOfId: batch.reworkOfId?.toString() ?? null,
    });
  }
}
