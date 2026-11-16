import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { WAREHOUSE_SCOPE_KEY } from '../decorators/require-warehouse-scope.decorator';
import { REQUIRE_ASSIGNED_WAREHOUSE_KEY } from '../decorators/require-assigned-warehouse.decorator';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../constants/roles.constant';

export const NO_ASSIGNED_WAREHOUSE_MESSAGE =
  'Tài khoản chưa được gán kho phụ trách - không thao tác kho được. Nhờ Admin gán kho ở Admin > Người dùng nếu bạn là thủ kho';

@Injectable()
export class WarehouseScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requireAssigned = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_ASSIGNED_WAREHOUSE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requireAssigned) {
      const user = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>().user;
      const roles = user?.roles ?? [];
      const isTop = roles.includes(DEFAULT_ROLES.ADMIN) || roles.includes(BUSINESS_ROLES.BOSS);
      if (!isTop && roles.includes(BUSINESS_ROLES.WAREHOUSE_STAFF) && !user?.warehouseScope) {
        throw new ForbiddenException(NO_ASSIGNED_WAREHOUSE_MESSAGE);
      }
    }

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
        `Tài khoản đang làm việc ở kho '${callerScope}', không được thao tác dữ liệu của kho khác`,
      );
    }

    return true;
  }
}
