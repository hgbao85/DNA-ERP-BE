import { PrismaServiceType } from '../../prisma/prisma.service';
import { WorkshopMoveService } from './workshop-move.service';

const dec = (n: number) => ({ toNumber: () => n });

// Đổi xưởng (anh Nhân 09-10/11/2026, Sang 10/11): đổi nơi nhận dòng mua chưa về, kế hoạch chuyển hàng đang giữ, chuyển giữ chỗ.
describe('WorkshopMoveService', () => {
  const phoiPA = {
    id: 1n,
    code: 'phoi-son-han',
    name: 'Kho Phôi Phú An',
    kind: 'PHOI',
    workshopId: 10n,
  };
  const hanPA = {
    id: 6n,
    code: 'phoi-son-han-han-pa',
    name: 'Kho Hàn Phú An',
    kind: 'HAN',
    workshopId: 10n,
  };
  const phoiPHA = {
    id: 7n,
    code: 'phoi-son-han-phoi-pha',
    name: 'Kho Phôi Phước An',
    kind: 'PHOI',
    workshopId: 20n,
  };
  const hanPHA = {
    id: 8n,
    code: 'phoi-son-han-han-pha',
    name: 'Kho Hàn Phước An',
    kind: 'HAN',
    workshopId: 20n,
  };
  const pk = {
    id: 2n,
    code: 'vat-tu-tp',
    name: 'Kho Phụ kiện',
    kind: 'PHU_KIEN',
    workshopId: null,
  };
  const all = [phoiPA, hanPA, phoiPHA, hanPHA, pk];

  let prisma: Record<string, Record<string, jest.Mock>>;
  let notifications: { emit: jest.Mock; resolve: jest.Mock };
  let service: WorkshopMoveService;

  beforeEach(() => {
    prisma = {
      purchaseProposalItem: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      warehouse: {
        findMany: jest.fn(({ where }: { where: { code: { in: string[] } } }) =>
          Promise.resolve(all.filter((w) => where.code.in.includes(w.code))),
        ),
        findFirst: jest.fn(({ where }: { where: { kind: string; workshopId?: bigint } }) =>
          Promise.resolve(
            all.find(
              (w) =>
                w.kind === where.kind &&
                (where.workshopId === undefined || w.workshopId === where.workshopId),
            ) ?? null,
          ),
        ),
        findUnique: jest.fn(({ where }: { where: { id?: bigint; code?: string } }) =>
          Promise.resolve(all.find((w) => w.id === where.id || w.code === where.code) ?? null),
        ),
      },
      productionInvoiceItem: {
        // Lệnh 500 nay ở Phước An.
        findFirst: jest.fn().mockResolvedValue({ workshopId: 20n }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      productionInvoice: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ cuttingRecheckRequired: false }),
      },
      stockReservation: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        create: jest.fn(),
      },
      warehouseTransferItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    notifications = { emit: jest.fn().mockResolvedValue(undefined), resolve: jest.fn() };
    service = new WorkshopMoveService(
      prisma as unknown as PrismaServiceType,
      notifications as never,
    );
  });

  it('afterWorkshopChanged: dòng mua chưa về ở kho Phôi/Hàn xưởng cũ đổi sang kho cùng loại xưởng mới; báo người mua sau commit', async () => {
    prisma.purchaseProposalItem.findMany.mockResolvedValue([
      // Sắt: kho mặc định Phôi PA -> Phôi PhA (ghi receiveWarehouseCode).
      {
        id: 1n,
        receiveWarehouseCode: null,
        material: { code: 'SAT-1', buyerId: 'b1', warehouseId: 1n, warehouse: phoiPA },
      },
      // Đang ghi đè Hàn PA (vật tư hàn) -> Hàn PhA.
      {
        id: 2n,
        receiveWarehouseCode: 'phoi-son-han-han-pa',
        material: { code: 'HAN-1', buyerId: 'b2', warehouseId: 6n, warehouse: hanPA },
      },
      // Kho Phụ kiện: không đổi.
      {
        id: 3n,
        receiveWarehouseCode: null,
        material: { code: 'PK-1', buyerId: 'b1', warehouseId: 2n, warehouse: pk },
      },
    ]);
    const notify = await service.afterWorkshopChanged(prisma as never, 500n, 20n, 'qlsx');
    expect(prisma.purchaseProposalItem.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: { receiveWarehouseCode: 'phoi-son-han-phoi-pha' },
    });
    expect(prisma.purchaseProposalItem.update).toHaveBeenCalledWith({
      where: { id: 2n },
      data: { receiveWarehouseCode: 'phoi-son-han-han-pha' },
    });
    expect(prisma.purchaseProposalItem.update).toHaveBeenCalledTimes(2);
    expect(notifications.emit).not.toHaveBeenCalled();
    await notify();
    expect(notifications.emit).toHaveBeenCalledWith(
      'PURCHASE_RECEIVE_WAREHOUSE_CHANGED',
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
        params: expect.objectContaining({ count: 2, buyerIds: ['b1', 'b2'] }),
      }),
    );
  });

  it('afterWorkshopChanged: đổi về xưởng có kho mặc định của vật tư -> bỏ ghi đè (null)', async () => {
    prisma.purchaseProposalItem.findMany.mockResolvedValue([
      {
        id: 1n,
        receiveWarehouseCode: 'phoi-son-han-phoi-pha',
        material: { code: 'SAT-1', buyerId: null, warehouseId: 1n, warehouse: phoiPA },
      },
    ]);
    await service.afterWorkshopChanged(prisma as never, 500n, 10n, 'qlsx');
    expect(prisma.purchaseProposalItem.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: { receiveWarehouseCode: null },
    });
  });

  it('getPlans: hàng đang giữ ở kho Phôi xưởng cũ, gộp theo vật tư + chiều dài, trừ phần trên phiếu chờ nhận', async () => {
    const res = (len: number, q: number) => ({
      productionInvoiceId: 500n,
      materialId: 33n,
      quantity: dec(q),
      consumedQty: dec(0),
      stockLengthMm: len,
      spec: '',
      warehouse: phoiPA,
      material: {
        code: 'SAT-1',
        name: 'Sắt hộp',
        unit: 'cây',
        materialGroup: { systemKey: 'STEEL_BAR' },
      },
    });
    prisma.stockReservation.findMany.mockResolvedValue([res(6000, 10), res(6000, 5), res(5850, 4)]);
    prisma.warehouseTransferItem.findMany.mockResolvedValue([
      {
        materialId: 33n,
        quantity: dec(3),
        stockLengthMm: 6000,
        spec: '',
        transfer: { productionInvoiceId: 500n, fromWarehouseId: 1n },
      },
    ]);
    const [plan] = await service.getPlans();
    expect(plan).toEqual(
      expect.objectContaining({
        fromWarehouseCode: 'phoi-son-han',
        toWarehouseCode: 'phoi-son-han-phoi-pha',
        recheckPending: false,
      }),
    );
    expect(plan.lines.map((l) => `${l.stockLengthMm}:${l.qty}`)).toEqual(['6000:12', '5850:4']);
  });

  it('getPlans: KHSX chưa bấm "Đã kiểm" phương án cắt -> recheckPending', async () => {
    prisma.stockReservation.findMany.mockResolvedValue([
      {
        productionInvoiceId: 500n,
        materialId: 33n,
        quantity: dec(5),
        consumedQty: dec(0),
        stockLengthMm: 6000,
        spec: '',
        warehouse: phoiPA,
        material: {
          code: 'SAT-1',
          name: 'Sắt hộp',
          unit: 'cây',
          materialGroup: { systemKey: 'STEEL_BAR' },
        },
      },
    ]);
    prisma.productionInvoice.findUnique.mockResolvedValue({ cuttingRecheckRequired: true });
    const [plan] = await service.getPlans();
    expect(plan.recheckPending).toBe(true);
  });

  it('getPlans: chưa "Đã kiểm" -> chỉ phần sắt bị chặn, vật tư khác cùng kho tách phiếu riêng chuyển ngay', async () => {
    const row = (code: string, materialId: bigint, systemKey: string | null) => ({
      productionInvoiceId: 500n,
      materialId,
      quantity: dec(5),
      consumedQty: dec(0),
      stockLengthMm: systemKey === 'STEEL_BAR' ? 6000 : 0,
      spec: '',
      warehouse: phoiPA,
      material: { code, name: code, unit: 'cái', materialGroup: systemKey ? { systemKey } : null },
    });
    prisma.stockReservation.findMany.mockResolvedValue([
      row('SAT-1', 33n, 'STEEL_BAR'),
      row('QH-1', 44n, 'OTHER'),
    ]);
    prisma.productionInvoice.findUnique.mockResolvedValue({ cuttingRecheckRequired: true });
    const plans = await service.getPlans();
    expect(
      plans.map(
        (p) => `${p.part}:${p.recheckPending}:${p.lines.map((l) => l.materialCode).join(',')}`,
      ),
    ).toEqual(['STEEL:true:SAT-1', 'OTHER:false:QH-1']);
    const other = await service.getPlans(undefined, { part: 'OTHER' });
    expect(other.map((p) => p.part)).toEqual(['OTHER']);
  });

  it('getPlans: giữ chỗ đã đúng kho xưởng hiện tại -> không có gì phải chuyển', async () => {
    prisma.stockReservation.findMany.mockResolvedValue([
      {
        productionInvoiceId: 500n,
        materialId: 33n,
        quantity: dec(5),
        consumedQty: dec(0),
        stockLengthMm: 6000,
        spec: '',
        warehouse: phoiPHA,
        material: { code: 'S', name: 'S', unit: 'cây' },
      },
    ]);
    expect(await service.getPlans()).toEqual([]);
  });

  it('moveReservationsInTx: chuyển nguyên dòng giữ chỗ; nhận thiếu thì tách - phần thiếu vẫn giữ ở kho cũ', async () => {
    prisma.stockReservation.findMany.mockResolvedValue([
      {
        id: 1n,
        quantity: dec(10),
        consumedQty: dec(0),
        materialId: 33n,
        refType: 'PRODUCTION_INVOICE',
        refId: '500',
        productionInvoiceId: 500n,
        note: null,
        createdById: null,
        stockLengthMm: 6000,
        spec: '',
      },
      {
        id: 2n,
        quantity: dec(5),
        consumedQty: dec(0),
        materialId: 33n,
        refType: 'PRODUCTION_INVOICE',
        refId: '500',
        productionInvoiceId: 500n,
        note: null,
        createdById: null,
        stockLengthMm: 6000,
        spec: '',
      },
    ]);
    await service.moveReservationsInTx(
      prisma as never,
      { productionInvoiceId: 500n, fromWarehouseId: 1n, toWarehouseId: 7n },
      [{ materialId: 33n, stockLengthMm: 6000, spec: '', qty: 12 }],
    );
    expect(prisma.stockReservation.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: { warehouseId: 7n },
    });
    expect(prisma.stockReservation.update).toHaveBeenCalledWith({
      where: { id: 2n },
      data: { quantity: 3 },
    });
    expect(prisma.stockReservation.create).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
      data: expect.objectContaining({
        warehouseId: 7n,
        quantity: 2,
        stockLengthMm: 6000,
        productionInvoiceId: 500n,
      }),
    });
  });
});
