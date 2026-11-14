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
    service = new SegmentOveragesService(prisma as never, cls as never, workshopScope);
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

  it('QLSX gắn xưởng chỉ thấy lệnh có SKU thuộc xưởng mình', async () => {
    jest.spyOn(scopeOf(), 'getScope').mockResolvedValue(scoped);
    await service.findAll({ status: 'all', productionInvoiceId: '79' }, 'u2');
    expect(whereOf()).toEqual({
      productionInvoiceId: 79n,
      productionInvoice: {
        items: { some: { OR: [{ workshopId: null }, { workshopId: { in: [1n] } }] } },
      },
    });
  });

  it('đóng dòng: ghi lý do có điều kiện chưa đóng + nhật ký', async () => {
    prisma.segmentOverage.findUnique.mockResolvedValue({
      productionInvoice: { items: [{ workshopId: 1n }] },
    });
    const out = await service.resolve('7', 'Đã đếm lại', 'u2');
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

  it('đóng dòng đã đóng → 409, không ghi nhật ký', async () => {
    prisma.segmentOverage.findUnique.mockResolvedValue({ productionInvoice: { items: [] } });
    prisma.segmentOverage.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.resolve('7', 'Đã đếm lại', 'u2')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('QLSX xưởng khác không đóng được', async () => {
    jest.spyOn(scopeOf(), 'getScope').mockResolvedValue(scoped);
    prisma.segmentOverage.findUnique.mockResolvedValue({
      productionInvoice: { items: [{ workshopId: 2n }] },
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
