import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Gán lại tồn kho SẮT hiện có đang nằm ở "ngăn chiều dài 0" (stockLengthMm=0 - mọi bút toán trước
 * 2026-09-05 đều ghi mặc định vậy, vì chưa có code nào truyền chiều dài thật) sang ngăn 6000mm -
 * chiều dài chuẩn duy nhất từng dùng tới nay (SystemConfig.solverStockLengths).
 *
 * VÌ SAO CẦN: sau khi steel-issues/cutting-proposals/purchase-proposals bắt đầu ghi
 * `stockLengthMm` thật (xem changelog sửa "Cần" 2026-09-05), các truy vấn tồn kho/giữ chỗ mới đều
 * LỌC theo đúng bucket chiều dài đang cần - tồn cũ nằm ở bucket 0 sẽ "biến mất" khỏi màn hình cho
 * tới khi có phiếu nhập mới. Script này gán lại 1 LẦN để dữ liệu test/đang dùng dở không bị hụt.
 *
 * CHẠY 1 LẦN (dry-run trước để soát):
 *   npm run backfill:stock-length-steel -- --dry-run
 *   npm run backfill:stock-length-steel
 *
 * CÁCH GHI: `stock_quant` là bảng CACHE do trigger DB tự tính lại mỗi khi `stock_ledger` có dòng
 * mới (app không bao giờ ghi trực tiếp bảng này, xem StockLedgerService) - nên KHÔNG update thẳng
 * `stock_quant`, mà ghi 2 bút toán `stock_ledger` bù trừ qua kho ảo OPENING_BALANCE (đúng kho ảo
 * `materials.service.ts` đã dùng để bơm/rút tồn không qua nhà cung cấp thật):
 *   - Trừ số hiện có khỏi bucket 0 (from=kho sắt, to=OPENING_BALANCE, stockLengthMm=0)
 *   - Cộng lại đúng số đó vào bucket 6000 (from=OPENING_BALANCE, to=kho sắt, stockLengthMm=6000)
 * Mỗi bút toán có idempotencyKey RIÊNG (resolve-or-create) - script dừng giữa chừng (crash, Ctrl+C)
 * vẫn chạy lại an toàn: bút toán nào đã ghi thì bỏ qua, bút toán còn thiếu thì ghi tiếp, không bao
 * giờ mất/nhân đôi số lượng.
 *
 * AN TOÀN - CHỦ ĐỘNG BỎ QUA (không tự đoán) khi:
 *   - Vật tư đã có dòng stock_quant ở bucket khác 0 (nghĩa là code MỚI đã sinh dữ liệu thật cho
 *     nó rồi - gộp bucket 0 cũ vào 6000 lúc này có thể SAI nếu bucket 0 còn lại thực ra là 1 lô
 *     chiều dài khác đang chờ dùng nốt).
 *   - Vật tư có PurchaseProposalItem.stockLengthMm ghi nhận khác 6000 (và khác null) - nghĩa là giả
 *     định "chỉ từng mua 6000mm" không đúng cho vật tư này.
 *
 * NGOÀI RA: cũng gán lại `stock_reservations.stockLengthMm` (0 -> 6000) cho dòng ACTIVE của các vật
 * tư sắt hợp lệ ở trên - CuttingProposalsService.approve() từ nay lọc StockReservation theo đúng
 * bucket chiều dài khi tính "available" (getAvailableQty), dòng giữ chỗ cũ ở bucket 0 sẽ bị bỏ sót
 * nếu không gán lại, khiến 1 phương án duyệt MỚI ngay sau khi lên bản này tưởng tồn còn nhiều hơn
 * thực tế. update() trực tiếp - StockReservation là bảng app tự ghi (không phải cache), giống cách
 * backfill-stock-reservation-production-invoice.ts đã làm.
 */

const DRY_RUN = process.argv.includes('--dry-run');
const TARGET_LENGTH_MM = 6000;
const OPENING_BALANCE_WAREHOUSE_CODE = 'OPENING_BALANCE';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function resolveOrCreateLedgerEntry(input: {
  fromWarehouseId: bigint;
  toWarehouseId: bigint;
  materialId: bigint;
  qty: number;
  stockLengthMm: number;
  idempotencyKey: string;
  note: string;
}) {
  const existing = await prisma.stockLedger.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    console.log(`    (đã có sẵn, bỏ qua) ${input.idempotencyKey}`);
    return;
  }
  if (DRY_RUN) {
    console.log(
      `    [dry-run] sẽ ghi StockLedger ${input.idempotencyKey}: ${input.qty} @ ` +
        `stockLengthMm=${input.stockLengthMm} (kho ${input.fromWarehouseId} -> ${input.toWarehouseId})`,
    );
    return;
  }
  await prisma.stockLedger.create({
    data: {
      fromWarehouse: { connect: { id: input.fromWarehouseId } },
      toWarehouse: { connect: { id: input.toWarehouseId } },
      material: { connect: { id: input.materialId } },
      qty: input.qty,
      stockLengthMm: input.stockLengthMm,
      refType: 'ADJUST',
      refId: `backfill-stock-length-steel:${input.materialId}`,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
    },
  });
  console.log(`    đã ghi ${input.idempotencyKey}`);
}

async function main() {
  const openingWarehouse = await prisma.warehouse.findUniqueOrThrow({
    where: { code: OPENING_BALANCE_WAREHOUSE_CODE },
  });

  const steelMaterials = await prisma.material.findMany({
    where: { materialGroup: { systemKey: 'STEEL_BAR' } },
    select: { id: true, code: true },
  });
  const steelMaterialIds = steelMaterials.map((m) => m.id);
  console.log(`Tìm thấy ${steelMaterials.length} vật tư nhóm Sắt (STEEL_BAR).`);

  // Loại vật tư đã có bucket khác 0 - có thể Phần 2 đã sinh dữ liệu thật, không tự đoán.
  const nonZeroQuants = await prisma.stockQuant.findMany({
    where: { materialId: { in: steelMaterialIds }, stockLengthMm: { not: 0 } },
    select: { materialId: true, stockLengthMm: true },
  });
  const skipHasNonZeroBucket = new Set(
    nonZeroQuants.filter((q) => q.materialId != null).map((q) => q.materialId!.toString()),
  );

  // Loại vật tư có PurchaseProposalItem.stockLengthMm khác 6000/null - giả định "chỉ mua 6000mm"
  // không đúng cho vật tư đó.
  const unexpectedLengthItems = await prisma.purchaseProposalItem.findMany({
    where: {
      materialId: { in: steelMaterialIds },
      stockLengthMm: { not: null, notIn: [TARGET_LENGTH_MM] },
    },
    select: { materialId: true, stockLengthMm: true },
  });
  const skipUnexpectedLength = new Set(unexpectedLengthItems.map((i) => i.materialId.toString()));

  for (const m of steelMaterials) {
    const key = m.id.toString();
    if (skipHasNonZeroBucket.has(key)) {
      console.log(`BỎ QUA ${m.code}: đã có stock_quant ở bucket khác 0 - kiểm tra thủ công.`);
    }
    if (skipUnexpectedLength.has(key)) {
      const found = unexpectedLengthItems.find((i) => i.materialId === m.id)?.stockLengthMm;
      console.log(
        `BỎ QUA ${m.code}: PurchaseProposalItem có stockLengthMm=${found}mm (khác ${TARGET_LENGTH_MM}mm) - kiểm tra thủ công.`,
      );
    }
  }

  const eligibleMaterialIds = steelMaterialIds.filter(
    (id) => !skipHasNonZeroBucket.has(id.toString()) && !skipUnexpectedLength.has(id.toString()),
  );

  const zeroQuantsRaw = await prisma.stockQuant.findMany({
    where: { materialId: { in: eligibleMaterialIds }, stockLengthMm: 0, qty: { gt: 0 } },
    select: { warehouseId: true, materialId: true, qty: true },
  });
  // materialId khai báo nullable ở schema (leg dùng chung với segmentSpecId/pieceId/
  // productVariantId) nhưng query trên đã lọc `materialId: { in: eligibleMaterialIds } }` nên luôn
  // có giá trị ở đây - lọc lại để TypeScript hẹp kiểu, không phải vì kỳ vọng gặp null thật.
  const zeroQuants = zeroQuantsRaw.filter(
    (q): q is typeof q & { materialId: bigint } => q.materialId != null,
  );
  console.log(
    `${zeroQuants.length} dòng tồn kho (kho, vật tư) ở bucket 0 đủ điều kiện gán lại sang ${TARGET_LENGTH_MM}mm.`,
  );

  for (const q of zeroQuants) {
    const qty = q.qty.toNumber();
    console.log(`  Vật tư ${q.materialId}, kho ${q.warehouseId}: ${qty} cây`);
    await resolveOrCreateLedgerEntry({
      fromWarehouseId: q.warehouseId,
      toWarehouseId: openingWarehouse.id,
      materialId: q.materialId,
      qty,
      stockLengthMm: 0,
      idempotencyKey: `backfill-stock-length:${q.warehouseId}:${q.materialId}:zero-to-6000:out`,
      note: `Backfill 2026-09-05: rút khỏi bucket 0 (gán lại sang ${TARGET_LENGTH_MM}mm)`,
    });
    await resolveOrCreateLedgerEntry({
      fromWarehouseId: openingWarehouse.id,
      toWarehouseId: q.warehouseId,
      materialId: q.materialId,
      qty,
      stockLengthMm: TARGET_LENGTH_MM,
      idempotencyKey: `backfill-stock-length:${q.warehouseId}:${q.materialId}:zero-to-6000:in`,
      note: `Backfill 2026-09-05: gán vào bucket ${TARGET_LENGTH_MM}mm (từ bucket 0)`,
    });
  }

  // StockReservation là bảng app tự ghi (không phải cache) - update thẳng, không qua ledger.
  const reservations = await prisma.stockReservation.findMany({
    where: {
      materialId: { in: eligibleMaterialIds },
      stockLengthMm: 0,
      status: 'ACTIVE',
    },
    select: { id: true, materialId: true },
  });
  console.log(
    `${reservations.length} dòng StockReservation ACTIVE ở bucket 0 sẽ gán lại sang ${TARGET_LENGTH_MM}mm.`,
  );
  for (const r of reservations) {
    if (DRY_RUN) {
      console.log(`    [dry-run] sẽ update StockReservation ${r.id} (vật tư ${r.materialId})`);
      continue;
    }
    await prisma.stockReservation.update({
      where: { id: r.id },
      data: { stockLengthMm: TARGET_LENGTH_MM },
    });
    console.log(`    đã update StockReservation ${r.id}`);
  }

  console.log(DRY_RUN ? 'Dry-run xong - chưa ghi gì.' : 'Hoàn tất.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
