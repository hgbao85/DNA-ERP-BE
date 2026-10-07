import { IoAdapter } from '@nestjs/platform-socket.io';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { RealtimeIoAdapter } from './realtime-io.adapter';

jest.mock('ioredis', () => {
  const duplicate = jest.fn();
  const RedisMock = jest.fn().mockImplementation(() => {
    const client = { on: jest.fn(), quit: jest.fn().mockResolvedValue('OK'), duplicate };
    return client;
  });
  duplicate.mockImplementation(() => ({ on: jest.fn(), quit: jest.fn().mockResolvedValue('OK') }));
  return { __esModule: true, default: RedisMock };
});

jest.mock('@socket.io/redis-adapter', () => {
  // socket.io cần một class adapter (không phải chuỗi) khi gắn vào server.
  class RedisAdapterMock {}
  return { createAdapter: jest.fn(() => RedisAdapterMock) };
});

// socket.io lưu adapter đang gắn trong _adapter (private) - đọc để kiểm tra.
const serverAdapter = (server: Server): unknown =>
  (server as unknown as { _adapter: unknown })._adapter;
const RedisAdapterClass = (): unknown => (createAdapter as jest.Mock).mock.results[0]?.value;

describe('RealtimeIoAdapter', () => {
  // undefined = không gắn HTTP server (đường port 0 của IoAdapter); object giả sẽ bị coi là httpServer.
  const app = undefined as never;
  const servers: Server[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  it('không có REDIS_URL -> giữ adapter bộ nhớ (không tạo kết nối Redis)', () => {
    const adapter = new RealtimeIoAdapter(app, true, '');
    const server = adapter.createIOServer(0);
    servers.push(server);

    expect(Redis).not.toHaveBeenCalled();
    expect(createAdapter).not.toHaveBeenCalled();
    expect(serverAdapter(server)).not.toBe(RedisAdapterClass());
  });

  it('có REDIS_URL -> tạo pub/sub Redis và gắn Redis adapter cho server', () => {
    const adapter = new RealtimeIoAdapter(app, true, 'redis://localhost:6379');
    const server = adapter.createIOServer(0);
    servers.push(server);

    expect(Redis).toHaveBeenCalledWith('redis://localhost:6379', expect.any(Object));
    expect(createAdapter).toHaveBeenCalledTimes(1);
    expect(serverAdapter(server)).toBe(RedisAdapterClass());
  });

  it('CORS luôn áp cho Socket.IO theo cấu hình ứng dụng', () => {
    const baseSpy = jest.spyOn(IoAdapter.prototype, 'createIOServer');
    const adapter = new RealtimeIoAdapter(app, ['https://erp.example.com'], '');
    servers.push(adapter.createIOServer(0));

    expect(baseSpy.mock.calls[0][1]).toEqual(
      expect.objectContaining({ cors: { origin: ['https://erp.example.com'], credentials: true } }),
    );
    baseSpy.mockRestore();
  });
});
