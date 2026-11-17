import { BadRequestException } from '@nestjs/common';
import { PaginationQueryDto, SortOrder } from '../dto/pagination-query.dto';

/**
 * B2 (danh sách lỗi 16/11) - `orderBy` từ `?sortBy=` của PaginationQueryDto, chỉ nhận trường trong danh sách cho phép của từng
 * màn. Trước đây chuỗi tuỳ ý đi thẳng vào Prisma `orderBy`: trường lạ -> 500; trên /users sắp xếp được theo `password` (dò dần
 * hash qua thứ tự trả về). Trường ngoài danh sách -> 400. Không gửi sortBy -> `fallback` như cũ.
 */
export function sortOrderBy(
  query: Pick<PaginationQueryDto, 'sortBy' | 'sortOrder'>,
  allowed: readonly string[],
  fallback: Record<string, SortOrder>,
): Record<string, SortOrder> {
  if (!query.sortBy) return fallback;
  if (!allowed.includes(query.sortBy)) {
    throw new BadRequestException(
      `Không sắp xếp được theo "${query.sortBy}" - chỉ nhận: ${allowed.join(', ')}`,
    );
  }
  return { [query.sortBy]: query.sortOrder };
}
