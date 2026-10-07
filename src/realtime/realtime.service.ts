import { Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'crypto';
import { AppClsStore } from '../common/interfaces/cls-store.interface';
import { PermissionModule } from '../common/constants/permission-modules.constant';
import {
  EntityChangedPayload,
  NotificationChangedPayload,
  NotificationCreatedPayload,
  REALTIME_ENTITY_ROUTES,
  REALTIME_EVENTS,
  REALTIME_ROOMS,
  RealtimeEntity,
  RealtimeEntityAction,
  RealtimeEnvelope,
  RealtimeEventMap,
  RealtimeEventName,
} from './realtime.contract';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Điểm DUY NHẤT để nghiệp vụ phát realtime. Mọi hàm `publish*` CHỈ được gọi SAU KHI transaction
 * đã commit (hoặc sau một ghi đơn lẻ đã xong). Lý do: event đã phát thì không thu hồi được - phát
 * trước commit mà transaction rollback sẽ khiến FE hiển thị dữ liệu chưa tồn tại.
 *
 * Quy tắc an toàn:
 * - Không bao giờ ném lỗi ra ngoài: realtime là phần phụ, không được làm hỏng request nghiệp vụ
 *   đã commit. Lỗi chỉ được log kèm correlationId.
 * - Không có server (môi trường test, script không mở cổng) -> no-op có log debug.
 * - Không tự quyết định người nhận: caller truyền đúng danh sách user đã được tính theo quyền.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  constructor(
    private readonly gateway: RealtimeGateway,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  /** Thông báo cá nhân: gửi tới room `user:<id>` của từng người nhận. */
  publishNotificationCreated(
    recipientUserIds: string[],
    payload: NotificationCreatedPayload,
  ): void {
    const rooms = recipientUserIds.map((id) => REALTIME_ROOMS.user(id));
    this.emit(rooms, REALTIME_EVENTS.NOTIFICATION_CREATED, payload);
  }

  /** Đổi trạng thái thông báo: gửi tới room cá nhân của người dùng (đồng bộ giữa các tab/thiết bị). */
  publishNotificationChanged(
    recipientUserIds: string[],
    payload: NotificationChangedPayload,
  ): void {
    const rooms = recipientUserIds.map((id) => REALTIME_ROOMS.user(id));
    this.emit(rooms, REALTIME_EVENTS.NOTIFICATION_CHANGED, payload);
  }

  /**
   * Sự kiện nghiệp vụ: gửi tới room quyền VIEW của các module đã khai trong REALTIME_ENTITY_ROUTES.
   * Socket có nhiều quyền vẫn chỉ nhận 1 lần (socket.io khử trùng khi broadcast nhiều room).
   */
  publishEntityChanged(input: {
    entity: RealtimeEntity;
    entityId: string | number | bigint;
    action: RealtimeEntityAction;
    /** Chỉ để truy vết trong log server - KHÔNG đưa vào payload (tránh lộ người thao tác cho mọi người có VIEW). */
    actorId?: string | null;
  }): void {
    this.logger.debug(
      `entity.changed ${input.entity}#${String(input.entityId)} ${input.action} actor=${input.actorId ?? '-'}`,
    );
    const route = REALTIME_ENTITY_ROUTES[input.entity];
    const rooms = route.modules.map((m: PermissionModule) => REALTIME_ROOMS.permission(m));
    const payload: EntityChangedPayload = {
      entity: input.entity,
      entityId: String(input.entityId),
      action: input.action,
      topics: route.topics,
    };
    this.emit(rooms, REALTIME_EVENTS.ENTITY_CHANGED, payload);
  }

  private emit<N extends RealtimeEventName>(
    rooms: string[],
    name: N,
    payload: RealtimeEventMap[N],
  ): void {
    const server = this.gateway.server;
    if (!server || rooms.length === 0) {
      this.logger.debug(`Bỏ qua ${name}: chưa có server hoặc không có người nhận`);
      return;
    }
    const correlationId = this.currentCorrelationId();
    const envelope: RealtimeEnvelope<N, RealtimeEventMap[N]> = {
      eventId: randomUUID(),
      name,
      occurredAt: new Date().toISOString(),
      correlationId,
      payload,
    };
    try {
      server.to(rooms).emit(name, envelope);
      // debug: mỗi event là 1 dòng - ở production (LOG_LEVEL=info) không được làm đầy log.
      this.logger.debug(
        `Phát ${name} eventId=${envelope.eventId} rooms=${rooms.length} correlationId=${correlationId ?? '-'}`,
      );
    } catch (error) {
      this.logger.error(
        `Phát ${name} thất bại (eventId=${envelope.eventId}, correlationId=${correlationId ?? '-'}): ${(error as Error).message}`,
      );
    }
  }

  /** Correlation ID của request hiện tại (nếu có) - để nối log realtime với log REST. */
  private currentCorrelationId(): string | null {
    try {
      return this.cls.getId() ?? null;
    } catch {
      return null;
    }
  }
}
