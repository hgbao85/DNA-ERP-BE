import { ConflictException, NotFoundException } from '@nestjs/common';
import { BUSINESS_ROLES } from '../../common/constants/roles.constant';
import { MFG_FLOOR_WAREHOUSE_SCOPE } from '../../common/constants/role-permissions.constant';
import { Prisma } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { FloorAdminService } from './floor-admin.service';

/** Đối số đầu tiên của lần gọi đầu tiên của một jest.Mock - có kiểu rõ ràng để assert không phải dùng `any`. */
const firstCall = (mock: jest.Mock) =>
  (mock.mock.calls as unknown[][])[0][0] as { data: Record<string, unknown> };

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

  // ─── tạo công nhân: các nhánh còn lại ─────────────────────────────────────────

  const newWorker = {
    username: 'phoi.b',
    firstName: 'Bình',
    lastName: 'Trần',
    stage: 'PHOI' as const,
  };

  it('tạo: tổ của công nhân = mfgRole, gắn role FLOOR_WORKER + kho xưởng, họ tên được cắt khoảng trắng', async () => {
    await service.createWorker({
      ...newWorker,
      firstName: '  Bình ',
      lastName: ' Trần  ',
      stage: 'HAN',
    });

    const data = firstCall(prisma.user.create).data;
    expect(data).toMatchObject({
      mfgRole: 'HAN',
      warehouseScope: MFG_FLOOR_WAREHOUSE_SCOPE,
      firstName: 'Bình',
      lastName: 'Trần',
      roles: { create: { roleId: 'role-fw' } },
    });
    expect(prisma.role.findUnique).toHaveBeenCalledWith({
      where: { name: BUSINESS_ROLES.FLOOR_WORKER },
    });
  });

  it('tạo: chưa có role FLOOR_WORKER (chưa chạy seed) -> 409 nhắc chạy seed, không tạo tài khoản', async () => {
    prisma.role.findUnique.mockResolvedValue(null);
    await expect(service.createWorker(newWorker)).rejects.toThrow(/seed/);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('tạo: tên đăng nhập đã có (kể cả khác hoa/thường) -> 409, không tạo', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'x' });
    await expect(service.createWorker({ ...newWorker, username: 'PHOI.B' })).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { username: 'phoi.b' } });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('tạo: 2 QLSX cùng tạo 1 tên (trùng unique, P2002) -> 409 thay vì lỗi 500; lỗi khác ném lại nguyên văn', async () => {
    prisma.user.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
    );
    await expect(service.createWorker(newWorker)).rejects.toThrow(/đã có người dùng/);
    prisma.user.create.mockRejectedValueOnce(new Error('mất kết nối'));
    await expect(service.createWorker(newWorker)).rejects.toThrow('mất kết nối');
  });

  // ─── sửa công nhân: khoá / đổi tổ phải đăng xuất mọi máy ───────────────────────

  it.each([
    ['khoá tài khoản (isActive=false)', { isActive: false }, true],
    ['đổi tổ (token cũ còn mang tổ cũ)', { stage: 'HAN' as const }, true],
    ['mở khoá lại (isActive=true) không cần đăng xuất', { isActive: true }, false],
    ['chỉ sửa họ tên không đăng xuất ai', { firstName: ' Mới ', lastName: ' Tên ' }, false],
  ])('sửa: %s', async (_label, dto, revokes) => {
    await service.updateWorker('u1', dto);

    if (revokes) {
      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) as unknown },
      });
    } else {
      expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
    }
  });

  it('sửa: họ tên được cắt khoảng trắng, tổ ghi vào mfgRole, trường không gửi thì để nguyên (undefined)', async () => {
    await service.updateWorker('u1', { firstName: ' Mới ', stage: 'SON' });

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { firstName: 'Mới', lastName: undefined, mfgRole: 'SON', isActive: undefined },
      select: expect.anything() as unknown,
    });
  });

  // ─── ranh giới quyền: QLSX chỉ động được vào tài khoản CÔNG NHÂN ──────────────

  it.each([
    ['sửa', (s: FloorAdminService) => s.updateWorker('adm', { isActive: false })],
    ['đặt lại PIN', (s: FloorAdminService) => s.resetWorkerPin('adm')],
    ['mở khoá', (s: FloorAdminService) => s.unlockWorker('adm')],
  ])(
    '%s: id không phải công nhân (vd tài khoản admin) -> 404, không sửa gì',
    async (_label, call) => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(call(service)).rejects.toThrow(NotFoundException);

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'adm',
          deletedAt: null,
          roles: { some: { role: { name: BUSINESS_ROLES.FLOOR_WORKER } } },
        },
        select: { id: true },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
    },
  );
});
