import { PrismaServiceType } from '../../prisma/prisma.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { FloorAdminService } from './floor-admin.service';

/** QLSX chỉ ĐỌC địa chỉ ERP dùng cho tem; Admin đặt ở Cấu hình hệ thống (test ghi ở system-config.service.spec). */
describe('FloorAdminService.getSettings', () => {
  let prisma: { systemConfig: { findUnique: jest.Mock } };
  let service: FloorAdminService;

  beforeEach(() => {
    prisma = { systemConfig: { findUnique: jest.fn() } };
    service = new FloorAdminService(
      prisma as unknown as PrismaServiceType,
      {} as SteelIssuesService,
      {} as ProductionBatchesService,
    );
  });

  it('chưa đặt -> null (FE dùng địa chỉ trình duyệt đang mở)', async () => {
    prisma.systemConfig.findUnique.mockResolvedValue({ floorPublicUrl: null });
    expect(await service.getSettings()).toEqual({ publicUrl: null });
  });

  it('đã đặt -> trả đúng giá trị; chưa seed cấu hình hệ thống -> null, không lỗi', async () => {
    prisma.systemConfig.findUnique.mockResolvedValue({
      floorPublicUrl: 'https://erpdna.vercel.app',
    });
    expect(await service.getSettings()).toEqual({ publicUrl: 'https://erpdna.vercel.app' });

    prisma.systemConfig.findUnique.mockResolvedValue(null);
    expect(await service.getSettings()).toEqual({ publicUrl: null });
  });
});
