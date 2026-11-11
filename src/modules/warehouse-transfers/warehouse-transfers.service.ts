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
  MfgStage,
  Prisma,
  ProductionBatchStatus,
  ReservationStatus,
  StockLedgerRefType,
  TransferStatus,
  Warehouse,
  WarehouseKind,
} from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { warehouseFamilyOf } from '../../common/utils/warehouse-family.util';
import { NotificationsService } from '../notifications/notifications.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { ConfirmWarehouseTransferDto } from './dto/confirm-warehouse-transfer.dto';
import { CreatePieceWarehouseTransferDto } from './dto/create-piece-warehouse-transfer.dto';
import { CreateWarehouseTransferDto } from './dto/create-warehouse-transfer.dto';
import { ListWarehouseTransfersQueryDto } from './dto/list-warehouse-transfers-query.dto';
import { PieceTransferPlanItemResponseDto } from './dto/piece-transfer-plan-item-response.dto';
import { WarehouseTransferDetailResponseDto } from './dto/warehouse-transfer-detail-response.dto';
import { WarehouseTransferItemResponseDto } from './dto/warehouse-transfer-item-response.dto';
import { WarehouseTransferPieceItemResponseDto } from './dto/warehouse-transfer-piece-item-response.dto';
import { WarehouseTransferResponseDto } from './dto/warehouse-transfer-response.dto';
import {
  isValidTransferRoute,
  PIECE_TRANSFER_LEAVES_FRAME,
  PIECE_TRANSFER_TO_PAINT,
  transferWarehouseShortCode,
} from './transfer-routes.constant';
import { RealtimeService } from '../../realtime/realtime.service';
import { WorkshopMovePart, WorkshopMoveService } from './workshop-move.service';
import { lenhDisplayCode } from '../../common/utils/lenh-code.util';
import { CUTTING_RECHECK_MESSAGE } from './cutting-recheck.util';

const ACTOR_NAME_SELECT = { select: { firstName: true, lastName: true } };

const TRANSFER_INCLUDE = {
  fromWarehouse: true,
  toWarehouse: true,
  // material.spec (2026-09-15) - "Nhập nội bộ" (InternalTransferSections.tsx) cần cột Quy cách
  // giống màn "Nhập kho" (PurchaseProposalItemResponseDto.materialSpec), để Thủ kho đối chiếu đúng
  // quy cách khi nhận hàng chuyển kho, không chỉ tên. Dòng "ghi tự do" cũ (materialId null,
  // trước 09/09/2026) không có Material để join -> materialSpec null.
  items: { include: { material: { select: { spec: true, code: true } } } },
  // Phiếu chuyển hàng của lệnh đổi xưởng (10/11/2026): số lệnh để in ô "Lệnh sản xuất" / cột LSX.
  productionInvoice: {
    select: { code: true, items: { select: { lsxCode: true }, orderBy: { id: 'asc' as const } } },
  },
  pieceItems: {
    include: {
      productionOrder: {
        include: {
          productionInvoiceItem: {
            select: {
              lsxCode: true,
              productionInvoice: { select: { code: true } },
              salesOrder: { select: { orderCode: true } },
            },
          },
          mfgProduct: { select: { factoryCode: true } },
        },
      },
      piece: true,
    },
  },
  // Tên người tạo/xác nhận/từ chối - trả sẵn thay vì để FE tự resolve qua GET /users (thủ kho
  // không có quyền USER:VIEW nên gọi /users sẽ 403 - cùng vấn đề đã vá ở StockLedgerService, xem
  // changelog 2026-09-12-lich-su-nhap-xuat-kho.md mục "Lịch sử kho gộp cả phiếu bị từ chối").
  createdBy: ACTOR_NAME_SELECT,
  confirmedBy: ACTOR_NAME_SELECT,
  rejectedBy: ACTOR_NAME_SELECT,
} satisfies Prisma.WarehouseTransferInclude;

type WarehouseTransferWithRefs = Prisma.WarehouseTransferGetPayload<{
  include: typeof TRANSFER_INCLUDE;
}>;

/**
 * Phiếu chuyển kho nội bộ - lớp workflow ngồi trên StockLedger (docs/dna-erp-db-schema.html
 * mục 1.8). State machine 1 chiều PENDING -> CONFIRMED|REJECTED. confirm() là nơi duy nhất ghi
 * StockLedger cho luồng transfer, qua StockLedgerService.postEntry() dùng chung.
 */
@Injectable()
export class WarehouseTransfersService {
  private readonly logger = new Logger(WarehouseTransfersService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly stockLedgerService: StockLedgerService,
    private readonly stockReservationsService: StockReservationsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly workshopMove: WorkshopMoveService,
  ) {}

  /** Phát realtime SAU KHI transaction đã commit (xem RealtimeService). */
  private publishTransferChanged(
    transferId: bigint,
    action: 'CREATED' | 'CONFIRMED' | 'REJECTED',
    actorId: string | null,
  ): void {
    this.realtime.publishEntityChanged({
      entity: 'WAREHOUSE_TRANSFER',
      entityId: transferId,
      action,
      actorId,
    });
  }

  /** Best-effort NGOÀI transaction - cùng lý do kỹ thuật đã ghi ở nhiều nơi khác (mục 15.2/16.2/
   *  17.2/19.2/22.2 changelog notification). */
  private async notifyTransferCreated(transfer: WarehouseTransferWithRefs): Promise<void> {
    try {
      const itemCount = transfer.items.length + transfer.pieceItems.length;
      await this.notifications.emit('WAREHOUSE_TRANSFER_CREATED', {
        entityId: transfer.id.toString(),
        actorId: transfer.createdById,
        params: {
          code: transfer.code,
          fromWarehouseName: transfer.fromWarehouse.name,
          itemCount,
          toWarehouseCode: transfer.toWarehouse.code,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to create WAREHOUSE_TRANSFER_CREATED notification (entity ${transfer.id}): ${(error as Error).message}`,
      );
    }
  }

  private async resolveTransferCreated(entityId: bigint): Promise<void> {
    try {
      await this.notifications.resolve({
        entityType: 'WAREHOUSE_TRANSFER',
        entityId: entityId.toString(),
        types: ['WAREHOUSE_TRANSFER_CREATED'],
      });
    } catch (error) {
      this.logger.error(
        `Failed to resolve WAREHOUSE_TRANSFER_CREATED (entity ${entityId}): ${(error as Error).message}`,
      );
    }
  }

  private async notifyTransferRejected(
    transfer: WarehouseTransferWithRefs,
    reason: string,
  ): Promise<void> {
    try {
      const itemCount = transfer.items.length + transfer.pieceItems.length;
      await this.notifications.emit('WAREHOUSE_TRANSFER_REJECTED', {
        entityId: transfer.id.toString(),
        params: {
          code: transfer.code,
          fromWarehouseName: transfer.fromWarehouse.name,
          itemCount,
          reason,
          createdById: transfer.createdById,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to create WAREHOUSE_TRANSFER_REJECTED notification (entity ${transfer.id}): ${(error as Error).message}`,
      );
    }
  }

  async create(
    dto: CreateWarehouseTransferDto,
    warehouseScope: string | null,
    userId: string,
    idempotencyKey?: string,
  ): Promise<WarehouseTransferResponseDto> {
    // Vấn đề #11 audit 26/08 (phần còn thiếu) - trước đây create() không có gì để dedupe, khác
    // material-issues/packaging-issues/steel-issues đã có. Cùng idiom resolve-or-return.
    if (idempotencyKey) {
      const existing = await this.prisma.warehouseTransfer.findUnique({
        where: { idempotencyKey },
        include: TRANSFER_INCLUDE,
      });
      if (existing) {
        return this.toResponseDto(existing);
      }
    }

    const fromWarehouseId = parseBigIntId(dto.fromWarehouseId);
    const toWarehouseId = parseBigIntId(dto.toWarehouseId);

    const [fromWarehouse, toWarehouse] = await Promise.all([
      this.findWarehouseOrThrow(fromWarehouseId),
      this.findWarehouseOrThrow(toWarehouseId),
    ]);

    // Kho ẢO (OPENING_BALANCE/SCRAP/PRODUCTION/SUPPLIER) không phải điểm nguồn/đích hợp lệ cho
    // "chuyển kho tự do" - đây là điểm đối ứng bút toán kép cho các nghiệp vụ CÓ audit riêng (mua
    // hàng, "Sửa nhanh tồn kho" bắt buộc note + optimistic lock, KCS phế liệu...), không phải kho
    // vật lý. Live-test 15/09/2026 xác nhận đây là lỗ hổng THẬT: gỡ isValidTransferRoute() (quyết
    // định nghiệp vụ ở trên) vô tình gỡ luôn tác dụng phụ của nó là chặn mọi code không match
    // warehouseFamilyOf() - vốn luôn null với code kho ảo. Test thực tế trên DB dev: OPENING_BALANCE
    // và PRODUCTION có DÒNG DƯƠNG cho nhiều vật tư (vd PRODUCTION giữ "vật tư đang tiêu hao SX" -
    // dương vì đã bị trừ khỏi kho thật, KHÔNG phải tồn thật) - "chuyển kho tự do" từ đó về kho thật
    // sẽ NHÂN BẢN vật tư không tồn tại vật lý; chiều ngược lại (gửi TỚI kho ảo) né được luôn note
    // bắt buộc + optimistic lock của adjustStock(). FE (ChuyenKhoTuDoPage.tsx) đã lọc isVirtual khỏi
    // dropdown nên không đi qua UI được, nhưng BE phải tự chặn (defense-in-depth) vì gọi thẳng API
    // vẫn lọt - piece-transfer (createPieceTransfer(), dùng isValidTransferRoute()) không cần thêm
    // chặn vì warehouseFamilyOf() vốn đã loại kho ảo.
    if (fromWarehouse.isVirtual || toWarehouse.isVirtual) {
      const badWarehouse = fromWarehouse.isVirtual ? fromWarehouse : toWarehouse;
      throw new BadRequestException(
        `"${badWarehouse.name}" là kho ảo (điểm đối ứng bút toán kép) - không dùng được cho chuyển kho tự do`,
      );
    }

    // Kho nguồn tạo phiếu - scope phải khớp fromWarehouse (kho đích chỉ tham gia lúc confirm()).
    this.assertWarehouseScope(warehouseScope, fromWarehouse.code, 'tạo phiếu chuyển kho từ');

    // Quyết định nghiệp vụ: bỏ ràng buộc chuỗi kho cố định cho vật tư tiêu hao (trước đây chỉ được
    // đi đúng 1 bước Phôi sơn hàn → Vật tư TP → Thành phẩm qua isValidTransferRoute()) - thủ kho
    // giờ chủ động chọn kho nguồn/đích bất kỳ. Chỉ còn chặn trường hợp vô nghĩa: nguồn == đích.
    // Luồng "mảnh"/piece-transfer (createPieceTransfer(), gắn PI/production order) KHÔNG đổi -
    // vẫn dùng isValidTransferRoute() vì đó là nghiệp vụ khác (WIP theo lô sản xuất đã qua KCS).
    if (fromWarehouseId === toWarehouseId) {
      throw new BadRequestException('Kho nguồn và kho đích không được trùng nhau');
    }

    // 2026-09-15 (quyết định nghiệp vụ): Phôi Sơn Hàn không nhận chuyển kho tự do từ chặng khác -
    // họ chỉ nhận vật tư qua mua hàng/nhập kho. Chặn cứng ở đây vì assertWarehouseScope() chỉ xét
    // kho NGUỒN, không có gì cản 1 request hợp lệ khác (vd vat-tu-tp gửi ngược) chọn phoi-son-han
    // làm đích qua thẳng API.
    // Đợt 7 (anh Nhân 07/11): ngoại lệ DUY NHẤT - kho Phôi chuyển sang kho Hàn CÙNG XƯỞNG (đá cắt mua về kho Phôi, Hàn
    // dùng một phần).
    const phoiToHanSameWorkshop =
      fromWarehouse.kind === WarehouseKind.PHOI &&
      toWarehouse.kind === WarehouseKind.HAN &&
      fromWarehouse.workshopId != null &&
      fromWarehouse.workshopId === toWarehouse.workshopId;
    if (warehouseFamilyOf(toWarehouse.code) === 'phoi-son-han' && !phoiToHanSameWorkshop) {
      throw new BadRequestException(
        `Không được chuyển kho tự do tới "${toWarehouse.name}" - kho Phôi Sơn Hàn chỉ nhận vật tư qua mua hàng/nhập kho`,
      );
    }

    const planFormId = dto.planFormId ? parseBigIntId(dto.planFormId) : undefined;

    const created = await this.prisma.$transaction(async (tx) => {
      // Khoá advisory TRƯỚC khi đếm - live-test 15/09/2026 (2 request đồng thời) xác nhận
      // nextTransferCode() cũ (đếm ở NGOÀI transaction, không khoá gì) cho ra cùng 1 mã ở 4/5
      // request bắn cùng lúc, rớt 409 "Duplicate value" dù tồn kho thừa sức phục vụ cả 2 - lưới
      // chặn "unique constraint trên code" vẫn đúng (không bao giờ ghi trùng), nhưng biến 1 race vô
      // hại (2 thủ kho tạo phiếu cùng lúc) thành lỗi giả phải tự bấm lại. Khoá theo năm (cùng phạm
      // vi với prefix `CK-{year}-`) serialize đúng phần đếm+tạo, cùng idiom lockBusinessKey() đã
      // dùng ở createPieceTransfer() - tự nhả khi transaction này commit/rollback.
      const code = await this.nextTransferCode(tx, fromWarehouse);

      const clampedItems: {
        materialId: bigint;
        materialName: string;
        unit: string;
        quantity: number;
        note?: string;
        spec: string;
      }[] = [];

      // Gộp các dòng CÙNG materialId TRƯỚC khi tính khả dụng (2026-09-15, phát hiện qua live-test:
      // 1 request với 2 dòng cùng materialId, mỗi dòng xin 2000/2788 tồn thật - cả 2 dòng đều đọc
      // CÙNG 1 `available` (reservation của dòng 1 chỉ ghi vào WarehouseTransferReservation SAU khi
      // cả vòng lặp xong, xem createMany bên dưới), nên cả 2 CÙNG được clamp riêng rẽ theo 2788 →
      // tổng 4000 lọt qua, phiếu tạo ra "giữ chỗ" vượt tồn thật. postEntry() (StockLedgerService)
      // không tự chặn âm số dư khi confirm() ghi ledger sau này - nếu phiếu này được duyệt sẽ làm
      // âm tồn kho thật. Gộp theo materialId để mỗi vật tư chỉ bị trừ khả dụng ĐÚNG 1 lần cho dù
      // request có bao nhiêu dòng trùng.
      //
      // Gộp theo (vật tư, QUY CÁCH): nệm khác quy cách là các bucket tồn RIÊNG nên mỗi quy cách tự tính khả dụng
      // và giữ chỗ riêng (2026-10-23).
      const itemsByMaterial = new Map<
        string,
        {
          materialId: string;
          materialName: string;
          unit: string;
          quantity: number;
          note?: string;
          spec: string;
        }
      >();
      for (const item of dto.items) {
        const spec = item.spec?.trim() ?? '';
        const key = `${item.materialId}|${spec}`;
        const existing = itemsByMaterial.get(key);
        if (existing) {
          existing.quantity += item.quantity;
        } else {
          itemsByMaterial.set(key, { ...item, spec });
        }
      }

      for (const item of itemsByMaterial.values()) {
        const materialId = parseBigIntId(item.materialId);
        // FOR UPDATE khoá TẤT CẢ dòng stock_quant liên quan (mọi bucket chiều dài) trong lúc tính
        // "tồn khả dụng" - chặn 2 phiếu tạo gần như đồng thời cùng đọc thấy 1 số dư rồi cùng đặt
        // cọc vượt quá tồn thật (oversell race mà unique constraint không bắt được, khác lớp race
        // của BomRevision.revNo).
        const locked = await tx.$queryRaw<{ qty: Prisma.Decimal; stockLengthMm: number }[]>`
          SELECT "qty", "stockLengthMm" FROM "stock_quant"
          WHERE "warehouseId" = ${fromWarehouseId} AND "materialId" = ${materialId}
            AND "spec" = ${item.spec}
          FOR UPDATE
        `;
        // Đính chính audit độc lập 09/09 (rà soát nốt nhánh fixbug-28-08): trước đây đọc `locked[0]`
        // (1 dòng BẤT KỲ Postgres trả về) làm "tồn hiện có" - nếu vật tư này có ≥2 bucket chiều dài
        // (đã có tồn ở bucket 0 lẫn 1 bucket sắt khác, vd do gán nhầm dùng chung materialId với
        // CuttingProposal), `locked[0]` có thể trả về bucket KHÁC bucket 0 mà getAvailableQty() bên
        // dưới đang tính (luôn ngầm định bucket 0 cho chuyển kho nội bộ) - tính sai available, có
        // thể tạo phiếu chuyển vượt quá tồn thật của ĐÚNG bucket sẽ bị trừ lúc confirm() (luôn ghi
        // stockLengthMm=0, xem bên dưới). Chuyển kho nội bộ CỐ Ý chưa hỗ trợ chọn cỡ cây - nếu vật
        // tư đã có bất kỳ bucket ≠ 0 với qty ≠ 0, chặn cứng thay vì âm thầm tính sai, gợi ý dùng
        // đúng luồng xuất sắt (Phôi) cho vật tư đó.
        const nonZeroBucket = locked.find((r) => r.stockLengthMm !== 0 && r.qty.toNumber() !== 0);
        if (nonZeroBucket) {
          throw new BadRequestException(
            `Vật tư ${materialId} đã có tồn kho phân theo cỡ cây (bucket ${nonZeroBucket.stockLengthMm}mm) - ` +
              `chuyển kho nội bộ chưa hỗ trợ chọn cỡ cây, dùng đúng luồng xuất sắt (Phôi) cho vật tư này`,
          );
        }
        const onHand = locked.reduce((sum, r) => sum + r.qty.toNumber(), 0);

        // Dùng ĐÚNG hàm dùng chung (H1 fix) - trước đây tự cộng riêng warehouseTransferReservation,
        // bỏ qua StockReservation (giữ chỗ cho phương án cắt sắt đã duyệt) - 2 nghiệp vụ giành
        // nhau cùng lô hàng mà không ai phát hiện. getAvailableQty() là hàm DUY NHẤT được phép
        // cộng cả 2 bảng (xem comment ở đầu hàm đó). Bucket 0 tường minh - chặn ở trên đã đảm bảo
        // mọi tồn còn lại của vật tư này đều ở bucket 0.
        const available = await this.stockReservationsService.getAvailableQty(
          tx,
          fromWarehouseId,
          materialId,
          onHand,
          0,
          undefined,
          item.spec,
        );
        const quantity = Math.max(0, Math.min(item.quantity, available));
        if (quantity > 0) {
          clampedItems.push({
            materialId,
            materialName: item.materialName,
            unit: item.unit,
            quantity,
            note: item.note,
            spec: item.spec,
          });
        }
      }

      if (clampedItems.length === 0) {
        throw new BadRequestException(
          'Không đủ tồn kho khả dụng để tạo phiếu chuyển kho cho (các) vật tư đã chọn',
        );
      }

      const transfer = await tx.warehouseTransfer.create({
        data: {
          code,
          fromWarehouseId,
          toWarehouseId,
          planFormId,
          note: dto.note,
          createdById: userId,
          idempotencyKey,
          items: { create: clampedItems },
        },
        include: TRANSFER_INCLUDE,
      });

      await tx.warehouseTransferReservation.createMany({
        data: clampedItems.map((item) => ({
          transferId: transfer.id,
          warehouseId: fromWarehouseId,
          materialId: item.materialId,
          quantity: item.quantity,
          spec: item.spec,
        })),
      });

      return transfer;
    });

    await this.notifyTransferCreated(created);
    this.publishTransferChanged(created.id, 'CREATED', created.createdById);
    return this.toResponseDto(created);
  }

  /**
   * Phiếu chuyển kho piece-only (mảnh/vật tư thành phẩm - mục 7 docs/review-2026-08-17-
   * sanxuat-stage-v16-va-chuyen-kho-manh.md) - tách khỏi create() (vật tư tiêu hao) theo quyết
   * định "không gộp" mục 7.5. Không dùng WarehouseTransferReservation (piece không có StockQuant
   * làm nguồn khả dụng) - clamp theo GetPieceTransferPlan tại thời điểm tạo thay thế.
   */
  async createPieceTransfer(
    dto: CreatePieceWarehouseTransferDto,
    warehouseScope: string | null,
    userId: string,
    idempotencyKey?: string,
  ): Promise<WarehouseTransferResponseDto> {
    // Vấn đề #11 audit 26/08 (phần còn thiếu) - cùng lý do create().
    if (idempotencyKey) {
      const existing = await this.prisma.warehouseTransfer.findUnique({
        where: { idempotencyKey },
        include: TRANSFER_INCLUDE,
      });
      if (existing) {
        return this.toResponseDto(existing);
      }
    }

    const fromWarehouseId = parseBigIntId(dto.fromWarehouseId);
    const toWarehouseId = parseBigIntId(dto.toWarehouseId);

    const [fromWarehouse, toWarehouse] = await Promise.all([
      this.findWarehouseOrThrow(fromWarehouseId),
      this.findWarehouseOrThrow(toWarehouseId),
    ]);

    this.assertWarehouseScope(warehouseScope, fromWarehouse.code, 'tạo phiếu chuyển kho từ');

    // Đợt 7: mảnh Phước An hàn xong -> kho Sơn Phú An (kho Hàn chuyển sang kho Sơn của XƯỞNG KHÁC, có phiếu ký). Trong cùng xưởng
    // không lập phiếu (user chốt 09/11) - nên Hàn -> Sơn cùng xưởng không phải 1 tuyến hợp lệ.
    const toPaint =
      fromWarehouse.kind === WarehouseKind.HAN &&
      toWarehouse.kind === WarehouseKind.SON &&
      fromWarehouse.workshopId !== toWarehouse.workshopId;
    if (!toPaint && !isValidTransferRoute(fromWarehouse.code, toWarehouse.code)) {
      throw new BadRequestException(
        `Không được chuyển mảnh từ "${fromWarehouse.name}" sang "${toWarehouse.name}" - mảnh không đan chuyển từ kho Phôi/Hàn/Sơn sang kho Thành phẩm của lệnh (mảnh cần đan lập phiếu xuất đan)`,
      );
    }

    const orderIds = [...new Set(dto.pieceItems.map((i) => i.productionOrderId))];
    if (!toPaint) {
      // Kho Thành phẩm của lệnh (anh Nhân 09/11): QLSX đã chọn kho cho từng SKU - phiếu phải về đúng kho đó.
      const items = await this.prisma.productionOrder.findMany({
        where: { id: { in: orderIds.map((id) => parseBigIntId(id)) } },
        select: {
          poNumber: true,
          productionInvoiceItem: { select: { warehouseCode: true } },
        },
      });
      const wrong = items.find(
        (o) =>
          o.productionInvoiceItem.warehouseCode &&
          o.productionInvoiceItem.warehouseCode !== toWarehouse.code,
      );
      if (wrong) {
        throw new BadRequestException(
          `SKU ${wrong.poNumber} giao về kho ${wrong.productionInvoiceItem.warehouseCode}, không phải "${toWarehouse.name}" - chọn đúng kho Thành phẩm của lệnh`,
        );
      }
    }

    // Piece không có StockQuant để FOR UPDATE - khoá advisory theo từng productionOrderId (sort
    // tăng dần trước khi khoá, tránh deadlock khi 2 request chạm nhiều order chung theo thứ tự
    // khác nhau) là cách duy nhất chặn 2 request đồng thời cùng đọc 1 suggestedQty rồi cùng tạo
    // phiếu vượt số mảnh thực đã qua KCS.
    const transfer = await this.prisma.$transaction(async (tx) => {
      for (const orderId of [...orderIds].sort()) {
        await lockBusinessKey(tx, `piece-transfer:${orderId}`);
      }

      // Cùng khoá/dãy số với create() (CK-<mã kho giao>-NNN) - xem nextTransferCode().
      const code = await this.nextTransferCode(tx, fromWarehouse);

      const plan = await this.getPieceTransferPlan(orderIds, tx, toPaint ? 'TO_PAINT' : 'OUT');
      const planByKey = new Map(plan.map((p) => [`${p.productionOrderId}:${p.pieceId}`, p]));

      const rows: {
        productionOrderId: bigint;
        pieceId: bigint;
        quantity: number;
        note?: string;
      }[] = [];
      for (const item of dto.pieceItems) {
        const planItem = planByKey.get(`${item.productionOrderId}:${item.pieceId}`);
        const suggestedQty = planItem?.suggestedQty ?? 0;
        const quantity = Math.max(0, Math.min(item.quantity, suggestedQty));
        if (quantity > 0) {
          rows.push({
            productionOrderId: parseBigIntId(item.productionOrderId),
            pieceId: parseBigIntId(item.pieceId),
            quantity,
            note: item.note,
          });
        }
      }

      if (rows.length === 0) {
        throw new BadRequestException(
          'Không có mảnh nào đủ số lượng đã qua KCS (trừ phần đã ở trong phiếu khác) để tạo phiếu chuyển kho',
        );
      }

      return tx.warehouseTransfer.create({
        data: {
          code,
          fromWarehouseId,
          toWarehouseId,
          planFormId: dto.planFormId ? parseBigIntId(dto.planFormId) : undefined,
          note: dto.note,
          createdById: userId,
          idempotencyKey,
          pieceItems: { create: rows },
        },
        include: TRANSFER_INCLUDE,
      });
    });

    await this.notifyTransferCreated(transfer);
    this.publishTransferChanged(transfer.id, 'CREATED', transfer.createdById);
    return this.toResponseDto(transfer);
  }

  /**
   * Kế hoạch chuyển kho cho mảnh theo 1 hoặc nhiều PO (không theo PI - mục 6 tài liệu trên, vì 1
   * PI có thể gồm nhiều PO tiến độ khác nhau). Mốc "sẵn sàng" tính theo ProductionBatch QC_DONE,
   * stage tuỳ loại mảnh: needsHan=true → SON nếu needsSon, không thì HAN; needsHan=false ("vật tư
   * thành phẩm", vd chân nhôm - cắt xong là hết, không hàn) → PHOI, Phôi tự báo sản lượng qua
   * cùng ProductionBatchesService.create() (thêm 21/08/2026 - xem role-permissions PHOI_STAFF).
   * "Đã chuyển" trừ CẢ phiếu PENDING lẫn CONFIRMED (không chỉ CONFIRMED như mô tả mục 7.2) để tránh
   * 2 phiếu PENDING cùng lúc cùng "double-book" quá số đã đạt - risk tương tự oversell vật tư
   * nhưng piece không có StockQuant để FOR UPDATE khoá, nên chặn ở tầng đọc kế hoạch thay vì khoá
   * dòng.
   *
   * Lịch sử needsHan=false: từ 2026-08-19 (SteelIssue gộp theo PI, mất pieceId) tới 2026-08-20
   * (fix Critical C2 - đổi throw làm hỏng cả batch thành BỎ QUA đúng mảnh lỗi), nhánh này hoàn
   * toàn không tính được "sẵn sàng" nên bị loại khỏi kế hoạch. 21/08/2026: xác nhận needsHan=false
   * LÀ nghiệp vụ thật (không phải lý thuyết) → khôi phục lại bằng nguồn dữ liệu MỚI (Phôi tự báo
   * qua ProductionBatch, KHÔNG dựa vào SteelIssue.pieceId đã mất) thay vì SUM SteelIssue.QC_PASSED
   * như thiết kế gốc 2026-08-17 (docs/review-2026-08-17-sanxuat-stage-v16-va-chuyen-kho-manh.md).
   */
  async getPieceTransferPlan(
    productionOrderIds: string[],
    client: PrismaServiceType | PrismaTx = this.prisma,
    /** 'OUT' (mặc định): chuyển ra kho Phụ kiện/Thành phẩm sau công đoạn cuối. 'TO_PAINT' (Đợt 7): mảnh cần sơn của xưởng không có
     *  kho Sơn (Phước An) - hàn xong (HAN QC_DONE) chuyển sang kho Sơn Phú An. */
    leg: 'OUT' | 'TO_PAINT' = 'OUT',
  ): Promise<PieceTransferPlanItemResponseDto[]> {
    if (productionOrderIds.length === 0) {
      throw new BadRequestException('Phải truyền ít nhất 1 productionOrderId');
    }
    const orderBigIds = productionOrderIds.map((id) => parseBigIntId(id));
    const orders = await client.productionOrder.findMany({
      where: { id: { in: orderBigIds } },
      include: {
        mfgProduct: true,
        productionInvoiceItem: {
          select: { warehouseCode: true, salesOrder: { select: { orderCode: true } } },
        },
      },
    });
    if (orders.length !== orderBigIds.length) {
      throw new NotFoundException('Một hoặc nhiều productionOrderId không tồn tại');
    }
    const bomRevisionIds = [...new Set(orders.map((o) => o.bomRevisionId))];

    const [bomPieces, batches, transferredItems] = await Promise.all([
      client.bomPiece.findMany({
        where: { bomRevisionId: { in: bomRevisionIds } },
        include: { piece: true },
      }),
      client.productionBatch.findMany({
        where: {
          productionOrderId: { in: orderBigIds },
          status: ProductionBatchStatus.QC_DONE,
          stage: { in: [MfgStage.PHOI, MfgStage.HAN, MfgStage.SON] },
        },
        select: { productionOrderId: true, pieceId: true, stage: true, reportedQty: true },
      }),
      client.warehouseTransferPieceItem.findMany({
        where: {
          productionOrderId: { in: orderBigIds },
          transfer: {
            status: { in: [TransferStatus.PENDING, TransferStatus.CONFIRMED] },
            ...(leg === 'TO_PAINT' ? PIECE_TRANSFER_TO_PAINT : PIECE_TRANSFER_LEAVES_FRAME),
          },
        },
        select: { productionOrderId: true, pieceId: true, quantity: true },
      }),
    ]);

    const bomPiecesByRevision = new Map<string, typeof bomPieces>();
    for (const bp of bomPieces) {
      const key = bp.bomRevisionId.toString();
      const arr = bomPiecesByRevision.get(key) ?? [];
      arr.push(bp);
      bomPiecesByRevision.set(key, arr);
    }

    const batchQtyByKey = new Map<string, number>();
    for (const b of batches) {
      const key = `${b.productionOrderId}:${b.pieceId}:${b.stage}`;
      batchQtyByKey.set(key, (batchQtyByKey.get(key) ?? 0) + b.reportedQty);
    }

    const transferredByKey = new Map<string, number>();
    for (const t of transferredItems) {
      const key = `${t.productionOrderId}:${t.pieceId}`;
      transferredByKey.set(key, (transferredByKey.get(key) ?? 0) + t.quantity);
    }

    const items: PieceTransferPlanItemResponseDto[] = [];
    for (const order of orders) {
      const pieces = bomPiecesByRevision.get(order.bomRevisionId.toString()) ?? [];
      for (const bp of pieces) {
        // needsHan=false, needsSon=true là tổ hợp không hợp lệ về nghiệp vụ (Sơn phải sau Hàn) -
        // bỏ qua, xem bảng mục 7.1.
        if (!bp.needsHan && bp.needsSon) continue;
        // Chặng Hàn -> Sơn chỉ có ý nghĩa với mảnh cần CẢ hàn lẫn sơn.
        if (leg === 'TO_PAINT' && !(bp.needsHan && bp.needsSon)) continue;
        // Mảnh cần đan không chuyển kho - xuất đan thẳng từ kho giữ mảnh bằng phiếu XK (anh Nhân 09/11/2026).
        if (leg === 'OUT' && bp.isWoven) continue;

        // needsHan=false ("vật tư thành phẩm") → PHOI (Phôi tự báo cắt xong, không qua Hàn/Sơn).
        // needsHan=true → SON nếu needsSon, không thì HAN. Xem comment đầu hàm.
        const finalStage =
          leg === 'TO_PAINT'
            ? MfgStage.HAN
            : !bp.needsHan
              ? MfgStage.PHOI
              : bp.needsSon
                ? MfgStage.SON
                : MfgStage.HAN;
        const readyQty = batchQtyByKey.get(`${order.id}:${bp.pieceId}:${finalStage}`) ?? 0;
        const transferredQty = transferredByKey.get(`${order.id}:${bp.pieceId}`) ?? 0;
        const suggestedQty = Math.max(0, readyQty - transferredQty);

        items.push(
          new PieceTransferPlanItemResponseDto({
            productionOrderId: order.id.toString(),
            poNumber: order.poNumber,
            salesOrderCode: order.productionInvoiceItem.salesOrder?.orderCode ?? null,
            productName: order.mfgProduct.name,
            pieceId: bp.pieceId.toString(),
            pieceCode: bp.piece.code,
            pieceName: bp.piece.name,
            label: bp.needsHan ? 'MANH' : 'VAT_TU_THANH_PHAM',
            readyQty,
            transferredQty,
            suggestedQty,
            finishedWarehouseCode: order.productionInvoiceItem.warehouseCode ?? null,
          }),
        );
      }
    }
    return items;
  }

  async findAll(
    query: ListWarehouseTransfersQueryDto,
    warehouseScope: string | null,
  ): Promise<Paginated<WarehouseTransferResponseDto>> {
    const scopedWarehouseId = warehouseScope
      ? (await this.prisma.warehouse.findUnique({ where: { code: warehouseScope } }))?.id
      : undefined;

    const where: Prisma.WarehouseTransferWhereInput = {
      status: query.status,
      toWarehouseId: query.toWarehouseId ? parseBigIntId(query.toWarehouseId) : undefined,
      // Nhân viên kho chỉ thấy phiếu chạm tới đúng kho của mình (gửi hoặc nhận) - null/tổng kho
      // (BOSS/ADMIN) thấy tất cả, không lọc gì thêm.
      OR: scopedWarehouseId
        ? [{ fromWarehouseId: scopedWarehouseId }, { toWarehouseId: scopedWarehouseId }]
        : undefined,
    };

    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.warehouseTransfer.findMany({ ...args, include: TRANSFER_INCLUDE }),
        count: (args) => this.prisma.warehouseTransfer.count(args),
      },
      query,
      where,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { createdAt: query.sortOrder },
    );

    return { data: result.data.map((r) => this.toResponseDto(r)), meta: result.meta };
  }

  async findOne(
    id: string,
    warehouseScope: string | null,
  ): Promise<WarehouseTransferDetailResponseDto> {
    const transfer = await this.findOneOrThrow(id);
    this.assertScopeTouchesTransfer(warehouseScope, transfer);
    return this.toDetailResponseDto(transfer);
  }

  async confirm(
    id: string,
    dto: ConfirmWarehouseTransferDto,
    userId: string,
    warehouseScope: string | null,
  ): Promise<WarehouseTransferResponseDto> {
    const transfer = await this.findOneOrThrow(id);
    if (transfer.status !== TransferStatus.PENDING) {
      throw new ConflictException(
        `Phiếu chuyển kho ${transfer.code} đang ở trạng thái ${transfer.status} - chỉ phiếu chờ nhận mới xác nhận được`,
      );
    }
    // Kho đích xác nhận.
    this.assertWarehouseScope(
      warehouseScope,
      transfer.toWarehouse.code,
      'xác nhận phiếu chuyển kho tới',
    );
    // v8 4.1/4.2: khoá cứng - không có ảnh phiếu đã ký thì không nhận được.
    const urls = [...new Set((dto.signedSlipUrls ?? []).map((u) => u.trim()).filter(Boolean))];
    if (urls.length === 0) {
      throw new BadRequestException('Cần ảnh phiếu chuyển kho đã có chữ ký');
    }
    const received = this.resolveReceived(transfer, dto);

    // Toàn bộ đọc-status -> ghi-ledger -> update-status nằm chung 1 transaction. updateMany guard
    // theo (id, status:PENDING) chạy TRƯỚC, cùng pattern SkusService.approve(): UPDATE khoá hàng
    // trong Postgres nên 2 request confirm/reject đồng thời cho cùng phiếu tự serialize - request
    // thua chỉ thấy count=0 và rollback toàn bộ (kể cả các postEntry đã chạy trong cùng tx), thay
    // vì trước đây status được ghi ở bước cuối không kèm điều kiện, khiến 2 request có thể cùng
    // "thắng" (Critical C1 - phiếu hiện REJECTED nhưng ledger đã ghi CONFIRMED).
    const confirmed = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.warehouseTransfer.updateMany({
        where: { id: transfer.id, status: TransferStatus.PENDING },
        data: {
          status: TransferStatus.CONFIRMED,
          confirmedAt: new Date(),
          confirmedById: userId,
          signedSlipUrls: urls,
        },
      });
      if (count === 0) {
        throw new ConflictException(
          `Phiếu chuyển kho ${id} đã được xử lý bởi 1 yêu cầu khác trong lúc xác nhận - không ghi đè`,
        );
      }

      // idempotencyKey theo (transferId, itemId) khiến việc gọi lại confirm() sau khi 1 item giữa
      // chừng lỗi trở nên an toàn - các item đã post thành công trả về đúng dòng cũ, không tạo
      // trùng bút toán (StockLedgerService.postEntry tự resolve-or-return theo key này).
      for (const item of transfer.items) {
        // materialId bắt buộc từ 09/09/2026 (DTO không còn cho tạo dòng "ghi tự do") - guard này
        // giờ chỉ còn là an toàn cho dữ liệu CŨ đã tạo trước ngày đó (cột DB vẫn nullable).
        if (!item.materialId) continue;
        // v8 4.7: tồn kho nhận chỉ cộng số THỰC NHẬN; phần thiếu ở lại kho giao (kho giao lập phiếu bù).
        const qty = received.items.get(item.id.toString()) ?? item.quantity.toNumber();
        if (qty < item.quantity.toNumber()) {
          await tx.warehouseTransferItem.update({
            where: { id: item.id },
            data: { quantity: qty, sentQty: item.quantity },
          });
        }
        if (qty <= 0) continue;
        await this.stockLedgerService.postEntry(
          {
            fromWarehouseId: transfer.fromWarehouseId,
            toWarehouseId: transfer.toWarehouseId,
            materialId: item.materialId,
            qty,
            refType: StockLedgerRefType.WAREHOUSE_TRANSFER,
            refId: transfer.id.toString(),
            createdById: userId,
            idempotencyKey: `warehouse-transfer:${transfer.id}:item:${item.id}`,
            // Lấy ĐÚNG bucket quy cách đã chọn lúc tạo phiếu ('' = không quy cách) - nệm.
            spec: item.spec,
            // Phiếu chuyển hàng của lệnh đổi xưởng: đúng chiều dài cây (sắt). Phiếu thường = 0.
            stockLengthMm: item.stockLengthMm,
          },
          tx,
        );
      }
      for (const pieceItem of transfer.pieceItems) {
        // Mảnh: quantity giảm về số thực nhận -> mọi chỗ đếm "đã chuyển" (kế hoạch chuyển, xuất đan, chuyền kiểm) tự theo
        // thực nhận, phần thiếu lại hiện ở kế hoạch để lập phiếu bù.
        const qty = received.pieceItems.get(pieceItem.id.toString()) ?? pieceItem.quantity;
        if (qty < pieceItem.quantity) {
          await tx.warehouseTransferPieceItem.update({
            where: { id: pieceItem.id },
            data: { quantity: qty, sentQty: pieceItem.quantity },
          });
        }
        if (qty <= 0) continue;
        await this.stockLedgerService.postEntry(
          {
            fromWarehouseId: transfer.fromWarehouseId,
            toWarehouseId: transfer.toWarehouseId,
            pieceId: pieceItem.pieceId,
            qty,
            refType: StockLedgerRefType.WAREHOUSE_TRANSFER,
            refId: transfer.id.toString(),
            createdById: userId,
            idempotencyKey: `warehouse-transfer:${transfer.id}:piece-item:${pieceItem.id}`,
          },
          tx,
        );
      }

      await tx.warehouseTransferReservation.updateMany({
        where: { transferId: transfer.id, status: ReservationStatus.ACTIVE },
        data: { status: ReservationStatus.RELEASED },
      });

      // Phiếu chuyển hàng của lệnh đổi xưởng (10/11/2026, Sang dặn): giữ chỗ của lệnh chuyển theo sang kho mới, đúng số thực nhận
      // - số "Cần" ở Xuất sắt và sắt giữ cho lệnh vẫn khớp. Phần thiếu vẫn giữ ở kho cũ, kho cũ lập phiếu bù.
      if (transfer.productionInvoiceId) {
        await this.workshopMove.moveReservationsInTx(
          tx,
          {
            productionInvoiceId: transfer.productionInvoiceId,
            fromWarehouseId: transfer.fromWarehouseId,
            toWarehouseId: transfer.toWarehouseId,
          },
          transfer.items
            .filter((i) => i.materialId)
            .map((i) => ({
              materialId: i.materialId!,
              stockLengthMm: i.stockLengthMm,
              spec: i.spec,
              qty: received.items.get(i.id.toString()) ?? i.quantity.toNumber(),
            })),
        );
      }

      return tx.warehouseTransfer.findUniqueOrThrow({
        where: { id: transfer.id },
        include: TRANSFER_INCLUDE,
      });
    });

    await this.resolveTransferCreated(confirmed.id);
    if (confirmed.productionInvoiceId) {
      await this.resolveWorkshopMoveIfDone(
        confirmed.productionInvoiceId,
        confirmed.fromWarehouseId,
      );
    }
    this.publishTransferChanged(confirmed.id, 'CONFIRMED', userId);
    return this.toResponseDto(confirmed);
  }

  async reject(
    id: string,
    rejectionReason: string,
    warehouseScope: string | null,
    userId: string,
  ): Promise<WarehouseTransferResponseDto> {
    const transfer = await this.findOneOrThrow(id);
    if (transfer.status !== TransferStatus.PENDING) {
      throw new ConflictException(
        `Phiếu chuyển kho ${id} đang ở trạng thái ${transfer.status} - chỉ PENDING mới từ chối được`,
      );
    }
    this.assertWarehouseScope(
      warehouseScope,
      transfer.toWarehouse.code,
      'từ chối phiếu chuyển kho tới',
    );

    // Cùng lý do với confirm(): updateMany guard theo (id, status:PENDING) trước, để 2 request
    // confirm/reject đồng thời cho cùng phiếu tự serialize thay vì cùng "thắng".
    const rejected = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.warehouseTransfer.updateMany({
        where: { id: transfer.id, status: TransferStatus.PENDING },
        data: {
          status: TransferStatus.REJECTED,
          rejectionReason,
          rejectedAt: new Date(),
          rejectedById: userId,
        },
      });
      if (count === 0) {
        throw new ConflictException(
          `Phiếu chuyển kho ${id} đã được xử lý bởi 1 yêu cầu khác trong lúc từ chối - không ghi đè`,
        );
      }

      await tx.warehouseTransferReservation.updateMany({
        where: { transferId: transfer.id, status: ReservationStatus.ACTIVE },
        data: { status: ReservationStatus.RELEASED },
      });

      return tx.warehouseTransfer.findUniqueOrThrow({
        where: { id: transfer.id },
        include: TRANSFER_INCLUDE,
      });
    });

    await this.resolveTransferCreated(rejected.id);
    await this.notifyTransferRejected(rejected, rejectionReason);
    this.publishTransferChanged(rejected.id, 'REJECTED', userId);
    return this.toResponseDto(rejected);
  }

  private async findWarehouseOrThrow(id: bigint): Promise<Warehouse> {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!warehouse) {
      throw new NotFoundException(`Không tìm thấy kho ${id}`);
    }
    return warehouse;
  }

  private async findOneOrThrow(id: string): Promise<WarehouseTransferWithRefs> {
    const bigId = parseBigIntId(id);
    const transfer = await this.prisma.warehouseTransfer.findUnique({
      where: { id: bigId },
      include: TRANSFER_INCLUDE,
    });
    if (!transfer) {
      throw new NotFoundException(`Không tìm thấy phiếu chuyển kho ${id}`);
    }
    return transfer;
  }

  /** null = tổng kho (BOSS/ADMIN), thấy mọi kho - không có gì để chặn. */
  private assertWarehouseScope(
    warehouseScope: string | null,
    requiredCode: string,
    actionLabel: string,
  ): void {
    if (warehouseScope && warehouseScope !== requiredCode) {
      throw new ForbiddenException(
        `Bạn bị giới hạn ở kho '${warehouseScope}', không được ${actionLabel} kho '${requiredCode}'`,
      );
    }
  }

  private assertScopeTouchesTransfer(
    warehouseScope: string | null,
    transfer: WarehouseTransferWithRefs,
  ): void {
    if (!warehouseScope) return;
    if (
      warehouseScope !== transfer.fromWarehouse.code &&
      warehouseScope !== transfer.toWarehouse.code
    ) {
      throw new ForbiddenException(
        `Bạn bị giới hạn ở kho '${warehouseScope}', không liên quan tới phiếu chuyển kho này`,
      );
    }
  }

  /**
   * Gọi bên trong transaction, SAU khi đã lockBusinessKey(tx, `warehouse-transfer-code:${year}`)
   * (xem create()) - khoá advisory serialize đúng phần đếm này giữa các request đồng thời, nên
   * nhận `tx` thay vì dùng `this.prisma` (client ngoài transaction sẽ không thấy tác dụng của
   * khoá). Trước 15/09/2026 đếm bằng `this.prisma` NGOÀI transaction, không khoá gì - vẫn đúng dữ
   * liệu nhờ unique constraint trên `code` chặn ghi trùng, nhưng request thua cuộc nhận thẳng lỗi
   * 409 thay vì tự chờ rồi lấy đúng số tiếp theo.
   */
  /** Hàng của lệnh đổi xưởng còn phải chuyển (theo kho của thủ kho; tổng kho thấy hết). */
  async getWorkshopMovePlans(warehouseScope: string | null) {
    return this.workshopMove.getPlans(this.prisma, { fromWarehouseCode: warehouseScope });
  }

  /**
   * Lập phiếu chuyển hàng của lệnh đổi xưởng (10/11/2026): mọi dòng đang giữ cho lệnh ở kho cũ (vật tư + chiều dài cây + quy
   * cách) thuộc 1 phần (sắt / vật tư khác), trừ phần đã nằm trên phiếu chờ nhận, sang kho cùng loại của xưởng mới. Phần sắt
   * chặn khi KHSX chưa kiểm lại phương án cắt; vật tư khác chuyển ngay (anh Nhân 10/11).
   */
  async createWorkshopMove(
    productionInvoiceId: string,
    fromWarehouseId: string,
    part: WorkshopMovePart,
    warehouseScope: string | null,
    userId: string,
    idempotencyKey?: string,
  ): Promise<WarehouseTransferResponseDto> {
    if (idempotencyKey) {
      const existing = await this.prisma.warehouseTransfer.findUnique({
        where: { idempotencyKey },
        include: TRANSFER_INCLUDE,
      });
      if (existing) return this.toResponseDto(existing);
    }
    const piId = parseBigIntId(productionInvoiceId);
    const fromWarehouse = await this.findWarehouseOrThrow(parseBigIntId(fromWarehouseId));
    this.assertWarehouseScope(warehouseScope, fromWarehouse.code, 'tạo phiếu chuyển kho từ');

    const transfer = await this.prisma.$transaction(
      async (tx) => {
        await lockBusinessKey(tx, `workshop-move:${piId}:${fromWarehouse.id}`);
        const [plan] = await this.workshopMove.getPlans(tx, {
          productionInvoiceId: piId,
          fromWarehouseCode: fromWarehouse.code,
          part,
        });
        if (!plan) {
          throw new BadRequestException(
            `Lệnh không còn ${part === 'STEEL' ? 'sắt' : 'vật tư'} giữ ở "${fromWarehouse.name}" cần chuyển sang xưởng mới (hoặc đã nằm trên phiếu chờ nhận)`,
          );
        }
        if (plan.recheckPending) throw new ConflictException(CUTTING_RECHECK_MESSAGE);
        const code = await this.nextTransferCode(tx, fromWarehouse);
        return tx.warehouseTransfer.create({
          data: {
            code,
            fromWarehouseId: fromWarehouse.id,
            toWarehouseId: parseBigIntId(plan.toWarehouseId),
            productionInvoiceId: piId,
            note: `Chuyển ${part === 'STEEL' ? 'sắt' : 'vật tư'} của lệnh ${plan.lenhCode} (đổi xưởng) sang ${plan.toWarehouseName}`,
            createdById: userId,
            idempotencyKey,
            items: {
              create: plan.lines.map((l) => ({
                materialId: parseBigIntId(l.materialId),
                materialName: l.materialName,
                unit: l.unit,
                quantity: l.qty,
                spec: l.spec,
                stockLengthMm: l.stockLengthMm,
              })),
            },
          },
          include: TRANSFER_INCLUDE,
        });
      },
      { timeout: 20_000 },
    );
    await this.notifyTransferCreated(transfer);
    this.publishTransferChanged(transfer.id, 'CREATED', transfer.createdById);
    return this.toResponseDto(transfer);
  }

  /** Đã chuyển hết hàng của lệnh khỏi kho cũ -> tắt thông báo "cần chuyển hàng". */
  private async resolveWorkshopMoveIfDone(piId: bigint, fromWarehouseId: bigint): Promise<void> {
    try {
      const plans = await this.workshopMove.getPlans(this.prisma, { productionInvoiceId: piId });
      const reservedLeft = await this.prisma.stockReservation.count({
        where: {
          productionInvoiceId: piId,
          warehouseId: fromWarehouseId,
          status: ReservationStatus.ACTIVE,
        },
      });
      if (reservedLeft > 0 && plans.some((p) => p.fromWarehouseId === fromWarehouseId.toString()))
        return;
      await this.notifications.resolve({
        entityType: 'PRODUCTION_INVOICE',
        entityId: `${piId}:${fromWarehouseId}`,
        types: ['WORKSHOP_MOVE_NEEDED'],
      });
    } catch (error) {
      this.logger.error(
        `Không tắt được thông báo chuyển hàng đổi xưởng: ${(error as Error).message}`,
      );
    }
  }

  private async nextTransferCode(tx: PrismaTx, fromWarehouse: Warehouse): Promise<string> {
    // v8 4.8 (09/11/2026): CK-<mã kho giao>-NNN, đếm liên tục theo từng kho giao (không theo năm). Khoá theo mã kho giao rồi
    // mới đếm - 2 phiếu cùng kho giao tạo đồng thời không ra trùng số (sự cố 15/09/2026 với cách đếm cũ ngoài khoá).
    const workshop = fromWarehouse.workshopId
      ? await tx.workshop.findUnique({
          where: { id: fromWarehouse.workshopId },
          select: { code: true },
        })
      : null;
    const prefix = `CK-${transferWarehouseShortCode({ ...fromWarehouse, workshopCode: workshop?.code ?? null })}-`;
    await lockBusinessKey(tx, `warehouse-transfer-code:${prefix}`);
    const count = await tx.warehouseTransfer.count({
      where: { code: { startsWith: prefix } },
    });
    return `${prefix}${String(count + 1).padStart(3, '0')}`;
  }

  /**
   * Số thực nhận từng dòng (v8 4.7): không gửi dòng nào = nhận đủ. Không được nhận quá số gửi; nhận 0 cả phiếu thì dùng
   * "Từ chối" thay vì xác nhận.
   */
  private resolveReceived(
    transfer: WarehouseTransferWithRefs,
    dto: ConfirmWarehouseTransferDto,
  ): { items: Map<string, number>; pieceItems: Map<string, number> } {
    const items = new Map<string, number>();
    const pieceItems = new Map<string, number>();
    for (const r of dto.items ?? []) {
      const line = transfer.items.find((i) => i.id.toString() === r.id);
      if (!line) throw new BadRequestException(`Dòng ${r.id} không thuộc phiếu ${transfer.code}`);
      if (r.receivedQty > line.quantity.toNumber()) {
        throw new BadRequestException(
          `${line.materialName}: thực nhận ${r.receivedQty} lớn hơn số gửi ${line.quantity.toNumber()}`,
        );
      }
      items.set(r.id, r.receivedQty);
    }
    for (const r of dto.pieceItems ?? []) {
      const line = transfer.pieceItems.find((i) => i.id.toString() === r.id);
      if (!line) throw new BadRequestException(`Dòng ${r.id} không thuộc phiếu ${transfer.code}`);
      if (!Number.isInteger(r.receivedQty)) {
        throw new BadRequestException(`${line.piece.name}: số mảnh thực nhận phải là số nguyên`);
      }
      if (r.receivedQty > line.quantity) {
        throw new BadRequestException(
          `${line.piece.name}: thực nhận ${r.receivedQty} lớn hơn số gửi ${line.quantity}`,
        );
      }
      pieceItems.set(r.id, r.receivedQty);
    }
    const total =
      transfer.items.reduce(
        (s, i) => s + (items.get(i.id.toString()) ?? i.quantity.toNumber()),
        0,
      ) +
      transfer.pieceItems.reduce((s, i) => s + (pieceItems.get(i.id.toString()) ?? i.quantity), 0);
    if (total <= 0) {
      throw new BadRequestException(
        'Không nhận được dòng nào - bấm "Từ chối" phiếu và ghi lý do thay vì xác nhận',
      );
    }
    return { items, pieceItems };
  }

  private toResponseDto(row: WarehouseTransferWithRefs): WarehouseTransferResponseDto {
    return new WarehouseTransferResponseDto({
      id: row.id.toString(),
      code: row.code,
      fromWarehouseId: row.fromWarehouseId.toString(),
      fromWarehouseCode: row.fromWarehouse.code,
      fromWarehouseName: row.fromWarehouse.name,
      toWarehouseId: row.toWarehouseId.toString(),
      toWarehouseCode: row.toWarehouse.code,
      toWarehouseName: row.toWarehouse.name,
      status: row.status,
      planFormId: row.planFormId?.toString() ?? null,
      rejectionReason: row.rejectionReason,
      note: row.note,
      createdAt: row.createdAt,
      confirmedAt: row.confirmedAt,
      rejectedAt: row.rejectedAt,
      createdById: row.createdById,
      confirmedById: row.confirmedById,
      rejectedById: row.rejectedById,
      createdByName: row.createdBy
        ? `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim()
        : null,
      confirmedByName: row.confirmedBy
        ? `${row.confirmedBy.firstName} ${row.confirmedBy.lastName}`.trim()
        : null,
      rejectedByName: row.rejectedBy
        ? `${row.rejectedBy.firstName} ${row.rejectedBy.lastName}`.trim()
        : null,
      signedSlipUrls: row.signedSlipUrls,
      productionInvoiceId: row.productionInvoiceId?.toString() ?? null,
      lenhCode: row.productionInvoice
        ? lenhDisplayCode(row.productionInvoice, row.productionInvoice.items)
        : null,
    });
  }

  private toDetailResponseDto(row: WarehouseTransferWithRefs): WarehouseTransferDetailResponseDto {
    return new WarehouseTransferDetailResponseDto({
      ...this.toResponseDto(row),
      items: row.items.map(
        (item) =>
          new WarehouseTransferItemResponseDto({
            id: item.id.toString(),
            materialId: item.materialId?.toString() ?? null,
            materialCode: item.material?.code ?? null,
            materialName: item.materialName,
            // Nệm: quy cách đã chọn khi tạo phiếu thay cho Material.spec.
            materialSpec: item.spec || (item.material?.spec ?? null),
            // Dòng sắt có chiều dài cây (phiếu chuyển hàng đổi xưởng) đếm bằng cây - phiếu lập trước 11/11 còn lưu đơn vị gốc ('Mm').
            unit: item.stockLengthMm > 0 ? 'cây' : item.unit,
            quantity: item.quantity.toNumber(),
            sentQty: item.sentQty?.toNumber() ?? null,
            stockLengthMm: item.stockLengthMm,
            note: item.note,
          }),
      ),
      pieceItems: row.pieceItems.map(
        (item) =>
          new WarehouseTransferPieceItemResponseDto({
            id: item.id.toString(),
            productionOrderId: item.productionOrderId.toString(),
            poNumber: item.productionOrder.poNumber,
            salesOrderCode:
              item.productionOrder.productionInvoiceItem.salesOrder?.orderCode ?? null,
            pieceId: item.pieceId.toString(),
            pieceCode: item.piece.code,
            pieceName: item.piece.name,
            quantity: item.quantity,
            sentQty: item.sentQty,
            lenhCode:
              item.productionOrder.productionInvoiceItem.lsxCode?.trim() ||
              item.productionOrder.productionInvoiceItem.productionInvoice?.code ||
              null,
            sku: item.productionOrder.mfgProduct.factoryCode,
            note: item.note,
          }),
      ),
    });
  }
}
