import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Prisma, StockLedgerRefType } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { ListStockLedgerQueryDto } from './dto/list-stock-ledger-query.dto';
import { StockLedgerResponseDto } from './dto/stock-ledger-response.dto';

type StockLedgerWithRefs = Prisma.StockLedgerGetPayload<{
  include: {
    fromWarehouse: true;
    toWarehouse: true;
    material: true;
    segmentSpec: { include: { material: true } };
    piece: true;
    productVariant: true;
  };
}>;

const LEDGER_INCLUDE = {
  fromWarehouse: true,
  toWarehouse: true,
  material: true,
  segmentSpec: { include: { material: true } },
  piece: true,
  productVariant: true,
} satisfies Prisma.StockLedgerInclude;

/** Input to postEntry() - callers already resolved every id to a bigint/known value. */
export interface PostStockEntryInput {
  fromWarehouseId: bigint;
  toWarehouseId: bigint;
  materialId?: bigint;
  segmentSpecId?: bigint;
  pieceId?: bigint;
  productVariantId?: bigint;
  qty: number;
  refType: StockLedgerRefType;
  refId?: string;
  note?: string;
  createdById?: string;
  /** Chỉ set khi gọi từ POST /stock-ledger/adjust - xem StockLedgerService.adjust(). */
  idempotencyKey?: string;
}

/**
 * Sổ cái kho bút toán kép - nguồn sự thật duy nhất của tồn kho (docs/dna-erp-db-schema.html
 * mục 1.8). postEntry() là API duy nhất để ghi bảng này, dùng lại bởi StockLedgerService.adjust()
 * và bởi mọi module nghiệp vụ ghi kho ở các Phase sau (Purchasing nhận hàng, Phôi xuất sắt, KCS
 * chấm phế, WarehouseTransfersService.confirm()...) - không có endpoint POST công khai tự do
 * nào khác. stock_quant được đồng bộ bởi trigger DB ngay khi dòng này insert xong, service
 * không tự tính lại số dư.
 */
@Injectable()
export class StockLedgerService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async postEntry(input: PostStockEntryInput): Promise<StockLedgerResponseDto> {
    this.assertExactlyOneGoodsLeg(input);
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw new BadRequestException('fromWarehouseId và toWarehouseId không được trùng nhau');
    }
    if (!(input.qty > 0)) {
      throw new BadRequestException('qty phải lớn hơn 0');
    }

    const data: Prisma.StockLedgerCreateInput = {
      fromWarehouse: { connect: { id: input.fromWarehouseId } },
      toWarehouse: { connect: { id: input.toWarehouseId } },
      material: input.materialId ? { connect: { id: input.materialId } } : undefined,
      segmentSpec: input.segmentSpecId ? { connect: { id: input.segmentSpecId } } : undefined,
      piece: input.pieceId ? { connect: { id: input.pieceId } } : undefined,
      productVariant: input.productVariantId
        ? { connect: { id: input.productVariantId } }
        : undefined,
      qty: input.qty,
      refType: input.refType,
      refId: input.refId,
      note: input.note,
      createdBy: input.createdById ? { connect: { id: input.createdById } } : undefined,
      idempotencyKey: input.idempotencyKey,
    };

    if (input.idempotencyKey) {
      const existing = await this.prisma.stockLedger.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: LEDGER_INCLUDE,
      });
      if (existing) {
        return this.toResponseDto(existing);
      }
    }

    try {
      const row = await this.prisma.stockLedger.create({ data, include: LEDGER_INCLUDE });
      return this.toResponseDto(row);
    } catch (e) {
      // Đua 2 request cùng Idempotency-Key gần như đồng thời - fetch lại thay vì để lộ 409 giả
      // (cùng idiom resolve-or-create đã dùng ở SkusService.resolveDraftBomRevision).
      if (
        input.idempotencyKey &&
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const raced = await this.prisma.stockLedger.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: LEDGER_INCLUDE,
        });
        if (raced) {
          return this.toResponseDto(raced);
        }
      }
      throw e;
    }
  }

  async adjust(
    dto: CreateStockAdjustmentDto,
    idempotencyKey: string,
    userId: string,
    warehouseScope: string | null,
  ): Promise<StockLedgerResponseDto> {
    await this.assertScopeTouchesWarehouses(
      warehouseScope,
      parseBigIntId(dto.fromWarehouseId),
      parseBigIntId(dto.toWarehouseId),
    );
    return this.postEntry({
      fromWarehouseId: parseBigIntId(dto.fromWarehouseId),
      toWarehouseId: parseBigIntId(dto.toWarehouseId),
      materialId: dto.materialId ? parseBigIntId(dto.materialId) : undefined,
      segmentSpecId: dto.segmentSpecId ? parseBigIntId(dto.segmentSpecId) : undefined,
      pieceId: dto.pieceId ? parseBigIntId(dto.pieceId) : undefined,
      productVariantId: dto.productVariantId ? parseBigIntId(dto.productVariantId) : undefined,
      qty: dto.qty,
      refType: StockLedgerRefType.ADJUST,
      note: dto.note,
      createdById: userId,
      idempotencyKey,
    });
  }

  async findAll(query: ListStockLedgerQueryDto): Promise<Paginated<StockLedgerResponseDto>> {
    const where: Prisma.StockLedgerWhereInput = {
      refType: query.refType,
      materialId: query.materialId ? parseBigIntId(query.materialId) : undefined,
      segmentSpecId: query.segmentSpecId ? parseBigIntId(query.segmentSpecId) : undefined,
      pieceId: query.pieceId ? parseBigIntId(query.pieceId) : undefined,
      productVariantId: query.productVariantId ? parseBigIntId(query.productVariantId) : undefined,
      OR: query.warehouseId
        ? [
            { fromWarehouseId: parseBigIntId(query.warehouseId) },
            { toWarehouseId: parseBigIntId(query.warehouseId) },
          ]
        : undefined,
      createdAt:
        query.fromDate || query.toDate
          ? {
              gte: query.fromDate ? new Date(query.fromDate) : undefined,
              lte: query.toDate ? new Date(query.toDate) : undefined,
            }
          : undefined,
    };

    const result = await paginate(
      {
        findMany: (args) => this.prisma.stockLedger.findMany({ ...args, include: LEDGER_INCLUDE }),
        count: (args) => this.prisma.stockLedger.count(args),
      },
      query,
      where,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { createdAt: query.sortOrder },
    );

    return { data: result.data.map((r) => this.toResponseDto(r)), meta: result.meta };
  }

  /** null = tổng kho (BOSS/ADMIN), thấy mọi kho - không có gì để chặn. Cùng pattern
   *  WarehouseTransfersService.assertScopeTouchesTransfer() - caller bị giới hạn theo
   *  warehouseScope phải chạm ít nhất 1 trong 2 chân kho của bút toán. */
  private async assertScopeTouchesWarehouses(
    warehouseScope: string | null,
    fromWarehouseId: bigint,
    toWarehouseId: bigint,
  ): Promise<void> {
    if (!warehouseScope) return;
    const warehouses = await this.prisma.warehouse.findMany({
      where: { id: { in: [fromWarehouseId, toWarehouseId] } },
      select: { id: true, code: true },
    });
    const touchesScope = warehouses.some((w) => w.code === warehouseScope);
    if (!touchesScope) {
      throw new ForbiddenException(
        `Caller bị giới hạn ở kho '${warehouseScope}', không liên quan tới bút toán này`,
      );
    }
  }

  private assertExactlyOneGoodsLeg(
    input: Pick<
      PostStockEntryInput,
      'materialId' | 'segmentSpecId' | 'pieceId' | 'productVariantId'
    >,
  ): void {
    const legs = [input.materialId, input.segmentSpecId, input.pieceId, input.productVariantId];
    const setCount = legs.filter((leg) => leg !== undefined).length;
    if (setCount !== 1) {
      throw new BadRequestException(
        'Phải truyền đúng 1 trong 4 chân hàng (materialId/segmentSpecId/pieceId/productVariantId)',
      );
    }
  }

  private toResponseDto(row: StockLedgerWithRefs): StockLedgerResponseDto {
    return new StockLedgerResponseDto({
      id: row.id.toString(),
      fromWarehouseId: row.fromWarehouseId.toString(),
      fromWarehouseCode: row.fromWarehouse.code,
      toWarehouseId: row.toWarehouseId.toString(),
      toWarehouseCode: row.toWarehouse.code,
      materialId: row.materialId?.toString() ?? null,
      materialCode: row.material?.code ?? null,
      segmentSpecId: row.segmentSpecId?.toString() ?? null,
      segmentSpecLabel: row.segmentSpec
        ? `${row.segmentSpec.material.code} @ ${row.segmentSpec.cutLengthMm}mm`
        : null,
      pieceId: row.pieceId?.toString() ?? null,
      pieceCode: row.piece?.code ?? null,
      productVariantId: row.productVariantId?.toString() ?? null,
      productVariantLabel: row.productVariant?.description ?? row.productVariant?.colorCode ?? null,
      qty: row.qty.toNumber(),
      refType: row.refType,
      refId: row.refId,
      note: row.note,
      createdAt: row.createdAt,
      createdById: row.createdById,
    });
  }
}
