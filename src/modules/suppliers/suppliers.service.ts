import { Inject, Injectable, NotFoundException } from '@nestjs/common';
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
 * No name uniqueness in docs/dna-erp-db-schema.html "suppliers" - 2 NCC can legitimately
 * share a name. `isActive` IS the soft-delete column here (unlike material-groups): remove()
 * flips it instead of a real DELETE, so material_suppliers history stays intact.
 */
@Injectable()
export class SuppliersService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async create(dto: CreateSupplierDto): Promise<SupplierResponseDto> {
    const supplier = await this.prisma.supplier.create({
      data: { name: dto.name, phone: dto.phone, address: dto.address },
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

    const supplier = await this.prisma.supplier.update({
      where: { id: bigId },
      data: { name: dto.name, phone: dto.phone, address: dto.address, isActive: dto.isActive },
    });
    return this.toResponseDto(supplier);
  }

  async remove(id: string): Promise<void> {
    const bigId = parseBigIntId(id);
    await this.findOneOrThrow(id);
    await this.prisma.supplier.update({ where: { id: bigId }, data: { isActive: false } });
  }

  private async findOneOrThrow(id: string): Promise<Supplier> {
    const bigId = parseBigIntId(id);
    const supplier = await this.prisma.supplier.findUnique({ where: { id: bigId } });
    if (!supplier) {
      throw new NotFoundException(`Supplier ${id} not found`);
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
