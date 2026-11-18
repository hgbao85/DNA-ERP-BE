import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { WorkshopScopeService } from '../../common/workshop-scope/workshop-scope.service';
import { SegmentOveragesService } from './segment-overages.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 7n,
  productionInvoiceId: 79n,
  productionOrderId: 5n,
  productionBatchId: 300n,
  pieceId: 9n,
  stage: 'HAN',
  warehouseId: 2n,
  segmentSpecId: 11n,
  segmentSteps: 'DAP',
  neededQty: new Prisma.Decimal(20),
  takenQty: new Prisma.Decimal(12),
  shortageQty: new Prisma.Decimal(8),
  overPieces: 0,
  extraQty: new Prisma.Decimal(0),
  extraKind: null,
  reportedById: 'u1',
  createdAt: new Date('2026-11-13T08:00:00Z'),
  resolvedAt: null,
  resolvedById: null,
  resolveReason: null,
  productionBatch: { piece: { code: 'M01', name: 'Mảnh lưng' } },
  warehouse: { name: 'Kho Phôi Phước An' },
  segmentSpec: { cutLengthMm: new Prisma.Decimal(460), material: { code: 'SAT-005' } },
  ...over,
});

describe('SegmentOveragesService', () => {
  let prisma: Record<string, Record<string, jest.Mock>>;
  let service: SegmentOveragesService;
  let notifications: { resolve: jest.Mock };
  const cls = { isActive: () => false, get: jest.fn(), getId: jest.fn() };

  const scoped = { workshopId: 1n, workshopName: 'Phước An', visibleWorkshopIds: [1n] };
  const unscoped = { workshopId: null, workshopName: null, visibleWorkshopIds: null };

  beforeEach(() => {
    prisma = {
      segmentOverage: {
        findMany: jest.fn().mockResolvedValue([row()]),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue(
            row({ resolvedAt: new Date(), resolvedById: 'u2', resolveReason: 'Đã đếm lại' }),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
      productionInvoice: {
        findMany: jest.fn().mockResolvedValue([{ id: 79n, code: 'PI-2026-079' }]),
      },
      productionInvoiceItem: {
        findMany: jest.fn().mockResolvedValue([{ productionInvoiceId: 79n, lsxCode: 'LSX313' }]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'u1', firstName: 'Hàn', lastName: 'Tổ', username: 'han1' },
          { id: 'u2', firstName: 'Quản', lastName: 'Lý', username: 'qlsx' },
        ]),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const workshopScope = new WorkshopScopeService(prisma as never);
    jest.spyOn(workshopScope, 'getScope').mockResolvedValue(unscoped);
    notifications = { resolve: jest.fn().mockResolvedValue(undefined) };
    service = new SegmentOveragesService(
      prisma as never,
      cls as never,
      workshopScope,
      notifications as never,
    );
  });

  const whereOf = (): unknown =>
    (prisma.segmentOverage.findMany.mock.calls as [{ where: unknown }][])[0][0].where;

  const scopeOf = () =>
    (service as unknown as { workshopScope: WorkshopScopeService }).workshopScope;

  it('liệt kê mặc định dòng chưa đóng, nhãn mã đoạn + số LSX + tên người báo', async () => {
    const out = await service.findAll({}, 'u2');
    expect(whereOf()).toEqual({ resolvedAt: null });
    expect(out[0]).toMatchObject({
      lenhCode: 'LSX313',
      segmentLabel: 'SAT-005 @ 460mm · Dập',
      shortageQty: 8,
      reportedByName: 'Tổ Hàn',
      pieceCode: 'M01',
    });
  });

  it('TĐ9 14/11: QLSX gắn xưởng chỉ thấy dòng mà KHO PHÔI ghi trên dòng thuộc xưởng mình (cùng căn cứ với lúc đóng)', async () => {
    jest.spyOn(scopeOf(), 'getScope').mockResolvedValue(scoped);
    await service.findAll({ status: 'all', productionInvoiceId: '79' }, 'u2');
    expect(whereOf()).toEqual({
      productionInvoiceId: 79n,
      AND: [{ OR: [{ warehouse: { workshopId: null } }, { warehouse: { workshopId: 1n } }] }],
    });
  });

  it('TĐ9 14/11: xưởng sơn nhờ cho xưởng 2 thấy + đóng được dòng tổ SƠN của kho xưởng 2, KHÔNG thấy/đóng dòng tổ Hàn', async () => {
    jest
      .spyOn(scopeOf(), 'getScope')
      .mockResolvedValue({ workshopId: 1n, workshopName: 'Phú An', visibleWorkshopIds: [1n, 2n] });
    await service.findAll({ status: 'open' }, 'u2');
    expect(whereOf()).toEqual({
      resolvedAt: null,
      AND: [
        {
          OR: [
            { warehouse: { workshopId: null } },
            { warehouse: { workshopId: 1n } },
            { stage: 'SON', warehouse: { workshopId: { in: [2n] } } },
          ],
        },
      ],
    });
    prisma.segmentOverage.findUnique.mockResolvedValue({
      productionBatchId: 300n,
      stage: 'HAN',
      warehouse: { workshopId: 2n },
    });
    await expect(service.resolve('7', 'x', 'u2')).rejects.toBeInstanceOf(ForbiddenException);
    prisma.segmentOverage.findUnique.mockResolvedValue({
      productionBatchId: 300n,
      stage: 'SON',
      warehouse: { workshopId: 2n },
    });
    await expect(service.resolve('7', 'x', 'u2')).resolves.toBeDefined();
  });

  it('đóng dòng: ghi lý do có điều kiện chưa đóng + nhật ký', async () => {
    prisma.segmentOverage.findUnique.mockResolvedValue({
      productionBatchId: 300n,
      warehouse: { workshopId: 1n },
    });
    const out = await service.resolve('7', 'Đã đếm lại', 'u2');
    // Đợt 300 hết dòng mở -> đóng thông báo báo vượt của đợt.
    expect(notifications.resolve).toHaveBeenCalledWith({
      entityType: 'PRODUCTION_BATCH',
      entityId: '300',
      types: ['SEGMENT_OVERAGE_REPORTED'],
    });
    expect(prisma.segmentOverage.updateMany).toHaveBeenCalledWith({
      where: { id: 7n, resolvedAt: null },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({ resolvedById: 'u2', resolveReason: 'Đã đếm lại' }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({ tableName: 'SegmentOverage', recordId: '7' }),
    });
    expect(out.resolvedByName).toBe('Lý Quản');
  });

  it('đợt còn dòng chưa đóng -> giữ thông báo', async () => {
    prisma.segmentOverage.findUnique.mockResolvedValue({
      productionBatchId: 300n,
      warehouse: { workshopId: null },
    });
    prisma.segmentOverage.count.mockResolvedValue(1);
    await service.resolve('7', 'Đã đếm lại', 'u2');
    expect(notifications.resolve).not.toHaveBeenCalled();
  });

  it('đóng dòng đã đóng → 409, không ghi nhật ký', async () => {
    prisma.segmentOverage.findUnique.mockResolvedValue({ warehouse: { workshopId: null } });
    prisma.segmentOverage.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.resolve('7', 'Đã đếm lại', 'u2')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('QLSX xưởng khác (kho Phôi trên dòng thuộc xưởng 2) không đóng được', async () => {
    jest.spyOn(scopeOf(), 'getScope').mockResolvedValue(scoped);
    prisma.segmentOverage.findUnique.mockResolvedValue({
      warehouse: { workshopId: 2n },
    });
    await expect(service.resolve('7', 'Đã đếm lại', 'u2')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.segmentOverage.updateMany).not.toHaveBeenCalled();
  });

  it('không có dòng → 404', async () => {
    prisma.segmentOverage.findUnique.mockResolvedValue(null);
    await expect(service.resolve('99', 'Đã đếm lại', 'u2')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
