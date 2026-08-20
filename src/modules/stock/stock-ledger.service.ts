import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Prisma, StockLedgerRefType } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
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

  /**
   * `tx` = ghi bút toán TRONG transaction của caller. BẮT BUỘC dùng khi caller có bước "đọc tồn
   * rồi quyết định" trước đó (xem CuttingProposalsService.approve): stock_quant chỉ đổi khi trigger
   * `trg_sync_stock_quant` chạy lúc INSERT dòng này, nên nếu bút toán nằm NGOÀI transaction đã khoá
   * `stock_quant ... FOR UPDATE` thì khoá đó nhả trước khi số dư kịp đổi - hai lượt duyệt gần nhau
   * cùng đọc thấy một số dư và cùng tiêu một lô hàng (tồn âm, cả hai đều báo "không cần mua").
   *
   * Bỏ trống `tx` cho caller chỉ ghi một bút toán độc lập, không có quyết định nào phía trước dựa
   * trên số dư (nhập tồn đầu kỳ, xuất vật tư...), và cho WarehouseTransfersService.confirm() - chỗ
   * đó CỐ Ý để ngoài transaction để gọi lại được giữa chừng, xem comment tại đó.
   */
  async postEntry(input: PostStockEntryInput, tx?: PrismaTx): Promise<StockLedgerResponseDto> {
    const db = tx ?? this.prisma;
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
      const existing = await db.stockLedger.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: LEDGER_INCLUDE,
      });
      if (existing) {
        return this.toResponseDto(existing);
      }
    }

    // Trong transaction thì KHÔNG bọc try/catch cứu P2002: Postgres huỷ cả transaction ngay khi
    // một câu lệnh lỗi ("current transaction is aborted, commands ignored until end of transaction
    // block"), nên findUnique cứu vãn phía dưới cũng lỗi nốt - bọc lại chỉ nuốt mất lỗi thật rồi
    // ném ra một lỗi khó hiểu hơn. Prisma không expose SAVEPOINT trong interactive transaction nên
    // không có cách vá cục bộ. Đổi lại, caller truyền tx phải tự serialise (khoá dòng nghiệp vụ
    // FOR UPDATE, xem CuttingProposalsService.approve) - lúc đó không còn ca đua nào để cứu.
    if (tx) {
      const row = await db.stockLedger.create({ data, include: LEDGER_INCLUDE });
      return this.toResponseDto(row);
    }

    try {
      const row = await db.stockLedger.create({ data, include: LEDGER_INCLUDE });
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
    const fromWarehouseId = parseBigIntId(dto.fromWarehouseId);
    const toWarehouseId = parseBigIntId(dto.toWarehouseId);
    await this.assertScopeTouchesWarehouses(warehouseScope, fromWarehouseId, toWarehouseId);

    const input = {
      fromWarehouseId,
      toWarehouseId,
      materialId: dto.materialId ? parseBigIntId(dto.materialId) : undefined,
      segmentSpecId: dto.segmentSpecId ? parseBigIntId(dto.segmentSpecId) : undefined,
      pieceId: dto.pieceId ? parseBigIntId(dto.pieceId) : undefined,
      productVariantId: dto.productVariantId ? parseBigIntId(dto.productVariantId) : undefined,
      qty: dto.qty,
      refType: StockLedgerRefType.ADJUST,
      note: dto.note,
      createdById: userId,
      idempotencyKey,
    };

    if (dto.expectedCurrentQty === undefined) {
      return this.postEntry(input);
    }

    // Optimistic lock cho UI "sửa nhanh tồn kho" (MfgWarehousesPage/MaterialsPage) - client nhập
    // số tuyệt đối rồi tự tính delta = newQty - oldQty(đọc trước đó). Không khoá thì 2 người cùng
    // thấy tồn=100 sửa gần như đồng thời cộng dồn sai (100-10-5=85, không khớp số đếm thật của
    // ai). FOR UPDATE + so expectedCurrentQty (đọc lúc bắt đầu sửa) với tồn THẬT tại thời điểm
    // ghi - lệch nghĩa là ai đó vừa sửa xong, từ chối thay vì âm thầm cộng dồn sai.
    const expectedWarehouseId = dto.expectedWarehouseId
      ? parseBigIntId(dto.expectedWarehouseId)
      : fromWarehouseId;
    if (expectedWarehouseId !== fromWarehouseId && expectedWarehouseId !== toWarehouseId) {
      throw new BadRequestException(
        'expectedWarehouseId phải trùng fromWarehouseId hoặc toWarehouseId',
      );
    }
    if (input.materialId === undefined) {
      throw new BadRequestException('expectedCurrentQty chỉ hỗ trợ điều chỉnh theo materialId');
    }
    const materialId = input.materialId;

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
        SELECT "qty" FROM "stock_quant"
        WHERE "warehouseId" = ${expectedWarehouseId} AND "materialId" = ${materialId}
        FOR UPDATE
      `;
      const currentQty = locked[0]?.qty.toNumber() ?? 0;
      if (Math.abs(currentQty - dto.expectedCurrentQty!) > 1e-6) {
        throw new ConflictException(
          `Tồn kho hiện tại đã đổi (đang là ${currentQty}, bạn thấy ${dto.expectedCurrentQty}) - tải lại trang và thử lại`,
        );
      }
      return this.postEntry(input, tx);
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
        ? `${row.segmentSpec.material.code} @ ${Number(row.segmentSpec.cutLengthMm)}mm`
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
