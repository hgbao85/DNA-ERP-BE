import { BadRequestException } from '@nestjs/common';
import { WarehouseKind } from '../../generated/prisma/client';
import { WorkshopWarehouseResolver } from './workshop-warehouse.util';

describe('WorkshopWarehouseResolver (Đợt 7 - chia 9 kho)', () => {
  const PA = 1n;
  const PHA = 2n;
  const phoiPA = { id: 10n, code: 'phoi-son-han', kind: WarehouseKind.PHOI, workshopId: PA };
  const hanPA = { id: 11n, code: 'phoi-son-han-han-pa', kind: WarehouseKind.HAN, workshopId: PA };
  const sonPA = { id: 12n, code: 'phoi-son-han-son-pa', kind: WarehouseKind.SON, workshopId: PA };
  const phoiPHA = {
    id: 13n,
    code: 'phoi-son-han-phoi-pha',
    kind: WarehouseKind.PHOI,
    workshopId: PHA,
  };
  const hanPHA = {
    id: 14n,
    code: 'phoi-son-han-han-pha',
    kind: WarehouseKind.HAN,
    workshopId: PHA,
  };
  const phuKien = { id: 20n, code: 'vat-tu-tp', kind: WarehouseKind.PHU_KIEN, workshopId: null };
  const all = [phoiPA, hanPA, sonPA, phoiPHA, hanPHA, phuKien];

  let db: {
    warehouse: { findFirst: jest.Mock; findUnique: jest.Mock };
    productionInvoiceItem: { findFirst: jest.Mock };
  };
  let resolver: WorkshopWarehouseResolver;

  beforeEach(() => {
    db = {
      warehouse: {
        findFirst: jest.fn(({ where }: { where: { kind: WarehouseKind; workshopId: bigint } }) =>
          Promise.resolve(
            all.find((w) => w.kind === where.kind && w.workshopId === where.workshopId) ?? null,
          ),
        ),
        findUnique: jest.fn(({ where }: { where: { code?: string; id?: bigint } }) =>
          Promise.resolve(all.find((w) => w.code === where.code || w.id === where.id) ?? null),
        ),
      },
      productionInvoiceItem: { findFirst: jest.fn().mockResolvedValue({ workshopId: PHA }) },
    };
    resolver = new WorkshopWarehouseResolver(db as never);
  });

  it('sắt (kho mặc định Phôi Phú An) của lệnh Phước An -> kho Phôi Phước An', async () => {
    await expect(resolver.resolveForPi(phoiPA, 500n)).resolves.toEqual(phoiPHA);
    expect(db.productionInvoiceItem.findFirst).toHaveBeenCalledWith({
      where: { productionInvoiceId: 500n, workshopId: { not: null } },
      select: { workshopId: true },
    });
  });

  it('vật tư Hàn của lệnh Phước An -> kho Hàn Phước An', async () => {
    await expect(resolver.resolveForPi(hanPA, 500n)).resolves.toEqual(hanPHA);
  });

  it('lệnh Phú An: giữ nguyên kho mặc định, không tra kho khác', async () => {
    db.productionInvoiceItem.findFirst.mockResolvedValue({ workshopId: PA });
    await expect(resolver.resolveForPi(phoiPA, 500n)).resolves.toBe(phoiPA);
    expect(db.warehouse.findFirst).not.toHaveBeenCalled();
  });

  it('kho Sơn / Phụ kiện / chưa phân loại dùng chung mọi xưởng - không đọc DB', async () => {
    await expect(resolver.resolveForPi(sonPA, 500n)).resolves.toBe(sonPA);
    await expect(resolver.resolveForPi(phuKien, 500n)).resolves.toBe(phuKien);
    const legacy = { id: 99n, code: 'x' };
    await expect(resolver.resolveForPi(legacy, 500n)).resolves.toBe(legacy);
    expect(db.productionInvoiceItem.findFirst).not.toHaveBeenCalled();
  });

  it('lệnh chưa chọn xưởng -> kho mặc định', async () => {
    db.productionInvoiceItem.findFirst.mockResolvedValue(null);
    await expect(resolver.resolveForPi(phoiPA, 500n)).resolves.toBe(phoiPA);
  });

  it('xưởng chưa có kho cùng loại -> lỗi rõ ràng, không lặng lẽ dùng kho Phú An', async () => {
    db.productionInvoiceItem.findFirst.mockResolvedValue({ workshopId: 3n });
    await expect(resolver.resolveForPi(hanPA, 500n)).rejects.toThrow(BadRequestException);
  });

  it('nhớ xưởng của PI và kho đã tra trong cùng 1 bộ đổi', async () => {
    await resolver.resolveForPi(phoiPA, 500n);
    await resolver.resolveForPi(phoiPA, 500n);
    expect(db.productionInvoiceItem.findFirst).toHaveBeenCalledTimes(1);
    expect(db.warehouse.findFirst).toHaveBeenCalledTimes(1);
  });

  it('sameKindAs: thủ kho Hàn Phước An lấy dây hàn dùng chung ở kho mình; thủ kho khác loại -> kho mặc định', async () => {
    await expect(resolver.sameKindAs(hanPA, hanPHA.code)).resolves.toEqual(hanPHA);
    await expect(resolver.sameKindAs(hanPA, phoiPHA.code)).resolves.toBe(hanPA);
    await expect(resolver.sameKindAs(hanPA, null)).resolves.toBe(hanPA);
  });

  it('phoiWarehouseOfPi: theo xưởng của lệnh; chưa chọn xưởng -> kho gốc phoi-son-han', async () => {
    await expect(resolver.phoiWarehouseOfPi(500n)).resolves.toEqual(phoiPHA);
    const r2 = new WorkshopWarehouseResolver(db as never);
    db.productionInvoiceItem.findFirst.mockResolvedValue(null);
    await expect(r2.phoiWarehouseOfPi(501n)).resolves.toEqual(phoiPA);
  });
});
