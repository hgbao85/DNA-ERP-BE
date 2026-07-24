import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MfgRole } from '../../generated/prisma/client';
import { MfgRoleGuard } from './mfg-role.guard';

describe('MfgRoleGuard', () => {
  const buildContext = (mfgRole: MfgRole | null): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user: { mfgRole } }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    }) as unknown as ExecutionContext;

  it('allows the request when no mfgRole is required', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const guard = new MfgRoleGuard(reflector);

    expect(guard.canActivate(buildContext(null))).toBe(true);
  });

  it('allows the request when the caller has one of the required mfgRoles', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([MfgRole.PHOI, MfgRole.KCS]),
    } as unknown as Reflector;
    const guard = new MfgRoleGuard(reflector);

    expect(guard.canActivate(buildContext(MfgRole.PHOI))).toBe(true);
  });

  it('rejects the request when the caller has no mfgRole', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([MfgRole.PHOI]),
    } as unknown as Reflector;
    const guard = new MfgRoleGuard(reflector);

    expect(() => guard.canActivate(buildContext(null))).toThrow(ForbiddenException);
  });

  it('rejects the request when the caller has a different mfgRole', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([MfgRole.PHOI]),
    } as unknown as Reflector;
    const guard = new MfgRoleGuard(reflector);

    expect(() => guard.canActivate(buildContext(MfgRole.HAN))).toThrow(ForbiddenException);
  });
});
