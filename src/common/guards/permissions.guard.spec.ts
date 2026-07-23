import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionAction } from '@prisma/client';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  const buildContext = (permissions: string[]): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user: { permissions } }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    }) as unknown as ExecutionContext;

  it('allows the request when no permissions are required', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(guard.canActivate(buildContext([]))).toBe(true);
  });

  it('allows the request when the user has all required permissions', () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValue([{ module: 'USER', action: PermissionAction.CREATE }]),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(guard.canActivate(buildContext(['USER:CREATE']))).toBe(true);
  });

  it('rejects the request when a required permission is missing', () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValue([{ module: 'USER', action: PermissionAction.DELETE }]),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(() => guard.canActivate(buildContext(['USER:VIEW']))).toThrow(ForbiddenException);
  });
});
