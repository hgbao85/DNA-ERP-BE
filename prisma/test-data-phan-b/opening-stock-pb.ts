/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any -- script dựng dữ liệu thử (ngoài ứng dụng), gọi Prisma/service kiểu lỏng */
/**
 * Tồn đầu kỳ cho buổi test PB (12/11) - chạy SAU build-pb-a.ts + build-pb-pgd.ts để không ảnh hưởng giữ chỗ lúc Sếp duyệt.
 * Ghi qua StockLedgerService.postEntry (service thật) từ kho ảo OPENING_BALANCE vào kho của chính vật tư,
 * refType ADJUST, refId 'PB-OPEN', idempotencyKey 'PB-OPEN:<mã>:<kho>' -> chạy lại không cộng trùng.
 * reset-pb.ts trả ngược + xoá các dòng này.
 *
 *   cd D:\DNA-ERP-BE
 *   NODE_PATH="D:/DNA-ERP-BE/node_modules" npx ts-node --transpile-only -P tsconfig.json prisma/test-data-phan-b/opening-stock-pb.ts
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ClsService, CLS_ID } from 'nestjs-cls';
import { AppModule } from 'D:/DNA-ERP-BE/src/app.module';
import { PRISMA_SERVICE } from 'D:/DNA-ERP-BE/src/prisma/prisma.service';
import { StockLedgerService } from 'D:/DNA-ERP-BE/src/modules/stock/stock-ledger.service';
import { StockLedgerRefType } from 'D:/DNA-ERP-BE/src/generated/prisma/client';

/** [mã vật tư, kho mong đợi (= Material.warehouseId), số lượng] */
const ROWS: [string, string, number][] = [
  ['DAY-010', 'vat-tu-tp', 50],
  ['DINH-001', 'vat-tu-tp', 300],
  ['NN-001', 'vat-tu-tp', 300],
  ['CHAN-NHOM-01', 'vat-tu-tp', 100],
  ['VTK-352', 'thanh-pham', 40],
  ['SAT-015', 'phoi-son-han', 10],
  ['SAT-009', 'phoi-son-han', 30], // Bánh đá cắt
];

/**
 * `--bo-sung`: nạp thêm lần 2 (11/11/2026) - lệnh PI 79 của bên Kế hoạch (cùng DB dev) đã giữ hết đinh/dây tồn đầu kỳ ở kho
 * Phụ kiện. Khoá riêng 'PB-OPEN-2:...' nên chạy lại không cộng trùng; vẫn refId 'PB-OPEN' để reset-pb.ts trả ngược như lần 1.
 */
const ROWS_BO_SUNG: [string, string, number][] = [
  ['DAY-010', 'vat-tu-tp', 50],
  ['DINH-001', 'vat-tu-tp', 300],
];
const BO_SUNG = process.argv.includes('--bo-sung');
/** `--bo-sung --lan 3`: nạp bổ sung lần thứ n (mỗi lần 1 khoá chống trùng riêng PB-OPEN-<n>) - 13/11/2026 lệnh PI 79 tính lại
 *  đã giữ hết phần nạp lần 2. Không ghi --lan thì là lần 2 như trước. */
const lanIdx = process.argv.indexOf('--lan');
const LAN = lanIdx >= 0 ? Number(process.argv[lanIdx + 1]) : 2;
if (!Number.isInteger(LAN) || LAN < 2) throw new Error('--lan phải là số nguyên >= 2');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma: any = app.get(PRISMA_SERVICE);
    const cls = app.get(ClsService);
    const ledger = app.get(StockLedgerService);
    const admin = await prisma.user.findFirstOrThrow({ where: { username: 'admin' } });
    const opening = await prisma.warehouse.findUniqueOrThrow({
      where: { code: 'OPENING_BALANCE' },
    });
    for (const [code, whCode, qty] of BO_SUNG ? ROWS_BO_SUNG : ROWS) {
      const m = await prisma.material.findUniqueOrThrow({
        where: { code },
        include: { warehouse: true },
      });
      if (m.warehouse?.code !== whCode)
        throw new Error(`${code}: kho của vật tư là ${m.warehouse?.code}, không phải ${whCode}`);
      const r = await cls.run(async () => {
        cls.set(CLS_ID, 'PB-OPEN');
        cls.set('userId', admin.id);
        return ledger.postEntry({
          fromWarehouseId: opening.id,
          toWarehouseId: m.warehouseId,
          materialId: m.id,
          qty,
          refType: StockLedgerRefType.ADJUST,
          refId: 'PB-OPEN',
          note: BO_SUNG
            ? 'Tồn đầu kỳ dữ liệu thử PB (12/11) - nạp bổ sung'
            : 'Tồn đầu kỳ dữ liệu thử PB (12/11)',
          createdById: admin.id,
          idempotencyKey: `${BO_SUNG ? `PB-OPEN-${LAN}` : 'PB-OPEN'}:${code}:${whCode}`,
        });
      });
      const q = await prisma.stockQuant.findFirst({
        where: { warehouseId: m.warehouseId, materialId: m.id, stockLengthMm: 0, spec: '' },
      });
      console.log(
        `${code.padEnd(13)} ${m.unit.padEnd(5)} +${qty} -> ${whCode} (ledger ${r.id}) tồn bucket 0 = ${q?.qty}`,
      );
    }
  } finally {
    await app.close();
  }
}
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
