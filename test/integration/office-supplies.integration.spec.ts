import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import configuration from '../../src/config/configuration';
import { envValidationSchema } from '../../src/config/env.validation';
import { OfficeSupplyLedgerReason } from '../../src/generated/prisma/client';
import { OfficeSuppliesModule } from '../../src/modules/office-supplies/office-supplies.module';
import { OfficeSuppliesService } from '../../src/modules/office-supplies/office-supplies.service';
import { PRISMA_SERVICE, PrismaServiceType } from '../../src/prisma/prisma.service';
import { PrismaModule } from '../../src/prisma/prisma.module';

/**
 * Test này chạy trên Postgres THẬT (test/jest-integration.json, xem docker-compose.test.yml) -
 * KHÔNG mock Prisma. Mục đích: `office-supplies.service.spec.ts` (unit, mock) chỉ chứng minh
 * code PHẢN ỨNG đúng khi `updateMany` trả `count: 0` - nó không chứng minh Postgres thật sự khoá
 * đúng dưới tải đồng thời. Bài học từ audit trước đây (race PurchaseProposalItem, race QLSX
 * floor gate...): guard logic đúng trên giấy vẫn có thể bị vô hiệu hoá âm thầm bởi 1 lần refactor
 * (vd đổi `updateMany` thành `update` + check riêng, tách điều kiện ra khỏi transaction...) mà
 * unit test mock không bắt được vì nó không thực sự chạy qua transaction/lock thật của DB.
 */
describe('OfficeSuppliesService (integration, real Postgres) - race condition', () => {
  let service: OfficeSuppliesService;
  let prisma: PrismaServiceType;
  let warehouseId: bigint;
  const warehouseCode = `race-test-wh-${Date.now()}`;

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
        OfficeSuppliesModule,
      ],
    }).compile();

    service = moduleRef.get(OfficeSuppliesService);
    prisma = moduleRef.get(PRISMA_SERVICE);

    const warehouse = await prisma.warehouse.create({
      data: { code: warehouseCode, name: 'Race Test Warehouse' },
    });
    warehouseId = warehouse.id;
  });

  afterAll(async () => {
    await prisma.officeSupplyLedgerEntry.deleteMany({ where: { officeSupply: { warehouseId } } });
    await prisma.officeSupply.deleteMany({ where: { warehouseId } });
    await prisma.warehouse.delete({ where: { id: warehouseId } });
    await prisma.$disconnect();
  });

  it('2 lệnh xuất đồng thời cùng vượt tồn: đúng 1 lệnh thành công, không âm kho', async () => {
    const created = await service.create(
      { name: 'Bút bi race test', unit: 'cái', openingQty: 10 },
      warehouseCode,
    );

    // Cả 2 request cùng xuất 6 (tổng 12 > tồn 10) - nếu guard chỉ đúng "trên giấy" (vd đọc quantity
    // rồi so sánh ở tầng ứng dụng thay vì để Postgres tự khoá trong 1 câu UPDATE), 2 request có thể
    // cùng đọc thấy "đủ tồn" rồi cùng trừ, làm âm kho. Promise.allSettled để lấy kết quả CẢ HAI
    // nhánh (không cho 1 exception dừng ngang việc kiểm tra nhánh còn lại).
    const [r1, r2] = await Promise.allSettled([
      service.adjustQuantity(
        created.id,
        { changeQty: -6, reason: OfficeSupplyLedgerReason.EXPORT },
        null,
        warehouseCode,
      ),
      service.adjustQuantity(
        created.id,
        { changeQty: -6, reason: OfficeSupplyLedgerReason.EXPORT },
        null,
        warehouseCode,
      ),
    ]);

    const outcomes = [r1, r2];
    const fulfilled = outcomes.filter((r) => r.status === 'fulfilled');
    const rejected = outcomes.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as Error).message).toMatch(/Không đủ tồn/);

    // Nguồn sự thật là chính hàng trong DB (không phải giá trị trả về của promise đã fulfilled) -
    // đọc lại để chắc chắn không có bút toán "ma" nào lọt qua ngoài đúng 1 lần trừ 6.
    const final = await prisma.officeSupply.findUniqueOrThrow({
      where: { id: BigInt(created.id) },
    });
    expect(Number(final.quantity)).toBe(4);
    expect(Number(final.quantity)).toBeGreaterThanOrEqual(0);

    const ledgerCount = await prisma.officeSupplyLedgerEntry.count({
      where: { officeSupplyId: BigInt(created.id) },
    });
    // INITIAL (tồn ban đầu) + đúng 1 dòng EXPORT thành công - KHÔNG phải 2 (nếu guard hỏng, cả 2
    // request đều ghi được ledger dù 1 trong 2 lẽ ra phải bị từ chối trước khi tới bước ghi sổ).
    expect(ledgerCount).toBe(2);
  });
});
