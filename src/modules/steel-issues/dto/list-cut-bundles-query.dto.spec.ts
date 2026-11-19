import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListCutBundlesQueryDto } from './list-cut-bundles-query.dto';

/** T1-6 (19/11/2026): GET /cut-bundles?status=<lạ> phải 400 (DTO), không để xuống Prisma (500). */
describe('ListCutBundlesQueryDto', () => {
  const errs = async (payload: Record<string, unknown>) =>
    validate(plainToInstance(ListCutBundlesQueryDto, payload));

  it('bỏ trống hoặc trạng thái đúng thì qua', async () => {
    expect(await errs({})).toEqual([]);
    expect(await errs({ status: 'AWAITING_QC' })).toEqual([]);
    expect(await errs({ productionInvoiceId: 'abc' })).toEqual([]);
  });

  it('trạng thái lạ bị chặn với câu tiếng Việt', async () => {
    const bad = await errs({ status: 'XYZ' });
    expect(bad.map((e) => e.property)).toContain('status');
    expect(Object.values(bad[0].constraints ?? {})[0]).toContain('Trạng thái đợt cắt');
  });
});
