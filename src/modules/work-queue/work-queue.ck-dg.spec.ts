import type { PrismaServiceType } from '../../prisma/prisma.service';
import { WorkQueueService } from './work-queue.service';

/** CK_DG_QR (24/11/2026): số đỏ "đợt chờ KCS chuyền kiểm" cho tài khoản mfgRole KCS_CHUYEN_KIEM (tài khoản PIN, vai FLOOR_WORKER). */
describe('WorkQueueService - KCS chuyền kiểm (CK_DG_QR)', () => {
  const prev = process.env.CK_DG_QR_ENABLED;
  afterEach(() => {
    if (prev === undefined) delete process.env.CK_DG_QR_ENABLED;
    else process.env.CK_DG_QR_ENABLED = prev;
  });
  const build = () => {
    const prisma = { transferCheckBatch: { count: jest.fn().mockResolvedValue(4) } };
    const service = new WorkQueueService(
      prisma as unknown as PrismaServiceType,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { prisma, service };
  };

  it('bật công tắc: đếm đợt AWAITING_KCS của SKU chưa huỷ', async () => {
    process.env.CK_DG_QR_ENABLED = 'true';
    const { prisma, service } = build();
    const r = await service.getWorkQueue({
      roles: ['FLOOR_WORKER'],
      warehouseScope: null,
      mfgRole: 'KCS_CHUYEN_KIEM',
    });
    expect(r.counts).toEqual({ kcsChuyenKiem: 4 });
    expect(prisma.transferCheckBatch.count).toHaveBeenCalledWith({
      where: { status: 'AWAITING_KCS', productionInvoiceItem: { cancelledAt: null } },
    });
  });

  it('tắt công tắc hoặc tổ khác: không có khoá, không query', async () => {
    delete process.env.CK_DG_QR_ENABLED;
    const { prisma, service } = build();
    const off = await service.getWorkQueue({
      roles: ['FLOOR_WORKER'],
      warehouseScope: null,
      mfgRole: 'KCS_CHUYEN_KIEM',
    });
    expect(off.counts).toEqual({});
    process.env.CK_DG_QR_ENABLED = 'true';
    const other = await service.getWorkQueue({
      roles: ['FLOOR_WORKER'],
      warehouseScope: null,
      mfgRole: 'CHUYEN_KIEM',
    });
    expect(other.counts).toEqual({});
    expect(prisma.transferCheckBatch.count).not.toHaveBeenCalled();
  });
});
