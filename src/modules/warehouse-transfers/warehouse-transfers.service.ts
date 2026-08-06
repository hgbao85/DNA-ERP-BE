import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ReservationStatus,
  StockLedgerRefType,
  TransferStatus,
  Warehouse,
} from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { CreateWarehouseTransferDto } from './dto/create-warehouse-transfer.dto';
import { ListWarehouseTransfersQueryDto } from './dto/list-warehouse-transfers-query.dto';
import { WarehouseTransferDetailResponseDto } from './dto/warehouse-transfer-detail-response.dto';
import { WarehouseTransferItemResponseDto } from './dto/warehouse-transfer-item-response.dto';
import { WarehouseTransferResponseDto } from './dto/warehouse-transfer-response.dto';
import { isValidTransferRoute } from './transfer-routes.constant';

const TRANSFER_INCLUDE = {
  fromWarehouse: true,
  toWarehouse: true,
  items: true,
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
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly stockLedgerService: StockLedgerService,
  ) {}

  async create(
    dto: CreateWarehouseTransferDto,
    warehouseScope: string | null,
  ): Promise<WarehouseTransferResponseDto> {
    const fromWarehouseId = parseBigIntId(dto.fromWarehouseId);
    const toWarehouseId = parseBigIntId(dto.toWarehouseId);

    const [fromWarehouse, toWarehouse] = await Promise.all([
      this.findWarehouseOrThrow(fromWarehouseId),
      this.findWarehouseOrThrow(toWarehouseId),
    ]);

    // Kho nguồn tạo phiếu - scope phải khớp fromWarehouse (kho đích chỉ tham gia lúc confirm()).
    this.assertWarehouseScope(warehouseScope, fromWarehouse.code, 'tạo phiếu chuyển kho từ');

    if (!isValidTransferRoute(fromWarehouse.code, toWarehouse.code)) {
      throw new BadRequestException(
        `Không được chuyển trực tiếp từ "${fromWarehouse.name}" sang "${toWarehouse.name}" - chỉ được chuyển đúng 1 bước theo chuỗi Phôi sơn hàn → Vật tư thành phẩm → Thành phẩm`,
      );
    }

    const planFormId = dto.planFormId ? parseBigIntId(dto.planFormId) : undefined;
    const code = await this.nextTransferCode();

    const created = await this.prisma.$transaction(async (tx) => {
      const clampedItems: {
        materialId?: bigint;
        materialName: string;
        unit: string;
        quantity: number;
        note?: string;
      }[] = [];

      for (const item of dto.items) {
        if (!item.materialId) {
          // Kế thừa hạn chế của mock (materialId chưa bắt buộc) - không có gì để tra tồn kho
          // thật, trust nguyên số lượng client gửi (xem comment ở WarehouseTransferItem).
          clampedItems.push({
            materialName: item.materialName,
            unit: item.unit,
            quantity: item.quantity,
            note: item.note,
          });
          continue;
        }

        const materialId = parseBigIntId(item.materialId);
        // FOR UPDATE khoá dòng stock_quant liên quan trong lúc tính "tồn khả dụng" - chặn 2
        // phiếu tạo gần như đồng thời cùng đọc thấy 1 số dư rồi cùng đặt cọc vượt quá tồn thật
        // (oversell race mà unique constraint không bắt được, khác lớp race của BomRevision.revNo).
        const locked = await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
          SELECT "qty" FROM "stock_quant"
          WHERE "warehouseId" = ${fromWarehouseId} AND "materialId" = ${materialId}
          FOR UPDATE
        `;
        const onHand = locked[0]?.qty.toNumber() ?? 0;

        const reservedAgg = await tx.warehouseTransferReservation.aggregate({
          where: { warehouseId: fromWarehouseId, materialId, status: ReservationStatus.ACTIVE },
          _sum: { quantity: true },
        });
        const reserved = reservedAgg._sum.quantity?.toNumber() ?? 0;

        const available = Math.max(0, onHand - reserved);
        const quantity = Math.max(0, Math.min(item.quantity, available));
        if (quantity > 0) {
          clampedItems.push({
            materialId,
            materialName: item.materialName,
            unit: item.unit,
            quantity,
            note: item.note,
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
          items: { create: clampedItems },
        },
        include: TRANSFER_INCLUDE,
      });

      await tx.warehouseTransferReservation.createMany({
        data: clampedItems
          .filter((item) => item.materialId !== undefined)
          .map((item) => ({
            transferId: transfer.id,
            warehouseId: fromWarehouseId,
            materialId: item.materialId,
            quantity: item.quantity,
          })),
      });

      return transfer;
    });

    return this.toResponseDto(created);
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
    userId: string,
    warehouseScope: string | null,
  ): Promise<WarehouseTransferResponseDto> {
    const transfer = await this.findOneOrThrow(id);
    if (transfer.status !== TransferStatus.PENDING) {
      throw new ConflictException(
        `Phiếu chuyển kho ${id} đang ở trạng thái ${transfer.status} - chỉ PENDING mới xác nhận được`,
      );
    }
    // Kho đích xác nhận.
    this.assertWarehouseScope(
      warehouseScope,
      transfer.toWarehouse.code,
      'xác nhận phiếu chuyển kho tới',
    );

    // idempotencyKey theo (transferId, itemId) khiến việc gọi lại confirm() sau khi 1 item giữa
    // chừng lỗi trở nên an toàn - các item đã post thành công trả về đúng dòng cũ, không tạo
    // trùng bút toán (StockLedgerService.postEntry tự resolve-or-return theo key này).
    for (const item of transfer.items) {
      if (!item.materialId) continue; // dòng free-text không có gì để ghi vào ledger (XOR)
      await this.stockLedgerService.postEntry({
        fromWarehouseId: transfer.fromWarehouseId,
        toWarehouseId: transfer.toWarehouseId,
        materialId: item.materialId,
        qty: item.quantity.toNumber(),
        refType: StockLedgerRefType.WAREHOUSE_TRANSFER,
        refId: transfer.id.toString(),
        createdById: userId,
        idempotencyKey: `warehouse-transfer:${transfer.id}:item:${item.id}`,
      });
    }

    const confirmed = await this.prisma.$transaction(async (tx) => {
      await tx.warehouseTransferReservation.updateMany({
        where: { transferId: transfer.id, status: ReservationStatus.ACTIVE },
        data: { status: ReservationStatus.RELEASED },
      });
      return tx.warehouseTransfer.update({
        where: { id: transfer.id },
        data: { status: TransferStatus.CONFIRMED, confirmedAt: new Date() },
        include: TRANSFER_INCLUDE,
      });
    });

    return this.toResponseDto(confirmed);
  }

  async reject(
    id: string,
    rejectionReason: string,
    warehouseScope: string | null,
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

    const rejected = await this.prisma.$transaction(async (tx) => {
      await tx.warehouseTransferReservation.updateMany({
        where: { transferId: transfer.id, status: ReservationStatus.ACTIVE },
        data: { status: ReservationStatus.RELEASED },
      });
      return tx.warehouseTransfer.update({
        where: { id: transfer.id },
        data: { status: TransferStatus.REJECTED, rejectionReason, rejectedAt: new Date() },
        include: TRANSFER_INCLUDE,
      });
    });

    return this.toResponseDto(rejected);
  }

  private async findWarehouseOrThrow(id: bigint): Promise<Warehouse> {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!warehouse) {
      throw new NotFoundException(`Warehouse ${id} not found`);
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
      throw new NotFoundException(`Warehouse transfer ${id} not found`);
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
        `Caller bị giới hạn ở kho '${warehouseScope}', không được ${actionLabel} kho '${requiredCode}'`,
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
        `Caller bị giới hạn ở kho '${warehouseScope}', không liên quan tới phiếu chuyển kho này`,
      );
    }
  }

  /**
   * DB unique constraint trên `code` là lưới chặn thật cho race hiếm gặp (2 request đếm cùng 1
   * số rồi cùng tạo) - cùng idiom "đếm rồi tạo, để DB bắt race" đã dùng cho BomRevision.revNo,
   * không phải lock trong code.
   */
  private async nextTransferCode(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `CK-${year}-`;
    const count = await this.prisma.warehouseTransfer.count({
      where: { code: { startsWith: prefix } },
    });
    return `${prefix}${String(count + 1).padStart(3, '0')}`;
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
            materialName: item.materialName,
            unit: item.unit,
            quantity: item.quantity.toNumber(),
            note: item.note,
          }),
      ),
    });
  }
}
