import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { NotificationsService } from './notifications.service';

/**
 * `/notifications` = thông báo CỦA NGƯỜI GỌI (fan-out theo NotificationRecipient - xem
 * NotificationsService.emit()), không phải "xem tất cả thông báo đã tạo". Route tĩnh
 * (`unread-count`, `read-all`, `sent`) khai TRƯỚC `:id/...` cho rõ ý, dù path-to-regexp không thật
 * sự đòi hỏi thứ tự này (2 nhóm khác hình dạng path).
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  @RequirePermissions({ module: PERMISSION_MODULES.NOTIFICATION, action: PermissionAction.CREATE })
  create(@Body() dto: CreateNotificationDto, @CurrentUser('id') userId: string) {
    return this.notificationsService.createAnnouncement(dto, userId);
  }

  /** Admin/Sếp xem lại mọi thông báo chung đã phát + tỉ lệ đã đọc - khác GET / (chỉ thấy của
   *  chính mình). Cùng quyền với tạo (CREATE): ai phát được thông báo mới xem "đã gửi". */
  @Get('sent')
  @RequirePermissions({ module: PERMISSION_MODULES.NOTIFICATION, action: PermissionAction.CREATE })
  findSent(@Query() query: PaginationQueryDto) {
    return this.notificationsService.findSentAnnouncements(query);
  }

  @Get('unread-count')
  @RequirePermissions({ module: PERMISSION_MODULES.NOTIFICATION, action: PermissionAction.VIEW })
  unreadCount(@CurrentUser('id') userId: string) {
    return this.notificationsService.unreadCount(userId);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ module: PERMISSION_MODULES.NOTIFICATION, action: PermissionAction.VIEW })
  markAllRead(@CurrentUser('id') userId: string, @Query('category') category?: string) {
    return this.notificationsService.markAllRead(userId, category);
  }

  @Get()
  @RequirePermissions({ module: PERMISSION_MODULES.NOTIFICATION, action: PermissionAction.VIEW })
  findAll(@Query() query: ListNotificationsQueryDto, @CurrentUser('id') userId: string) {
    return this.notificationsService.findMyNotifications(query, userId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ module: PERMISSION_MODULES.NOTIFICATION, action: PermissionAction.VIEW })
  markRead(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.notificationsService.markRead(id, userId);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ module: PERMISSION_MODULES.NOTIFICATION, action: PermissionAction.VIEW })
  archive(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.notificationsService.archive(id, userId);
  }
}
