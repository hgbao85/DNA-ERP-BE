import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import configuration from '../../src/config/configuration';
import { envValidationSchema } from '../../src/config/env.validation';
import {
  BomRevisionStatus,
  MfgStage,
  ProductionOrderFloorStage,
  StockLedgerRefType,
  StockReservationRefType,
} from '../../src/generated/prisma/client';
import { ConsumableMaterialPurchaseService } from '../../src/modules/production-invoices/consumable-material-purchase.service';
import { MaterialIssuesService } from '../../src/modules/material-issues/material-issues.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { StockLedgerService } from '../../src/modules/stock/stock-ledger.service';
import { StockReservationsService } from '../../src/modules/stock/stock-reservations.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PRISMA_SERVICE, PrismaServiceType } from '../../src/prisma/prisma.service';
import { RealtimeService } from '../../src/realtime/realtime.service';

/**
 * HỒI QUY 2 lỗi báo 2026-10-27 (xuất tiêu hao bị chặn oan cho chính PI đã mua hàng / PI khác lấy
 * mất hàng vừa mua). Chạy trên Postgres TEST riêng (docker-compose.test.yml, cổng 5433, tmpfs) -
 * KHÔNG đụng DB đang dùng. Mọi dữ liệu tự tạo với hậu tố riêng, dọn lại ở afterAll.
 *
 * Gọi THẬT MaterialIssuesService.create() + StockReservationsService.creditPool()/reserveOrAdjust()
 * (đúng 2 hàm PurchaseProposalsService.receiveItem() và ConsumableMaterialPurchaseService gọi),
 * chỉ mock thông báo/realtime (không liên quan).
 */
describe('Giữ chỗ tồn kho vật tư tiêu hao theo PI (integration, real Postgres)', () => {
  let prisma: PrismaServiceType;
  let issues: MaterialIssuesService;
  let purchase: ConsumableMaterialPurchaseService;
  let reservations: StockReservationsService;
  let ledger: StockLedgerService;

  const sfx = Date.now();
  let userId: string;
  let whId: bigint;
  let supplierWhId: bigint;
  let mfgProductId: bigint;
  let bomRevisionId: bigint;
  const createdWarehouseCodes: string[] = [];
  const created = {
    materials: [] as bigint[],
    invoices: [] as bigint[],
    orders: [] as bigint[],
    items: [] as bigint[],
  };

  async function upsertVirtualWarehouse(code: string): Promise<bigint> {
    const existing = await prisma.warehouse.findUnique({ where: { code } });
    if (existing) return existing.id;
    createdWarehouseCodes.push(code);
    return (await prisma.warehouse.create({ data: { code, name: code, isVirtual: true } })).id;
  }

  /** Vật tư mới + tồn `onHand` nhập qua sổ cái thật (stock_quant do trigger DB cập nhật). */
  async function makeMaterial(tag: string, onHand: number): Promise<bigint> {
    const m = await prisma.material.create({
      data: { code: `REPRO-${tag}-${sfx}`, name: `Sơn LIVE ${tag}`, unit: 'kg', warehouseId: whId },
    });
    created.materials.push(m.id);
    if (onHand > 0) {
      await ledger.postEntry({
        fromWarehouseId: supplierWhId,
        toWarehouseId: whId,
        materialId: m.id,
        qty: onHand,
        refType: StockLedgerRefType.OPENING_BALANCE,
        refId: `repro-${tag}-${sfx}`,
        idempotencyKey: `repro-open-${tag}-${sfx}`,
      });
    }
    return m.id;
  }

  /** PI + item + lệnh SX (floor ACTIVE) + định mức tiêu hao SON cho `materialId`. */
  async function makePi(tag: string, materialId: bigint, qtyPerUnit: number, orderQty: number) {
    const pi = await prisma.productionInvoice.create({ data: { code: `REPRO-PI-${tag}-${sfx}` } });
    created.invoices.push(pi.id);
    const item = await prisma.productionInvoiceItem.create({
      data: { productionInvoiceId: pi.id, mfgProductId, quantity: orderQty },
    });
    created.items.push(item.id);
    const order = await prisma.productionOrder.create({
      data: {
        poNumber: `REPRO-PO-${tag}-${sfx}`,
        productionInvoiceItemId: item.id,
        mfgProductId,
        bomRevisionId,
        quantity: orderQty,
        floorStage: ProductionOrderFloorStage.ACTIVE,
      },
    });
    created.orders.push(order.id);
    await prisma.consumableBom.upsert({
      where: {
        bomRevisionId_stage_materialId: { bomRevisionId, stage: MfgStage.SON, materialId },
      },
      create: { bomRevisionId, stage: MfgStage.SON, materialId, qtyPerUnit },
      update: { qtyPerUnit },
    });
    return { piId: pi.id, orderId: order.id };
  }

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
        MaterialIssuesService,
        ConsumableMaterialPurchaseService,
        StockLedgerService,
        StockReservationsService,
        { provide: NotificationsService, useValue: { emit: jest.fn(), resolve: jest.fn() } },
        { provide: RealtimeService, useValue: { publishEntityChanged: jest.fn() } },
      ],
    }).compile();

    prisma = moduleRef.get(PRISMA_SERVICE);
    issues = moduleRef.get(MaterialIssuesService);
    purchase = moduleRef.get(ConsumableMaterialPurchaseService);
    reservations = moduleRef.get(StockReservationsService);
    ledger = moduleRef.get(StockLedgerService);

    userId = (
      await prisma.user.create({
        data: {
          username: `repro-${sfx}`,
          password: 'x',
          firstName: 'Repro',
          lastName: 'Test',
        },
      })
    ).id;
    whId = (await prisma.warehouse.create({ data: { code: `repro-wh-${sfx}`, name: 'Kho repro' } }))
      .id;
    createdWarehouseCodes.push(`repro-wh-${sfx}`);
    supplierWhId = await upsertVirtualWarehouse('SUPPLIER');
    await upsertVirtualWarehouse('PRODUCTION'); // kho đích của xuất tiêu hao, service tự tra theo code
    mfgProductId = (
      await prisma.mfgProduct.create({ data: { factoryCode: `REPRO-${sfx}`, name: 'SP repro' } })
    ).id;
    bomRevisionId = (
      await prisma.bomRevision.create({
        data: { mfgProductId, revNo: 1, status: BomRevisionStatus.DRAFT },
      })
    ).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    // Test DB tmpfs, nhưng vẫn dọn đúng những gì mình tạo (không đụng dòng nào khác).
    const matIds = created.materials;
    await prisma.purchaseProposalItem.deleteMany({
      where: { proposal: { productionInvoiceId: { in: created.invoices } } },
    });
    await prisma.purchaseProposal.deleteMany({
      where: { productionInvoiceId: { in: created.invoices } },
    });
    await prisma.stockReservation.deleteMany({ where: { materialId: { in: matIds } } });
    await prisma.materialIssue.deleteMany({ where: { productionOrderId: { in: created.orders } } });
    await prisma.consumableBom.deleteMany({ where: { bomRevisionId } });
    await prisma.stockLedger.deleteMany({ where: { materialId: { in: matIds } } });
    await prisma.stockQuant.deleteMany({ where: { materialId: { in: matIds } } });
    await prisma.productionOrder.deleteMany({ where: { id: { in: created.orders } } });
    await prisma.productionInvoiceItem.deleteMany({ where: { id: { in: created.items } } });
    await prisma.productionInvoice.deleteMany({ where: { id: { in: created.invoices } } });
    await prisma.bomRevision.deleteMany({ where: { id: bomRevisionId } });
    await prisma.mfgProduct.deleteMany({ where: { id: mfgProductId } });
    await prisma.material.deleteMany({ where: { id: { in: matIds } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.warehouse.deleteMany({ where: { code: { in: createdWarehouseCodes } } });
    await prisma.$disconnect();
  });

  it('hàng về giữ cho PI A (kho hết sạch lúc tính) -> chính PI A xuất sơn được, không bị chặn "tồn khả dụng 0"', async () => {
    // Kho trống, PI A mua 100 -> hàng về (nhập kho thật) + receiveItem() gọi creditPool().
    const materialId = await makeMaterial('L1', 100);
    const a = await makePi('L1-A', materialId, 1, 10); // cần 10 kg, tồn vật lý 100

    await prisma.$transaction((tx) =>
      reservations.creditPool(tx, {
        productionInvoiceId: a.piId,
        materialId,
        warehouseId: whId,
        qty: 100,
      }),
    );
    const rows = await prisma.stockReservation.findMany({ where: { materialId } });
    console.log(
      '[PI A] giữ chỗ sau khi hàng về:',
      rows.map((r) => `${r.refType} PI=${r.productionInvoiceId} qty=${r.quantity.toString()}`),
    );

    // Kỳ vọng ĐÚNG: PI A xuất 10 / tồn 100 (giữ cho chính nó) phải thành công.
    await expect(
      issues.create(
        a.orderId.toString(),
        { stage: MfgStage.SON, materialId: materialId.toString(), issuedQty: 10 },
        userId,
        null,
      ),
    ).resolves.toBeDefined();
  });

  it('hàng về cộng vào giữ chỗ của PI A (kho còn ít lúc tính) -> PI B KHÔNG lấy mất được hàng mua cho PI A', async () => {
    // Tồn 30 lúc PI A tính đề xuất mua (cần 100) -> giữ 30 (CONSUMABLE_MATERIAL_PURCHASE),
    // mua thêm 70, về kho -> tồn vật lý 100, receiveItem() credit 70.
    const materialId = await makeMaterial('L2', 30);
    const a = await makePi('L2-A', materialId, 10, 10); // PI A định mức 100
    const b = await makePi('L2-B', materialId, 10, 10); // PI B cũng định mức 100

    await prisma.$transaction(async (tx) => {
      await reservations.reserveOrAdjust(tx, {
        warehouseId: whId,
        materialId,
        qty: 30,
        refType: StockReservationRefType.CONSUMABLE_MATERIAL_PURCHASE,
        refId: a.piId.toString(),
        productionInvoiceId: a.piId,
      });
    });
    await ledger.postEntry({
      fromWarehouseId: supplierWhId,
      toWarehouseId: whId,
      materialId,
      qty: 70,
      refType: StockLedgerRefType.PURCHASE,
      refId: `repro-L2-${sfx}`,
      idempotencyKey: `repro-purchase-L2-${sfx}`,
    });
    await prisma.$transaction((tx) =>
      reservations.creditPool(tx, {
        productionInvoiceId: a.piId,
        materialId,
        warehouseId: whId,
        qty: 70,
      }),
    );
    const rows = await prisma.stockReservation.findMany({ where: { materialId } });
    console.log(
      '[PI A+B] giữ chỗ sau khi hàng về:',
      rows.map((r) => `${r.refType} PI=${r.productionInvoiceId} qty=${r.quantity.toString()}`),
    );

    // Kỳ vọng ĐÚNG: 100 kg đã được giữ đích danh cho PI A -> PI B KHÔNG được lấy.
    await expect(
      issues.create(
        b.orderId.toString(),
        { stage: MfgStage.SON, materialId: materialId.toString(), issuedQty: 100 },
        userId,
        null,
      ),
    ).rejects.toThrow();
  });
  /** Số còn được giữ cho PI (phần chưa xuất) của mọi dòng giữ chỗ ACTIVE của vật tư. */
  async function remainingReserved(materialId: bigint, piId: bigint): Promise<number> {
    const rows = await prisma.stockReservation.findMany({
      where: { materialId, productionInvoiceId: piId, status: 'ACTIVE' },
    });
    return rows.reduce((sum, r) => sum + r.quantity.toNumber() - r.consumedQty.toNumber(), 0);
  }

  async function buyQtyOf(materialId: bigint, piId: bigint): Promise<number> {
    const items = await prisma.purchaseProposalItem.findMany({
      where: { materialId, proposal: { productionInvoiceId: piId } },
    });
    return items.reduce((sum, i) => sum + i.buyQty.toNumber(), 0);
  }

  it('tính lại đề xuất mua SAU KHI hàng về: giữ chỗ vẫn đủ 100 cho PI A (shrinkToFloor không làm mất phần hàng mua về)', async () => {
    const materialId = await makeMaterial('R1', 30);
    const a = await makePi('R1-A', materialId, 10, 10); // cần 100
    const b = await makePi('R1-B', materialId, 10, 10);

    await purchase.computeAndUpsertProposals(a.piId.toString()); // tồn 30 -> giữ 30, mua 70
    expect(await remainingReserved(materialId, a.piId)).toBe(30);
    expect(await buyQtyOf(materialId, a.piId)).toBe(70);

    await ledger.postEntry({
      fromWarehouseId: supplierWhId,
      toWarehouseId: whId,
      materialId,
      qty: 70,
      refType: StockLedgerRefType.PURCHASE,
      refId: `repro-R1-${sfx}`,
      idempotencyKey: `repro-purchase-R1-${sfx}`,
    });
    await prisma.$transaction((tx) =>
      reservations.creditPool(tx, {
        productionInvoiceId: a.piId,
        materialId,
        warehouseId: whId,
        qty: 70,
      }),
    );

    await purchase.computeAndUpsertProposals(a.piId.toString()); // tính lại
    console.log(
      '[R1] sau tính lại: giữ còn',
      await remainingReserved(materialId, a.piId),
      'buyQty',
      await buyQtyOf(materialId, a.piId),
    );
    expect(await remainingReserved(materialId, a.piId)).toBe(100);
    await expect(
      issues.create(
        b.orderId.toString(),
        { stage: MfgStage.SON, materialId: materialId.toString(), issuedQty: 100 },
        userId,
        null,
      ),
    ).rejects.toThrow();
  });

  // LỖI ĐÃ BIẾT, ưu tiên thấp (chưa sửa, 2026-10-27): ConsumableMaterialPurchaseService tính `required` là TỔNG
  // định mức của PI chứ không trừ phần ĐÃ xuất, nên nếu tính lại SAU khi xuất 20/100 sẽ thấy "cần 100, tồn 80" ->
  // mua thừa 20 và chỉ giữ chỗ còn 60 thay vì 80. Luồng thường chỉ tính 1 LẦN ngay sau khi Sếp duyệt PI (lúc chưa
  // xuất gì) nên hiếm gặp; đường tính lại duy nhất đã thấy là retryProductionOrder() (Admin cứu SKU kẹt).
  // Test chạy ĐÚNG hành vi mong muốn nên đang fail - `it.failing` giữ suite xanh; khi sửa xong đổi lại thành `it`
  // (Jest sẽ báo lỗi nếu test này bắt đầu pass mà vẫn còn `.failing`).
  it.failing(
    'tính lại đề xuất mua SAU KHI PI A đã xuất 20/100: không mua thừa, phần còn lại (80) vẫn được giữ đủ cho PI A',
    async () => {
      const materialId = await makeMaterial('R2', 100);
      const a = await makePi('R2-A', materialId, 10, 10); // cần 100, tồn 100
      const b = await makePi('R2-B', materialId, 10, 10);

      await purchase.computeAndUpsertProposals(a.piId.toString());
      expect(await remainingReserved(materialId, a.piId)).toBe(100);
      expect(await buyQtyOf(materialId, a.piId)).toBe(0);

      await issues.create(
        a.orderId.toString(),
        { stage: MfgStage.SON, materialId: materialId.toString(), issuedQty: 20 },
        userId,
        null,
      ); // tồn còn 80, đã tiêu 20

      await purchase.computeAndUpsertProposals(a.piId.toString()); // tính lại
      console.log(
        '[R2] sau tính lại: giữ còn',
        await remainingReserved(materialId, a.piId),
        'buyQty',
        await buyQtyOf(materialId, a.piId),
      );
      expect(await buyQtyOf(materialId, a.piId)).toBe(0); // còn cần 80, tồn 80
      expect(await remainingReserved(materialId, a.piId)).toBe(80);
      await expect(
        issues.create(
          b.orderId.toString(),
          { stage: MfgStage.SON, materialId: materialId.toString(), issuedQty: 1 },
          userId,
          null,
        ),
      ).rejects.toThrow(); // 80 còn lại đã giữ cho PI A
    },
  );
});
