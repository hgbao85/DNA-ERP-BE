import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Material, Prisma } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CreateMaterialDto } from './dto/create-material.dto';
import { CreateMaterialSupplierDto } from './dto/create-material-supplier.dto';
import { MaterialResponseDto } from './dto/material-response.dto';
import { MaterialSupplierResponseDto } from './dto/material-supplier-response.dto';
import { UpdateMaterialDto } from './dto/update-material.dto';
import { UpdateMaterialSupplierDto } from './dto/update-material-supplier.dto';

type MaterialSupplierWithSupplier = Prisma.MaterialSupplierGetPayload<{
  include: { supplier: true };
}>;

/**
 * Materials + MaterialSuppliers (docs/dna-erp-db-schema.html "materials" / "material_suppliers").
 * `remove()` is a real hard delete (as originally built) - soft-delete for this model is
 * pending, see CONTRIBUTING.md "0. Ưu tiên". `isActive` is a separate, independent flag.
 * Prereq for SegmentSpec (P2 step 5, validates materialGroup.systemKey='STEEL_BAR' - not
 * enforced here, that check belongs to the SegmentSpec module that consumes this one).
 */
@Injectable()
export class MaterialsService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async create(dto: CreateMaterialDto): Promise<MaterialResponseDto> {
    // code/name/unit là cột NOT NULL ở DB - không thể bỏ qua được (không phải "validate form"
    // chặn nhập liệu, chỉ là guard tránh PrismaClientValidationError raw -> 500 khó hiểu khi
    // thiếu field mà lẽ ra DB sẽ từ chối; findUnique({ where: { code: undefined } }) bên dưới
    // tự nó đã ném lỗi này nếu không chặn sớm ở đây).
    if (!dto.code || !dto.name || !dto.unit) {
      throw new BadRequestException(
        'Thiếu Mã vật tư / Tên vật tư / Đơn vị tính - đây là 3 trường bắt buộc ở DB, không thể để trống',
      );
    }

    const existing = await this.prisma.material.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException(`Material "${dto.code}" already exists`);
    }

    const material = await this.prisma.material.create({
      data: {
        code: dto.code,
        name: dto.name,
        unit: dto.unit,
        spec: dto.spec,
        materialGroupId: dto.materialGroupId ? parseBigIntId(dto.materialGroupId) : undefined,
        khoUnitFactor: dto.khoUnitFactor,
      },
    });
    return this.toResponseDto(material);
  }

  async findAll(query: PaginationQueryDto): Promise<Paginated<MaterialResponseDto>> {
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
        findMany: (args) => this.prisma.material.findMany(args),
        count: (args) => this.prisma.material.count(args),
      },
      query,
      where,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { id: query.sortOrder },
    );

    return { data: result.data.map((m) => this.toResponseDto(m)), meta: result.meta };
  }

  async findOne(id: string): Promise<MaterialResponseDto> {
    return this.toResponseDto(await this.findOneOrThrow(id));
  }

  async update(id: string, dto: UpdateMaterialDto): Promise<MaterialResponseDto> {
    const bigId = parseBigIntId(id);
    await this.findOneOrThrow(id);

    if (dto.code) {
      const existing = await this.prisma.material.findUnique({ where: { code: dto.code } });
      if (existing && existing.id !== bigId) {
        throw new ConflictException(`Material "${dto.code}" already exists`);
      }
    }

    const material = await this.prisma.material.update({
      where: { id: bigId },
      data: {
        code: dto.code,
        name: dto.name,
        unit: dto.unit,
        spec: dto.spec,
        materialGroupId: dto.materialGroupId ? parseBigIntId(dto.materialGroupId) : undefined,
        khoUnitFactor: dto.khoUnitFactor,
        isActive: dto.isActive,
      },
    });
    return this.toResponseDto(material);
  }

  async remove(id: string): Promise<void> {
    const bigId = parseBigIntId(id);
    await this.findOneOrThrow(id);
    await this.prisma.material.delete({ where: { id: bigId } });
  }

  // ─── MaterialSupplier sub-resource ────────────────────────────────────────

  async addSupplier(
    materialId: string,
    dto: CreateMaterialSupplierDto,
  ): Promise<MaterialSupplierResponseDto> {
    const materialBigId = parseBigIntId(materialId);
    await this.findOneOrThrow(materialId);
    const supplierBigId = parseBigIntId(dto.supplierId);

    const existing = await this.prisma.materialSupplier.findUnique({
      where: { materialId_supplierId: { materialId: materialBigId, supplierId: supplierBigId } },
    });
    if (existing) {
      throw new ConflictException(
        `Supplier ${dto.supplierId} is already linked to material ${materialId}`,
      );
    }

    const link = await this.prisma.materialSupplier.create({
      data: {
        materialId: materialBigId,
        supplierId: supplierBigId,
        price: dto.price,
        leadTimeDays: dto.leadTimeDays,
      },
      include: { supplier: true },
    });
    return this.toSupplierResponseDto(link);
  }

  async listSuppliers(materialId: string): Promise<MaterialSupplierResponseDto[]> {
    const materialBigId = parseBigIntId(materialId);
    await this.findOneOrThrow(materialId);

    const links = await this.prisma.materialSupplier.findMany({
      where: { materialId: materialBigId },
      include: { supplier: true },
      orderBy: { price: 'asc' },
    });
    return links.map((link) => this.toSupplierResponseDto(link));
  }

  async updateSupplier(
    materialId: string,
    id: string,
    dto: UpdateMaterialSupplierDto,
  ): Promise<MaterialSupplierResponseDto> {
    const linkBigId = parseBigIntId(id);
    await this.findSupplierLinkOrThrow(materialId, id);

    const link = await this.prisma.materialSupplier.update({
      where: { id: linkBigId },
      data: { price: dto.price, leadTimeDays: dto.leadTimeDays },
      include: { supplier: true },
    });
    return this.toSupplierResponseDto(link);
  }

  async removeSupplier(materialId: string, id: string): Promise<void> {
    const linkBigId = parseBigIntId(id);
    await this.findSupplierLinkOrThrow(materialId, id);
    await this.prisma.materialSupplier.delete({ where: { id: linkBigId } });
  }

  private async findSupplierLinkOrThrow(
    materialId: string,
    id: string,
  ): Promise<MaterialSupplierWithSupplier> {
    const materialBigId = parseBigIntId(materialId);
    const linkBigId = parseBigIntId(id);
    const link = await this.prisma.materialSupplier.findUnique({
      where: { id: linkBigId },
      include: { supplier: true },
    });
    if (!link || link.materialId !== materialBigId) {
      throw new NotFoundException(
        `Material-supplier link ${id} not found on material ${materialId}`,
      );
    }
    return link;
  }

  private async findOneOrThrow(id: string): Promise<Material> {
    const bigId = parseBigIntId(id);
    const material = await this.prisma.material.findUnique({ where: { id: bigId } });
    if (!material) {
      throw new NotFoundException(`Material ${id} not found`);
    }
    return material;
  }

  private toResponseDto(material: Material): MaterialResponseDto {
    return new MaterialResponseDto({
      id: material.id.toString(),
      code: material.code,
      name: material.name,
      unit: material.unit,
      spec: material.spec ?? null,
      materialGroupId: material.materialGroupId?.toString() ?? null,
      khoUnitFactor: material.khoUnitFactor?.toNumber() ?? null,
      isActive: material.isActive,
      createdAt: material.createdAt,
      updatedAt: material.updatedAt,
    });
  }

  private toSupplierResponseDto(link: MaterialSupplierWithSupplier): MaterialSupplierResponseDto {
    return new MaterialSupplierResponseDto({
      id: link.id.toString(),
      materialId: link.materialId.toString(),
      supplierId: link.supplierId.toString(),
      supplierName: link.supplier.name,
      price: link.price.toNumber(),
      leadTimeDays: link.leadTimeDays,
    });
  }
}
