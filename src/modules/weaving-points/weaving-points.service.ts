import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { WeavingPoint } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CreateWeavingPointDto } from './dto/create-weaving-point.dto';
import { UpdateWeavingPointDto } from './dto/update-weaving-point.dto';
import { WeavingPointResponseDto } from './dto/weaving-point-response.dto';

/** `isActive` is the soft-delete column (same pattern as suppliers) - remove() flips it. */
@Injectable()
export class WeavingPointsService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async create(dto: CreateWeavingPointDto): Promise<WeavingPointResponseDto> {
    const existing = await this.prisma.weavingPoint.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException(`Weaving point "${dto.code}" already exists`);
    }

    const point = await this.prisma.weavingPoint.create({
      data: {
        code: dto.code,
        fullName: dto.fullName,
        aliasNote: dto.aliasNote,
        phone: dto.phone,
        address: dto.address,
        dayDaiPercent: dto.dayDaiPercent,
        ketThucPercent: dto.ketThucPercent,
        hangQuanPercent: dto.hangQuanPercent,
        note: dto.note,
      },
    });
    return this.toResponseDto(point);
  }

  async findAll(query: PaginationQueryDto): Promise<Paginated<WeavingPointResponseDto>> {
    const where = query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: 'insensitive' as const } },
            { fullName: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : undefined;

    const result = await paginate(
      {
        findMany: (args) => this.prisma.weavingPoint.findMany(args),
        count: (args) => this.prisma.weavingPoint.count(args),
      },
      query,
      where,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { id: query.sortOrder },
    );

    return { data: result.data.map((p) => this.toResponseDto(p)), meta: result.meta };
  }

  async findOne(id: string): Promise<WeavingPointResponseDto> {
    return this.toResponseDto(await this.findOneOrThrow(id));
  }

  async update(id: string, dto: UpdateWeavingPointDto): Promise<WeavingPointResponseDto> {
    const bigId = parseBigIntId(id);
    await this.findOneOrThrow(id);

    if (dto.code) {
      const existing = await this.prisma.weavingPoint.findUnique({ where: { code: dto.code } });
      if (existing && existing.id !== bigId) {
        throw new ConflictException(`Weaving point "${dto.code}" already exists`);
      }
    }

    const point = await this.prisma.weavingPoint.update({
      where: { id: bigId },
      data: {
        code: dto.code,
        fullName: dto.fullName,
        aliasNote: dto.aliasNote,
        phone: dto.phone,
        address: dto.address,
        dayDaiPercent: dto.dayDaiPercent,
        ketThucPercent: dto.ketThucPercent,
        hangQuanPercent: dto.hangQuanPercent,
        note: dto.note,
        isActive: dto.isActive,
      },
    });
    return this.toResponseDto(point);
  }

  async remove(id: string): Promise<void> {
    const bigId = parseBigIntId(id);
    await this.findOneOrThrow(id);
    await this.prisma.weavingPoint.update({ where: { id: bigId }, data: { isActive: false } });
  }

  private async findOneOrThrow(id: string): Promise<WeavingPoint> {
    const bigId = parseBigIntId(id);
    const point = await this.prisma.weavingPoint.findUnique({ where: { id: bigId } });
    if (!point) {
      throw new NotFoundException(`Weaving point ${id} not found`);
    }
    return point;
  }

  private toResponseDto(point: WeavingPoint): WeavingPointResponseDto {
    return new WeavingPointResponseDto({
      id: point.id.toString(),
      code: point.code,
      fullName: point.fullName,
      aliasNote: point.aliasNote,
      phone: point.phone,
      address: point.address,
      dayDaiPercent: point.dayDaiPercent?.toNumber() ?? null,
      ketThucPercent: point.ketThucPercent?.toNumber() ?? null,
      hangQuanPercent: point.hangQuanPercent?.toNumber() ?? null,
      note: point.note,
      isActive: point.isActive,
    });
  }
}
