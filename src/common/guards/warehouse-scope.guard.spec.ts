import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WarehouseScopeGuard } from './warehouse-scope.guard';

describe('WarehouseScopeGuard', () => {
  const buildContext = (
    callerScope: string | null,
    request: { params?: Record<string, string>; query?: Record<string, string> } = {},
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          user: { warehouseScope: callerScope },
          params: request.params ?? {},
          query: request.query ?? {},
        }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    }) as unknown as ExecutionContext;

  it('allows the request when the route is not warehouse-scoped', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const guard = new WarehouseScopeGuard(reflector);

    expect(guard.canActivate(buildContext('kho-a'))).toBe(true);
  });

  it('allows the request when the caller has no warehouseScope (tổng kho)', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue('warehouseCode'),
    } as unknown as Reflector;
    const guard = new WarehouseScopeGuard(reflector);

    expect(guard.canActivate(buildContext(null, { params: { warehouseCode: 'kho-a' } }))).toBe(
      true,
    );
  });

  it('allows the request when the resource scope matches the caller scope', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue('warehouseCode'),
    } as unknown as Reflector;
    const guard = new WarehouseScopeGuard(reflector);

    expect(guard.canActivate(buildContext('kho-a', { params: { warehouseCode: 'kho-a' } }))).toBe(
      true,
    );
  });

  it('rejects the request when the resource scope does not match the caller scope', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue('warehouseCode'),
    } as unknown as Reflector;
    const guard = new WarehouseScopeGuard(reflector);

    expect(() =>
      guard.canActivate(buildContext('kho-a', { params: { warehouseCode: 'kho-b' } })),
    ).toThrow(ForbiddenException);
  });
});
