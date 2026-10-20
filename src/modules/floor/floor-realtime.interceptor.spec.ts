import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { RealtimeService } from '../../realtime/realtime.service';
import { FloorAlertsService } from './floor-alerts.service';
import { FloorRealtimeInterceptor } from './floor-realtime.interceptor';

describe('FloorRealtimeInterceptor', () => {
  let publish: jest.Mock;
  let requestEvaluate: jest.Mock;
  let interceptor: FloorRealtimeInterceptor;

  const run = (
    req: { method: string; path: string; user?: { id: string } },
    handler: () => unknown,
  ) => {
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    const next = { handle: () => handler() } as unknown as CallHandler;
    return interceptor.intercept(context, next);
  };

  beforeEach(() => {
    publish = jest.fn();
    requestEvaluate = jest.fn();
    interceptor = new FloorRealtimeInterceptor(
      { publishEntityChanged: publish } as unknown as RealtimeService,
      { requestEvaluate } as unknown as FloorAlertsService,
    );
  });

  it('GET không phát event, không kích hoạt kiểm cảnh báo, trả nguyên dữ liệu', async () => {
    const data = { rows: [1] };
    await expect(
      lastValueFrom(run({ method: 'GET', path: '/api/v1/floor/stats' }, () => of(data))),
    ).resolves.toBe(data);
    expect(publish).not.toHaveBeenCalled();
    expect(requestEvaluate).not.toHaveBeenCalled();
  });

  it.each(['POST', 'PATCH', 'DELETE'])(
    '%s thành công: phát FLOOR_REPORT (màn QLSX tự tải lại) + kiểm cảnh báo, trả nguyên kết quả',
    async (method) => {
      const result = { ok: true };
      await expect(
        lastValueFrom(
          run({ method, path: '/api/v1/floor/queue/PHOI/advance', user: { id: 'qlsx-1' } }, () =>
            of(result),
          ),
        ),
      ).resolves.toBe(result);
      expect(publish).toHaveBeenCalledWith({
        entity: 'FLOOR_REPORT',
        entityId: '/api/v1/floor/queue/PHOI/advance',
        action: 'UPDATED',
        actorId: 'qlsx-1',
      });
      expect(requestEvaluate).toHaveBeenCalledTimes(1);
    },
  );

  it('request không có người dùng (actorId) vẫn phát, actorId = null', async () => {
    await lastValueFrom(
      run({ method: 'POST', path: '/api/v1/floor/scan/t/reports' }, () => of({})),
    );
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ actorId: null }));
  });

  it('request GHI THẤT BẠI (ném lỗi) không phát event và không kích hoạt kiểm cảnh báo - lỗi vẫn tới người gọi', async () => {
    await expect(
      lastValueFrom(
        run({ method: 'POST', path: '/api/v1/floor/review/step-groups/send-kcs' }, () =>
          throwError(() => new Error('409')),
        ),
      ),
    ).rejects.toThrow('409');
    expect(publish).not.toHaveBeenCalled();
    expect(requestEvaluate).not.toHaveBeenCalled();
  });
});
