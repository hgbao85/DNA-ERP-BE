import { PaginationQueryDto, SortOrder } from '../dto/pagination-query.dto';
import { paginate } from './paginate.util';

describe('paginate', () => {
  it('applies skip/take from the query and returns pagination meta', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: '1' }, { id: '2' }]);
    const count = jest.fn().mockResolvedValue(42);

    const query = new PaginationQueryDto();
    query.page = 2;
    query.limit = 10;
    query.sortOrder = SortOrder.ASC;

    const result = await paginate({ findMany, count }, query, { active: true }, { id: 'asc' });

    expect(findMany).toHaveBeenCalledWith({
      where: { active: true },
      orderBy: { id: 'asc' },
      skip: 10,
      take: 10,
    });
    expect(count).toHaveBeenCalledWith({ where: { active: true } });
    expect(result.data).toHaveLength(2);
    expect(result.meta).toEqual({ page: 2, limit: 10, total: 42, totalPages: 5 });
  });
});
