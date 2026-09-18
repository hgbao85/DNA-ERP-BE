import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OfficeSupplyLedgerReason, Prisma } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { AdjustOfficeSupplyQuantityDto } from './dto/adjust-office-supply-quantity.dto';
import { CreateOfficeSupplyDto } from './dto/create-office-supply.dto';
import { ListOfficeSuppliesQueryDto } from './dto/list-office-supplies-query.dto';
import {
  OfficeSupplyLedgerEntryResponseDto,
  OfficeSupplyResponseDto,
} from './dto/office-supply-response.dto';
import { UpdateOfficeSupplyDto } from './dto/update-office-supply.dto';

type OfficeSupplyWithWarehouse = Prisma.OfficeSupplyGetPayload<{ include: { warehouse: true } }>;
const OFFICE_SUPPLY_INCLUDE = { warehouse: true } as const;
type LedgerEntryWithUser = Prisma.OfficeSupplyLedgerEntryGetPayload<{
  include: { createdByUser: true };
}>;

/**
 * Vật tư văn phòng/sinh hoạt (bút, giấy...) - CRUD đơn giản, HOÀN TOÀN tách biệt khỏi
 * MaterialsService (vật tư sản xuất gắn định mức/BOM). RIÊNG THEO TỪNG KHO VẬT LÝ
 * (warehouseId bắt buộc) - thủ kho chỉ thấy/thao tác được đúng kho mình phụ trách, enforce qua
 * assertWarehouseScope() (cùng idiom MaterialIssuesService/SteelIssuesService: null = tổng
 * kho/Boss/Admin, không giới hạn; khác null phải khớp ĐÚNG code kho). `quantity` chỉ được đổi
 * qua adjustQuantity() (kèm 1 dòng OfficeSupplyLedgerEntry trong cùng transaction) - update()
 * không bao giờ đụng field này.
 */
@Injectable()
export class OfficeSuppliesService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async create(
    dto: CreateOfficeSupplyDto,
    warehouseScope: string | null,
  ): Promise<OfficeSupplyResponseDto> {
    if (!dto.name || !dto.unit) {
      throw new BadRequestException('Thiếu Tên vật tư / Đơn vị tính');
    }

    // Có scope (thủ kho bình thường) -> LUÔN tạo trong đúng kho mình phụ trách, bỏ qua
    // dto.warehouseCode nếu có gửi (không cho tạo hộ kho khác). Không scope (Boss/Admin/tổng
    // kho) -> bắt buộc phải chỉ định warehouseCode vì không có kho mặc định nào để suy ra.
    const targetWarehouseCode = warehouseScope ?? dto.warehouseCode;
    if (!targetWarehouseCode) {
      throw new BadRequestException('Thiếu warehouseCode - tài khoản tổng kho phải chỉ định kho');
    }
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { code: targetWarehouseCode },
    });
    if (!warehouse) {
      throw new BadRequestException(`Không tìm thấy kho '${targetWarehouseCode}'`);
    }

    const trimmedCode = dto.code?.trim() || undefined;
    if (trimmedCode) {
      const existing = await this.prisma.officeSupply.findUnique({
        where: { warehouseId_code: { warehouseId: warehouse.id, code: trimmedCode } },
      });
      if (existing) {
        throw new ConflictException(`Vật tư văn phòng "${trimmedCode}" đã tồn tại trong kho này`);
      }
    }

    const openingQty = dto.openingQty && dto.openingQty > 0 ? dto.openingQty : 0;

    let supply: OfficeSupplyWithWarehouse;
    try {
      supply = await this.prisma.officeSupply.create({
        data: {
          warehouseId: warehouse.id,
          code: trimmedCode,
          name: dto.name,
          unit: dto.unit,
          note: dto.note,
          quantity: openingQty,
        },
        include: OFFICE_SUPPLY_INCLUDE,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Vật tư văn phòng "${trimmedCode}" đã tồn tại trong kho này`);
      }
      throw e;
    }

    if (openingQty > 0) {
      await this.prisma.officeSupplyLedgerEntry.create({
        data: {
          officeSupplyId: supply.id,
          changeQty: openingQty,
          quantityAfter: openingQty,
          reason: OfficeSupplyLedgerReason.INITIAL,
          note: 'Tồn ban đầu lúc tạo vật tư',
        },
      });
    }

    return this.toResponseDto(supply);
  }

  async findAll(
    query: ListOfficeSuppliesQueryDto,
    warehouseScope: string | null,
  ): Promise<Paginated<OfficeSupplyResponseDto>> {
    // Có scope -> LUÔN lọc theo đúng kho của mình, bỏ qua query.warehouseCode nếu thủ kho lỡ
    // truyền kho khác (không cho dòm danh sách kho khác qua query param). Không scope + không
    // truyền warehouseCode -> xem gộp mọi kho (Boss/tổng kho, có cột "Kho" phân biệt ở FE).
    const filterWarehouseCode = warehouseScope ?? query.warehouseCode;
    const warehouseId = filterWarehouseCode
      ? (await this.resolveWarehouseOrThrow(filterWarehouseCode)).id
      : undefined;

    const where: Prisma.OfficeSupplyWhereInput = {
      // includeDeleted='true' - CHỈ dùng cho màn quản trị (Admin xem lại vật tư đã xóa để tra
      // lịch sử) - không giới hạn theo role ở tầng BE (cùng tiền lệ WAREHOUSE:CREATE isAdmin-gated
      // ở FE), FE chỉ hiện nút bật cho Admin.
      ...(query.includeDeleted === 'true' ? {} : { deletedAt: null }),
      ...(warehouseId ? { warehouseId } : {}),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' as const } },
              { name: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.officeSupply.findMany({ ...args, include: OFFICE_SUPPLY_INCLUDE }),
        count: (args) => this.prisma.officeSupply.count(args),
      },
      query,
      where,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { id: query.sortOrder },
    );

    return { data: result.data.map((s) => this.toResponseDto(s)), meta: result.meta };
  }

  async findOne(id: string, warehouseScope: string | null): Promise<OfficeSupplyResponseDto> {
    const supply = await this.findOneOrThrow(id);
    this.assertWarehouseScope(warehouseScope, supply.warehouse.code);
    return this.toResponseDto(supply);
  }

  async update(
    id: string,
    dto: UpdateOfficeSupplyDto,
    warehouseScope: string | null,
  ): Promise<OfficeSupplyResponseDto> {
    const bigId = parseBigIntId(id);
    const previous = await this.findOneOrThrow(id);
    this.assertWarehouseScope(warehouseScope, previous.warehouse.code);

    const trimmedCode = dto.code?.trim();
    if (trimmedCode) {
      const existing = await this.prisma.officeSupply.findUnique({
        where: { warehouseId_code: { warehouseId: previous.warehouseId, code: trimmedCode } },
      });
      if (existing && existing.id !== bigId) {
        throw new ConflictException(`Vật tư văn phòng "${trimmedCode}" đã tồn tại trong kho này`);
      }
    }

    const supply = await this.prisma.officeSupply.update({
      where: { id: bigId },
      data: {
        code: dto.code !== undefined ? trimmedCode || null : undefined,
        name: dto.name,
        unit: dto.unit,
        note: dto.note,
        isActive: dto.isActive,
      },
      include: OFFICE_SUPPLY_INCLUDE,
    });

    return this.toResponseDto(supply);
  }

  /**
   * Nhập/Xuất/Điều chỉnh tồn - route DUY NHẤT được phép đổi `quantity`. Atomic bằng updateMany
   * kèm điều kiện `quantity >= -changeQty` khi xuất (đúng idiom đã dùng để vá race
   * PurchaseProposalItem: check count thay vì findUnique-rồi-update rời rạc, tránh 2 request
   * xuất chạy song song cùng đọc thấy đủ tồn rồi cùng trừ, làm âm kho). count === 0 nghĩa là
   * không đủ tồn HOẶC vật tư đã bị xoá giữa lúc request tới - không phân biệt 2 case này với
   * client vì hệ quả xử lý giống nhau (từ chối, yêu cầu tải lại).
   */
  async adjustQuantity(
    id: string,
    dto: AdjustOfficeSupplyQuantityDto,
    userId: string | null,
    warehouseScope: string | null,
  ): Promise<OfficeSupplyResponseDto> {
    const bigId = parseBigIntId(id);
    if (!dto.changeQty) {
      throw new BadRequestException('changeQty không được bằng 0');
    }
    const existing = await this.findOneOrThrow(id);
    this.assertWarehouseScope(warehouseScope, existing.warehouse.code);

    return this.prisma.$transaction(async (tx) => {
      const where: Prisma.OfficeSupplyWhereInput = {
        id: bigId,
        deletedAt: null,
        ...(dto.changeQty < 0 ? { quantity: { gte: -dto.changeQty } } : {}),
      };
      const result = await tx.officeSupply.updateMany({
        where,
        data: { quantity: { increment: dto.changeQty } },
      });
      if (result.count === 0) {
        throw new ConflictException(
          'Không đủ tồn để xuất, hoặc vật tư đã bị xoá/thay đổi - tải lại trang và thử lại',
        );
      }

      const supply = await tx.officeSupply.findUniqueOrThrow({
        where: { id: bigId },
        include: OFFICE_SUPPLY_INCLUDE,
      });
      await tx.officeSupplyLedgerEntry.create({
        data: {
          officeSupplyId: bigId,
          changeQty: dto.changeQty,
          quantityAfter: supply.quantity,
          reason: dto.reason,
          note: dto.note,
          createdByUserId: userId ?? undefined,
        },
      });

      return this.toResponseDto(supply);
    });
  }

  async listLedger(
    id: string,
    query: PaginationQueryDto,
    warehouseScope: string | null,
  ): Promise<Paginated<OfficeSupplyLedgerEntryResponseDto>> {
    // allowDeleted: true - lịch sử phải tra được cả sau khi vật tư đã bị xóa (đúng lời hứa trong
    // dialog xác nhận xóa ở FE: "Lịch sử nhập/xuất vẫn được giữ lại để tra cứu") - trước đây
    // findOneOrThrow() mặc định 404 với item đã xóa nên route này chưa từng dùng được sau khi xóa.
    const supply = await this.findOneOrThrow(id, { allowDeleted: true });
    this.assertWarehouseScope(warehouseScope, supply.warehouse.code);
    const bigId = parseBigIntId(id);

    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.officeSupplyLedgerEntry.findMany({
            ...args,
            include: { createdByUser: true },
          }),
        count: (args) => this.prisma.officeSupplyLedgerEntry.count(args),
      },
      query,
      { officeSupplyId: bigId },
      { createdAt: Prisma.SortOrder.desc },
    );

    return {
      data: result.data.map((e) => this.toLedgerResponseDto(e)),
      meta: result.meta,
    };
  }

  async remove(id: string, warehouseScope: string | null): Promise<void> {
    const bigId = parseBigIntId(id);
    const supply = await this.findOneOrThrow(id);
    this.assertWarehouseScope(warehouseScope, supply.warehouse.code);
    await this.prisma.officeSupply.update({
      where: { id: bigId },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  /** null = tổng kho (BOSS/ADMIN) - không có gì để chặn, cùng idiom MaterialIssuesService/
   *  SteelIssuesService.assertWarehouseScope(). Khác null: phải khớp ĐÚNG kho vật lý cụ thể -
   *  vật tư văn phòng không dùng chung, thủ kho kho A không được đụng vào kho B dù cùng "họ". */
  private assertWarehouseScope(warehouseScope: string | null, expectedWarehouseCode: string): void {
    if (warehouseScope && warehouseScope !== expectedWarehouseCode) {
      throw new ForbiddenException(
        `Caller bị giới hạn ở kho '${warehouseScope}', không được thao tác vật tư văn phòng của kho '${expectedWarehouseCode}'`,
      );
    }
  }

  private async resolveWarehouseOrThrow(code: string) {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { code } });
    if (!warehouse) {
      throw new BadRequestException(`Không tìm thấy kho '${code}'`);
    }
    return warehouse;
  }

  private async findOneOrThrow(
    id: string,
    options?: { allowDeleted?: boolean },
  ): Promise<OfficeSupplyWithWarehouse> {
    const bigId = parseBigIntId(id);
    const supply = await this.prisma.officeSupply.findUnique({
      where: { id: bigId },
      include: OFFICE_SUPPLY_INCLUDE,
    });
    if (!supply || (supply.deletedAt && !options?.allowDeleted)) {
      throw new NotFoundException(`Office supply ${id} not found`);
    }
    return supply;
  }

  private toResponseDto(supply: OfficeSupplyWithWarehouse): OfficeSupplyResponseDto {
    return new OfficeSupplyResponseDto({
      id: supply.id.toString(),
      warehouseId: supply.warehouseId.toString(),
      warehouseCode: supply.warehouse.code,
      warehouseName: supply.warehouse.name,
      code: supply.code,
      name: supply.name,
      unit: supply.unit,
      quantity: Number(supply.quantity),
      note: supply.note,
      isActive: supply.isActive,
      deletedAt: supply.deletedAt,
      createdAt: supply.createdAt,
      updatedAt: supply.updatedAt,
    });
  }

  private toLedgerResponseDto(entry: LedgerEntryWithUser): OfficeSupplyLedgerEntryResponseDto {
    return new OfficeSupplyLedgerEntryResponseDto({
      id: entry.id.toString(),
      officeSupplyId: entry.officeSupplyId.toString(),
      changeQty: Number(entry.changeQty),
      quantityAfter: Number(entry.quantityAfter),
      reason: entry.reason,
      note: entry.note,
      createdByUserId: entry.createdByUserId,
      createdByUserName: entry.createdByUser
        ? `${entry.createdByUser.firstName} ${entry.createdByUser.lastName}`
        : null,
      createdAt: entry.createdAt,
    });
  }
}
