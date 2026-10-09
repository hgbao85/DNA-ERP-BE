import { RealtimeService } from './realtime.service';
import { RealtimeGateway } from './realtime.gateway';
import { ClsService } from 'nestjs-cls';

type EmittedEnvelope = {
  eventId: string;
  name: string;
  correlationId: string | null;
  payload: Record<string, unknown>;
};

describe('RealtimeService', () => {
  let emit: jest.Mock<void, [string, EmittedEnvelope]>;
  let to: jest.Mock<{ emit: typeof emit }, [string[]]>;
  let server: { to: typeof to };
  let gateway: { server: unknown };
  let cls: { getId: jest.Mock<string | undefined, []> };
  let service: RealtimeService;

  beforeEach(() => {
    emit = jest.fn<void, [string, EmittedEnvelope]>();
    to = jest.fn<{ emit: typeof emit }, [string[]]>(() => ({ emit }));
    server = { to };
    gateway = { server };
    cls = { getId: jest.fn<string | undefined, []>(() => 'corr-123') };
    service = new RealtimeService(
      gateway as unknown as RealtimeGateway,
      cls as unknown as ClsService,
    );
  });

  it('thông báo cá nhân: gửi tới đúng room user:<id> của từng người nhận, kèm envelope', () => {
    service.publishNotificationCreated(['u1', 'u2'], {
      notificationId: 'n-1',
      type: 'WAREHOUSE_TRANSFER_CREATED',
      category: 'ACTION_REQUIRED',
      severity: 'WARNING',
      title: 'Phiếu mới',
      message: 'msg',
      link: null,
      entityType: null,
      entityId: null,
      merged: false,
      createdAt: '2026-10-07T00:00:00.000Z',
    });

    expect(to).toHaveBeenCalledWith(['user:u1', 'user:u2']);
    const [name, envelope] = emit.mock.calls[0];
    expect(name).toBe('notification.created');
    expect(envelope.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(envelope).toMatchObject({
      name: 'notification.created',
      correlationId: 'corr-123',
      payload: { notificationId: 'n-1' },
    });
  });

  it('sự kiện nghiệp vụ: gửi tới room VIEW của mọi module khai trong route, payload chỉ có ID + topic', () => {
    service.publishEntityChanged({
      entity: 'WAREHOUSE_TRANSFER',
      entityId: 42n,
      action: 'CONFIRMED',
      actorId: 'u9',
    });

    expect(to).toHaveBeenCalledWith(['perm:WAREHOUSE_TRANSFER:VIEW', 'perm:STOCK:VIEW']);
    const envelope = emit.mock.calls[0][1];
    expect(emit.mock.calls[0][0]).toBe('entity.changed');
    expect(envelope.payload).toEqual({
      entity: 'WAREHOUSE_TRANSFER',
      entityId: '42',
      action: 'CONFIRMED',
      topics: ['warehouse-transfers', 'stock'],
    });
    // Không đưa object nghiệp vụ đầy đủ qua socket, và không lộ người thao tác.
    expect(Object.keys(envelope.payload)).not.toContain('items');
    expect(Object.keys(envelope.payload)).not.toContain('actorId');
  });

  it('không có server (script/test không mở cổng) -> no-op, không ném lỗi', () => {
    gateway.server = undefined;
    expect(() =>
      service.publishEntityChanged({
        entity: 'PURCHASE_PROPOSAL',
        entityId: 1n,
        action: 'APPROVED',
        actorId: null,
      }),
    ).not.toThrow();
    expect(to).not.toHaveBeenCalled();
  });

  it('lỗi khi phát -> chỉ log, KHÔNG ném ra ngoài (không làm hỏng request đã commit)', () => {
    to.mockImplementation(() => {
      throw new Error('socket down');
    });
    expect(() =>
      service.publishNotificationCreated(['u1'], {
        notificationId: 'n',
        type: null,
        category: 'ANNOUNCEMENT',
        severity: 'INFO',
        title: 't',
        message: 'm',
        link: null,
        entityType: null,
        entityId: null,
        merged: false,
        createdAt: new Date().toISOString(),
      }),
    ).not.toThrow();
  });

  it('không có người nhận -> không phát gì', () => {
    service.publishNotificationCreated([], {
      notificationId: 'n',
      type: null,
      category: 'ANNOUNCEMENT',
      severity: 'INFO',
      title: 't',
      message: 'm',
      link: null,
      entityType: null,
      entityId: null,
      merged: false,
      createdAt: new Date().toISOString(),
    });
    expect(to).not.toHaveBeenCalled();
  });

  it('không có request context (cls.getId ném lỗi) -> correlationId null, vẫn phát được', () => {
    cls.getId.mockImplementation(() => {
      throw new Error('no context');
    });
    service.publishEntityChanged({
      entity: 'QC_REVIEW',
      entityId: 5,
      action: 'QC_RECORDED',
      actorId: null,
    });
    expect(emit.mock.calls[0][1].correlationId).toBeNull();
  });
});
