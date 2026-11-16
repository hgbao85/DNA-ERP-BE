import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { NO_ASSIGNED_WAREHOUSE_MESSAGE, WarehouseScopeGuard } from './warehouse-scope.guard';
import { REQUIRE_ASSIGNED_WAREHOUSE_KEY } from '../decorators/require-assigned-warehouse.decorator';

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
  describe('rà soát 14/11 XK1: @RequireAssignedWarehouse - route ghi của kho', () => {
    const ctx = (roles: string[], warehouseScope: string | null): ExecutionContext =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({ user: { roles, warehouseScope }, params: {}, query: {} }),
        }),
        getHandler: () => jest.fn(),
        getClass: () => jest.fn(),
      }) as unknown as ExecutionContext;
    const guard = new WarehouseScopeGuard({
      getAllAndOverride: jest.fn((key: string) =>
        key === REQUIRE_ASSIGNED_WAREHOUSE_KEY ? true : undefined,
      ),
    } as unknown as Reflector);

    it('Nhân viên (người mua / KHSX / thủ kho chưa gán kho) để trống phạm vi -> 403', () => {
      expect(() => guard.canActivate(ctx(['PURCHASER', 'WAREHOUSE_STAFF'], null))).toThrow(
        NO_ASSIGNED_WAREHOUSE_MESSAGE,
      );
      expect(() => guard.canActivate(ctx(['WAREHOUSE_STAFF'], ''))).toThrow(ForbiddenException);
    });

    it('thủ kho đã gán kho, Admin, Giám đốc, vai trò khác không bị chặn', () => {
      expect(guard.canActivate(ctx(['WAREHOUSE_STAFF'], 'vat-tu-tp'))).toBe(true);
      expect(guard.canActivate(ctx(['ADMIN'], null))).toBe(true);
      expect(guard.canActivate(ctx(['BOSS', 'WAREHOUSE_STAFF'], null))).toBe(true);
      expect(guard.canActivate(ctx(['PRODUCTION_MANAGER'], null))).toBe(true);
    });
  });
});
