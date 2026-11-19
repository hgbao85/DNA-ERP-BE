import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListNotificationsQueryDto } from './list-notifications-query.dto';
import { MarkAllReadQueryDto } from './mark-all-read-query.dto';

/** T1-5 (19/11/2026): category lạ phải bị chặn ở DTO (400), không để xuống Prisma (500). */
describe('category của thông báo', () => {
  const errs = async (cls: new () => object, payload: Record<string, unknown>) =>
    validate(plainToInstance(cls, payload));

  it('GET /notifications: category lạ bị chặn, category đúng và bỏ trống thì qua', async () => {
    expect(await errs(ListNotificationsQueryDto, {})).toEqual([]);
    expect(await errs(ListNotificationsQueryDto, { category: 'ALERT' })).toEqual([]);
    const bad = await errs(ListNotificationsQueryDto, { category: 'XYZ' });
    expect(bad.map((e) => e.property)).toContain('category');
    expect(Object.values(bad[0].constraints ?? {})[0]).toContain('Loại thông báo');
  });

  it('POST /notifications/read-all: category lạ bị chặn', async () => {
    expect(await errs(MarkAllReadQueryDto, {})).toEqual([]);
    expect(await errs(MarkAllReadQueryDto, { category: 'RESULT' })).toEqual([]);
    const bad = await errs(MarkAllReadQueryDto, { category: 'XYZ' });
    expect(bad.map((e) => e.property)).toContain('category');
    expect(Object.values(bad[0].constraints ?? {})[0]).toContain('Loại thông báo');
  });
});
