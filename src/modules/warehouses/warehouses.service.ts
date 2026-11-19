import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Warehouse } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PROTECTED_WAREHOUSE_CODES } from '../../common/constants/protected-warehouse-codes.constant';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { sortOrderBy } from '../../common/utils/sort-order-by.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { WarehouseResponseDto } from './dto/warehouse-response.dto';

function isProtected(code: string): boolean {
  return (PROTECTED_WAREHOUSE_CODES as readonly string[]).includes(code);
}

/**
 * The 6 seeded codes in PROTECTED_WAREHOUSE_CODES (see prisma/seed.ts) can never be
 * deleted or renamed - FE hardcodes these code strings throughout Manufacturing/
 * InboundWarehouse to route materials, so losing one silently breaks those screens.
 * `isActive` is still the soft-delete column for everything else (same as suppliers).
 */
@Injectable()
export class WarehousesService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async create(dto: CreateWarehouseDto): Promise<WarehouseResponseDto> {
    const existing = await this.prisma.warehouse.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException(`Kho "${dto.code}" đã tồn tại`);
    }

    const warehouse = await this.prisma.warehouse.create({
      data: { code: dto.code, name: dto.name, isVirtual: dto.isVirtual, note: dto.note },
    });
    return this.toResponseDto(warehouse);
  }

  async findAll(query: PaginationQueryDto): Promise<Paginated<WarehouseResponseDto>> {
    const where = query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: 'insensitive' as const } },
            { name: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : undefined;

    const result = await paginate(
      {
        findMany: (args) => this.prisma.warehouse.findMany(args),
        count: (args) => this.prisma.warehouse.count(args),
      },
      query,
      where,
      sortOrderBy(query, ['id', 'code', 'name'], { id: query.sortOrder }),
    );

    return { data: result.data.map((w) => this.toResponseDto(w)), meta: result.meta };
  }

  async findOne(id: string): Promise<WarehouseResponseDto> {
    return this.toResponseDto(await this.findOneOrThrow(id));
  }

  async update(id: string, dto: UpdateWarehouseDto): Promise<WarehouseResponseDto> {
    const bigId = parseBigIntId(id);
    const current = await this.findOneOrThrow(id);

    if (dto.code && dto.code !== current.code && isProtected(current.code)) {
      throw new ForbiddenException(`Kho "${current.code}" là kho hệ thống, không thể đổi tên`);
    }
    if (dto.code && dto.code !== current.code) {
      const existing = await this.prisma.warehouse.findUnique({ where: { code: dto.code } });
      if (existing) {
        throw new ConflictException(`Kho "${dto.code}" đã tồn tại`);
      }
    }

    const warehouse = await this.prisma.warehouse.update({
      where: { id: bigId },
      data: {
        code: dto.code,
        name: dto.name,
        note: dto.note,
        isActive: dto.isActive,
      },
    });
    return this.toResponseDto(warehouse);
  }

  async remove(id: string): Promise<void> {
    const bigId = parseBigIntId(id);
    const current = await this.findOneOrThrow(id);

    if (isProtected(current.code)) {
      throw new ForbiddenException(`Kho "${current.code}" là kho hệ thống, không thể xoá`);
    }

    // 19/11/2026 (T1-1): trước đây $transaction([...]) dạng mảng bị extension xoá mềm viết lại
    // user.deleteMany thành updateMany gọi ngoài batch nên batch không bao giờ chạy -> DELETE treo.
    // Nay dùng $transaction(async tx): kiểm kho còn được tham chiếu TRƯỚC (409 tiếng Việt), rồi mới
    // xoá mềm tài khoản gắn warehouseScope đúng kho này (giữ ý cũ: Thủ kho tự tạo cùng kho không
    // được sống mồ côi) và xoá kho. Xoá mềm tài khoản PHẢI là tx.user.updateMany(deletedAt) - KHÔNG
    // dùng tx.user.deleteMany: extension xoá mềm viết lại delete* của User/Role bằng client GỐC nên
    // chạy ngoài transaction, kho xoá lỗi thì tài khoản vẫn bị xoá mềm (QA thử thật 19/11). Bỏ qua
    // tài khoản đã xoá mềm từ trước (giữ mốc deletedAt cũ). Kho xoá lỗi thì cả hai cùng lùi.
    await this.prisma.$transaction(async (tx) => {
      const where = { warehouseId: bigId };
      const bothLegs = { OR: [{ fromWarehouseId: bigId }, { toWarehouseId: bigId }] };
      const counts: Array<[string, number]> = [
        ['vật tư', await tx.material.count({ where })],
        ['dòng tồn kho', await tx.stockQuant.count({ where })],
        ['bút toán sổ kho', await tx.stockLedger.count({ where: bothLegs })],
        ['giữ chỗ tồn kho', await tx.stockReservation.count({ where })],
        ['phiếu chuyển kho', await tx.warehouseTransfer.count({ where: bothLegs })],
        ['giữ chỗ chuyển kho', await tx.warehouseTransferReservation.count({ where })],
        ['giữ chỗ đoạn', await tx.segmentReservation.count({ where })],
        ['dòng đoạn dư', await tx.segmentOverage.count({ where })],
        ['dòng đoạn đã sản xuất', await tx.segmentProduction.count({ where })],
        ['dòng đoạn còn dư', await tx.segmentProductionLeftover.count({ where })],
        ['văn phòng phẩm', await tx.officeSupply.count({ where })],
        ['phiếu xuất kho', await tx.issueSlip.count({ where })],
      ];
      const used = counts.filter(([, n]) => n > 0).map(([label, n]) => `${n} ${label}`);
      if (used.length > 0) {
        throw new ConflictException(`Kho còn ${used.join(', ')} - không xoá được`);
      }
      await tx.user.updateMany({
        where: { warehouseScope: current.code, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      await tx.warehouse.delete({ where: { id: bigId } });
    });
  }

  private async findOneOrThrow(id: string): Promise<Warehouse> {
    const bigId = parseBigIntId(id);
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id: bigId } });
    if (!warehouse) {
      throw new NotFoundException(`Không tìm thấy kho ${id}`);
    }
    return warehouse;
  }

  private toResponseDto(warehouse: Warehouse): WarehouseResponseDto {
    return new WarehouseResponseDto({
      id: warehouse.id.toString(),
      code: warehouse.code,
      name: warehouse.name,
      isVirtual: warehouse.isVirtual,
      note: warehouse.note,
      isActive: warehouse.isActive,
      kind: warehouse.kind ?? null,
      workshopId: warehouse.workshopId?.toString() ?? null,
    });
  }
}
