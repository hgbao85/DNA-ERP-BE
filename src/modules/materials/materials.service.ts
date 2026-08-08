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
import { MATERIAL_CODE_FALLBACK_PREFIX } from '../../common/constants/material-group-code-prefix.constant';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CloudinaryService } from '../uploads/cloudinary.service';
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
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async create(dto: CreateMaterialDto): Promise<MaterialResponseDto> {
    // name/unit là cột NOT NULL ở DB - không thể bỏ qua được (không phải "validate form" chặn
    // nhập liệu, chỉ là guard tránh PrismaClientValidationError raw -> 500 khó hiểu khi thiếu
    // field mà lẽ ra DB sẽ từ chối). `code` KHÔNG còn bắt buộc - để trống thì tự sinh theo nhóm
    // vật tư (generateMaterialCode), theo yêu cầu "đỡ phải nghĩ mã tay mà vẫn có unique".
    if (!dto.name || !dto.unit) {
      throw new BadRequestException(
        'Thiếu Tên vật tư / Đơn vị tính - đây là 2 trường bắt buộc ở DB, không thể để trống',
      );
    }

    const materialGroupId = dto.materialGroupId ? parseBigIntId(dto.materialGroupId) : undefined;
    // .trim() bắt buộc trước khi coi là "có nhập code" - '   ' (chỉ khoảng trắng) là truthy
    // trong JS, không trim thì lọt qua nhánh tự sinh và ghi thẳng chuỗi trắng vào DB.
    const trimmedCode = dto.code?.trim();
    const code = trimmedCode || (await this.generateMaterialCode(materialGroupId));

    const existing = await this.prisma.material.findUnique({ where: { code } });
    if (existing) {
      throw new ConflictException(`Material "${code}" already exists`);
    }

    const material = await this.prisma.material.create({
      data: {
        code,
        name: dto.name,
        unit: dto.unit,
        spec: dto.spec,
        materialGroupId,
        warehouseId: dto.warehouseId ? parseBigIntId(dto.warehouseId) : undefined,
        buyerId: dto.buyerId || undefined,
        khoUnitFactor: dto.khoUnitFactor,
        imageUrl: dto.imageUrl,
      },
    });
    return this.toResponseDto(material);
  }

  /**
   * Sinh mã dạng `PREFIX-NNN` khi tạo vật tư không nhập `code` - PREFIX đọc thẳng
   * MaterialGroup.codePrefix (cột NOT NULL + unique, xem schema.prisma - mỗi nhóm luôn có
   * đúng 1 tiền tố cố định của riêng nó, không suy từ `name` nên 2 nhóm không bao giờ đụng
   * tiền tố dù tên gần giống nhau). Chưa chọn nhóm nào thì dùng PREFIX chung
   * (MATERIAL_CODE_FALLBACK_PREFIX). NNN = số lớn nhất đã dùng cho đúng PREFIX đó +1 (không
   * phải COUNT) - để không sinh trùng mã khi có vật tư ở giữa đã bị xoá (remove() là hard
   * delete thật, xem comment class).
   */
  private async generateMaterialCode(materialGroupId?: bigint): Promise<string> {
    const prefix = await this.resolveCodePrefix(materialGroupId);

    const existing = await this.prisma.material.findMany({
      where: { code: { startsWith: `${prefix}-` } },
      select: { code: true },
    });
    const usedSeqs = existing
      .map((m) => Number(m.code.slice(prefix.length + 1)))
      .filter((n) => Number.isInteger(n) && n > 0);
    const nextSeq = (usedSeqs.length ? Math.max(...usedSeqs) : 0) + 1;

    return `${prefix}-${String(nextSeq).padStart(3, '0')}`;
  }

  private async resolveCodePrefix(materialGroupId?: bigint): Promise<string> {
    if (!materialGroupId) return MATERIAL_CODE_FALLBACK_PREFIX;

    const group = await this.prisma.materialGroup.findUnique({ where: { id: materialGroupId } });
    return group?.codePrefix ?? MATERIAL_CODE_FALLBACK_PREFIX;
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
    const previous = await this.findOneOrThrow(id);

    // .trim() cùng lý do đã áp cho create() - '   ' là truthy trong JS, không trim thì ghi
    // thẳng chuỗi trắng đè lên code cũ khi PATCH.
    const trimmedCode = dto.code?.trim() || undefined;
    if (trimmedCode) {
      const existing = await this.prisma.material.findUnique({ where: { code: trimmedCode } });
      if (existing && existing.id !== bigId) {
        throw new ConflictException(`Material "${trimmedCode}" already exists`);
      }
    }

    const material = await this.prisma.material.update({
      where: { id: bigId },
      data: {
        code: trimmedCode,
        name: dto.name,
        unit: dto.unit,
        spec: dto.spec,
        materialGroupId: dto.materialGroupId ? parseBigIntId(dto.materialGroupId) : undefined,
        warehouseId: dto.warehouseId ? parseBigIntId(dto.warehouseId) : undefined,
        buyerId: dto.buyerId || undefined,
        khoUnitFactor: dto.khoUnitFactor,
        imageUrl: dto.imageUrl,
        isActive: dto.isActive,
      },
    });

    // dto.imageUrl === undefined nghĩa là request không đụng tới field này (giữ nguyên) - CHỈ
    // xóa ảnh cũ trên Cloudinary khi nó thật sự bị thay/gỡ (khác giá trị mới, kể cả gỡ về null).
    if (dto.imageUrl !== undefined && previous.imageUrl && previous.imageUrl !== dto.imageUrl) {
      await this.cloudinaryService.deleteByUrl(previous.imageUrl);
    }

    return this.toResponseDto(material);
  }

  async remove(id: string): Promise<void> {
    const bigId = parseBigIntId(id);
    const material = await this.findOneOrThrow(id);
    await this.prisma.material.delete({ where: { id: bigId } });

    if (material.imageUrl) {
      await this.cloudinaryService.deleteByUrl(material.imageUrl);
    }
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
      warehouseId: material.warehouseId?.toString() ?? null,
      buyerId: material.buyerId ?? null,
      khoUnitFactor: material.khoUnitFactor?.toNumber() ?? null,
      imageUrl: material.imageUrl ?? null,
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
