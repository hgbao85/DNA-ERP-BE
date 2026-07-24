import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { WAREHOUSE_SCOPE_KEY } from '../decorators/require-warehouse-scope.decorator';

@Injectable()
export class WarehouseScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const paramName = this.reflector.getAllAndOverride<string>(WAREHOUSE_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!paramName) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    const callerScope = request.user?.warehouseScope;

    // null = tổng kho (sees every warehouse) - nothing to enforce.
    if (!callerScope) {
      return true;
    }

    const body = request.body as Record<string, unknown> | undefined;
    const resourceScope: unknown =
      request.params?.[paramName] ?? request.query?.[paramName] ?? body?.[paramName];

    if (resourceScope !== undefined && resourceScope !== callerScope) {
      throw new ForbiddenException(
        `Caller is scoped to warehouse '${callerScope}', which does not match this resource`,
      );
    }

    return true;
  }
}
