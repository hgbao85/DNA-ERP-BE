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
import { StockReservationsService } from './stock-reservations.service';
import { paginate } from '../../common/utils/paginate.util';
import { sortOrderBy } from '../../common/utils/sort-order-by.util';
import { lockBusinessKeyShared } from '../../common/utils/advisory-lock.util';
import { SEGMENT_LEGACY_CONVERSION_LOCK } from '../segment-stock/segment-stock.config';
import { warehouseWhereForScope } from '../../common/utils/warehouse-family.util';
import { TRON_SEGMENT_STEPS, isNormalizedSegmentSteps } from '../../common/utils/segment-code.util';
import { vnDayStart } from '../../common/utils/floor-stats.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { MATERIAL_GROUP_SYSTEM_KEYS } from '../../common/constants/material-group-system-keys.constant';
import { RealtimeService } from '../../realtime/realtime.service';
import { RealtimeEntity, RealtimeEntityAction } from '../../realtime/realtime.contract';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { ListStockLedgerQueryDto } from './dto/list-stock-ledger-query.dto';
import { StockLedgerResponseDto } from './dto/stock-ledger-response.dto';

/**
 * Câu chặn ghi tay tồn đoạn khi dữ liệu đoạn cũ chưa chuyển sang cách quản theo lệnh (kiểm kê đoạn và sửa tồn dùng chung). Đặt ở
 * đây (SegmentStocktakeService nhập lại) để tránh import vòng.
 */
export const SEGMENT_STOCKTAKE_NOT_CONVERTED_MESSAGE =
  'Chưa ghi kiểm kê đoạn được: dữ liệu đoạn cũ chưa được chuyển sang cách quản theo lệnh, số nhập bây giờ sẽ bị xoá khi chuyển. Báo IT chuyển đổi xong rồi nhập lại số đếm';

type StockLedgerWithRefs = Prisma.StockLedgerGetPayload<{
  include: {
    fromWarehouse: true;
    toWarehouse: true;
    material: true;
    segmentSpec: { include: { material: true } };
    piece: true;
    productVariant: true;
    createdBy: { select: { firstName: true; lastName: true } };
  };
}>;

/**
 * 19/11/2026 (T3-10): ngày thuần 'YYYY-MM-DD' tính theo ngày lịch giờ VN (UTC+7) - trước đây thành
 * 00:00 UTC nên toDate loại cả ngày đó. fromDate = 00:00 VN; toDate = 23:59:59.999 VN. Chuỗi có giờ giữ nguyên.
 */
function ledgerFromDate(raw: string): Date {
  return vnDayStart(raw) ?? new Date(raw);
}
function ledgerToDate(raw: string): Date {
  const start = vnDayStart(raw);
  return start ? new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1) : new Date(raw);
}

const LEDGER_INCLUDE = {
  fromWarehouse: true,
  toWarehouse: true,
  material: true,
  segmentSpec: { include: { material: true } },
  piece: true,
  productVariant: true,
  // Tên người ghi bút toán - lấy thẳng ở đây thay vì để FE tự resolve qua GET /users như các màn
  // Admin đang làm: WAREHOUSE_STAFF (thủ kho, người đọc sổ kho chính) KHÔNG có quyền USER:VIEW
  // nên gọi /users sẽ 403 (thêm 2026-09-12, màn "Lịch sử kho").
  createdBy: { select: { firstName: true, lastName: true } },
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
  /** Chiều dài cây (mm) - CHỈ có ý nghĩa khi materialId set (CHECK DB: =0 nếu materialId null).
   *  Mặc định 0 nếu không truyền - giữ nguyên hành vi cũ cho mọi caller không phải sắt (packaging,
   *  vật tư tiêu hao, chuyển kho...). Sắt (steel-issues, purchase-proposals receiveItem,
   *  cutting-proposals approve) truyền giá trị thật để tồn kho phân biệt đúng theo từng lô chiều
   *  dài, xem migration 20260829072018_stock_length_bucket. */
  stockLengthMm?: number;
  /** Quy cách (nệm: "Đôi 870x450x50") - CHỈ có ý nghĩa khi materialId set (CHECK DB). Bỏ trống = không quy cách,
   *  giữ nguyên hành vi cũ cho mọi caller không phải nệm. Là chiều thứ 3 của bucket tồn kho, xem migration
   *  20261023120000_stock_spec_dimension. */
  spec?: string;
  /** Bộ công đoạn phụ của ĐOẠN (mã đoạn = cỡ đoạn + bộ công đoạn, '' = trơn) - CHỈ có ý nghĩa khi segmentSpecId set (CHECK DB
   *  stock_ledger_segment_steps_chk). Truyền đúng dạng lưu của normalizeSegmentSteps() (src/common/utils/segment-code.util.ts).
   *  Bỏ trống = trơn, giữ nguyên hành vi cũ cho mọi caller hiện có (SEGMENT_CONSUME...). Xem migration
   *  20261113180000_segment_stock_by_order. */
  segmentSteps?: string;
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
    private readonly realtime: RealtimeService,
    private readonly reservations: StockReservationsService,
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
    const segmentSteps = input.segmentSteps ?? TRON_SEGMENT_STEPS;
    if (segmentSteps !== TRON_SEGMENT_STEPS && input.segmentSpecId === undefined) {
      throw new BadRequestException('segmentSteps chỉ dùng cho bút toán đoạn (segmentSpecId)');
    }
    if (!isNormalizedSegmentSteps(segmentSteps)) {
      throw new BadRequestException(`Bộ công đoạn '${segmentSteps}' không đúng dạng mã đoạn`);
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
      stockLengthMm: input.stockLengthMm ?? 0,
      spec: input.spec?.trim() ?? '',
      segmentSteps,
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

  /**
   * CK10 (rà soát 14/11): hàng đếm nguyên - mảnh, mã đoạn, sản phẩm và sắt (theo cỡ cây hoặc thuộc nhóm Sắt) - không nhận số lẻ
   * (sửa tồn mảnh 0,5 / 9,5 cây sắt). Vật tư khác (kg, mét...) vẫn được lẻ tới 4 số (DTO).
   */
  private async assertWholeCountQty(dto: CreateStockAdjustmentDto): Promise<void> {
    if (Number.isInteger(dto.qty)) return;
    let label: string | null = null;
    if (dto.pieceId) label = 'mảnh';
    else if (dto.segmentSpecId) label = 'đoạn';
    else if (dto.productVariantId) label = 'sản phẩm';
    else if ((dto.stockLengthMm ?? 0) > 0) label = 'cây sắt';
    else if (dto.materialId) {
      const m = await this.prisma.material.findUnique({
        where: { id: parseBigIntId(dto.materialId) },
        select: { materialGroup: { select: { systemKey: true } } },
      });
      if (m?.materialGroup?.systemKey === MATERIAL_GROUP_SYSTEM_KEYS.STEEL_BAR) label = 'cây sắt';
    }
    if (label) {
      throw new BadRequestException(`Số ${label} phải là số nguyên (nhận ${dto.qty})`);
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
    const realWarehouseId = await this.assertAdjustLegs(
      warehouseScope,
      fromWarehouseId,
      toWarehouseId,
    );
    await this.assertWholeCountQty(dto);
    // Gọi lại cùng Idempotency-Key (mất mạng, bấm 2 lần) trả bút toán đã ghi - trước khi kiểm âm bên dưới, vì tồn đã đổi theo
    // chính bút toán đó nên kiểm lại sẽ báo âm oan.
    const replay = await this.prisma.stockLedger.findUnique({
      where: { idempotencyKey },
      include: LEDGER_INCLUDE,
    });
    if (replay) return this.toResponseDto(replay);

    const input = {
      fromWarehouseId,
      toWarehouseId,
      materialId: dto.materialId ? parseBigIntId(dto.materialId) : undefined,
      segmentSpecId: dto.segmentSpecId ? parseBigIntId(dto.segmentSpecId) : undefined,
      pieceId: dto.pieceId ? parseBigIntId(dto.pieceId) : undefined,
      productVariantId: dto.productVariantId ? parseBigIntId(dto.productVariantId) : undefined,
      qty: dto.qty,
      // Bỏ trống -> postEntry() mặc định 0 (bucket "chung", dùng cho UI chỉ hiện 1 số tổng - xem
      // comment CreateStockAdjustmentDto.stockLengthMm). Có giá trị -> ghi ĐÚNG bucket đó.
      stockLengthMm: dto.stockLengthMm,
      // Quy cách của bucket cần chỉnh (nệm) - bỏ trống = bucket "không quy cách".
      spec: dto.spec,
      refType: StockLedgerRefType.ADJUST,
      note: dto.note,
      createdById: userId,
      idempotencyKey,
    };

    // K3 (danh sách lỗi 16/11): trước đây không gửi expectedCurrentQty thì ghi thẳng - không khoá, không chặn âm. Nay mọi lần
    // sửa đều trong transaction, khoá đúng ô tồn sẽ ghi ở kho thật (lockAdjustBucket) và chặn tồn âm; expectedCurrentQty (nếu
    // có) vẫn so như cũ. Hạ tồn xuống dưới phần đang giữ cho lệnh vẫn cho (số đếm thực tế là đúng - anh chốt 17/11), kèm cảnh
    // báo reservationWarning để thủ kho báo người mua / KHSX.
    if (dto.expectedCurrentQty === undefined) {
      const { entry, warning } = await this.prisma.$transaction((tx) =>
        this.postAdjustLockedInTx(tx, input, realWarehouseId),
      );
      if (input.materialId !== undefined) {
        this.publishRealtime('STOCK', input.materialId, 'ADJUSTED', userId);
      }
      return Object.assign(entry, { reservationWarning: warning });
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

    const adjusted = await this.prisma.$transaction(async (tx) => {
      // dto.stockLengthMm CÓ giá trị -> caller đã tách hiển thị theo từng bucket (vd
      // MfgWarehousesPage.tsx "Quản lý kho") và muốn sửa ĐÚNG bucket đó - lọc thêm stockLengthMm,
      // khớp unique index 3 cột nên chỉ có ĐÚNG 1 dòng.
      //
      // dto.stockLengthMm BỎ TRỐNG -> caller chỉ hiện 1 số TỔNG (vd Admin > Vật tư/Tổng hợp vật tư)
      // - CỘNG DỒN mọi dòng khớp (warehouseId, materialId), KHÔNG chỉ lấy locked[0]. Vật tư Sắt có
      // thể có NHIỀU dòng stock_quant cho ĐÚNG 1 cặp này khi tồn ở nhiều bucket stockLengthMm khác
      // nhau (cây 6m/4m là 2 lô riêng, unique index 3 cột). FOR UPDATE khoá TẤT CẢ các dòng trả về,
      // không chỉ 1 dòng - đủ để chặn race 2 người sửa cùng lúc. Trước đây chỉ lấy locked[0] (thứ
      // tự Postgres KHÔNG đảm bảo) trong khi FE đã hiển thị đúng TỔNG các bucket cho Admin xem -
      // lệch nhau khiến "Sửa nhanh tồn kho" luôn 409 cho mọi vật tư Sắt đa-bucket (xác nhận thật
      // qua SAT-005: hiển thị 324, locked[0] ngẫu nhiên ra 0 hoặc 324).
      // dto.spec CÓ giá trị (kể cả '') -> caller đã tách theo quy cách (nệm), chỉ khoá/so ĐÚNG bucket quy cách đó.
      const specFilter = dto.spec !== undefined ? dto.spec.trim() : undefined;
      const locked =
        dto.stockLengthMm !== undefined
          ? await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
              SELECT "qty" FROM "stock_quant"
              WHERE "warehouseId" = ${expectedWarehouseId} AND "materialId" = ${materialId}
                AND "stockLengthMm" = ${dto.stockLengthMm}
                AND (${specFilter}::text IS NULL OR "spec" = ${specFilter}::text)
              FOR UPDATE
            `
          : await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
              SELECT "qty" FROM "stock_quant"
              WHERE "warehouseId" = ${expectedWarehouseId} AND "materialId" = ${materialId}
                AND (${specFilter}::text IS NULL OR "spec" = ${specFilter}::text)
              FOR UPDATE
            `;
      const currentQty = locked.reduce((sum, row) => sum + row.qty.toNumber(), 0);
      if (Math.abs(currentQty - dto.expectedCurrentQty!) > 1e-6) {
        throw new ConflictException(
          `Tồn kho hiện tại đã đổi (đang là ${currentQty}, bạn thấy ${dto.expectedCurrentQty}) - tải lại trang và thử lại`,
        );
      }
      return this.postAdjustLockedInTx(tx, input, realWarehouseId);
    });
    this.publishRealtime('STOCK', materialId, 'ADJUSTED', userId);
    return Object.assign(adjusted.entry, { reservationWarning: adjusted.warning });
  }

  /**
   * K3 16/11: khoá FOR UPDATE đúng ô tồn mà bút toán sửa sẽ ghi ở kho thật (cùng ô postEntry ghi: chiều dài/quy cách/bộ công
   * đoạn mặc định), chặn tồn âm khi giảm, rồi ghi. Vật tư: tồn mới thấp hơn phần đang giữ cho lệnh thì vẫn ghi nhưng trả cảnh báo.
   */
  private async postAdjustLockedInTx(
    tx: PrismaTx,
    input: PostStockEntryInput,
    realWarehouseId: bigint,
  ): Promise<{ entry: StockLedgerResponseDto; warning: string | null }> {
    if (input.segmentSpecId !== undefined) {
      // Nhánh tồn đoạn: chặn giống kiểm kê đoạn - dữ liệu đoạn chưa chuyển đổi thì số sửa tay sẽ bị lượt chuyển đổi xoá. Đếm SAU
      // khoá dùng chung chuyển đổi (cùng thứ tự với SegmentStocktakeService).
      await lockBusinessKeyShared(tx, SEGMENT_LEGACY_CONVERSION_LOCK);
      const [reservationCount, productionCount] = await Promise.all([
        tx.segmentReservation.count(),
        tx.segmentProduction.count(),
      ]);
      if (reservationCount + productionCount === 0) {
        throw new ConflictException(SEGMENT_STOCKTAKE_NOT_CONVERTED_MESSAGE);
      }
    }
    const stockLengthMm = input.stockLengthMm ?? 0;
    const spec = input.spec?.trim() ?? '';
    const segmentSteps = input.segmentSteps ?? '';
    const rows =
      input.materialId !== undefined
        ? await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
            SELECT "qty" FROM "stock_quant"
            WHERE "warehouseId" = ${realWarehouseId} AND "materialId" = ${input.materialId}
              AND "stockLengthMm" = ${stockLengthMm} AND "spec" = ${spec}
            FOR UPDATE
          `
        : input.pieceId !== undefined
          ? await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
              SELECT "qty" FROM "stock_quant"
              WHERE "warehouseId" = ${realWarehouseId} AND "pieceId" = ${input.pieceId}
              FOR UPDATE
            `
          : input.productVariantId !== undefined
            ? await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
                SELECT "qty" FROM "stock_quant"
                WHERE "warehouseId" = ${realWarehouseId} AND "productVariantId" = ${input.productVariantId}
                FOR UPDATE
              `
            : input.segmentSpecId !== undefined
              ? await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
                  SELECT "qty" FROM "stock_quant"
                  WHERE "warehouseId" = ${realWarehouseId} AND "segmentSpecId" = ${input.segmentSpecId}
                    AND "segmentSteps" = ${segmentSteps}
                  FOR UPDATE
                `
              : [];
    const onHand = rows.reduce((sum, r) => sum + r.qty.toNumber(), 0);
    const decreases = input.fromWarehouseId === realWarehouseId;
    const after = Math.round((decreases ? onHand - input.qty : onHand + input.qty) * 1e4) / 1e4 + 0;
    if (after < 0) {
      throw new BadRequestException(
        `Tồn hiện có ${Math.round(onHand * 1e4) / 1e4} - không giảm ${input.qty} được (tồn sẽ âm). Tải lại số tồn rồi sửa lại`,
      );
    }
    let warning: string | null = null;
    if (decreases && input.materialId !== undefined) {
      const reserved = await this.reservations.getReservedQty(
        tx,
        realWarehouseId,
        input.materialId,
        stockLengthMm,
        undefined,
        spec,
      );
      if (after < reserved) {
        warning =
          `Tồn mới ${after} thấp hơn phần đang giữ cho lệnh / phiếu chuyển (${reserved}) - thiếu ` +
          `${Math.round((reserved - after) * 1e4) / 1e4}, lệnh xuất sau sẽ bị chặn. Báo người mua / KHSX để mua bù hoặc điều chỉnh.`;
      }
    }
    return { entry: await this.postEntry(input, tx), warning };
  }

  async findAll(
    query: ListStockLedgerQueryDto,
    scope: string | null = null,
  ): Promise<Paginated<StockLedgerResponseDto>> {
    // K5 16/11: thủ kho chỉ đọc bút toán có 1 chân thuộc họ kho mình (trước đây đọc được sổ mọi kho).
    const scopeWh = warehouseWhereForScope(scope);
    const where: Prisma.StockLedgerWhereInput = {
      ...(scopeWh ? { AND: [{ OR: [{ fromWarehouse: scopeWh }, { toWarehouse: scopeWh }] }] } : {}),
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
              gte: query.fromDate ? ledgerFromDate(query.fromDate) : undefined,
              lte: query.toDate ? ledgerToDate(query.toDate) : undefined,
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
      sortOrderBy(query, ['id', 'createdAt'], { createdAt: query.sortOrder }),
    );

    const [transferCodeById, refStageByKey, poCodeByKey, piCodeByKey] = await Promise.all([
      this.fetchTransferCodes(result.data),
      this.fetchRefStages(result.data),
      this.fetchPoCodes(result.data),
      this.fetchPiCodes(result.data),
    ]);
    return {
      data: result.data.map((r) =>
        this.toResponseDto(r, transferCodeById, refStageByKey, poCodeByKey, piCodeByKey),
      ),
      meta: result.meta,
    };
  }

  /** `${refType}:${refId}` -> công đoạn (MfgStage) của bản ghi nguồn, để sổ kho ghi rõ "Tổ Phôi/Hàn/
   *  Sơn" thay vì chung chung "Xưởng sản xuất" (xem `refStage` ở StockLedgerResponseDto). Chỉ 2
   *  refType có cột stage thật; các loại còn lại tổ là cố định theo nghiệp vụ nên FE tự suy, không
   *  tốn query. Mỗi bảng 1 query cho cả trang. */
  private async fetchRefStages(rows: StockLedgerWithRefs[]): Promise<Map<string, string>> {
    const idsOf = (refType: StockLedgerRefType) => [
      ...new Set(rows.filter((r) => r.refType === refType && r.refId).map((r) => r.refId!)),
    ];
    const batchIds = idsOf(StockLedgerRefType.SEGMENT_CONSUME);
    const materialIssueIds = idsOf(StockLedgerRefType.MATERIAL_ISSUE);

    const [batches, materialIssues] = await Promise.all([
      batchIds.length
        ? this.prisma.productionBatch.findMany({
            where: { id: { in: batchIds.map((id) => parseBigIntId(id)) } },
            select: { id: true, stage: true },
          })
        : Promise.resolve([]),
      materialIssueIds.length
        ? this.prisma.materialIssue.findMany({
            where: { id: { in: materialIssueIds.map((id) => parseBigIntId(id)) } },
            select: { id: true, stage: true },
          })
        : Promise.resolve([]),
    ]);

    const map = new Map<string, string>();
    for (const b of batches) {
      map.set(`${StockLedgerRefType.SEGMENT_CONSUME}:${b.id.toString()}`, b.stage);
    }
    for (const m of materialIssues) {
      map.set(`${StockLedgerRefType.MATERIAL_ISSUE}:${m.id.toString()}`, m.stage);
    }
    return map;
  }

  /** refId -> mã phiếu chuyển kho ("CK-2026-010") cho riêng refType=WAREHOUSE_TRANSFER. Chỉ bảng
   *  `warehouse_transfers` có cột `code` đọc được; các nguồn khác (steel_issues, material_issues,
   *  packaging_issues, purchase_proposals...) chỉ có id số nên không tra gì thêm - xem `refCode` ở
   *  StockLedgerResponseDto. 1 query cho cả trang, không lặp theo từng dòng. */
  private async fetchTransferCodes(rows: StockLedgerWithRefs[]): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        rows
          .filter((r) => r.refType === StockLedgerRefType.WAREHOUSE_TRANSFER && r.refId)
          .map((r) => r.refId!),
      ),
    ];
    if (ids.length === 0) return new Map();
    const transfers = await this.prisma.warehouseTransfer.findMany({
      where: { id: { in: ids.map((id) => parseBigIntId(id)) } },
      select: { id: true, code: true },
    });
    return new Map(transfers.map((t) => [t.id.toString(), t.code]));
  }

  /** `${refType}:${refId}` -> mã đơn hàng Sales (SalesOrder.orderCode) của Lệnh sản xuất gắn với
   *  bản ghi nguồn - cột "Mã đơn hàng (PO)" ở màn Lịch sử kho (2026-09-12, theo yêu cầu Sếp). Mỗi
   *  refType đi qua 1 chuỗi quan hệ khác nhau tới ProductionOrder/ProductionInvoice - cùng chuỗi
   *  `productionOrder.productionInvoiceItem.salesOrder.orderCode` đã dùng ở MaterialIssuesService/
   *  PackagingIssuesService/ProductionBatchesService/WeavingIssuesService/MaterialYieldIssuesService,
   *  riêng STEEL_ISSUE đi thẳng `productionInvoice.salesOrder.orderCode` (không qua ProductionOrder).
   *  refType không gắn đơn hàng nào (mua hàng, chuyển kho, KCS phế, điều chỉnh tay...) không tra gì
   *  thêm. 1 query/loại cho cả trang, không lặp theo từng dòng - cùng pattern fetchRefStages(). */
  private async fetchPoCodes(rows: StockLedgerWithRefs[]): Promise<Map<string, string>> {
    const idsOf = (refType: StockLedgerRefType) => [
      ...new Set(rows.filter((r) => r.refType === refType && r.refId).map((r) => r.refId!)),
    ];
    const materialIssueIds = idsOf(StockLedgerRefType.MATERIAL_ISSUE);
    const batchIds = idsOf(StockLedgerRefType.SEGMENT_CONSUME);
    const packagingIssueIds = idsOf(StockLedgerRefType.PACKAGING_ISSUE);
    const materialYieldIssueIds = idsOf(StockLedgerRefType.MATERIAL_YIELD_CONSUME);
    const weavingIssueMaterialIds = idsOf(StockLedgerRefType.WEAVING_ISSUE_MATERIAL);
    const steelIssueIds = idsOf(StockLedgerRefType.STEEL_ISSUE);

    const productionOrderSalesOrderSelect = {
      productionOrder: {
        select: {
          productionInvoiceItem: { select: { salesOrder: { select: { orderCode: true } } } },
        },
      },
    } as const;

    const [
      materialIssues,
      batches,
      packagingIssues,
      materialYieldIssues,
      weavingIssueMaterials,
      steelIssues,
    ] = await Promise.all([
      materialIssueIds.length
        ? this.prisma.materialIssue.findMany({
            where: { id: { in: materialIssueIds.map((id) => parseBigIntId(id)) } },
            select: { id: true, ...productionOrderSalesOrderSelect },
          })
        : Promise.resolve([]),
      batchIds.length
        ? this.prisma.productionBatch.findMany({
            where: { id: { in: batchIds.map((id) => parseBigIntId(id)) } },
            select: { id: true, ...productionOrderSalesOrderSelect },
          })
        : Promise.resolve([]),
      packagingIssueIds.length
        ? this.prisma.packagingIssue.findMany({
            where: { id: { in: packagingIssueIds.map((id) => parseBigIntId(id)) } },
            select: { id: true, ...productionOrderSalesOrderSelect },
          })
        : Promise.resolve([]),
      materialYieldIssueIds.length
        ? this.prisma.materialYieldIssue.findMany({
            where: { id: { in: materialYieldIssueIds.map((id) => parseBigIntId(id)) } },
            select: { id: true, ...productionOrderSalesOrderSelect },
          })
        : Promise.resolve([]),
      weavingIssueMaterialIds.length
        ? this.prisma.weavingIssueMaterial.findMany({
            where: { id: { in: weavingIssueMaterialIds.map((id) => parseBigIntId(id)) } },
            select: { id: true, weavingIssue: { select: productionOrderSalesOrderSelect } },
          })
        : Promise.resolve([]),
      steelIssueIds.length
        ? this.prisma.steelIssue.findMany({
            where: { id: { in: steelIssueIds.map((id) => parseBigIntId(id)) } },
            select: {
              id: true,
              productionInvoice: { select: { salesOrder: { select: { orderCode: true } } } },
            },
          })
        : Promise.resolve([]),
    ]);

    const map = new Map<string, string>();
    const putIfPresent = (
      refType: StockLedgerRefType,
      id: bigint,
      orderCode: string | null | undefined,
    ) => {
      if (orderCode) map.set(`${refType}:${id.toString()}`, orderCode);
    };
    for (const m of materialIssues) {
      putIfPresent(
        StockLedgerRefType.MATERIAL_ISSUE,
        m.id,
        m.productionOrder?.productionInvoiceItem?.salesOrder?.orderCode,
      );
    }
    for (const b of batches) {
      putIfPresent(
        StockLedgerRefType.SEGMENT_CONSUME,
        b.id,
        b.productionOrder?.productionInvoiceItem?.salesOrder?.orderCode,
      );
    }
    for (const p of packagingIssues) {
      putIfPresent(
        StockLedgerRefType.PACKAGING_ISSUE,
        p.id,
        p.productionOrder?.productionInvoiceItem?.salesOrder?.orderCode,
      );
    }
    for (const y of materialYieldIssues) {
      putIfPresent(
        StockLedgerRefType.MATERIAL_YIELD_CONSUME,
        y.id,
        y.productionOrder?.productionInvoiceItem?.salesOrder?.orderCode,
      );
    }
    for (const w of weavingIssueMaterials) {
      putIfPresent(
        StockLedgerRefType.WEAVING_ISSUE_MATERIAL,
        w.id,
        w.weavingIssue?.productionOrder?.productionInvoiceItem?.salesOrder?.orderCode,
      );
    }
    for (const s of steelIssues) {
      putIfPresent(
        StockLedgerRefType.STEEL_ISSUE,
        s.id,
        s.productionInvoice?.salesOrder?.orderCode,
      );
    }
    return map;
  }

  /** `${refType}:${refId}` -> mã Lệnh sản xuất (ProductionInvoice.code, vd "PI-2026-005") gắn với
   *  bản ghi nguồn - cột "Lệnh sản xuất" ở màn Lịch sử kho (2026-09-12, theo yêu cầu Sếp). "Lệnh
   *  sản xuất" trong toàn hệ thống LÀ ProductionInvoice/PI (xem nhãn "Lệnh sản xuất (PI)" ở
   *  BusinessDataPage.tsx/ProductionInvoicesPage.tsx phía FE) - KHÔNG phải ProductionOrder.poNumber
   *  (mã đó chỉ dùng nội bộ tra cứu, không hiển thị, xem comment refCode/fetchPoCodes ở trên).
   *  Cùng chuỗi quan hệ với fetchPoCodes() nhưng đi tới `productionInvoice.code` thay vì
   *  `salesOrder.orderCode` - và KHÔNG có ca null vì PI gộp (ProductionInvoice.code luôn có, chỉ
   *  `salesOrderId` mới null khi gộp). refType không gắn Lệnh sản xuất nào (mua hàng, chuyển kho,
   *  KCS phế, điều chỉnh tay...) không tra gì thêm. 1 query/loại cho cả trang. */
  private async fetchPiCodes(rows: StockLedgerWithRefs[]): Promise<Map<string, string>> {
    const idsOf = (refType: StockLedgerRefType) => [
      ...new Set(rows.filter((r) => r.refType === refType && r.refId).map((r) => r.refId!)),
    ];
    const materialIssueIds = idsOf(StockLedgerRefType.MATERIAL_ISSUE);
    const batchIds = idsOf(StockLedgerRefType.SEGMENT_CONSUME);
    const packagingIssueIds = idsOf(StockLedgerRefType.PACKAGING_ISSUE);
    const materialYieldIssueIds = idsOf(StockLedgerRefType.MATERIAL_YIELD_CONSUME);
    const weavingIssueMaterialIds = idsOf(StockLedgerRefType.WEAVING_ISSUE_MATERIAL);
    const steelIssueIds = idsOf(StockLedgerRefType.STEEL_ISSUE);
    // Phía cộng tồn đoạn (13/11/2026): refId là CHÍNH id lệnh.
    const segmentProduceInvoiceIds = idsOf(StockLedgerRefType.SEGMENT_PRODUCE);

    const productionOrderPiSelect = {
      productionOrder: {
        select: {
          productionInvoiceItem: { select: { productionInvoice: { select: { code: true } } } },
        },
      },
    } as const;

    const [
      materialIssues,
      batches,
      packagingIssues,
      materialYieldIssues,
      weavingIssueMaterials,
      steelIssues,
      segmentProduceInvoices,
    ] = await Promise.all([
      materialIssueIds.length
        ? this.prisma.materialIssue.findMany({
            where: { id: { in: materialIssueIds.map((id) => parseBigIntId(id)) } },
            select: { id: true, ...productionOrderPiSelect },
          })
        : Promise.resolve([]),
      batchIds.length
        ? this.prisma.productionBatch.findMany({
            where: { id: { in: batchIds.map((id) => parseBigIntId(id)) } },
            select: { id: true, ...productionOrderPiSelect },
          })
        : Promise.resolve([]),
      packagingIssueIds.length
        ? this.prisma.packagingIssue.findMany({
            where: { id: { in: packagingIssueIds.map((id) => parseBigIntId(id)) } },
            select: { id: true, ...productionOrderPiSelect },
          })
        : Promise.resolve([]),
      materialYieldIssueIds.length
        ? this.prisma.materialYieldIssue.findMany({
            where: { id: { in: materialYieldIssueIds.map((id) => parseBigIntId(id)) } },
            select: { id: true, ...productionOrderPiSelect },
          })
        : Promise.resolve([]),
      weavingIssueMaterialIds.length
        ? this.prisma.weavingIssueMaterial.findMany({
            where: { id: { in: weavingIssueMaterialIds.map((id) => parseBigIntId(id)) } },
            select: { id: true, weavingIssue: { select: productionOrderPiSelect } },
          })
        : Promise.resolve([]),
      steelIssueIds.length
        ? this.prisma.steelIssue.findMany({
            where: { id: { in: steelIssueIds.map((id) => parseBigIntId(id)) } },
            select: { id: true, productionInvoice: { select: { code: true } } },
          })
        : Promise.resolve([]),
      segmentProduceInvoiceIds.length
        ? this.prisma.productionInvoice.findMany({
            where: { id: { in: segmentProduceInvoiceIds.map((id) => parseBigIntId(id)) } },
            select: { id: true, code: true },
          })
        : Promise.resolve([]),
    ]);

    const map = new Map<string, string>();
    const putIfPresent = (
      refType: StockLedgerRefType,
      id: bigint,
      code: string | null | undefined,
    ) => {
      if (code) map.set(`${refType}:${id.toString()}`, code);
    };
    for (const m of materialIssues) {
      putIfPresent(
        StockLedgerRefType.MATERIAL_ISSUE,
        m.id,
        m.productionOrder?.productionInvoiceItem?.productionInvoice?.code,
      );
    }
    for (const b of batches) {
      putIfPresent(
        StockLedgerRefType.SEGMENT_CONSUME,
        b.id,
        b.productionOrder?.productionInvoiceItem?.productionInvoice?.code,
      );
    }
    for (const p of packagingIssues) {
      putIfPresent(
        StockLedgerRefType.PACKAGING_ISSUE,
        p.id,
        p.productionOrder?.productionInvoiceItem?.productionInvoice?.code,
      );
    }
    for (const y of materialYieldIssues) {
      putIfPresent(
        StockLedgerRefType.MATERIAL_YIELD_CONSUME,
        y.id,
        y.productionOrder?.productionInvoiceItem?.productionInvoice?.code,
      );
    }
    for (const w of weavingIssueMaterials) {
      putIfPresent(
        StockLedgerRefType.WEAVING_ISSUE_MATERIAL,
        w.id,
        w.weavingIssue?.productionOrder?.productionInvoiceItem?.productionInvoice?.code,
      );
    }
    for (const s of steelIssues) {
      putIfPresent(StockLedgerRefType.STEEL_ISSUE, s.id, s.productionInvoice?.code);
    }
    for (const pi of segmentProduceInvoices) {
      putIfPresent(StockLedgerRefType.SEGMENT_PRODUCE, pi.id, pi.code);
    }
    return map;
  }

  /**
   * "Sửa nhanh tồn kho" (rà soát 14/11 CK7): đúng 1 chân là kho THẬT (kho đang sửa) và chân kia là kho ẢO đối ứng (vd
   * OPENING_BALANCE). Trước đây chỉ cần 1 chân thuộc phạm vi thủ kho - thủ kho gọi thẳng API chuyển được hàng từ kho thật khác về
   * kho mình, bỏ qua phiếu chuyển / ảnh ký / xác nhận của kho kia. Chuyển giữa 2 kho thật phải đi phiếu chuyển kho.
   * Thủ kho bị giới hạn phạm vi: kho thật phải là kho mình. null = tổng kho (Admin / Giám đốc).
   */
  private async assertAdjustLegs(
    warehouseScope: string | null,
    fromWarehouseId: bigint,
    toWarehouseId: bigint,
  ): Promise<bigint> {
    const warehouses = await this.prisma.warehouse.findMany({
      where: { id: { in: [fromWarehouseId, toWarehouseId] } },
      select: { id: true, code: true, name: true, isVirtual: true },
    });
    const real = warehouses.filter((w) => !w.isVirtual);
    if (warehouses.length !== 2 || real.length !== 1) {
      throw new BadRequestException(
        'Sửa nhanh tồn kho phải đối ứng 1 kho thật với 1 kho ảo (Cân đối tồn kho) - chuyển hàng giữa 2 kho thật thì lập phiếu chuyển kho',
      );
    }
    if (warehouseScope && real[0].code !== warehouseScope) {
      throw new ForbiddenException(
        `Bạn bị giới hạn ở kho '${warehouseScope}', không sửa tồn kho '${real[0].name}' được`,
      );
    }
    return real[0].id;
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

  /** `transferCodeById` chỉ được truyền từ findAll() (màn Lịch sử kho cần cột "Chứng từ") - các
   *  lời gọi khác (postEntry/adjust trả về đúng 1 bút toán vừa ghi) không cần, để trống → null. */
  private toResponseDto(
    row: StockLedgerWithRefs,
    transferCodeById?: Map<string, string>,
    refStageByKey?: Map<string, string>,
    poCodeByKey?: Map<string, string>,
    piCodeByKey?: Map<string, string>,
  ): StockLedgerResponseDto {
    return new StockLedgerResponseDto({
      id: row.id.toString(),
      fromWarehouseId: row.fromWarehouseId.toString(),
      fromWarehouseCode: row.fromWarehouse.code,
      fromWarehouseName: row.fromWarehouse.name,
      toWarehouseId: row.toWarehouseId.toString(),
      toWarehouseCode: row.toWarehouse.code,
      toWarehouseName: row.toWarehouse.name,
      materialId: row.materialId?.toString() ?? null,
      materialCode: row.material?.code ?? null,
      materialName: row.material?.name ?? null,
      materialUnit: row.material?.unit ?? null,
      segmentSpecId: row.segmentSpecId?.toString() ?? null,
      segmentSpecLabel: row.segmentSpec
        ? `${row.segmentSpec.material.code} @ ${Number(row.segmentSpec.cutLengthMm)}mm`
        : null,
      segmentSteps: row.segmentSteps,
      pieceId: row.pieceId?.toString() ?? null,
      pieceCode: row.piece?.code ?? null,
      productVariantId: row.productVariantId?.toString() ?? null,
      productVariantLabel: row.productVariant?.description ?? row.productVariant?.colorCode ?? null,
      qty: row.qty.toNumber(),
      refType: row.refType,
      refId: row.refId,
      // BUG đã sửa (2026-09-14, phát hiện qua test tay thật): `transferCodeById` chỉ tra
      // WAREHOUSE_TRANSFER (đúng, xem fetchTransferCodes()) nhưng map key CHỈ LÀ refId trần (không
      // kèm refType) - lookup ở đây trước đó KHÔNG kiểm tra row.refType, nên 1 dòng STEEL_ISSUE/
      // SEGMENT_CONSUME có refId TRÙNG SỐ với 1 WarehouseTransfer.id (khác bảng, id trùng thuần
      // ngẫu nhiên - vd SteelIssue id=2 và WarehouseTransfer id=2 cùng tồn tại) sẽ bị gán NHẦM mã
      // phiếu chuyển kho của transfer đó vào cột "Lệnh sản xuất", dù 2 bản ghi không liên quan gì
      // nhau. Thêm điều kiện refType === WAREHOUSE_TRANSFER trước khi tra, cùng cách refStage/
      // poCode/piCode đã làm đúng ngay từ đầu (key `${refType}:${refId}`).
      refCode:
        (row.refId && row.refType === StockLedgerRefType.WAREHOUSE_TRANSFER
          ? transferCodeById?.get(row.refId)
          : undefined) ?? null,
      refStage: (row.refId ? refStageByKey?.get(`${row.refType}:${row.refId}`) : undefined) ?? null,
      poCode: (row.refId ? poCodeByKey?.get(`${row.refType}:${row.refId}`) : undefined) ?? null,
      piCode: (row.refId ? piCodeByKey?.get(`${row.refType}:${row.refId}`) : undefined) ?? null,
      note: row.note,
      createdAt: row.createdAt,
      createdById: row.createdById,
      createdByName: row.createdBy
        ? `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim()
        : null,
      stockLengthMm: row.stockLengthMm,
      spec: row.spec,
    });
  }
}
