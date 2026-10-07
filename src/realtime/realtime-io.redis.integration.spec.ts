import { AddressInfo } from 'net';
import { io as connect, Socket as ClientSocket } from 'socket.io-client';
import { Server } from 'socket.io';
import { RealtimeIoAdapter } from './realtime-io.adapter';

/**
 * Kiểm chứng THẬT việc event lan truyền giữa 2 instance qua Redis. Chỉ chạy khi có REDIS_TEST_URL
 * (ví dụ redis://localhost:6390). Bỏ qua trong CI không có Redis.
 */
const REDIS_TEST_URL = process.env.REDIS_TEST_URL ?? '';
const describeIfRedis = REDIS_TEST_URL ? describe : describe.skip;

const portOf = (server: Server): number => {
  const http = (server as unknown as { httpServer: { address(): AddressInfo } }).httpServer;
  return http.address().port;
};

const once = <T>(socket: ClientSocket, event: string): Promise<T> =>
  new Promise((resolve) => socket.once(event, (payload: T) => resolve(payload)));

describeIfRedis('RealtimeIoAdapter + Redis - 2 instance', () => {
  it('event phát từ instance A tới socket đang nối vào instance B', async () => {
    const adapterA = new RealtimeIoAdapter(undefined as never, true, REDIS_TEST_URL);
    const adapterB = new RealtimeIoAdapter(undefined as never, true, REDIS_TEST_URL);
    const serverA = adapterA.createIOServer(0);
    const serverB = adapterB.createIOServer(0);

    serverB.on('connection', (socket) => {
      void socket.join('perm:WAREHOUSE_TRANSFER:VIEW');
    });

    const client = connect(`http://localhost:${portOf(serverB)}`, { transports: ['websocket'] });
    await once(client, 'connect');
    // Chờ instance B hoàn tất join room trước khi A phát
    await new Promise((r) => setTimeout(r, 300));

    const received = once<{ eventId: string }>(client, 'entity.changed');
    serverA.to('perm:WAREHOUSE_TRANSFER:VIEW').emit('entity.changed', { eventId: 'cross-1' });

    await expect(received).resolves.toEqual({ eventId: 'cross-1' });

    client.close();
    await adapterA.close(serverA as never);
    await adapterB.close(serverB as never);
  }, 15000);
});
