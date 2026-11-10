import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Supplier } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { SupplierResponseDto } from './dto/supplier-response.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

/**
 * Tên NCC không được trùng (không phân biệt hoa thường, đã trim, gộp khoảng trắng) vì số đơn
 * đặt hàng cấp theo từng NCC - 2 bản trùng sẽ có 2 dãy số riêng (test tay 09/11 điểm 20).
 * Kiểm ở service, không có unique ở DB. `remove()` is a real hard delete (as originally built) - soft-delete for
 * this model is pending, see CONTRIBUTING.md "0. Ưu tiên". `isActive` is a separate,
 * independent flag.
 */
@Injectable()
export class SuppliersService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async create(dto: CreateSupplierDto): Promise<SupplierResponseDto> {
    await this.assertNameNotDuplicate(dto.name);
    const supplier = await this.prisma.supplier.create({
      data: { name: dto.name, phone: dto.phone, address: dto.address, isActive: dto.isActive },
    });
    return this.toResponseDto(supplier);
  }

  async findAll(query: PaginationQueryDto): Promise<Paginated<SupplierResponseDto>> {
    const where = query.search
      ? { name: { contains: query.search, mode: 'insensitive' as const } }
      : undefined;

    const result = await paginate(
      {
        findMany: (args) => this.prisma.supplier.findMany(args),
        count: (args) => this.prisma.supplier.count(args),
      },
      query,
      where,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { id: query.sortOrder },
    );

    return { data: result.data.map((s) => this.toResponseDto(s)), meta: result.meta };
  }

  async findOne(id: string): Promise<SupplierResponseDto> {
    return this.toResponseDto(await this.findOneOrThrow(id));
  }

  async update(id: string, dto: UpdateSupplierDto): Promise<SupplierResponseDto> {
    const bigId = parseBigIntId(id);
    await this.findOneOrThrow(id);
    if (dto.name !== undefined) await this.assertNameNotDuplicate(dto.name, bigId);

    const supplier = await this.prisma.supplier.update({
      where: { id: bigId },
      data: { name: dto.name, phone: dto.phone, address: dto.address, isActive: dto.isActive },
    });
    return this.toResponseDto(supplier);
  }

  async remove(id: string): Promise<void> {
    const bigId = parseBigIntId(id);
    await this.findOneOrThrow(id);
    await this.prisma.supplier.delete({ where: { id: bigId } });
  }

  private normalizeName(name: string): string {
    return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
  }

  /** Báo 409 nếu đã có NCC (chưa xoá mềm, trừ chính nó) trùng tên. */
  private async assertNameNotDuplicate(name: string, excludeId?: bigint): Promise<void> {
    const target = this.normalizeName(name);
    const rows = await this.prisma.supplier.findMany({
      where: { deletedAt: null, ...(excludeId !== undefined ? { id: { not: excludeId } } : {}) },
      select: { name: true },
    });
    if (rows.some((r) => this.normalizeName(r.name) === target)) {
      throw new ConflictException(
        `Đã có nhà cung cấp tên "${name.trim().replace(/\s+/g, ' ')}" - kiểm tra lại, không tạo trùng`,
      );
    }
  }

  private async findOneOrThrow(id: string): Promise<Supplier> {
    const bigId = parseBigIntId(id);
    const supplier = await this.prisma.supplier.findUnique({ where: { id: bigId } });
    if (!supplier) {
      throw new NotFoundException(`Không tìm thấy nhà cung cấp ${id}`);
    }
    return supplier;
  }

  private toResponseDto(supplier: Supplier): SupplierResponseDto {
    return new SupplierResponseDto({
      id: supplier.id.toString(),
      name: supplier.name,
      phone: supplier.phone,
      address: supplier.address,
      isActive: supplier.isActive,
      createdAt: supplier.createdAt,
      updatedAt: supplier.updatedAt,
    });
  }
}
