import { PrismaServiceType } from '../../prisma/prisma.service';
import { LenhCodesService } from './lenh-codes.service';

describe('LenhCodesService.displayCodesByPiCode', () => {
  const prisma = {
    productionInvoice: { findMany: jest.fn() },
    productionInvoiceItem: { findMany: jest.fn() },
  };
  const service = new LenhCodesService(prisma as unknown as PrismaServiceType);

  beforeEach(() => jest.clearAllMocks());

  it('mã PI -> số LSX; lệnh gộp nối " + "; lệnh chưa có LSX giữ mã PI; mã lạ bỏ qua', async () => {
    prisma.productionInvoice.findMany
      .mockResolvedValueOnce([
        { id: 1n, code: 'PI-2026-001' },
        { id: 2n, code: 'PI-2026-002' },
        { id: 3n, code: 'PI-2026-003' },
      ])
      .mockResolvedValueOnce([
        { id: 1n, code: 'PI-2026-001' },
        { id: 2n, code: 'PI-2026-002' },
        { id: 3n, code: 'PI-2026-003' },
      ]);
    prisma.productionInvoiceItem.findMany.mockResolvedValue([
      { productionInvoiceId: 1n, lsxCode: 'MY-313' },
      { productionInvoiceId: 2n, lsxCode: 'GP-176' },
      { productionInvoiceId: 2n, lsxCode: 'GP-177' },
    ]);

    const res = await service.displayCodesByPiCode([
      'PI-2026-001',
      'PI-2026-002',
      'PI-2026-003',
      'PI-2026-999',
      ' PI-2026-001 ',
      '',
    ]);

    expect(res).toEqual({
      'PI-2026-001': 'MY-313',
      'PI-2026-002': 'GP-176 + GP-177',
      'PI-2026-003': 'PI-2026-003',
    });
    expect(prisma.productionInvoice.findMany).toHaveBeenNthCalledWith(1, {
      where: { code: { in: ['PI-2026-001', 'PI-2026-002', 'PI-2026-003', 'PI-2026-999'] } },
      select: { id: true, code: true },
    });
  });

  it('không có mã nào thì không truy vấn', async () => {
    expect(await service.displayCodesByPiCode(['', ' '])).toEqual({});
    expect(prisma.productionInvoice.findMany).not.toHaveBeenCalled();
  });
});
