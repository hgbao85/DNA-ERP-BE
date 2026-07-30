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
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { WarehouseResponseDto } from './dto/warehouse-response.dto';

function isProtected(code: string): boolean {
  return (PROTECTED_WAREHOUSE_CODES as readonly string[]).includes(code);
}

/**
 * The 9 seeded codes in PROTECTED_WAREHOUSE_CODES (see prisma/seed.ts) can never be
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
      throw new ConflictException(`Warehouse "${dto.code}" already exists`);
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
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { id: query.sortOrder },
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
      throw new ForbiddenException(
        `Warehouse "${current.code}" is protected and cannot be renamed`,
      );
    }
    if (dto.code && dto.code !== current.code) {
      const existing = await this.prisma.warehouse.findUnique({ where: { code: dto.code } });
      if (existing) {
        throw new ConflictException(`Warehouse "${dto.code}" already exists`);
      }
    }

    const warehouse = await this.prisma.warehouse.update({
      where: { id: bigId },
      data: {
        code: dto.code,
        name: dto.name,
        isVirtual: dto.isVirtual,
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
      throw new ForbiddenException(
        `Warehouse "${current.code}" is protected and cannot be deleted`,
      );
    }

    await this.prisma.warehouse.update({ where: { id: bigId }, data: { isActive: false } });
  }

  private async findOneOrThrow(id: string): Promise<Warehouse> {
    const bigId = parseBigIntId(id);
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id: bigId } });
    if (!warehouse) {
      throw new NotFoundException(`Warehouse ${id} not found`);
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
    });
  }
}
