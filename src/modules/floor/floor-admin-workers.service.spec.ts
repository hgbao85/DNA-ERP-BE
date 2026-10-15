import { PrismaServiceType } from '../../prisma/prisma.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { FloorAdminService } from './floor-admin.service';

/** Tài khoản công nhân: QLSX KHÔNG đặt/biết PIN - công nhân tự đặt ở lần đăng nhập đầu (AuthService.pinSetup). */
describe('FloorAdminService - tài khoản công nhân', () => {
  let tx: { user: { update: jest.Mock }; refreshToken: { updateMany: jest.Mock } };
  let prisma: {
    role: { findUnique: jest.Mock };
    user: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let service: FloorAdminService;

  const row = (o: Record<string, unknown> = {}) => ({
    id: 'u1',
    username: 'phoi.a',
    firstName: 'An',
    lastName: 'Nguyễn',
    mfgRole: 'PHOI',
    isActive: true,
    createdAt: new Date(),
    pinPending: false,
    pinClaimExpiresAt: null,
    pinSetAt: new Date(),
    lockedUntil: null,
    ...o,
  });

  beforeEach(() => {
    tx = {
      user: { update: jest.fn().mockResolvedValue(row()) },
      refreshToken: { updateMany: jest.fn() },
    };
    prisma = {
      role: { findUnique: jest.fn().mockResolvedValue({ id: 'role-fw' }) },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue({ id: 'u1' }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn((a: { data: Record<string, unknown> }) =>
          Promise.resolve(row({ ...a.data, id: 'u2', pinSetAt: null })),
        ),
        update: jest.fn().mockResolvedValue(row()),
      },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    service = new FloorAdminService(
      prisma as unknown as PrismaServiceType,
      {} as SteelIssuesService,
      {} as ProductionBatchesService,
    );
  });

  it('tạo công nhân: không có PIN, chờ công nhân tự đặt (hạn 72 giờ), mật khẩu là hash ngẫu nhiên', async () => {
    const w = await service.createWorker({
      username: 'Phoi.B',
      firstName: 'Bình',
      lastName: 'Trần',
      stage: 'PHOI',
    });

    const data = (
      (prisma.user.create.mock.calls as unknown[][])[0][0] as { data: Record<string, unknown> }
    ).data;
    expect(data.username).toBe('phoi.b');
    expect(data.email).toBeNull();
    expect(data.pinPending).toBe(true);
    const hours = ((data.pinClaimExpiresAt as Date).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(71.9);
    expect(String(data.password)).toMatch(/^\$argon2/);
    expect(w.pinState).toBe('PENDING');
  });

  it('"Cho đặt lại PIN": về trạng thái chờ đặt PIN, mở khoá, đăng xuất mọi máy', async () => {
    tx.user.update.mockResolvedValue(
      row({ pinPending: true, pinClaimExpiresAt: new Date(Date.now() + 3_600_000) }),
    );

    const w = await service.resetWorkerPin('u1');

    const data = (
      (tx.user.update.mock.calls as unknown[][])[0][0] as { data: Record<string, unknown> }
    ).data;
    expect(data).toEqual(
      expect.objectContaining({ pinPending: true, failedLoginCount: 0, lockedUntil: null }),
    );
    expect(String(data.password)).toMatch(/^\$argon2/);
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }),
    );
    expect(w.pinState).toBe('PENDING');
  });

  it('mở khoá sớm: xoá bộ đếm sai + thời hạn khoá', async () => {
    await service.unlockWorker('u1');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { failedLoginCount: 0, lockedUntil: null } }),
    );
  });

  it('trạng thái PIN trong danh sách: SET / PENDING / EXPIRED; lockedUntil quá khứ coi như không khoá', async () => {
    prisma.user.findMany.mockResolvedValue([
      row({ id: 'a' }),
      row({ id: 'b', pinPending: true, pinClaimExpiresAt: new Date(Date.now() + 3_600_000) }),
      row({ id: 'c', pinPending: true, pinClaimExpiresAt: new Date(Date.now() - 1000) }),
      row({ id: 'd', lockedUntil: new Date(Date.now() + 600_000) }),
      row({ id: 'e', lockedUntil: new Date(Date.now() - 600_000) }),
    ]);

    const list = await service.listWorkers();

    expect(list.map((w) => w.pinState)).toEqual(['SET', 'PENDING', 'EXPIRED', 'SET', 'SET']);
    prisma.user.findMany.mockResolvedValue([row({ pinSetAt: null })]);
    expect((await service.listWorkers())[0].pinState).toBe('ADMIN_SET'); // tài khoản cũ, PIN do QLSX đặt
    expect(list[3].lockedUntil).not.toBeNull();
    expect(list[4].lockedUntil).toBeNull();
  });
});
