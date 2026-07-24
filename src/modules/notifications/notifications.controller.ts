import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  @RequirePermissions({ module: PERMISSION_MODULES.NOTIFICATION, action: PermissionAction.CREATE })
  create(@Body() dto: CreateNotificationDto, @CurrentUser('id') userId: string) {
    return this.notificationsService.create(dto, userId);
  }

  @Get()
  @RequirePermissions({ module: PERMISSION_MODULES.NOTIFICATION, action: PermissionAction.VIEW })
  findAll(@Query() query: ListNotificationsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.findAllForUser(query, user);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ module: PERMISSION_MODULES.NOTIFICATION, action: PermissionAction.VIEW })
  markRead(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.notificationsService.markRead(id, userId);
  }
}
