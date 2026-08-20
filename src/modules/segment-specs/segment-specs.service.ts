import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { MATERIAL_GROUP_SYSTEM_KEYS } from '../../common/constants/material-group-system-keys.constant';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CreateSegmentSpecDto } from './dto/create-segment-spec.dto';
import { SegmentSpecResponseDto } from './dto/segment-spec-response.dto';
import { UpdateSegmentSpecDto } from './dto/update-segment-spec.dto';

type SegmentSpecWithMaterial = Prisma.SegmentSpecGetPayload<{ include: { material: true } }>;

/**
 * Đoạn sắt = material + chiều dài cắt (docs/dna-erp-db-schema.html "segment_spec") - the
 * 3NF fix replacing the repeated (loại sắt, quy cách, chiều dài) key that used to be
 * duplicated everywhere in mock. `materialId` must point at a material whose
 * materialGroup.systemKey=STEEL_BAR - enforced here (the DB has no CHECK across two
 * tables), not at the Materials module, since only SegmentSpec cares about this constraint.
 *
 * No isActive/deletedAt - remove() is a real DELETE. piece_bom/part_bom both reference
 * segmentSpecId with ON DELETE RESTRICT, so deleting one still in use fails at the DB
 * with P2003, left to the global Prisma exception filter (400).
 */
@Injectable()
export class SegmentSpecsService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async create(dto: CreateSegmentSpecDto): Promise<SegmentSpecResponseDto> {
    const materialBigId = parseBigIntId(dto.materialId);
    await this.assertSteelGroup(materialBigId);
    await this.assertSpecFree(materialBigId, dto.cutLengthMm);

    const spec = await this.prisma.segmentSpec.create({
      data: { materialId: materialBigId, cutLengthMm: dto.cutLengthMm },
      include: { material: true },
    });
    return this.toResponseDto(spec);
  }

  async findAll(query: PaginationQueryDto): Promise<Paginated<SegmentSpecResponseDto>> {
    const where = query.search
      ? {
          material: {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' as const } },
              { name: { contains: query.search, mode: 'insensitive' as const } },
            ],
          },
        }
      : undefined;

    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.segmentSpec.findMany({ ...args, include: { material: true } }),
        count: (args) => this.prisma.segmentSpec.count(args),
      },
      query,
      where,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { id: query.sortOrder },
    );

    return { data: result.data.map((s) => this.toResponseDto(s)), meta: result.meta };
  }

  async findOne(id: string): Promise<SegmentSpecResponseDto> {
    return this.toResponseDto(await this.findOneOrThrow(id));
  }

  async update(id: string, dto: UpdateSegmentSpecDto): Promise<SegmentSpecResponseDto> {
    const bigId = parseBigIntId(id);
    const current = await this.findOneOrThrow(id);

    const materialBigId = dto.materialId ? parseBigIntId(dto.materialId) : current.materialId;
    if (dto.materialId) {
      await this.assertSteelGroup(materialBigId);
    }

    const cutLengthMm = dto.cutLengthMm ?? current.cutLengthMm.toNumber();
    if (dto.materialId || dto.cutLengthMm) {
      await this.assertSpecFree(materialBigId, cutLengthMm, bigId);
    }

    const spec = await this.prisma.segmentSpec.update({
      where: { id: bigId },
      data: {
        materialId: dto.materialId ? materialBigId : undefined,
        cutLengthMm: dto.cutLengthMm,
      },
      include: { material: true },
    });
    return this.toResponseDto(spec);
  }

  async remove(id: string): Promise<void> {
    const bigId = parseBigIntId(id);
    await this.findOneOrThrow(id);
    await this.prisma.segmentSpec.delete({ where: { id: bigId } });
  }

  private async assertSteelGroup(materialId: bigint): Promise<void> {
    const material = await this.prisma.material.findUnique({
      where: { id: materialId },
      include: { materialGroup: true },
    });
    if (!material) {
      throw new NotFoundException(`Material ${materialId} not found`);
    }
    if (material.materialGroup?.systemKey !== MATERIAL_GROUP_SYSTEM_KEYS.STEEL_BAR) {
      throw new BadRequestException(
        `Material "${material.code}" phải thuộc nhóm vật tư Sắt (systemKey=STEEL_BAR) để tạo segment spec`,
      );
    }
  }

  private async assertSpecFree(
    materialId: bigint,
    cutLengthMm: number,
    excludeId?: bigint,
  ): Promise<void> {
    const existing = await this.prisma.segmentSpec.findUnique({
      where: { materialId_cutLengthMm: { materialId, cutLengthMm } },
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(
        `Segment spec for material ${materialId} @ ${cutLengthMm}mm already exists`,
      );
    }
  }

  private async findOneOrThrow(id: string): Promise<SegmentSpecWithMaterial> {
    const bigId = parseBigIntId(id);
    const spec = await this.prisma.segmentSpec.findUnique({
      where: { id: bigId },
      include: { material: true },
    });
    if (!spec) {
      throw new NotFoundException(`Segment spec ${id} not found`);
    }
    return spec;
  }

  private toResponseDto(spec: SegmentSpecWithMaterial): SegmentSpecResponseDto {
    return new SegmentSpecResponseDto({
      id: spec.id.toString(),
      materialId: spec.materialId.toString(),
      materialCode: spec.material.code,
      cutLengthMm: Number(spec.cutLengthMm),
    });
  }
}
