import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationAudience, Prisma } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { paginate } from '../../common/utils/paginate.util';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { NotificationReadResponseDto } from './dto/notification-read-response.dto';
import { NotificationResponseDto } from './dto/notification-response.dto';

type NotificationWithReadFlag = Prisma.NotificationGetPayload<{
  include: { reads: true };
}>;

@Injectable()
export class NotificationsService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async create(dto: CreateNotificationDto, createdBy: string): Promise<NotificationResponseDto> {
    const notification = await this.prisma.notification.create({
      data: { title: dto.title, message: dto.message, audience: dto.audience, createdBy },
      include: { reads: true },
    });

    return this.toResponseDto(notification);
  }

  async findAllForUser(
    query: ListNotificationsQueryDto,
    user: AuthenticatedUser,
  ): Promise<Paginated<NotificationResponseDto>> {
    const audiences: NotificationAudience[] = [NotificationAudience.ALL];
    if (user.roles.includes(NotificationAudience.BOSS)) {
      audiences.push(NotificationAudience.BOSS);
    }
    if (user.roles.includes(NotificationAudience.WAREHOUSE_STAFF)) {
      audiences.push(NotificationAudience.WAREHOUSE_STAFF);
    }

    const where: Prisma.NotificationWhereInput = { audience: { in: audiences } };

    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.notification.findMany({
            ...args,
            include: { reads: { where: { userId: user.id } } },
          }),
        count: (args) => this.prisma.notification.count(args),
      },
      query,
      where,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { createdAt: query.sortOrder },
    );

    return {
      data: result.data.map((notification) => this.toResponseDto(notification)),
      meta: result.meta,
    };
  }

  async markRead(notificationId: string, userId: string): Promise<NotificationReadResponseDto> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification) {
      throw new NotFoundException(`Notification ${notificationId} not found`);
    }

    const read = await this.prisma.notificationRead.upsert({
      where: { notificationId_userId: { notificationId, userId } },
      update: {},
      create: { notificationId, userId },
    });

    return new NotificationReadResponseDto(read);
  }

  private toResponseDto(notification: NotificationWithReadFlag): NotificationResponseDto {
    return new NotificationResponseDto({
      id: notification.id,
      title: notification.title,
      message: notification.message,
      audience: notification.audience,
      createdBy: notification.createdBy,
      createdAt: notification.createdAt,
      isRead: notification.reads.length > 0,
    });
  }
}
