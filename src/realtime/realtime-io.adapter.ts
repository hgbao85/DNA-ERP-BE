import { Logger, INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Server, ServerOptions } from 'socket.io';

/**
 * Socket.IO cho ứng dụng:
 * - CORS theo đúng cấu hình `cors.origin` của HTTP.
 * - Tuỳ chọn Redis adapter (`REDIS_URL`): khi có, event phát từ instance này tới được socket nối vào
 *   instance khác. Không có -> adapter bộ nhớ (1 instance, như trước).
 */
export class RealtimeIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RealtimeIoAdapter.name);
  private pubClient?: Redis;
  private subClient?: Redis;

  constructor(
    app: INestApplicationContext,
    private readonly corsOrigin: boolean | string[],
    private readonly redisUrl: string = '',
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.corsOrigin, credentials: true },
    }) as Server;

    if (this.redisUrl) {
      this.pubClient = new Redis(this.redisUrl, { lazyConnect: false, maxRetriesPerRequest: 3 });
      this.subClient = this.pubClient.duplicate();
      for (const client of [this.pubClient, this.subClient]) {
        client.on('error', (error: Error) => {
          this.logger.error(`Redis (realtime adapter) lỗi kết nối: ${error.message}`);
        });
      }
      server.adapter(createAdapter(this.pubClient, this.subClient));
      this.logger.log('Socket.IO dùng Redis adapter - event lan truyền giữa các instance');
    }
    return server;
  }

  /** Đóng socket rồi đóng kết nối Redis (nếu có) khi shutdown. */
  async close(server: Parameters<IoAdapter['close']>[0]): Promise<void> {
    await super.close(server);
    await Promise.all([this.pubClient?.quit(), this.subClient?.quit()]);
  }
}
