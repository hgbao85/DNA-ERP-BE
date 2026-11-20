import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Customer, Prisma } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { sortOrderBy } from '../../common/utils/sort-order-by.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CustomerResponseDto } from './dto/customer-response.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

/**
 * No name uniqueness, no isActive in docs/dna-erp-db-schema.html "sales_customers" -
 * remove() is a real DELETE. product_variants.customerId is ON DELETE SET NULL, so
 * deleting a customer already referenced by a variant never blocks.
 */
@Injectable()
export class CustomersService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async create(dto: CreateCustomerDto): Promise<CustomerResponseDto> {
    const customer = await this.prisma.customer.create({
      data: {
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        country: dto.country,
        market: dto.market,
        contactName: dto.contactName,
        note: dto.note,
      },
    });
    return this.toResponseDto(customer);
  }

  async findAll(query: PaginationQueryDto): Promise<Paginated<CustomerResponseDto>> {
    const where = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' as const } },
            { email: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : undefined;

    const result = await paginate(
      {
        findMany: (args) => this.prisma.customer.findMany(args),
        count: (args) => this.prisma.customer.count(args),
      },
      query,
      where,
      sortOrderBy(query, ['id', 'name', 'email', 'createdAt'], { id: query.sortOrder }),
    );

    return { data: result.data.map((c) => this.toResponseDto(c)), meta: result.meta };
  }

  async findOne(id: string): Promise<CustomerResponseDto> {
    return this.toResponseDto(await this.findOneOrThrow(id));
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<CustomerResponseDto> {
    const bigId = parseBigIntId(id);
    await this.findOneOrThrow(id);

    const customer = await this.prisma.customer.update({
      where: { id: bigId },
      data: {
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        country: dto.country,
        market: dto.market,
        contactName: dto.contactName,
        note: dto.note,
      },
    });
    return this.toResponseDto(customer);
  }

  async remove(id: string): Promise<void> {
    const bigId = parseBigIntId(id);
    const customer = await this.findOneOrThrow(id);
    try {
      // 20/11/2026: kiểm đơn hàng / booking trong transaction trước khi xoá -> 409 nêu lý do
      // (trước đây ra lỗi khoá ngoại, câu chung). Biến thể sản phẩm vẫn SET NULL, không chặn.
      await this.prisma.$transaction(async (tx) => {
        const [orders, bookings] = await Promise.all([
          tx.salesOrder.count({ where: { customerId: bigId } }),
          tx.booking.count({ where: { customerId: bigId } }),
        ]);
        const parts = [
          orders > 0 ? `${orders} đơn hàng` : null,
          bookings > 0 ? `${bookings} booking` : null,
        ].filter((p): p is string => p !== null);
        if (parts.length > 0) {
          throw new ConflictException(
            `Khách hàng "${customer.name}" đang có ${parts.join(', ')} - không xoá được`,
          );
        }
        await tx.customer.delete({ where: { id: bigId } });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new ConflictException('Khách hàng đang được dùng ở chứng từ khác - không xoá được');
      }
      throw e;
    }
  }

  private async findOneOrThrow(id: string): Promise<Customer> {
    const bigId = parseBigIntId(id);
    const customer = await this.prisma.customer.findUnique({ where: { id: bigId } });
    if (!customer) {
      throw new NotFoundException(`Không tìm thấy khách hàng ${id}`);
    }
    return customer;
  }

  private toResponseDto(customer: Customer): CustomerResponseDto {
    return new CustomerResponseDto({
      id: customer.id.toString(),
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      country: customer.country,
      market: customer.market,
      contactName: customer.contactName,
      note: customer.note,
      createdAt: customer.createdAt,
    });
  }
}
