import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  NotificationAudience,
  NotificationCategory,
  NotificationSeverity,
  Prisma,
} from '../../generated/prisma/client';
import { PaginationMetaDto, Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BUSINESS_ROLES } from '../../common/constants/roles.constant';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { AnnouncementResponseDto } from './dto/announcement-response.dto';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { NotificationResponseDto } from './dto/notification-response.dto';
import { UnreadCountResponseDto } from './dto/unread-count-response.dto';
import { NotificationLink, NotificationType, NOTIFICATION_TYPES } from './notification-types';
import { RecipientResolverService } from './recipient-resolver.service';

type NotificationRow = Prisma.NotificationGetPayload<Record<string, never>>;
type RecipientRow = Prisma.NotificationRecipientGetPayload<Record<string, never>>;

export interface EmitNotificationOptions {
  /** Đối tượng nghiệp vụ gắn với sự kiện - dùng cho resolve() và để FE nhóm/link. Bỏ trống nếu
   *  sự kiện không gắn với 1 bản ghi cụ thể nào. */
  entityId?: string;
  /** Người gây ra sự kiện - loại khỏi người nhận trừ khi type khai `notifyActor`. */
  actorId?: string | null;
  /** Dữ liệu truyền cho `title()/message()/link()/recipients()` của type, đồng thời lưu vào
   *  `Notification.data` để FE hiển thị thêm nếu cần. */
  params?: Record<string, unknown>;
  /** "{type}:{entityId}" thường dùng - truyền tường minh vì có type cần gộp theo entity CHA (vd
   *  theo productionOrderId) thay vì theo entityId của chính dòng vừa tạo. */
  dedupeKey?: string;
  /** Emit trong CÙNG transaction với thay đổi nghiệp vụ - không bao giờ "đã duyệt mà không báo"
   *  hoặc "báo mà rollback" (mục 5.3 changelog 2026-09-25). Bỏ trống cho luồng best-effort ngoài
   *  request (vd solver cắt sắt chạy nền). */
  tx?: PrismaTx;
}

export interface ResolveNotificationCriteria {
  entityType: string;
  entityId: string;
  /** Chỉ đóng các type này - bỏ trống = đóng mọi ACTION_REQUIRED đang mở của đối tượng. */
  types?: NotificationType[];
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly recipientResolver: RecipientResolverService,
  ) {}

  // ─── Sự kiện nghiệp vụ (gọi từ các service khác, vd CuttingProposalsService) ──────────────────

  /**
   * Phát 1 sự kiện theo `type` đã khai trong NOTIFICATION_TYPES - tự tính người nhận, tự render
   * title/message/link, tự gộp (dedupe) nếu trùng sự kiện chưa xử lý xong. Không throw ra ngoài vì
   * lỗi tính toán tiêu chí người nhận (log + bỏ qua) - GHI CHÚ: lỗi ghi DB (create/update) vẫn ném
   * ra bình thường để caller tự quyết định best-effort (try/catch) hay để vỡ transaction.
   */
  async emit(type: NotificationType, options: EmitNotificationOptions = {}): Promise<void> {
    const def = NOTIFICATION_TYPES[type];
    if (!def) {
      this.logger.error(`emit(): không tìm thấy NOTIFICATION_TYPES["${type}"] - bỏ qua.`);
      return;
    }
    const client = options.tx ?? this.prisma;
    const params = options.params ?? {};

    const baseCriteria = def.recipients(params);
    const criteria =
      def.severity === 'CRITICAL'
        ? { ...baseCriteria, roles: [...(baseCriteria.roles ?? []), BUSINESS_ROLES.BOSS] }
        : baseCriteria;
    const excludeUserIds = def.notifyActor || !options.actorId ? [] : [options.actorId];

    const recipientIds = await this.recipientResolver.resolve(criteria, excludeUserIds, options.tx);
    if (recipientIds.length === 0) {
      this.logger.warn(`emit(${type}): không có người nhận nào khớp tiêu chí - bỏ qua.`);
      return;
    }

    const title = def.title(params);
    const message = def.message(params);
    const link = def.link ? def.link(params) : null;
    const dedupeKey = options.dedupeKey ?? null;

    if (dedupeKey) {
      const existing = await client.notification.findFirst({
        where: { dedupeKey, recipients: { some: { resolvedAt: null } } },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        await this.mergeIntoExisting(
          client,
          existing.id,
          { title, message, link, params },
          recipientIds,
        );
        return;
      }
    }

    const notification = await client.notification.create({
      data: {
        type,
        category: def.category,
        severity: def.severity,
        title,
        message,
        entityType: options.entityId ? def.entityType : null,
        entityId: options.entityId ?? null,
        link: (link ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        data: (params as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        actorId: options.actorId ?? null,
        dedupeKey,
      },
    });
    await client.notificationRecipient.createMany({
      data: recipientIds.map((userId) => ({ notificationId: notification.id, userId })),
    });
  }

  /** Cập nhật 1 dòng Notification đã gộp (dedupe) - đẩy lại CHƯA đọc cho người nhận hiện có (sự
   *  kiện vừa tái diễn) + fan-out thêm cho người nhận mới nếu lần này khớp thêm ai đó chưa từng
   *  nhận (hiếm, vd đổi role giữa 2 lần solver chạy). */
  private async mergeIntoExisting(
    client: PrismaServiceType | PrismaTx,
    notificationId: string,
    content: {
      title: string;
      message: string;
      link: NotificationLink | null;
      params: Record<string, unknown>;
    },
    recipientIds: string[],
  ): Promise<void> {
    await client.notification.update({
      where: { id: notificationId },
      data: {
        title: content.title,
        message: content.message,
        link: (content.link ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        data: (content.params as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      },
    });
    await client.notificationRecipient.updateMany({
      where: { notificationId },
      data: { readAt: null },
    });
    const existingRecipients = await client.notificationRecipient.findMany({
      where: { notificationId },
      select: { userId: true },
    });
    const existingIds = new Set(existingRecipients.map((r) => r.userId));
    const newIds = recipientIds.filter((id) => !existingIds.has(id));
    if (newIds.length > 0) {
      await client.notificationRecipient.createMany({
        data: newIds.map((userId) => ({ notificationId, userId })),
      });
    }
  }

  /**
   * Đóng (resolve) mọi thông báo ACTION_REQUIRED còn mở của 1 đối tượng - gọi khi đối tượng đó rời
   * trạng thái "cần xử lý" (vd ai đó đã duyệt/từ chối/nhận hàng). Không throw nếu không có gì để
   * đóng - no-op an toàn để gọi ở MỌI transition mà không cần biết trước có thông báo hay không.
   */
  async resolve(criteria: ResolveNotificationCriteria, tx?: PrismaTx): Promise<void> {
    const client = tx ?? this.prisma;
    await client.notificationRecipient.updateMany({
      where: {
        resolvedAt: null,
        notification: {
          entityType: criteria.entityType,
          entityId: criteria.entityId,
          ...(criteria.types ? { type: { in: criteria.types } } : {}),
        },
      },
      data: { resolvedAt: new Date() },
    });
  }

  // ─── Announcement (admin phát cho cả nhóm) ────────────────────────────────────────────────────

  async createAnnouncement(
    dto: CreateNotificationDto,
    createdBy: string,
  ): Promise<NotificationResponseDto> {
    const criteria =
      dto.audience === NotificationAudience.ALL
        ? { allActiveUsers: true }
        : { roles: [dto.audience as string] };
    const recipientIds = await this.recipientResolver.resolve(criteria, []);

    const notification = await this.prisma.notification.create({
      data: {
        category: NotificationCategory.ANNOUNCEMENT,
        severity: NotificationSeverity.INFO,
        title: dto.title,
        message: dto.message,
        audience: dto.audience,
        createdBy,
      },
    });
    if (recipientIds.length > 0) {
      await this.prisma.notificationRecipient.createMany({
        data: recipientIds.map((userId) => ({ notificationId: notification.id, userId })),
      });
    }
    return this.toResponseDto(notification, null);
  }

  /** Admin xem lại mọi thông báo chung đã phát + tỉ lệ đã đọc - KHÔNG lọc theo audience của người
   *  gọi (khác hành vi cũ của findAllForUser, xem changelog mục 2.2 "vấn đề P.admin-tu-tao"). */
  async findSentAnnouncements(
    query: PaginationQueryDto,
  ): Promise<Paginated<AnnouncementResponseDto>> {
    const where: Prisma.NotificationWhereInput = { category: NotificationCategory.ANNOUNCEMENT };
    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
        include: { _count: { select: { recipients: true } } },
      }),
      this.prisma.notification.count({ where }),
    ]);

    const ids = rows.map((r) => r.id);
    const readCounts = ids.length
      ? await this.prisma.notificationRecipient.groupBy({
          by: ['notificationId'],
          where: { notificationId: { in: ids }, readAt: { not: null } },
          _count: { _all: true },
        })
      : [];
    const readCountById = new Map(readCounts.map((r) => [r.notificationId, r._count._all]));

    return {
      data: rows.map(
        (n) =>
          new AnnouncementResponseDto({
            id: n.id,
            title: n.title,
            message: n.message,
            audience: n.audience,
            createdBy: n.createdBy,
            createdAt: n.createdAt,
            recipientCount: n._count.recipients,
            readCount: readCountById.get(n.id) ?? 0,
          }),
      ),
      meta: new PaginationMetaDto(query.page, query.limit, total),
    };
  }

  // ─── Người dùng cuối - thông báo của CHÍNH mình ────────────────────────────────────────────────

  /**
   * Danh sách thông báo của người gọi, mới nhất trước. Luôn sắp theo `createdAt` của Notification -
   * KHÔNG dùng `query.sortBy` tuỳ ý (khác `paginate()` dùng chung của các module khác): thứ tự thời
   * gian là điều duy nhất có ý nghĩa ở đây, và nhận field lạ từ client sẽ ném lỗi Prisma 500 (lỗ hổng
   * đã biết của PaginationQueryDto.sortBy, xem changelog 2026-09-25 mục 2.1).
   */
  async findMyNotifications(
    query: ListNotificationsQueryDto,
    userId: string,
  ): Promise<Paginated<NotificationResponseDto>> {
    const where: Prisma.NotificationRecipientWhereInput = {
      userId,
      archivedAt: null,
      ...(query.status === 'unread' ? { readAt: null } : {}),
      // resolved KHÁC status (đã đọc) - xem doc comment ListNotificationsQueryDto.resolved.
      ...(query.resolved === 'false' ? { resolvedAt: null } : {}),
      ...(query.resolved === 'true' ? { resolvedAt: { not: null } } : {}),
      ...(query.category
        ? { notification: { category: query.category as NotificationCategory } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.notificationRecipient.findMany({
        where,
        include: { notification: true },
        orderBy: { notification: { createdAt: 'desc' } },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.notificationRecipient.count({ where }),
    ]);

    return {
      data: rows.map((r) => this.toResponseDto(r.notification, r)),
      meta: new PaginationMetaDto(query.page, query.limit, total),
    };
  }

  async unreadCount(userId: string): Promise<UnreadCountResponseDto> {
    const rows = await this.prisma.notificationRecipient.findMany({
      where: { userId, readAt: null, archivedAt: null },
      select: { notification: { select: { category: true } } },
    });
    const byCategory: Record<string, number> = {};
    for (const row of rows) {
      const category = row.notification.category;
      byCategory[category] = (byCategory[category] ?? 0) + 1;
    }
    return new UnreadCountResponseDto({ total: rows.length, byCategory });
  }

  async markRead(id: string, userId: string): Promise<NotificationResponseDto> {
    const recipient = await this.findRecipientOrThrow(id, userId);
    const updated = recipient.readAt
      ? recipient
      : await this.prisma.notificationRecipient.update({
          where: { notificationId_userId: { notificationId: id, userId } },
          data: { readAt: new Date() },
          include: { notification: true },
        });
    return this.toResponseDto(updated.notification, updated);
  }

  async markAllRead(userId: string, category?: string): Promise<{ count: number }> {
    const result = await this.prisma.notificationRecipient.updateMany({
      where: {
        userId,
        readAt: null,
        ...(category ? { notification: { category: category as NotificationCategory } } : {}),
      },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  }

  async archive(id: string, userId: string): Promise<void> {
    await this.findRecipientOrThrow(id, userId);
    await this.prisma.notificationRecipient.update({
      where: { notificationId_userId: { notificationId: id, userId } },
      data: { archivedAt: new Date() },
    });
  }

  private async findRecipientOrThrow(
    notificationId: string,
    userId: string,
  ): Promise<RecipientRow & { notification: NotificationRow }> {
    const recipient = await this.prisma.notificationRecipient.findUnique({
      where: { notificationId_userId: { notificationId, userId } },
      include: { notification: true },
    });
    // Không phân biệt "không tồn tại" với "không phải người nhận" - tránh lộ rằng 1 thông báo có
    // tồn tại nhưng gửi cho người khác.
    if (!recipient) {
      throw new NotFoundException(`Notification ${notificationId} not found`);
    }
    return recipient;
  }

  private toResponseDto(
    notification: NotificationRow,
    recipient: RecipientRow | null,
  ): NotificationResponseDto {
    return new NotificationResponseDto({
      id: notification.id,
      type: notification.type,
      category: notification.category,
      severity: notification.severity,
      title: notification.title,
      message: notification.message,
      entityType: notification.entityType,
      entityId: notification.entityId,
      link: notification.link as NotificationLink | null,
      data: notification.data,
      actorId: notification.actorId,
      audience: notification.audience,
      createdBy: notification.createdBy,
      createdAt: notification.createdAt,
      isRead: recipient ? recipient.readAt !== null : false,
      isResolved: recipient ? recipient.resolvedAt !== null : false,
    });
  }
}
