import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BomRevisionStatus, Prisma, SteelSubGroup } from '../../generated/prisma/client';
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
      // H5 fix - SegmentSpec là master data dùng chung qua tham chiếu SỐNG (piece_bom/part_bom
      // chỉ lưu segmentSpecId, không snapshot vật liệu/chiều dài); trước đây sửa 1 spec đang bị
      // BOM ACTIVE/RETIRED tham chiếu sẽ âm thầm đổi số liệu cắt sắt của các PO/CuttingProposal/
      // SteelIssue đã lên kế hoạch hoặc đã hoàn tất - đúng rủi ro "BOM đã duyệt phải bất biến" mà
      // BomRevisionsService.assertDraft() đã chặn ở cấp revision nhưng chưa chặn ở cấp spec dùng
      // chung này. Chỉ revision DRAFT còn tham chiếu spec mới cho sửa.
      await this.assertNotReferencedByNonDraftBom(bigId);
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
      throw new NotFoundException(`Không tìm thấy vật tư ${materialId}`);
    }
    if (material.materialGroup?.systemKey !== MATERIAL_GROUP_SYSTEM_KEYS.STEEL_BAR) {
      throw new BadRequestException(
        `Vật tư "${material.code}" phải thuộc nhóm vật tư Sắt (systemKey=STEEL_BAR) để tạo cỡ đoạn`,
      );
    }
    // 2026-10-01: SegmentSpec là đoạn cắt qua solver bin-packing - chỉ nhóm con SOFTWARE (Phần
    // mềm, mặc định khi null) mới dùng cơ chế này. Tự tính (SELF_CALC) dùng PieceMaterialYield,
    // VTTP (FINISHED_COMPONENT) dùng MaterialYieldRecipe - cả 2 không có SegmentSpec.
    if ((material.steelSubGroup ?? SteelSubGroup.SOFTWARE) !== SteelSubGroup.SOFTWARE) {
      throw new BadRequestException(
        `Vật tư "${material.code}" thuộc nhóm con Tự tính/Vật tư thành phẩm - không dùng cỡ đoạn (chỉ nhóm con Phần mềm mới cắt qua bộ giải)`,
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
      throw new ConflictException(`Cỡ đoạn ${cutLengthMm}mm của vật tư ${materialId} đã tồn tại`);
    }
  }

  private async assertNotReferencedByNonDraftBom(segmentSpecId: bigint): Promise<void> {
    const [pieceBom, partBom] = await Promise.all([
      this.prisma.pieceBom.findFirst({
        where: { segmentSpecId, bomRevision: { status: { not: BomRevisionStatus.DRAFT } } },
        include: { bomRevision: true },
      }),
      this.prisma.partBom.findFirst({
        where: { segmentSpecId, bomRevision: { status: { not: BomRevisionStatus.DRAFT } } },
        include: { bomRevision: true },
      }),
    ]);
    const hit = pieceBom ?? partBom;
    if (hit) {
      throw new ConflictException(
        `Cỡ đoạn ${segmentSpecId} đang được bản định mức ${hit.bomRevisionId} (trạng thái ${hit.bomRevision.status}) dùng - chỉ sửa được khi bản định mức còn nháp (DRAFT), cần đổi số liệu thì tạo cỡ đoạn mới`,
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
      throw new NotFoundException(`Không tìm thấy cỡ đoạn ${id}`);
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
