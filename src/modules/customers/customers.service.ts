import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Customer } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
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
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { id: query.sortOrder },
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
    await this.findOneOrThrow(id);
    await this.prisma.customer.delete({ where: { id: bigId } });
  }

  private async findOneOrThrow(id: string): Promise<Customer> {
    const bigId = parseBigIntId(id);
    const customer = await this.prisma.customer.findUnique({ where: { id: bigId } });
    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
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
