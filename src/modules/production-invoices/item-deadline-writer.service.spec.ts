import { BadRequestException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ItemDeadlineWriter } from './item-deadline-writer.service';

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('ItemDeadlineWriter (Phần A – Đợt 9)', () => {
  let writer: ItemDeadlineWriter;
  let prisma: { auditLog: { create: jest.Mock } };
  let notifications: { emit: jest.Mock };
  let tx: {
    productionInvoiceItem: { findMany: jest.Mock; update: jest.Mock };
    productionInvoiceItemStage: { upsert: jest.Mock };
    systemConfig: { findUniqueOrThrow: jest.Mock };
  };

  beforeEach(() => {
    prisma = { auditLog: { create: jest.fn().mockResolvedValue({}) } };
    notifications = { emit: jest.fn().mockResolvedValue(undefined) };
    tx = {
      productionInvoiceItem: { findMany: jest.fn(), update: jest.fn() },
      productionInvoiceItemStage: { upsert: jest.fn() },
      systemConfig: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ solverMergeWindowDays: 3, solverMergeMaxSkus: 5 }),
      },
    };
    writer = new ItemDeadlineWriter(
      prisma as unknown as PrismaServiceType,
      {
        isActive: jest.fn().mockReturnValue(false),
        get: jest.fn(),
      } as unknown as ClsService<AppClsStore>,
      notifications as unknown as NotificationsService,
    );
  });

  it('toWrite: đổi DeadlineValues sang đầu vào ghi, bỏ khoá null', () => {
    expect(
      writer.toWrite({
        materialDeadline: '2026-11-10',
        finishedMaterialDeadline: null,
        'stage.FRAME_HAN': '2026-11-14',
        'stage.PACKAGING': '2026-11-20',
      }),
    ).toEqual({
      materialDeadline: '2026-11-10',
      stages: [
        { stageType: 'FRAME_HAN', deadline: '2026-11-14' },
        { stageType: 'PACKAGING', deadline: '2026-11-20' },
      ],
    });
  });

  describe('luật gộp trên giá trị dự kiến', () => {
    const item = (id: bigint, material: string) => ({
      id,
      materialDeadline: day(material),
      stages: [],
      mfgProduct: { factoryCode: `SKU-${id}` },
      salesOrder: null,
    });

    it('giá trị đang lưu cách nhau 1 ngày nhưng yêu cầu chờ kéo ra 9 ngày → 400', async () => {
      tx.productionInvoiceItem.findMany.mockResolvedValue([
        item(1n, '2026-11-01'),
        item(2n, '2026-11-02'),
      ]);
      await expect(
        writer.assertMergedPiProjectedRule(
          tx as never,
          7n,
          new Map([['2', { materialDeadline: '2026-11-10' }]]),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('không có thay đổi dự kiến thì giống luật gộp thường (trong khung → qua)', async () => {
      tx.productionInvoiceItem.findMany.mockResolvedValue([
        item(1n, '2026-11-01'),
        item(2n, '2026-11-02'),
      ]);
      await expect(writer.assertMergedPiDeadlineRule(tx as never, 7n)).resolves.toBeUndefined();
    });
  });

  describe('auditAndNotifyDeadlineChange', () => {
    const base = {
      id: 20n,
      productionInvoiceId: 7n,
      materialDeadline: day('2026-11-01'),
      finishedMaterialDeadline: null,
      deliveryDeadline: null,
      stages: [{ stageType: 'FRAME_HAN' as const, deadline: day('2026-11-12') }],
      mfgProduct: { factoryCode: 'SKU-20' },
    };

    it('có ghi chú: audit mang _note, thông báo mang note', async () => {
      const after = {
        ...base,
        stages: [{ stageType: 'FRAME_HAN' as const, deadline: day('2026-11-15') }],
      };
      await writer.auditAndNotifyDeadlineChange('PI-7', base, after, 'Sếp đã duyệt');
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      const audit = prisma.auditLog.create.mock.calls[0] as [
        { data: { newValue: Record<string, string> } },
      ];
      expect(audit[0].data.newValue._note).toBe('Sếp đã duyệt');
      expect(audit[0].data.newValue['stage.FRAME_HAN']).toBe('2026-11-15T00:00:00.000Z');
      expect(notifications.emit).toHaveBeenCalledWith(
        'PI_ITEM_DEADLINE_CHANGED',
        expect.objectContaining({
          params: expect.objectContaining({ note: 'Sếp đã duyệt', piCode: 'PI-7' }) as unknown,
        }),
      );
    });

    it('không đổi gì thì không audit / báo', async () => {
      await writer.auditAndNotifyDeadlineChange('PI-7', base, base);
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
      expect(notifications.emit).not.toHaveBeenCalled();
    });
  });
});
