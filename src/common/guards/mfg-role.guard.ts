import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { MfgRole } from '../../generated/prisma/client';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { MFG_ROLE_KEY } from '../decorators/require-mfg-role.decorator';

@Injectable()
export class MfgRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<MfgRole[]>(MFG_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    const mfgRole = request.user?.mfgRole;

    if (!mfgRole || !required.includes(mfgRole as MfgRole)) {
      throw new ForbiddenException(`Requires mfgRole to be one of: ${required.join(', ')}`);
    }

    return true;
  }
}
