import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Prisma, StockLedgerRefType } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { MATERIAL_GROUP_SYSTEM_KEYS } from '../../common/constants/material-group-system-keys.constant';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { ListStockLedgerQueryDto } from './dto/list-stock-ledger-query.dto';
import { RebucketStockDto } from './dto/rebucket-stock.dto';
import { StockLedgerResponseDto } from './dto/stock-ledger-response.dto';
import { StockReservationsService } from './stock-reservations.service';

/** Cùng idiom materials.service.ts (không export dùng chung - chỉ 2 nơi cần biết code này). */
const OPENING_BALANCE_WAREHOUSE_CODE = 'OPENING_BALANCE';

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
  /** Cỡ cây sắt (mm), 0 = "bucket chưa xác định cỡ cây" - BẮT BUỘC (không optional) dù đa số
   *  call site không liên quan sắt: caller phải truyền tường minh 0 - đổi lại tsc tự ép soát
   *  MỌI call site postEntry() trong repo khi thêm field này, không sót nơi nào (xem kế hoạch
   *  "chiều dài cây sắt" 2026-08-29, quyết định thiết kế #4 - ghi sai bucket hỏng dữ liệu vĩnh
   *  viễn, nặng hơn nhiều so với chỉ bắt buộc phía đọc). */
  stockLengthMm: number;
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
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly stockReservationsService: StockReservationsService,
  ) {}

  /**
   * `tx` = ghi bút toán TRONG transaction của caller. BẮT BUỘC dùng khi caller có bước "đọc tồn
   * rồi quyết định" trước đó (xem CuttingProposalsService.approve): stock_quant chỉ đổi khi trigger
   * `trg_sync_stock_quant` chạy lúc INSERT dòng này, nên nếu bút toán nằm NGOÀI transaction đã khoá
   * `stock_quant ... FOR UPDATE` thì khoá đó nhả trước khi số dư kịp đổi - hai lượt duyệt gần nhau
   * cùng đọc thấy một số dư và cùng tiêu một lô hàng (tồn âm, cả hai đều báo "không cần mua").
   *
   * Bỏ trống `tx` cho caller chỉ ghi một bút toán độc lập, không có quyết định nào phía trước dựa
   * trên số dư (nhập tồn đầu kỳ, xuất vật tư...).
   *
   * (M5 audit 26/08/2026 - sửa comment lỗi thời) WarehouseTransfersService.confirm() KHÔNG nằm
   * trong ngoại lệ trên - nó gọi postEntry() TRONG transaction của chính nó (truyền `tx`), cùng
   * nhóm với CuttingProposalsService.approve() ở trên. An toàn khi gọi lại giữa chừng đến từ
   * idempotencyKey theo (transferId, itemId) - resolve-or-return, không phải từ việc đứng ngoài
   * transaction (xem comment tại confirm()).
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
    if (input.stockLengthMm !== 0 && input.materialId === undefined) {
      // Mirror CHECK constraint stock_ledger_stock_length_mm_chk - trả 400 rõ ràng thay vì để lộ
      // lỗi CHECK constraint thô, cùng idiom assertExactlyOneGoodsLeg().
      throw new BadRequestException('stockLengthMm khác 0 chỉ hợp lệ khi có materialId');
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
      stockLengthMm: input.stockLengthMm,
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

    const materialId = dto.materialId ? parseBigIntId(dto.materialId) : undefined;
    const stockLengthMm = await this.resolveAdjustStockLengthMm(materialId, dto.stockLengthMm);

    const input: PostStockEntryInput = {
      fromWarehouseId,
      toWarehouseId,
      materialId,
      segmentSpecId: dto.segmentSpecId ? parseBigIntId(dto.segmentSpecId) : undefined,
      pieceId: dto.pieceId ? parseBigIntId(dto.pieceId) : undefined,
      productVariantId: dto.productVariantId ? parseBigIntId(dto.productVariantId) : undefined,
      stockLengthMm,
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
    if (materialId === undefined) {
      throw new BadRequestException('expectedCurrentQty chỉ hỗ trợ điều chỉnh theo materialId');
    }

    return this.prisma.$transaction(async (tx) => {
      // stockLengthMm PHẢI có trong WHERE - thiếu cột này thì so expectedCurrentQty (đọc từ 1
      // bucket) với "qty" của MỘT bucket khác/ngẫu nhiên khi vật tư có nhiều bucket, luôn báo lệch
      // giả (xem kế hoạch "chiều dài cây sắt" 2026-08-29, Bước 2).
      const locked = await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
        SELECT "qty" FROM "stock_quant"
        WHERE "warehouseId" = ${expectedWarehouseId} AND "materialId" = ${materialId}
          AND "stockLengthMm" = ${stockLengthMm}
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

  /**
   * Bước 8 (kế hoạch "chiều dài cây sắt" 2026-08-29) - công cụ vận hành cho thủ kho kiểm kê thật
   * rồi khai lại: "N cây bucket X thực tế là cỡ Y". KHÔNG tạo/xoá tồn - chỉ CHUYỂN tồn ĐANG CÓ từ
   * bucket này sang bucket khác của CÙNG 1 (kho, vật tư). Cần thiết vì Bước 1 cố ý KHÔNG backfill
   * dữ liệu lịch sử (mọi tồn cũ rơi vào bucket 0) - không có công cụ này, tồn kho sắt cũ "vô hình"
   * vĩnh viễn với mọi phương án cắt mới cần bucket khác.
   *
   * Cài đặt bằng 2 bút toán postEntry() đi qua kho ảo OPENING_BALANCE (đã có sẵn trong
   * PROTECTED_WAREHOUSE_CODES) - xuất bucket cũ ra OPENING_BALANCE, rồi nhập lại đúng kho ở bucket
   * mới - tránh vi phạm stock_ledger_from_ne_to_chk (from≠to) và giữ đúng nguyên tắc "1 dòng ledger
   * = 1 loại hàng, không phải 2 giá trị bucket trong 1 dòng". Dùng refType=ADJUST (không thêm enum
   * riêng) - đây vẫn là 1 dạng điều chỉnh tay, `note` + idempotencyKey đủ để tra soát sau này.
   *
   * Giới hạn rút CHỈ phần CHƯA bị giữ chỗ - gọi thẳng StockReservationsService.getAvailableQty()
   * (KHÔNG tự viết lại phép trừ, xem docstring hàm đó "ĐÚNG MỘT hàm được phép cộng 2 bảng"). Kịch
   * bản cần chặn: 1 PI dở dang bắc qua migration đang giữ chỗ ACTIVE ở bucket nguồn (case fallback
   * bucket-0 của StockReservationsService.resolvePoolBucket) - nếu rebucket() rút hết cả phần đã
   * hứa, PI đó không rút được thứ đã được hứa dù trên giấy tờ vẫn "còn giữ chỗ".
   */
  async rebucket(
    dto: RebucketStockDto,
    idempotencyKey: string,
    userId: string,
    warehouseScope: string | null,
  ): Promise<{ from: StockLedgerResponseDto; to: StockLedgerResponseDto }> {
    const warehouseId = parseBigIntId(dto.warehouseId);
    const materialId = parseBigIntId(dto.materialId);
    await this.assertScopeTouchesWarehouses(warehouseScope, warehouseId, warehouseId);

    if (dto.fromStockLengthMm === dto.toStockLengthMm) {
      throw new BadRequestException(
        'fromStockLengthMm và toStockLengthMm không được trùng nhau - không có gì để khai lại',
      );
    }

    const openingBalanceWarehouse = await this.prisma.warehouse.findUniqueOrThrow({
      where: { code: OPENING_BALANCE_WAREHOUSE_CODE },
    });

    return this.prisma.$transaction(async (tx) => {
      // Khoá CẢ 2 bucket liên quan theo thứ tự TĂNG DẦN - 2 lượt rebucket cùng vật tư+kho chạy
      // ngược thứ tự bucket sẽ khoá chéo và deadlock nếu không cố định thứ tự (cùng idiom
      // CuttingProposalsService.approve() khoá theo materialId tăng dần).
      const [lowBucket, highBucket] = [dto.fromStockLengthMm, dto.toStockLengthMm].sort(
        (a, b) => a - b,
      );
      const lowRows = await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
        SELECT "qty" FROM "stock_quant"
        WHERE "warehouseId" = ${warehouseId} AND "materialId" = ${materialId}
          AND "stockLengthMm" = ${lowBucket}
        FOR UPDATE
      `;
      const highRows = await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
        SELECT "qty" FROM "stock_quant"
        WHERE "warehouseId" = ${warehouseId} AND "materialId" = ${materialId}
          AND "stockLengthMm" = ${highBucket}
        FOR UPDATE
      `;
      const onHandOf = (bucket: number): number => {
        const rows = bucket === lowBucket ? lowRows : highRows;
        return rows[0]?.qty.toNumber() ?? 0;
      };
      const sourceOnHand = onHandOf(dto.fromStockLengthMm);

      const available = await this.stockReservationsService.getAvailableQty(
        tx,
        warehouseId,
        materialId,
        dto.fromStockLengthMm,
        sourceOnHand,
      );
      if (dto.qty > available) {
        throw new ConflictException(
          `Chỉ được khai lại tối đa ${available} cây ở bucket ${dto.fromStockLengthMm}mm (tồn vật lý ${sourceOnHand} cây, ` +
            `đang giữ chỗ ${sourceOnHand - available} cây cho phương án khác) - kiểm tra lại số lượng thực kiểm kê`,
        );
      }

      const note = `Khai lại cỡ cây (${dto.fromStockLengthMm}mm -> ${dto.toStockLengthMm}mm): ${dto.note}`;
      const from = await this.postEntry(
        {
          fromWarehouseId: warehouseId,
          toWarehouseId: openingBalanceWarehouse.id,
          materialId,
          stockLengthMm: dto.fromStockLengthMm,
          qty: dto.qty,
          refType: StockLedgerRefType.ADJUST,
          note,
          createdById: userId,
          idempotencyKey: `${idempotencyKey}:out`,
        },
        tx,
      );
      const to = await this.postEntry(
        {
          fromWarehouseId: openingBalanceWarehouse.id,
          toWarehouseId: warehouseId,
          materialId,
          stockLengthMm: dto.toStockLengthMm,
          qty: dto.qty,
          refType: StockLedgerRefType.ADJUST,
          note,
          createdById: userId,
          idempotencyKey: `${idempotencyKey}:in`,
        },
        tx,
      );
      return { from, to };
    });
  }

  async findAll(query: ListStockLedgerQueryDto): Promise<Paginated<StockLedgerResponseDto>> {
    const where: Prisma.StockLedgerWhereInput = {
      refType: query.refType,
      materialId: query.materialId ? parseBigIntId(query.materialId) : undefined,
      stockLengthMm: query.stockLengthMm,
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

  /** DTO client được phép lỏng hơn nội bộ service (stockLengthMm optional) - mặc định 0 cho mọi
   *  vật tư thường. Ngoại lệ: vật tư nhóm STEEL_BAR bị ép chọn rõ bucket, KHÔNG mặc định về 0 -
   *  "Admin > Sửa nhanh tồn kho" hiện chưa có ô chọn cỡ cây, nếu mặc định 0 thì sau khi thủ kho
   *  khai lại cỡ cây thật (rebucket), sửa nhanh qua màn cũ sẽ âm thầm ghi vào bucket 0 rỗng thay
   *  vì bucket có hàng thật - GHI SAI dữ liệu vĩnh viễn (xem kế hoạch "chiều dài cây sắt"
   *  2026-08-29, Bước 2). */
  private async resolveAdjustStockLengthMm(
    materialId: bigint | undefined,
    stockLengthMm: number | undefined,
  ): Promise<number> {
    if (materialId === undefined) {
      return 0;
    }
    if (stockLengthMm !== undefined) {
      return stockLengthMm;
    }
    const material = await this.prisma.material.findUnique({
      where: { id: materialId },
      include: { materialGroup: true },
    });
    if (material?.materialGroup?.systemKey === MATERIAL_GROUP_SYSTEM_KEYS.STEEL_BAR) {
      throw new BadRequestException(
        `Vật tư "${material.code}" thuộc nhóm Sắt - phải chọn rõ cỡ cây (stockLengthMm), không được để mặc định`,
      );
    }
    return 0;
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
      stockLengthMm: row.stockLengthMm,
      qty: row.qty.toNumber(),
      refType: row.refType,
      refId: row.refId,
      note: row.note,
      createdAt: row.createdAt,
      createdById: row.createdById,
    });
  }
}
