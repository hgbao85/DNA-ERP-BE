import { Paginated, PaginationMetaDto } from '../dto/paginated-response.dto';
import { PaginationQueryDto } from '../dto/pagination-query.dto';

interface PaginatableDelegate<T, WhereInput, OrderByInput> {
  findMany(args: {
    where?: WhereInput;
    orderBy?: OrderByInput;
    skip: number;
    take: number;
  }): Promise<T[]>;
  count(args: { where?: WhereInput }): Promise<number>;
}

/**
 * Shared pagination helper for Prisma delegates. Reuse this instead of
 * hand-rolling skip/take/count logic in every module (users, roles, and any
 * future ERP module).
 */
export async function paginate<T, WhereInput, OrderByInput>(
  delegate: PaginatableDelegate<T, WhereInput, OrderByInput>,
  query: PaginationQueryDto,
  where?: WhereInput,
  orderBy?: OrderByInput,
): Promise<Paginated<T>> {
  const [data, total] = await Promise.all([
    delegate.findMany({ where, orderBy, skip: query.skip, take: query.limit }),
    delegate.count({ where }),
  ]);

  return {
    data,
    meta: new PaginationMetaDto(query.page, query.limit, total),
  };
}
