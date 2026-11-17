import { BadRequestException } from '@nestjs/common';
import { SortOrder } from '../dto/pagination-query.dto';
import { sortOrderBy } from './sort-order-by.util';

describe('sortOrderBy (B2 16/11)', () => {
  const allowed = ['id', 'createdAt'];
  const fallback = { createdAt: SortOrder.DESC };

  it('không gửi sortBy -> giữ thứ tự mặc định', () => {
    expect(sortOrderBy({ sortOrder: SortOrder.ASC }, allowed, fallback)).toBe(fallback);
  });

  it('trường trong danh sách -> orderBy theo trường đó', () => {
    expect(sortOrderBy({ sortBy: 'id', sortOrder: SortOrder.ASC }, allowed, fallback)).toEqual({
      id: SortOrder.ASC,
    });
  });

  it('trường ngoài danh sách (vd password, trường không tồn tại) -> 400, không tới Prisma', () => {
    for (const sortBy of ['password', 'khongCo', 'roles', '__proto__']) {
      expect(() => sortOrderBy({ sortBy, sortOrder: SortOrder.ASC }, allowed, fallback)).toThrow(
        BadRequestException,
      );
    }
  });
});
