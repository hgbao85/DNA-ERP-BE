import { ClsService } from 'nestjs-cls';
import { AppClsStore, RequestTiming } from '../../common/interfaces/cls-store.interface';
import { withQueryTiming } from './query-timing.extension';

type Hook = (p: { args: unknown; query: (a: unknown) => Promise<unknown> }) => Promise<unknown>;

/** Lấy hàm hook ra khỏi object extension (defineExtension trả về hàm nhận client hoặc object cấu hình). */
function getHook(cls: ClsService<AppClsStore>): Hook {
  // Client giả: $extends trả lại đúng cấu hình để lấy hook ra.
  const fakeClient = { $extends: (cfg: unknown) => cfg };
  const ext = (withQueryTiming(cls) as unknown as (c: unknown) => unknown)(fakeClient) as {
    query: { $allOperations: Hook };
  };
  return ext.query.$allOperations;
}

const newTiming = (): RequestTiming => ({
  startMs: 0,
  dbMs: 0,
  dbCount: 0,
  solverMs: 0,
  solverCount: 0,
});

describe('withQueryTiming', () => {
  it('cộng dồn thời gian và số truy vấn vào CLS, kể cả truy vấn song song', async () => {
    const timing = newTiming();
    const cls = { isActive: () => true, get: () => timing } as unknown as ClsService<AppClsStore>;
    const hook = getHook(cls);
    const slow = () => new Promise((r) => setTimeout(() => r('ok'), 20));
    const results = await Promise.all([
      hook({ args: {}, query: slow }),
      hook({ args: {}, query: slow }),
    ]);
    expect(results).toEqual(['ok', 'ok']);
    expect(timing.dbCount).toBe(2);
    expect(timing.dbMs).toBeGreaterThanOrEqual(30);
  });

  it('vẫn đếm khi truy vấn lỗi và ném lại lỗi', async () => {
    const timing = newTiming();
    const cls = { isActive: () => true, get: () => timing } as unknown as ClsService<AppClsStore>;
    await expect(
      getHook(cls)({ args: {}, query: () => Promise.reject(new Error('boom')) }),
    ).rejects.toThrow('boom');
    expect(timing.dbCount).toBe(1);
  });

  it('không lỗi khi không có CLS context', async () => {
    const cls = {
      isActive: () => false,
      get: jest.fn(() => {
        throw new Error('không được gọi');
      }),
    } as unknown as ClsService<AppClsStore>;
    await expect(getHook(cls)({ args: 1, query: (a) => Promise.resolve(a) })).resolves.toBe(1);
  });

  it('không lỗi khi request không bật đo (store không có timing)', async () => {
    const cls = {
      isActive: () => true,
      get: () => undefined,
    } as unknown as ClsService<AppClsStore>;
    await expect(getHook(cls)({ args: 2, query: (a) => Promise.resolve(a) })).resolves.toBe(2);
  });
});
