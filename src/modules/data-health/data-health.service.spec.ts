import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { DataHealthCheck, ROW_LIMIT } from './data-health.checks';
import { DataHealthService, toDetail } from './data-health.service';

const check = (code: string): DataHealthCheck => ({
  code,
  title: `Phép ${code}`,
  severity: 'HIGH',
  description: 'mô tả',
  hint: 'gợi ý',
  columns: [{ key: 'vat_tu', label: 'Vật tư' }],
  sql: Prisma.sql`SELECT 1`,
});

describe('DataHealthService', () => {
  const RUN_AT = new Date('2026-10-28T18:00:00.000Z');
  let prisma: {
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
    dataHealthRun: { create: jest.Mock; update: jest.Mock; findFirst: jest.Mock };
    dataHealthFinding: {
      findMany: jest.Mock;
      count: jest.Mock;
      createMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    notification: { findFirst: jest.Mock };
  };
  /** Câu khoá advisory của run() - đi qua tx riêng, không lẫn với $queryRaw của các phép kiểm. */
  let lockQuery: jest.Mock;
  let notifications: { emit: jest.Mock; resolve: jest.Mock };
  let service: DataHealthService;

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(),
      dataHealthRun: {
        create: jest.fn().mockResolvedValue({ id: 1n, startedAt: RUN_AT }),
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      dataHealthFinding: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        createMany: jest
          .fn()
          .mockImplementation(({ data }: { data: unknown[] }) =>
            Promise.resolve({ count: data.length }),
          ),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      notification: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    lockQuery = jest.fn().mockResolvedValue([{ locked: true }]);
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn({ ...prisma, $queryRaw: lockQuery }),
    );
    notifications = {
      emit: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue(undefined),
    };
    service = new DataHealthService(prisma as never, notifications as never);
    service.checks = [check('A')];
  });

  it('dòng chưa từng thấy -> tạo phát hiện mới, báo Admin 1 thông báo/ngày kèm số dòng mới', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      { entity_key: 'mat:1', vat_tu: 'VTK-009' },
      { entity_key: 'mat:2', vat_tu: 'VTK-010' },
    ]);
    prisma.dataHealthFinding.count.mockResolvedValue(2);

    await service.run('CRON');

    expect(prisma.dataHealthFinding.createMany).toHaveBeenCalledWith({
      data: [
        {
          checkCode: 'A',
          entityKey: 'mat:1',
          detail: { vat_tu: 'VTK-009' },
          firstSeenAt: RUN_AT,
          lastSeenAt: RUN_AT,
        },
        {
          checkCode: 'A',
          entityKey: 'mat:2',
          detail: { vat_tu: 'VTK-010' },
          firstSeenAt: RUN_AT,
          lastSeenAt: RUN_AT,
        },
      ],
      skipDuplicates: true,
    });
    expect(prisma.dataHealthRun.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: expect.objectContaining({ summary: { A: 2 }, error: null }) as unknown,
    });
    expect(notifications.emit).toHaveBeenCalledWith('DATA_HEALTH_NEW_FINDINGS', {
      entityId: 'open',
      // RUN_AT 18:00 UTC 28/10 = 01:00 giờ VN 29/10 -> gộp theo ngày VN.
      dedupeKey: 'DATA_HEALTH_NEW_FINDINGS:2026-10-29',
      actorId: null,
      params: {
        newCount: 2,
        totalOpen: 2,
        breakdown: 'Phép A: 2',
        byCheck: { 'Phép A': 2 },
        failedCount: 0,
        failed: '',
      },
    });
    // Lần chạy giữ khoá advisory riêng của "Kiểm tra dữ liệu" (mọi tiến trình).
    expect(lockQuery).toHaveBeenCalledTimes(1);
  });

  it('tiến trình khác đang kiểm (không lấy được khoá) -> 409, không tạo lần chạy', async () => {
    lockQuery.mockResolvedValue([{ locked: false }]);
    await expect(service.run('MANUAL', 'admin-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.dataHealthRun.create).not.toHaveBeenCalled();
  });

  it('cùng ngày đã có thông báo đang mở -> CỘNG DỒN số mới, không ghi đè', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ entity_key: 'mat:3', vat_tu: 'VTK-011' }]);
    prisma.dataHealthFinding.count.mockResolvedValue(11);
    prisma.notification.findFirst.mockResolvedValue({ data: { byCheck: { 'Phép A': 10 } } });

    await service.run('CRON');

    expect(prisma.notification.findFirst).toHaveBeenCalledWith({
      where: {
        dedupeKey: 'DATA_HEALTH_NEW_FINDINGS:2026-10-29',
        recipients: { some: { resolvedAt: null } },
      },
      select: { id: true, data: true },
    });
    expect(notifications.emit).toHaveBeenCalledWith(
      'DATA_HEALTH_NEW_FINDINGS',
      expect.objectContaining({
        params: expect.objectContaining({ newCount: 11, breakdown: 'Phép A: 11' }) as unknown,
      }),
    );
  });

  it('ghi phát hiện lỗi -> chỉ phép kiểm đó -1, phép khác vẫn chạy, lần chạy vẫn xong và báo Admin phép lỗi', async () => {
    service.checks = [check('A'), check('B')];
    prisma.$queryRaw
      .mockResolvedValueOnce([{ entity_key: 'mat:1', vat_tu: 'X' }])
      .mockResolvedValueOnce([{ entity_key: 'mat:2', vat_tu: 'Y' }]);
    prisma.dataHealthFinding.createMany.mockRejectedValueOnce(
      new Error('Transaction already closed'),
    );
    prisma.dataHealthFinding.count.mockResolvedValue(1);

    await service.run('CRON');

    expect(prisma.dataHealthRun.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: expect.objectContaining({
        finishedAt: expect.any(Date) as unknown,
        summary: { A: -1, B: 1 },
        error: 'A: ghi phát hiện - Transaction already closed',
      }) as unknown,
    });
    expect(notifications.emit).toHaveBeenCalledWith(
      'DATA_HEALTH_NEW_FINDINGS',
      expect.objectContaining({
        params: expect.objectContaining({
          newCount: 1,
          failedCount: 1,
          failed: 'Phép A',
        }) as unknown,
      }),
    );
  });

  it('phép kiểm lỗi mà không còn dòng mở nào -> vẫn báo lỗi, không đóng thông báo', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('timeout'));
    prisma.dataHealthFinding.count.mockResolvedValue(0);

    await service.run('CRON');

    expect(notifications.resolve).not.toHaveBeenCalled();
    expect(notifications.emit).toHaveBeenCalledWith(
      'DATA_HEALTH_NEW_FINDINGS',
      expect.objectContaining({
        params: expect.objectContaining({ newCount: 0, failedCount: 1 }) as unknown,
      }),
    );
  });

  it('lỗi ngoài phép kiểm (ghi kết thúc lần chạy hỏng) -> ghi lý do, KHÔNG đặt finishedAt để việc hằng ngày chạy lại', async () => {
    prisma.dataHealthRun.update
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce({});

    await expect(service.run('CRON')).rejects.toThrow('connection lost');

    expect(prisma.dataHealthRun.update).toHaveBeenLastCalledWith({
      where: { id: 1n },
      data: { summary: { A: 0 }, error: 'Dừng giữa chừng: connection lost' },
    });
    expect(notifications.emit).not.toHaveBeenCalled();
  });

  it('dừng giữa chừng SAU khi đã ghi dòng mới -> vẫn báo Admin ngay (lần chạy lại sẽ coi là dòng cũ)', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ entity_key: 'mat:1', vat_tu: 'X' }]);
    prisma.dataHealthFinding.count.mockResolvedValue(1);
    prisma.dataHealthRun.update
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce({});

    await expect(service.run('CRON')).rejects.toThrow('connection lost');

    expect(notifications.emit).toHaveBeenCalledWith(
      'DATA_HEALTH_NEW_FINDINGS',
      expect.objectContaining({ params: expect.objectContaining({ newCount: 1 }) as unknown }),
    );
  });

  it('chạm trần ROW_LIMIT -> không đóng dòng vắng (có thể chỉ bị đẩy ra ngoài 500 dòng)', async () => {
    prisma.$queryRaw.mockResolvedValueOnce(
      Array.from({ length: ROW_LIMIT }, (_, i) => ({ entity_key: `mat:${i + 100}`, vat_tu: 'X' })),
    );
    prisma.dataHealthFinding.findMany.mockResolvedValueOnce([
      { id: 7n, entityKey: 'mat:1', resolvedAt: null },
    ]);
    prisma.dataHealthFinding.count.mockResolvedValue(ROW_LIMIT + 1);

    await service.run('CRON');

    expect(prisma.dataHealthFinding.updateMany).not.toHaveBeenCalled();
    // Phép kiểm vốn đã có dòng mở: khoá mới lọt vào cửa sổ vẫn lưu nhưng không tính "mới" -> không báo giả (vòng 2, R2-1).
    expect(prisma.dataHealthFinding.createMany).toHaveBeenCalled();
    expect(notifications.emit).not.toHaveBeenCalled();
  });

  it('LẦN ĐẦU chạm trần (chưa có dòng mở nào) -> vẫn tính đủ dòng mới và báo Admin', async () => {
    prisma.$queryRaw.mockResolvedValueOnce(
      Array.from({ length: ROW_LIMIT }, (_, i) => ({ entity_key: `mat:${i + 100}`, vat_tu: 'X' })),
    );
    prisma.dataHealthFinding.count.mockResolvedValue(ROW_LIMIT);

    await service.run('CRON');

    expect(notifications.emit).toHaveBeenCalledWith(
      'DATA_HEALTH_NEW_FINDINGS',
      expect.objectContaining({
        params: expect.objectContaining({ newCount: ROW_LIMIT }) as unknown,
      }),
    );
  });

  it('phép kiểm đã hết lỗi, không dòng mới -> sửa nội dung thông báo đang mở, KHÔNG gửi lại (không bật "chưa đọc")', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ entity_key: 'mat:1', vat_tu: 'X' }]);
    prisma.dataHealthFinding.findMany.mockResolvedValueOnce([
      { id: 7n, entityKey: 'mat:1', resolvedAt: null },
    ]);
    prisma.dataHealthFinding.count.mockResolvedValue(1);
    prisma.notification.findFirst.mockResolvedValue({
      id: 'n1',
      data: { byCheck: { 'Phép A': 1 }, failedCount: 1, failed: 'Phép B' },
    });
    const update = jest.fn().mockResolvedValue({});
    (prisma as unknown as { notification: { update: jest.Mock } }).notification.update = update;

    await service.run('CRON');

    expect(notifications.emit).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: expect.objectContaining({ title: 'Kiểm tra dữ liệu: 1 bất thường mới' }) as unknown,
    });
  });

  it('vẫn lỗi y như thông báo đang mở, không dòng mới -> không gửi lại', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('timeout'));
    prisma.dataHealthFinding.count.mockResolvedValue(0);
    prisma.notification.findFirst.mockResolvedValue({
      id: 'n1',
      data: { byCheck: {}, failedCount: 1, failed: 'Phép A' },
    });

    await service.run('MANUAL', 'admin-1');

    expect(notifications.emit).not.toHaveBeenCalled();
  });

  it('lỗi lưu cho Admin chỉ giữ dòng lý do cuối, bỏ đường dẫn máy chủ / trích đoạn code của Prisma', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(
      new Error(
        'Invalid `prisma.x()` invocation in\nD:\\DNA-ERP-BE\\dist\\x.js:149:48\n\n→ 149 await x()\nRaw query failed. Code: `42703`',
      ),
    );

    await service.run('CRON');

    expect(prisma.dataHealthRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          error: 'A: chạy SQL - Raw query failed. Code: `42703`',
        }) as unknown,
      }),
    );
  });

  it('dòng đang mở vẫn còn -> chỉ cập nhật lần cuối thấy, KHÔNG tính là mới, không báo lại', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ entity_key: 'mat:1', vat_tu: 'VTK-009' }]);
    prisma.dataHealthFinding.findMany.mockResolvedValueOnce([
      { id: 7n, entityKey: 'mat:1', resolvedAt: null },
    ]);
    prisma.dataHealthFinding.count.mockResolvedValue(1);

    await service.run('MANUAL', 'admin-1');

    expect(prisma.dataHealthFinding.update).toHaveBeenCalledWith({
      where: { id: 7n },
      data: { detail: { vat_tu: 'VTK-009' }, lastSeenAt: RUN_AT },
    });
    expect(prisma.dataHealthFinding.createMany).not.toHaveBeenCalled();
    expect(notifications.emit).not.toHaveBeenCalled();
  });

  it('dòng đã hết rồi lại thấy -> mở lại và tính là mới', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ entity_key: 'mat:1', vat_tu: 'VTK-009' }]);
    prisma.dataHealthFinding.findMany.mockResolvedValueOnce([
      { id: 7n, entityKey: 'mat:1', resolvedAt: new Date('2026-10-20') },
    ]);
    prisma.dataHealthFinding.count.mockResolvedValue(1);

    await service.run('CRON');

    expect(prisma.dataHealthFinding.update).toHaveBeenCalledWith({
      where: { id: 7n },
      data: {
        detail: { vat_tu: 'VTK-009' },
        firstSeenAt: RUN_AT,
        lastSeenAt: RUN_AT,
        resolvedAt: null,
      },
    });
    expect(notifications.emit).toHaveBeenCalledWith(
      'DATA_HEALTH_NEW_FINDINGS',
      expect.objectContaining({ params: expect.objectContaining({ newCount: 1 }) as unknown }),
    );
  });

  it('dòng đang mở không còn thấy -> đánh dấu đã hết; hết sạch thì đóng thông báo đang mở', async () => {
    prisma.dataHealthFinding.findMany.mockResolvedValueOnce([
      { id: 7n, entityKey: 'mat:1', resolvedAt: null },
    ]);
    prisma.dataHealthFinding.count.mockResolvedValue(0);

    await service.run('CRON');

    expect(prisma.dataHealthFinding.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [7n] } },
      data: { resolvedAt: RUN_AT },
    });
    expect(notifications.resolve).toHaveBeenCalledWith({
      entityType: 'DATA_HEALTH',
      entityId: 'open',
    });
    expect(notifications.emit).not.toHaveBeenCalled();
  });

  it('phép kiểm lỗi SQL -> ghi -1 + lý do, KHÔNG đóng phát hiện cũ của nó, các phép khác vẫn chạy', async () => {
    service.checks = [check('A'), check('B')];
    prisma.$queryRaw
      .mockRejectedValueOnce(new Error('column "x" does not exist'))
      .mockResolvedValueOnce([{ entity_key: 'mat:9', vat_tu: 'SAT-1' }]);
    prisma.dataHealthFinding.count.mockResolvedValue(3);

    await service.run('CRON');

    // 1 transaction giữ khoá + chỉ 1 transaction đồng bộ (của B) - A lỗi nên không đụng phát hiện của A.
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.dataHealthFinding.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { checkCode: 'B' } }),
    );
    expect(prisma.dataHealthRun.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: expect.objectContaining({
        summary: { A: -1, B: 1 },
        error: 'A: chạy SQL - column "x" does not exist',
      }) as unknown,
    });
  });

  it('đang chạy dở mà bấm lại -> 409, không chạy chồng', async () => {
    let release: () => void = () => undefined;
    prisma.$queryRaw.mockReturnValueOnce(new Promise((r) => (release = () => r([]))));
    const first = service.run('MANUAL');
    await Promise.resolve();
    await expect(service.run('MANUAL')).rejects.toBeInstanceOf(ConflictException);
    release();
    await first;
  });

  it('getReport lấy lần ĐÃ XONG gần nhất; lần mới hơn chưa xong trả riêng ở pendingRun', async () => {
    prisma.dataHealthRun.findFirst
      .mockResolvedValueOnce({
        id: 1n,
        trigger: 'CRON',
        startedAt: RUN_AT,
        finishedAt: RUN_AT,
        summary: { A: 3 },
        error: null,
      })
      .mockResolvedValueOnce({
        id: 2n,
        trigger: 'MANUAL',
        startedAt: new Date('2026-10-28T19:00:00.000Z'),
        finishedAt: null,
        summary: null,
        error: 'Dừng giữa chừng: connection lost',
      });

    const report = await service.getReport();

    expect(prisma.dataHealthRun.findFirst).toHaveBeenNthCalledWith(1, {
      where: { finishedAt: { not: null } },
      orderBy: { startedAt: 'desc' },
    });
    expect(prisma.dataHealthRun.findFirst).toHaveBeenNthCalledWith(2, {
      where: { finishedAt: null, startedAt: { gt: RUN_AT } },
      orderBy: { startedAt: 'desc' },
    });
    expect(report.lastRun).toEqual(expect.objectContaining({ id: '1' }));
    expect(report.pendingRun).toEqual(
      expect.objectContaining({ id: '2', error: 'Dừng giữa chừng: connection lost' }),
    );
    expect(report.checks[0].lastCount).toBe(3);
  });

  it('getReport: lần chưa xong không lý do mà quá thời hạn chạy -> coi như dừng giữa chừng (tiến trình đã chết)', async () => {
    const started = new Date('2026-10-28T19:00:00.000Z');
    prisma.dataHealthRun.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 2n,
      trigger: 'MANUAL',
      startedAt: started,
      finishedAt: null,
      summary: null,
      error: null,
    });

    const fresh = await service.getReport(new Date(started.getTime() + 60_000));
    expect(fresh.pendingRun?.error).toBeNull();

    prisma.dataHealthRun.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 2n,
      trigger: 'MANUAL',
      startedAt: started,
      finishedAt: null,
      summary: null,
      error: null,
    });
    const stale = await service.getReport(new Date(started.getTime() + 11 * 60_000));
    expect(stale.pendingRun?.error).toContain('Không thấy lần kiểm kết thúc');
  });

  it('getReport đánh dấu "mới" theo lần chạy gần nhất và trả số dòng/trần của từng phép kiểm', async () => {
    prisma.dataHealthRun.findFirst
      .mockResolvedValueOnce({
        id: 1n,
        trigger: 'CRON',
        startedAt: RUN_AT,
        finishedAt: RUN_AT,
        summary: { A: 2 },
        error: null,
      })
      .mockResolvedValueOnce(null);
    prisma.dataHealthFinding.findMany.mockResolvedValue([
      {
        id: 5n,
        checkCode: 'A',
        entityKey: 'mat:1',
        detail: { vat_tu: 'X' },
        firstSeenAt: RUN_AT,
        lastSeenAt: RUN_AT,
      },
      {
        id: 6n,
        checkCode: 'A',
        entityKey: 'mat:2',
        detail: { vat_tu: 'Y' },
        firstSeenAt: new Date('2026-10-01'),
        lastSeenAt: RUN_AT,
      },
    ]);

    const report = await service.getReport();

    expect(report.totalOpen).toBe(2);
    expect(report.newCount).toBe(1);
    expect(report.lastRun).toEqual(expect.objectContaining({ id: '1', trigger: 'CRON' }));
    expect(report.checks[0]).toEqual(
      expect.objectContaining({ code: 'A', lastCount: 2, truncated: false }),
    );
    expect(report.checks[0].findings.map((f) => [f.id, f.isNew])).toEqual([
      ['5', true],
      ['6', false],
    ]);
  });
});

describe('toDetail', () => {
  it('đổi kết quả $queryRaw sang JSON lưu được', () => {
    expect(
      toDetail({
        so: new Prisma.Decimal('12.5000'),
        id: 99n,
        ngay: new Date('2026-10-02T00:00:00.000Z'),
        ten: 'Sơn',
        trong: null,
      }),
    ).toEqual({ so: 12.5, id: '99', ngay: '2026-10-02', ten: 'Sơn', trong: null });
  });
});
