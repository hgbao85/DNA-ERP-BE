import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { BusinessRole } from '../constants/roles.constant';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { ROLE_KEY } from '../decorators/require-role.decorator';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<BusinessRole[]>(ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    const userRoles = request.user?.roles ?? [];

    if (!required.some((role) => userRoles.includes(role))) {
      throw new ForbiddenException(`Requires role to be one of: ${required.join(', ')}`);
    }

    return true;
  }
}
