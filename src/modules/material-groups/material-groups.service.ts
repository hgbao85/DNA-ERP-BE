import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { MaterialGroup } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CreateMaterialGroupDto } from './dto/create-material-group.dto';
import { MaterialGroupResponseDto } from './dto/material-group-response.dto';
import { UpdateMaterialGroupDto } from './dto/update-material-group.dto';

/**
 * Reference module for the 7 "pure CRUD" catalogs of Phase 2 (material-groups, suppliers,
 * defect-reasons, weaving-points, warehouses, customers, products) - same shape, no
 * soft-delete: docs/dna-erp-db-schema.html defines material_groups with no `is_active`/
 * `deletedAt` column, so remove() is a real DELETE (materials.materialGroupId FK is
 * ON DELETE SET NULL, so this never blocks on an in-use group).
 */
@Injectable()
export class MaterialGroupsService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async create(dto: CreateMaterialGroupDto): Promise<MaterialGroupResponseDto> {
    const existing = await this.prisma.materialGroup.findUnique({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException(`Material group "${dto.name}" already exists`);
    }

    const group = await this.prisma.materialGroup.create({ data: { name: dto.name } });
    return this.toResponseDto(group);
  }

  async findAll(query: PaginationQueryDto): Promise<Paginated<MaterialGroupResponseDto>> {
    const where = query.search
      ? { name: { contains: query.search, mode: 'insensitive' as const } }
      : undefined;

    const result = await paginate(
      {
        findMany: (args) => this.prisma.materialGroup.findMany(args),
        count: (args) => this.prisma.materialGroup.count(args),
      },
      query,
      where,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { id: query.sortOrder },
    );

    return { data: result.data.map((group) => this.toResponseDto(group)), meta: result.meta };
  }

  async findOne(id: string): Promise<MaterialGroupResponseDto> {
    const group = await this.findOneOrThrow(id);
    return this.toResponseDto(group);
  }

  async update(id: string, dto: UpdateMaterialGroupDto): Promise<MaterialGroupResponseDto> {
    const bigId = parseBigIntId(id);
    await this.findOneOrThrow(id);

    if (dto.name) {
      const existing = await this.prisma.materialGroup.findUnique({ where: { name: dto.name } });
      if (existing && existing.id !== bigId) {
        throw new ConflictException(`Material group "${dto.name}" already exists`);
      }
    }

    const group = await this.prisma.materialGroup.update({
      where: { id: bigId },
      data: { name: dto.name },
    });
    return this.toResponseDto(group);
  }

  async remove(id: string): Promise<void> {
    const bigId = parseBigIntId(id);
    await this.findOneOrThrow(id);
    await this.prisma.materialGroup.delete({ where: { id: bigId } });
  }

  private async findOneOrThrow(id: string): Promise<MaterialGroup> {
    const bigId = parseBigIntId(id);
    const group = await this.prisma.materialGroup.findUnique({ where: { id: bigId } });
    if (!group) {
      throw new NotFoundException(`Material group ${id} not found`);
    }
    return group;
  }

  private toResponseDto(group: MaterialGroup): MaterialGroupResponseDto {
    return new MaterialGroupResponseDto({ id: group.id.toString(), name: group.name });
  }
}
