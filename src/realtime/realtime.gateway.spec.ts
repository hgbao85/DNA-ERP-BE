import { JwtService } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';

const SECRET = 'realtime-test-secret';

type Middleware = (socket: FakeSocket, next: (err?: Error) => void) => void;

interface FakeSocket {
  id: string;
  handshake: { auth: Record<string, unknown> };
  data: Record<string, unknown>;
  join: jest.Mock<unknown, [string]>;
  disconnect: jest.Mock<unknown, [boolean?]>;
}

function makeSocket(auth: Record<string, unknown>, id = 'sock-1'): FakeSocket {
  return {
    id,
    handshake: { auth },
    data: {},
    join: jest.fn<unknown, [string]>(),
    disconnect: jest.fn<unknown, [boolean?]>(),
  };
}

describe('RealtimeGateway', () => {
  let jwt: JwtService;
  let gateway: RealtimeGateway;
  let middleware: Middleware;
  let server: {
    use: jest.Mock;
    sockets: { sockets: Map<string, unknown> };
    disconnectSockets: jest.Mock;
  };

  const signToken = (overrides: Record<string, unknown> = {}, expiresIn: string | number = '15m') =>
    jwt.sign(
      {
        sub: 'user-1',
        username: 'u1',
        email: 'u1@x.io',
        roles: ['WAREHOUSE_STAFF'],
        permissions: ['WAREHOUSE_TRANSFER:VIEW', 'WAREHOUSE_TRANSFER:CREATE', 'STOCK:VIEW'],
        mfgRole: null,
        warehouseScope: null,
        ...overrides,
      },
      { expiresIn },
    );

  beforeEach(() => {
    jest.useFakeTimers();
    jwt = new JwtService({ secret: SECRET });
    gateway = new RealtimeGateway(jwt);
    server = {
      use: jest.fn((fn: Middleware) => {
        middleware = fn;
      }),
      sockets: { sockets: new Map() },
      disconnectSockets: jest.fn(),
    };
    gateway.server = server as never;
    gateway.afterInit(server as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('xác thực handshake', () => {
    it('cho qua khi access token hợp lệ và gắn userId vào socket.data', () => {
      const socket = makeSocket({ token: signToken() });
      const next = jest.fn<void, [Error?]>();
      middleware(socket, next);
      expect(next).toHaveBeenCalledWith();
      expect(socket.data).toMatchObject({ userId: 'user-1' });
      expect(socket.data.permissions).toContain('WAREHOUSE_TRANSFER:VIEW');
    });

    it('từ chối khi thiếu token, KHÔNG lộ lý do chi tiết ra client', () => {
      const next = jest.fn<void, [Error?]>();
      middleware(makeSocket({}), next);
      const err = next.mock.calls[0][0] as Error;
      expect(err.message).toBe('UNAUTHORIZED');
    });

    it('từ chối token ký sai secret', () => {
      const forged = new JwtService({ secret: 'attacker' }).sign({
        sub: 'admin',
        permissions: ['STOCK:VIEW'],
      });
      const next = jest.fn<void, [Error?]>();
      middleware(makeSocket({ token: forged }), next);
      expect((next.mock.calls[0][0] as Error).message).toBe('UNAUTHORIZED');
    });

    it('từ chối token đã hết hạn', () => {
      const expired = jwt.sign({ sub: 'user-1', permissions: [] }, { expiresIn: -10 });
      const next = jest.fn<void, [Error?]>();
      middleware(makeSocket({ token: expired }), next);
      expect((next.mock.calls[0][0] as Error).message).toBe('UNAUTHORIZED');
    });

    it('thay correlationId quá dài/không hợp lệ bằng UUID do server sinh', () => {
      const socket = makeSocket({ token: signToken(), correlationId: 'x'.repeat(200) });
      middleware(socket, jest.fn<void, [Error?]>());
      expect((socket.data as { correlationId: string }).correlationId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('giữ correlationId hợp lệ do client gửi để nối log với request REST', () => {
      const socket = makeSocket({ token: signToken(), correlationId: 'req-abc-123' });
      middleware(socket, jest.fn<void, [Error?]>());
      expect((socket.data as { correlationId: string }).correlationId).toBe('req-abc-123');
    });
  });

  describe('room theo quyền', () => {
    it('join room user:<id> và chỉ các quyền VIEW dưới dạng perm:<MODULE>:VIEW', () => {
      const socket = makeSocket({ token: signToken() });
      middleware(socket, jest.fn<void, [Error?]>());
      gateway.handleConnection(socket as never);

      const rooms = socket.join.mock.calls.map((c) => c[0]);
      expect(rooms).toEqual(
        expect.arrayContaining(['user:user-1', 'perm:WAREHOUSE_TRANSFER:VIEW', 'perm:STOCK:VIEW']),
      );
      // CREATE không mở kênh realtime - chỉ xem mới cần làm mới dữ liệu.
      expect(rooms).not.toContain('perm:WAREHOUSE_TRANSFER:CREATE');
    });
  });

  describe('hết hạn token', () => {
    it('ngắt socket đúng lúc access token hết hạn', () => {
      const socket = makeSocket({ token: signToken({}, 60) });
      middleware(socket, jest.fn<void, [Error?]>());
      gateway.handleConnection(socket as never);

      jest.advanceTimersByTime(59_000);
      expect(socket.disconnect).not.toHaveBeenCalled();
      jest.advanceTimersByTime(2_000);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('hủy timer khi client tự ngắt trước hạn (không rò timer)', () => {
      const socket = makeSocket({ token: signToken({}, 60) });
      middleware(socket, jest.fn<void, [Error?]>());
      gateway.handleConnection(socket as never);
      gateway.handleDisconnect(socket as never);

      jest.advanceTimersByTime(120_000);
      expect(socket.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    it('ngắt mọi socket trước khi HTTP server đóng', () => {
      gateway.beforeApplicationShutdown('SIGTERM');
      expect(server.disconnectSockets).toHaveBeenCalledWith(true);
    });
  });
});
