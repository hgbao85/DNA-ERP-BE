import { BeforeApplicationShutdown, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { randomUUID } from 'crypto';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { REALTIME_ROOMS, MAX_CORRELATION_ID_LENGTH } from './realtime.contract';

/** Dữ liệu gắn vào socket sau khi xác thực thành công (socket.data). */
export interface RealtimeSocketData {
  userId: string;
  correlationId: string;
  /** Mốc hết hạn của access token (ms epoch) - hết hạn thì server ngắt để client xin token mới. */
  expiresAtMs: number;
}

/** Ngưỡng tối đa của setTimeout (~24.8 ngày). Token 15 phút không chạm tới, nhưng vẫn kẹp cho an toàn. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Cổng WebSocket duy nhất của hệ thống (Socket.IO, cùng cổng HTTP, path mặc định /socket.io).
 *
 * - Xác thực: access token JWT trong `handshake.auth.token` (không đọc cookie/query để tránh lộ
 *   token trong URL/log). Sai/hết hạn -> từ chối ở middleware, socket không bao giờ được connect.
 * - Phân quyền: server tự join room `user:<id>` và `perm:<MODULE>:VIEW` theo `permissions` trong
 *   JWT. Client không có API nào để chọn room -> không thể nghe kênh của người khác.
 * - Hết hạn: token hết hạn thì server ngắt socket (client nhận `io server disconnect`, FE refresh
 *   token rồi kết nối lại). Giống REST - guard cũng chỉ tin token đến khi exp, không kéo dài phiên ngầm.
 * - Shutdown: `beforeApplicationShutdown` ngắt mọi socket TRƯỚC khi đóng HTTP server, để client
 *   thấy disconnect rõ ràng và tự kết nối lại với backoff.
 */
@WebSocketGateway()
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, BeforeApplicationShutdown
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly jwtService: JwtService) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      try {
        this.authenticate(socket);
        next();
      } catch (error) {
        // Không lộ lý do chi tiết ra client (tránh dò token). Chi tiết chỉ đi vào log server.
        this.logger.warn(
          `Từ chối kết nối socket ${socket.id}: ${(error as Error).message} (correlationId=${this.readCorrelationId(socket)})`,
        );
        next(new Error('UNAUTHORIZED'));
      }
    });
    this.logger.log('Realtime gateway sẵn sàng (Socket.IO, xác thực bằng access token)');
  }

  handleConnection(client: Socket): void {
    const data = client.data as RealtimeSocketData;
    const perms = this.readPermissions(client);

    void client.join(REALTIME_ROOMS.user(data.userId));
    let joined = 1;
    for (const perm of perms) {
      if (perm.endsWith(':VIEW')) {
        void client.join(`perm:${perm}`);
        joined++;
      }
    }

    const delay = Math.min(Math.max(data.expiresAtMs - Date.now(), 0), MAX_TIMER_MS);
    const timer = setTimeout(() => {
      this.logger.log(
        `Ngắt socket ${client.id} do access token hết hạn (userId=${data.userId}, correlationId=${data.correlationId})`,
      );
      client.disconnect(true);
    }, delay);
    this.expiryTimers.set(client.id, timer);

    this.logger.log(
      `Socket connected id=${client.id} userId=${data.userId} rooms=${joined} correlationId=${data.correlationId}`,
    );
  }

  handleDisconnect(client: Socket): void {
    this.clearExpiryTimer(client.id);
    const data = client.data as Partial<RealtimeSocketData>;
    this.logger.log(
      `Socket disconnected id=${client.id} userId=${data.userId ?? '-'} correlationId=${data.correlationId ?? '-'}`,
    );
  }

  beforeApplicationShutdown(signal?: string): void {
    const count = this.server?.sockets.sockets.size ?? 0;
    this.logger.log(`Đóng realtime gateway (signal=${signal ?? '-'}): ngắt ${count} socket`);
    for (const timer of this.expiryTimers.values()) clearTimeout(timer);
    this.expiryTimers.clear();
    this.server?.disconnectSockets(true);
  }

  /** Xác thực handshake. Ném lỗi nếu token thiếu/sai/hết hạn. Gán socket.data khi thành công. */
  private authenticate(socket: Socket): void {
    const token: unknown = socket.handshake.auth?.token;
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('thiếu token');
    }
    const payload = this.jwtService.verify<JwtPayload & { exp: number }>(token);
    const data: RealtimeSocketData = {
      userId: payload.sub,
      correlationId: this.readCorrelationId(socket),
      expiresAtMs: payload.exp * 1000,
    };
    Object.assign(socket.data as Record<string, unknown>, data, {
      permissions: payload.permissions ?? [],
    });
  }

  /** Correlation ID do client gửi (nếu hợp lệ) hoặc tự sinh - dùng nối log với request REST. */
  private readCorrelationId(socket: Socket): string {
    const raw: unknown = socket.handshake.auth?.correlationId;
    if (typeof raw === 'string' && raw.length > 0 && raw.length <= MAX_CORRELATION_ID_LENGTH) {
      return raw;
    }
    return randomUUID();
  }

  private readPermissions(client: Socket): string[] {
    const perms: unknown = (client.data as { permissions?: unknown }).permissions;
    return Array.isArray(perms) ? perms.filter((p): p is string => typeof p === 'string') : [];
  }

  private clearExpiryTimer(socketId: string): void {
    const timer = this.expiryTimers.get(socketId);
    if (timer) {
      clearTimeout(timer);
      this.expiryTimers.delete(socketId);
    }
  }
}
