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
  WorkshopCapacityMode,
} from '../../src/generated/prisma/client';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { SegmentStockService } from '../../src/modules/segment-stock/segment-stock.service';
import { StockLedgerService } from '../../src/modules/stock/stock-ledger.service';
import { StockReservationsService } from '../../src/modules/stock/stock-reservations.service';
import { WorkshopMoveService } from '../../src/modules/warehouse-transfers/workshop-move.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PRISMA_SERVICE, PrismaServiceType } from '../../src/prisma/prisma.service';
import { RealtimeService } from '../../src/realtime/realtime.service';

/**
 * Giữ chỗ đi theo kho (rà soát Mua hàng + Kho 14/11, nhóm B - 16/11/2026), chạy trên Postgres TEST riêng (docker-compose.test.yml,
 * cổng 5433). Đi đúng chuỗi ở mục 03 bản thiết kế FE docs/thiet-ke-2026-11-16-giu-cho-theo-kho.html: lệnh giữ 50 ở kho Phôi
 * xưởng A -> đổi sang xưởng B -> tính lại (50 là "đang chuyển tới") -> 30 mua về kho B -> nhận phiếu chuyển 48 -> xuất ở kho B.
 * Gọi thật StockReservationsService + WorkshopMoveService.moveReservationsInTx; tồn qua sổ cái thật (trigger stock_quant).
 */
describe('Giữ chỗ theo kho sau đổi xưởng (integration, real Postgres)', () => {
  let prisma: PrismaServiceType;
  let reservations: StockReservationsService;
  let ledger: StockLedgerService;
  let workshopMove: WorkshopMoveService;

  const sfx = Date.now();
  const SRC = StockReservationRefType.CONSUMABLE_MATERIAL_PURCHASE;
  let workshopA: bigint;
  let workshopB: bigint;
  let phoiA: bigint;
  let phoiB: bigint;
  let supplierWh: bigint;
  let materialId: bigint;
  let piId: bigint;
  const createdWarehouseCodes: string[] = [];

  const rows = () =>
    prisma.stockReservation.findMany({
      where: { productionInvoiceId: piId, materialId, status: ReservationStatus.ACTIVE },
      orderBy: { id: 'asc' },
    });
  const heldAt = async (warehouseId: bigint) =>
    (await rows())
      .filter((r) => r.warehouseId === warehouseId)
      .reduce((s, r) => s + r.quantity.toNumber() - r.consumedQty.toNumber(), 0);
  const receive = (warehouseId: bigint, qty: number, tag: string) =>
    ledger.postEntry({
      fromWarehouseId: supplierWh,
      toWarehouseId: warehouseId,
      materialId,
      qty,
      refType: StockLedgerRefType.OPENING_BALANCE,
      refId: `ghk-${tag}-${sfx}`,
      idempotencyKey: `ghk-${tag}-${sfx}`,
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
        WorkshopMoveService,
        { provide: NotificationsService, useValue: { emit: jest.fn(), resolve: jest.fn() } },
        { provide: SegmentStockService, useValue: {} },
        { provide: RealtimeService, useValue: { publishEntityChanged: jest.fn() } },
      ],
    }).compile();
    prisma = moduleRef.get(PRISMA_SERVICE);
    reservations = moduleRef.get(StockReservationsService);
    ledger = moduleRef.get(StockLedgerService);
    workshopMove = moduleRef.get(WorkshopMoveService);

    const mkWorkshop = async (tag: string) =>
      (
        await prisma.workshop.create({
          data: {
            code: `GHK-${tag}-${sfx}`,
            name: `Xưởng ${tag}`,
            capacityMode: WorkshopCapacityMode.CONT_PER_DAY,
          },
        })
      ).id;
    workshopA = await mkWorkshop('A');
    workshopB = await mkWorkshop('B');
    const mkWh = async (tag: string, workshopId: bigint) => {
      const code = `ghk-phoi-${tag}-${sfx}`;
      createdWarehouseCodes.push(code);
      return (
        await prisma.warehouse.create({
          data: { code, name: `Kho Phôi ${tag}`, kind: WarehouseKind.PHOI, workshopId },
        })
      ).id;
    };
    phoiA = await mkWh('A', workshopA);
    phoiB = await mkWh('B', workshopB);
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
    materialId = (
      await prisma.material.create({
        data: { code: `GHK-DAY-${sfx}`, name: 'Dây test', unit: 'kg', warehouseId: phoiA },
      })
    ).id;
    piId = (await prisma.productionInvoice.create({ data: { code: `GHK-PI-${sfx}` } })).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.stockReservation.deleteMany({ where: { materialId } });
    await prisma.stockLedger.deleteMany({ where: { materialId } });
    await prisma.stockQuant.deleteMany({ where: { materialId } });
    await prisma.productionInvoice.deleteMany({ where: { id: piId } });
    await prisma.material.deleteMany({ where: { id: materialId } });
    await prisma.warehouse.deleteMany({ where: { code: { in: createdWarehouseCodes } } });
    await prisma.workshop.deleteMany({ where: { id: { in: [workshopA, workshopB] } } });
    await prisma.$disconnect();
  });

  it('đi hết chuỗi đổi xưởng: giữ chỗ luôn nằm đúng kho có hàng', async () => {
    // 1. Lệnh ở xưởng A: kho Phôi A có 50, nguồn vật tư tiêu hao giữ 50 - khoá có đuôi kho A.
    await receive(phoiA, 50, 'open-a');
    await prisma.$transaction((tx) =>
      reservations.reserveOrAdjust(tx, {
        warehouseId: phoiA,
        materialId,
        qty: 50,
        refType: SRC,
        refId: piId.toString(),
        productionInvoiceId: piId,
      }),
    );
    const [first] = await rows();
    expect(first.idempotencyKey).toBe(`${SRC}:${piId}:material:${materialId}:wh:${phoiA}`);

    // 2. Đổi sang xưởng B rồi tính lại ở kho Phôi B: 50 ở kho A KHÔNG bị kéo sang B (CK2) mà là "đang chuyển tới".
    const own = await prisma.$transaction((tx) =>
      reservations.releaseOwnHoldsForRecompute(tx, {
        refType: SRC,
        refId: piId.toString(),
        productionInvoiceId: piId,
        materialId,
        warehouseId: phoiB,
      }),
    );
    expect(own).toEqual({ ownConsumedQty: 0, sourceConsumedQty: 0, inTransitQty: 50 });
    await prisma.$transaction((tx) =>
      reservations.reserveOrAdjust(tx, {
        warehouseId: phoiB,
        materialId,
        qty: 0, // kho B chưa có gì để giữ
        refType: SRC,
        refId: piId.toString(),
        productionInvoiceId: piId,
      }),
    );
    expect(await heldAt(phoiA)).toBe(50);
    expect(await heldAt(phoiB)).toBe(0);

    // 3. 30 mua về kho B: cộng vào dòng ở ĐÚNG kho nhận (CK1), không cộng vào dòng ở kho A.
    await receive(phoiB, 30, 'buy-b');
    await prisma.$transaction((tx) =>
      reservations.creditPool(tx, {
        productionInvoiceId: piId,
        materialId,
        warehouseId: phoiB,
        qty: 30,
      }),
    );
    expect(await heldAt(phoiA)).toBe(50);
    expect(await heldAt(phoiB)).toBe(30);

    // 4. Kho B nhận phiếu chuyển 48/50 (thiếu 2): giữ chỗ sang theo số thực nhận, khoá đổi đuôi sang kho B; 2 còn giữ ở A.
    await prisma.$transaction(async (tx) => {
      await ledger.postEntry(
        {
          fromWarehouseId: phoiA,
          toWarehouseId: phoiB,
          materialId,
          qty: 48,
          refType: StockLedgerRefType.WAREHOUSE_TRANSFER,
          refId: `ghk-move-${sfx}`,
          idempotencyKey: `ghk-move-${sfx}`,
        },
        tx,
      );
      await workshopMove.moveReservationsInTx(
        tx,
        { productionInvoiceId: piId, fromWarehouseId: phoiA, toWarehouseId: phoiB },
        [{ materialId, stockLengthMm: 0, spec: '', qty: 48 }],
      );
    });
    expect(await heldAt(phoiA)).toBe(2);
    expect(await heldAt(phoiB)).toBe(78);
    const atB = (await rows()).filter((r) => r.warehouseId === phoiB && r.refType === SRC);
    expect(atB).toHaveLength(1);
    expect(atB[0].idempotencyKey).toBe(`${SRC}:${piId}:material:${materialId}:wh:${phoiB}`);

    // 5. Tính lại ở kho B lần nữa: tìm thấy đúng dòng của kho B (không giữ 2 lần); 2 ở kho A vẫn là "đang chuyển tới".
    const again = await prisma.$transaction((tx) =>
      reservations.releaseOwnHoldsForRecompute(tx, {
        refType: SRC,
        refId: piId.toString(),
        productionInvoiceId: piId,
        materialId,
        warehouseId: phoiB,
      }),
    );
    expect(again.inTransitQty).toBe(2);
    await prisma.$transaction((tx) =>
      reservations.reserveOrAdjust(tx, {
        warehouseId: phoiB,
        materialId,
        qty: 78,
        refType: SRC,
        refId: piId.toString(),
        productionInvoiceId: piId,
      }),
    );
    expect(await heldAt(phoiB)).toBe(78);

    // 6. Xuất 20 ở kho B: chỉ rút giữ chỗ ở kho B (XK6), 2 ở kho A không bị trừ.
    await prisma.$transaction((tx) =>
      reservations.drainPoolBestEffort(tx, {
        productionInvoiceId: piId,
        materialId,
        qty: 20,
        warehouseId: phoiB,
      }),
    );
    expect(await heldAt(phoiB)).toBe(58);
    expect(await heldAt(phoiA)).toBe(2);

    // 7. Rút cứng (luồng sắt) ở kho B vượt phần giữ ở B -> báo rõ còn giữ ở kho A, cần phiếu chuyển.
    await expect(
      prisma.$transaction((tx) =>
        reservations.drainPool(tx, {
          productionInvoiceId: piId,
          materialId,
          qty: 60,
          warehouseId: phoiB,
        }),
      ),
    ).rejects.toThrow('Lệnh còn giữ 2 ở Kho Phôi A');
  });
});
