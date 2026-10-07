import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { RealtimeMutationInterceptor } from './realtime-mutation.interceptor';
import { RealtimeService } from './realtime.service';

describe('RealtimeMutationInterceptor', () => {
  let publish: jest.Mock;
  let interceptor: RealtimeMutationInterceptor;

  const run = (
    req: { method: string; path: string; params?: Record<string, string>; user?: { id: string } },
    handler: () => unknown,
  ) => {
    const context = {
      getClass: () => class SkusController {},
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    const next = { handle: () => handler() } as unknown as CallHandler;
    return interceptor.intercept(context, next);
  };

  beforeEach(() => {
    publish = jest.fn();
    const realtime = { publishEntityChanged: publish } as unknown as RealtimeService;
    const reflector = { get: jest.fn(() => 'SKU') } as unknown as Reflector;
    interceptor = new RealtimeMutationInterceptor(reflector, realtime);
  });

  it('GET không phát event', async () => {
    await lastValueFrom(run({ method: 'GET', path: '/api/v1/skus', params: {} }, () => of([])));
    expect(publish).not.toHaveBeenCalled();
  });

  it('POST tạo mới: CREATED, lấy id từ response (không có :id trên URL)', async () => {
    await lastValueFrom(
      run({ method: 'POST', path: '/api/v1/skus', params: {}, user: { id: 'u1' } }, () =>
        of({ id: 42, code: 'SKU-1' }),
      ),
    );
    expect(publish).toHaveBeenCalledWith({
      entity: 'SKU',
      entityId: '42',
      action: 'CREATED',
      actorId: 'u1',
    });
  });

  it('PATCH /:id: UPDATED theo id trên URL', async () => {
    await lastValueFrom(
      run({ method: 'PATCH', path: '/api/v1/skus/7', params: { id: '7' } }, () => of({ id: 7 })),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: '7', action: 'UPDATED', actorId: null }),
    );
  });

  it('POST /:id/approve: APPROVED', async () => {
    await lastValueFrom(
      run({ method: 'POST', path: '/api/v1/skus/7/approve', params: { id: '7' } }, () =>
        of({ id: 7 }),
      ),
    );
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ action: 'APPROVED' }));
  });

  it('POST /:id/reject-boss: REJECTED', async () => {
    await lastValueFrom(
      run({ method: 'POST', path: '/api/v1/skus/7/reject-boss', params: { id: '7' } }, () =>
        of({ id: 7 }),
      ),
    );
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ action: 'REJECTED' }));
  });

  it('DELETE /:id: DELETED', async () => {
    await lastValueFrom(
      run({ method: 'DELETE', path: '/api/v1/skus/7', params: { id: '7' } }, () => of(undefined)),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: '7', action: 'DELETED' }),
    );
  });

  it('request lỗi (handler ném) -> KHÔNG phát event', async () => {
    await expect(
      lastValueFrom(
        run({ method: 'PATCH', path: '/api/v1/skus/7', params: { id: '7' } }, () =>
          throwError(() => new Error('conflict')),
        ),
      ),
    ).rejects.toThrow('conflict');
    expect(publish).not.toHaveBeenCalled();
  });
});
