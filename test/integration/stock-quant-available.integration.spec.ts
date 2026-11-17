import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import configuration from '../../src/config/configuration';
import { envValidationSchema } from '../../src/config/env.validation';
import {
  ReservationStatus,
  StockLedgerRefType,
  StockReservationRefType,
  WarehouseKind,
} from '../../src/generated/prisma/client';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { SegmentStockService } from '../../src/modules/segment-stock/segment-stock.service';
import { StockLedgerService } from '../../src/modules/stock/stock-ledger.service';
import { StockQuantService } from '../../src/modules/stock/stock-quant.service';
import { StockReservationsService } from '../../src/modules/stock/stock-reservations.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PRISMA_SERVICE, PrismaServiceType } from '../../src/prisma/prisma.service';
import { RealtimeService } from '../../src/realtime/realtime.service';

/**
 * Cột "Khả dụng" của GET /stock-quant với sắt (lỗi C3, 17/11/2026), chạy trên Postgres TEST riêng (cổng 5433).
 * Tồn sắt nằm ở ô chiều dài 6000, giữ chỗ cắt sắt cũng ghi ở ô 6000 - trước đây toResponseDto luôn tra giữ chỗ ở ô 0 nên
 * khả dụng = tồn. Tồn qua sổ cái thật (trigger stock_quant), giữ chỗ ghi thẳng bảng stock_reservations.
 */
describe('StockQuantService.findAll - khả dụng theo ô chiều dài (integration, real Postgres)', () => {
  let prisma: PrismaServiceType;
  let service: StockQuantService;
  let ledger: StockLedgerService;

  const sfx = Date.now();
  let whId: bigint;
  let supplierWh: bigint;
  let materialId: bigint;
  let steelId: bigint;
  const pis: bigint[] = [];
  const createdWarehouseCodes: string[] = [];

  const availableOf = async (mat: bigint, stockLengthMm: number): Promise<number> => {
    const rows = await service.findAll({
      warehouseId: whId.toString(),
      materialId: mat.toString(),
    });
    const row = rows.find((r) => r.stockLengthMm === stockLengthMm);
    if (!row) throw new Error(`không có dòng tồn ô ${stockLengthMm}`);
    return row.availableQty;
  };
  const hold = (mat: bigint, piId: bigint, quantity: number, stockLengthMm: number, tag: string) =>
    prisma.stockReservation.create({
      data: {
        warehouseId: whId,
        materialId: mat,
        quantity,
        stockLengthMm,
        refType: StockReservationRefType.CUTTING_PROPOSAL,
        refId: `sqa-${tag}-${sfx}`,
        productionInvoiceId: piId,
        idempotencyKey: `sqa-${tag}-${sfx}`,
      },
    });
  const receive = (mat: bigint, qty: number, stockLengthMm: number, tag: string) =>
    ledger.postEntry({
      fromWarehouseId: supplierWh,
      toWarehouseId: whId,
      materialId: mat,
      qty,
      stockLengthMm,
      refType: StockLedgerRefType.OPENING_BALANCE,
      refId: `sqa-${tag}-${sfx}`,
      idempotencyKey: `sqa-${tag}-${sfx}`,
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [configuration],
          validationSchema: envValidationSchema,
        }),
        ClsModule.forRoot({ global: true }),
        PrismaModule,
      ],
      providers: [
        StockLedgerService,
        StockReservationsService,
        StockQuantService,
        { provide: NotificationsService, useValue: { emit: jest.fn(), resolve: jest.fn() } },
        { provide: SegmentStockService, useValue: {} },
        { provide: RealtimeService, useValue: { publishEntityChanged: jest.fn() } },
      ],
    }).compile();
    prisma = moduleRef.get(PRISMA_SERVICE);
    service = moduleRef.get(StockQuantService);
    ledger = moduleRef.get(StockLedgerService);

    const whCode = `sqa-wh-${sfx}`;
    createdWarehouseCodes.push(whCode);
    whId = (
      await prisma.warehouse.create({
        data: { code: whCode, name: 'Kho sắt test', kind: WarehouseKind.PHOI },
      })
    ).id;
    const supplier = await prisma.warehouse.findUnique({ where: { code: 'SUPPLIER' } });
    if (supplier) supplierWh = supplier.id;
    else {
      createdWarehouseCodes.push('SUPPLIER');
      supplierWh = (
        await prisma.warehouse.create({
          data: { code: 'SUPPLIER', name: 'SUPPLIER', isVirtual: true },
        })
      ).id;
    }
    steelId = (
      await prisma.material.create({
        data: { code: `SQA-SAT-${sfx}`, name: 'Sắt test', unit: 'cay', warehouseId: whId },
      })
    ).id;
    materialId = (
      await prisma.material.create({
        data: { code: `SQA-DAY-${sfx}`, name: 'Dây test', unit: 'kg', warehouseId: whId },
      })
    ).id;
    for (const tag of ['1', '2']) {
      pis.push(
        (await prisma.productionInvoice.create({ data: { code: `SQA-PI${tag}-${sfx}` } })).id,
      );
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    const mats = [steelId, materialId].filter((m) => m !== undefined);
    await prisma.stockReservation.deleteMany({ where: { materialId: { in: mats } } });
    await prisma.stockLedger.deleteMany({ where: { materialId: { in: mats } } });
    await prisma.stockQuant.deleteMany({ where: { materialId: { in: mats } } });
    await prisma.productionInvoice.deleteMany({ where: { id: { in: pis } } });
    await prisma.material.deleteMany({ where: { id: { in: mats } } });
    await prisma.warehouse.deleteMany({ where: { code: { in: createdWarehouseCodes } } });
    await prisma.$disconnect();
  });

  it('C3-AC1/AC2/AC4: sắt ô 6000 trừ giữ chỗ ô 6000, không trừ giữ chỗ ô 0, nhả/tiêu thì khả dụng tăng đúng phần đó', async () => {
    await receive(steelId, 842, 6000, 'steel');
    // Chưa giữ gì
    expect(await availableOf(steelId, 6000)).toBe(842);

    // AC1: 2 PI giữ tổng 842 ở ô 6000 -> khả dụng 0
    const r1 = await hold(steelId, pis[0], 500, 6000, 'a');
    await hold(steelId, pis[1], 342, 6000, 'b');
    expect(await availableOf(steelId, 6000)).toBe(0);

    // AC2: giữ chỗ ô 0 của cùng vật tư KHÔNG trừ vào dòng ô 6000
    await hold(steelId, pis[0], 100, 0, 'zero');
    expect(await availableOf(steelId, 6000)).toBe(0);
    await prisma.stockReservation.update({
      where: { id: r1.id },
      data: { quantity: 400 },
    });
    expect(await availableOf(steelId, 6000)).toBe(100);

    // AC4: nhả 1 PI (RELEASED) -> khả dụng tăng đúng phần đó (342 giữ còn lại + 0 của PI 1)
    await prisma.stockReservation.update({
      where: { id: r1.id },
      data: { status: ReservationStatus.RELEASED },
    });
    expect(await availableOf(steelId, 6000)).toBe(500);

    // AC4: đã tiêu 42 trong 342 -> chỉ còn trừ 300
    await prisma.stockReservation.updateMany({
      where: { idempotencyKey: `sqa-b-${sfx}` },
      data: { consumedQty: 42 },
    });
    expect(await availableOf(steelId, 6000)).toBe(542);
  });

  it('C3-AC3: vật tư không theo chiều dài (ô 0) vẫn trừ giữ chỗ như cũ', async () => {
    await receive(materialId, 50, 0, 'plain');
    await hold(materialId, pis[0], 20, 0, 'plain-h');
    expect(await availableOf(materialId, 0)).toBe(30);
  });
});
