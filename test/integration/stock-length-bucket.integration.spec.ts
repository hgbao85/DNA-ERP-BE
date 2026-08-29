import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import configuration from '../../src/config/configuration';
import { envValidationSchema } from '../../src/config/env.validation';
import { lockBusinessKey } from '../../src/common/utils/advisory-lock.util';
import { StockLedgerRefType } from '../../src/generated/prisma/client';
import { PRISMA_SERVICE, PrismaServiceType } from '../../src/prisma/prisma.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { StockLedgerService } from '../../src/modules/stock/stock-ledger.service';
import { StockModule } from '../../src/modules/stock/stock.module';

/**
 * Kế hoạch "chiều dài cây sắt" 2026-08-29, Bước 9 - test tích hợp DB thật cho trigger
 * fn_sync_stock_quant() và các CHECK constraint/partial unique index mới thêm ở Bước 1. Unit test
 * mock Prisma (stock-ledger.service.spec.ts) không chứng minh được gì cho thay đổi sửa thẳng thân
 * trigger/constraint - cần chạy thật trên Postgres.
 *
 * Phạm vi test concurrency (đọc kỹ trước khi coi đây là bằng chứng cho CuttingProposalsService):
 * test dưới đây xác nhận CƠ CHẾ CHUNG `lockBusinessKey()` (2 transaction cùng khoá 1 advisory lock
 * key tự serialize) - đây ĐÚNG LÀ cơ chế Bước 4 dùng để vá lỗ hổng bucket mới toanh, nhưng test
 * KHÔNG gọi qua CuttingProposalsService.approve() thật (cần dựng lại toàn bộ ProductionInvoice/
 * ProductionOrder/BomRevision/CuttingProposal - vượt phạm vi hợp lý của 1 test tích hợp). Nếu sau
 * này có helper dựng fixture đầy đủ cho CuttingProposal, nên bổ sung thêm 1 test gọi thẳng
 * approve() 2 lần song song để khoá chắc chắn đường thật, không chỉ cơ chế nền.
 */
describe('Stock length bucket (integration, real Postgres)', () => {
  let prisma: PrismaServiceType;
  let stockLedgerService: StockLedgerService;
  let fromWarehouseId: bigint;
  let toWarehouseId: bigint;
  let materialId: bigint;
  let segmentSpecMaterialId: bigint;
  let segmentSpecId: bigint;

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
        StockModule,
      ],
    }).compile();

    prisma = moduleRef.get(PRISMA_SERVICE);
    stockLedgerService = moduleRef.get(StockLedgerService);

    const suffix = Date.now();
    const [fromWh, toWh] = await Promise.all([
      prisma.warehouse.create({
        data: { code: `int-test-from-${suffix}`, name: 'Integration test from' },
      }),
      prisma.warehouse.create({
        data: { code: `int-test-to-${suffix}`, name: 'Integration test to' },
      }),
    ]);
    fromWarehouseId = fromWh.id;
    toWarehouseId = toWh.id;

    const material = await prisma.material.create({
      data: { code: `INT-TEST-STEEL-${suffix}`, name: 'Integration test steel', unit: 'cây' },
    });
    materialId = material.id;

    // Chân segmentSpecId - phải KHÔNG bị ảnh hưởng bởi thay đổi ở chân materialId (3 partial
    // unique index còn lại giữ nguyên không đụng, xem migration Bước 1).
    const segmentSpecMaterial = await prisma.material.create({
      data: {
        code: `INT-TEST-SEGMENT-${suffix}`,
        name: 'Integration test segment material',
        unit: 'đoạn',
      },
    });
    segmentSpecMaterialId = segmentSpecMaterial.id;
    const segmentSpec = await prisma.segmentSpec.create({
      data: { materialId: segmentSpecMaterialId, cutLengthMm: 500 },
    });
    segmentSpecId = segmentSpec.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('2 bucket khác nhau của cùng (kho, vật tư) tạo 2 dòng stock_quant riêng biệt', async () => {
    await stockLedgerService.postEntry({
      fromWarehouseId,
      toWarehouseId,
      materialId,
      stockLengthMm: 6000,
      qty: 10,
      refType: StockLedgerRefType.ADJUST,
      note: 'integration test - bucket 6000',
    });
    await stockLedgerService.postEntry({
      fromWarehouseId,
      toWarehouseId,
      materialId,
      stockLengthMm: 6200,
      qty: 4,
      refType: StockLedgerRefType.ADJUST,
      note: 'integration test - bucket 6200',
    });

    const rows = await prisma.stockQuant.findMany({
      where: { warehouseId: toWarehouseId, materialId },
      orderBy: { stockLengthMm: 'asc' },
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ stockLengthMm: 6000, qty: expect.anything() as unknown });
    expect(rows[0].qty.toNumber()).toBe(10);
    expect(rows[1]).toMatchObject({ stockLengthMm: 6200 });
    expect(rows[1].qty.toNumber()).toBe(4);
  });

  it('cùng bucket cộng dồn vào ĐÚNG 1 dòng stock_quant, không tạo dòng mới', async () => {
    await stockLedgerService.postEntry({
      fromWarehouseId,
      toWarehouseId,
      materialId,
      stockLengthMm: 6000,
      qty: 3,
      refType: StockLedgerRefType.ADJUST,
      note: 'integration test - cộng dồn bucket 6000 lần 2',
    });

    const rows = await prisma.stockQuant.findMany({
      where: { warehouseId: toWarehouseId, materialId, stockLengthMm: 6000 },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].qty.toNumber()).toBe(13); // 10 (test trước) + 3
  });

  it('chân segmentSpecId không bị ảnh hưởng - vẫn ghi/đọc đúng bucket 0, không đụng partial unique index của nó', async () => {
    await stockLedgerService.postEntry({
      fromWarehouseId,
      toWarehouseId,
      segmentSpecId,
      stockLengthMm: 0,
      qty: 7,
      refType: StockLedgerRefType.ADJUST,
      note: 'integration test - segmentSpec leg',
    });

    const rows = await prisma.stockQuant.findMany({
      where: { warehouseId: toWarehouseId, segmentSpecId },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].stockLengthMm).toBe(0);
    expect(rows[0].qty.toNumber()).toBe(7);
  });

  it('stockLengthMm khác 0 thiếu materialId bị CHẶN Ở TẦNG DB (CHECK constraint stock_ledger_stock_length_mm_chk) - không chỉ validate ứng dụng', async () => {
    // Gọi thẳng $executeRaw để bỏ qua validate ở StockLedgerService.postEntry() (đã test riêng ở
    // unit test) - mục đích DUY NHẤT ở đây là xác nhận CHECK constraint THẬT tồn tại trong DB,
    // phòng trường hợp có ai xoá constraint này ở 1 migration sau mà unit test mock không phát
    // hiện được (mock không enforce CHECK constraint).
    await expect(
      prisma.$executeRaw`
        INSERT INTO "stock_ledger"
          ("fromWarehouseId", "toWarehouseId", "segmentSpecId", "stockLengthMm", "qty", "refType")
        VALUES (${fromWarehouseId}, ${toWarehouseId}, ${segmentSpecId}, 6000, 1, 'ADJUST'::"StockLedgerRefType")
      `,
    ).rejects.toThrow(/stock_ledger_stock_length_mm_chk/);
  });

  it('bất biến quant == Σledger theo từng bucket sau chuỗi nhập/xuất hỗn hợp', async () => {
    const suffix = Date.now();
    const material = await prisma.material.create({
      data: {
        code: `INT-TEST-INVARIANT-${suffix}`,
        name: 'Integration test invariant',
        unit: 'cây',
      },
    });

    // Chuỗi bút toán hỗn hợp: nhập bucket A, nhập bucket B, xuất một phần bucket A.
    await stockLedgerService.postEntry({
      fromWarehouseId,
      toWarehouseId,
      materialId: material.id,
      stockLengthMm: 6000,
      qty: 20,
      refType: StockLedgerRefType.ADJUST,
      note: 'invariant - nhập bucket 6000',
    });
    await stockLedgerService.postEntry({
      fromWarehouseId,
      toWarehouseId,
      materialId: material.id,
      stockLengthMm: 6200,
      qty: 8,
      refType: StockLedgerRefType.ADJUST,
      note: 'invariant - nhập bucket 6200',
    });
    await stockLedgerService.postEntry({
      fromWarehouseId: toWarehouseId,
      toWarehouseId: fromWarehouseId,
      materialId: material.id,
      stockLengthMm: 6000,
      qty: 5,
      refType: StockLedgerRefType.ADJUST,
      note: 'invariant - xuất bớt bucket 6000',
    });

    const ledgerRows = await prisma.stockLedger.findMany({
      where: { materialId: material.id },
      select: { fromWarehouseId: true, toWarehouseId: true, stockLengthMm: true, qty: true },
    });
    const ledgerNetByBucket = new Map<number, number>();
    for (const row of ledgerRows) {
      const delta = row.qty.toNumber();
      if (row.toWarehouseId === toWarehouseId) {
        ledgerNetByBucket.set(
          row.stockLengthMm,
          (ledgerNetByBucket.get(row.stockLengthMm) ?? 0) + delta,
        );
      }
      if (row.fromWarehouseId === toWarehouseId) {
        ledgerNetByBucket.set(
          row.stockLengthMm,
          (ledgerNetByBucket.get(row.stockLengthMm) ?? 0) - delta,
        );
      }
    }

    const quantRows = await prisma.stockQuant.findMany({
      where: { warehouseId: toWarehouseId, materialId: material.id },
    });

    expect(quantRows).toHaveLength(2); // bucket 6000 (15 còn lại) + bucket 6200 (8)
    for (const q of quantRows) {
      expect(q.qty.toNumber()).toBe(ledgerNetByBucket.get(q.stockLengthMm));
    }
    expect(quantRows.find((q) => q.stockLengthMm === 6000)?.qty.toNumber()).toBe(15);
    expect(quantRows.find((q) => q.stockLengthMm === 6200)?.qty.toNumber()).toBe(8);
  });

  // Xem docstring đầu file - test này xác nhận CƠ CHẾ NỀN (lockBusinessKey), không phải đường thật
  // CuttingProposalsService.approve(). Đây chính là race Bước 4 tìm ra và vá: 2 lượt duyệt song
  // song cùng (warehouseId, materialId, stockLengthMm) mà bucket đó CHƯA từng có dòng stock_quant
  // nào (bucket hoàn toàn mới) - FOR UPDATE không khoá được gì (chưa có dòng), phải advisory lock.
  it('lockBusinessKey() serialize thật 2 transaction đồng thời cùng khoá 1 bucket mới toanh (Promise.all, không tuần tự)', async () => {
    const key = `integration-test-stock-bucket-${Date.now()}`;
    const events: { label: string; at: number }[] = [];

    const run = (label: string) =>
      prisma.$transaction(async (tx) => {
        await lockBusinessKey(tx, key);
        events.push({ label: `${label}-acquired`, at: Date.now() });
        await new Promise((resolve) => setTimeout(resolve, 300));
        events.push({ label: `${label}-released`, at: Date.now() });
      });

    await Promise.all([run('A'), run('B')]);

    events.sort((a, b) => a.at - b.at);
    // Nếu serialize đúng: sự kiện đầu tiên phải là "X-acquired", và sự kiện NGAY SAU đó phải là
    // "X-released" của CÙNG X - nghĩa là không có "acquired" nào của bên kia chen vào giữa (2
    // transaction chạy song song thật, không phải do code test gọi tuần tự).
    expect(events[0].label.endsWith('-acquired')).toBe(true);
    expect(events[1].label.endsWith('-released')).toBe(true);
    expect(events[0].label.split('-')[0]).toBe(events[1].label.split('-')[0]);
  });
});
