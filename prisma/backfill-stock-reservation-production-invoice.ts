import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Lấp `stock_reservations.productionInvoiceId` cho dòng CUTTING_PROPOSAL tạo TRƯỚC khi có cột
 * này (L5, 2026-08-26 - xem StockReservationsService.loadPool/creditPool/drainPool).
 *
 * BẮT BUỘC chạy trước khi coi tính năng pool-theo-PI là xong: thiếu bước này, mọi dòng giữ chỗ
 * ACTIVE đang có sẵn (PI đang sản xuất dở) sẽ có productionInvoiceId=NULL - loadPool() không thấy
 * chúng, Phôi xuất sắt cho các PI đó sẽ ăn ngay ConflictException "chưa từng giữ chỗ" dù tồn/hàng
 * mua thực tế đã đủ.
 *
 * CHẠY 1 LẦN:  npm run backfill:stock-reservation-pi
 *
 * Suy productionInvoiceId từ CuttingProposal (refId): trực tiếp nếu neo PI (đợt gộp), qua PO
 * thành viên nếu neo PO (SKU cắt riêng) - cùng logic resolveTargetProductionInvoiceId() ở
 * CuttingProposalsService. Chỉ đụng dòng còn thiếu (productionInvoiceId IS NULL), refType=
 * CUTTING_PROPOSAL - chạy lại nhiều lần vô hại.
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const rows = await prisma.stockReservation.findMany({
    where: { refType: 'CUTTING_PROPOSAL', productionInvoiceId: null },
    select: { id: true, refId: true },
  });
  console.log(`Tìm thấy ${rows.length} dòng StockReservation thiếu productionInvoiceId.`);

  let filled = 0;
  let skipped = 0;
  for (const row of rows) {
    const cuttingProposalId = BigInt(row.refId);
    const proposal = await prisma.cuttingProposal.findUnique({
      where: { id: cuttingProposalId },
      select: {
        productionInvoiceId: true,
        productionOrder: {
          select: { productionInvoiceItem: { select: { productionInvoiceId: true } } },
        },
      },
    });
    const productionInvoiceId =
      proposal?.productionInvoiceId ??
      proposal?.productionOrder?.productionInvoiceItem.productionInvoiceId ??
      null;
    if (!productionInvoiceId) {
      console.log(
        `  BỎ QUA dòng ${row.id} (refId=${row.refId}) - không suy ra được PI (dữ liệu hỏng?).`,
      );
      skipped += 1;
      continue;
    }
    await prisma.stockReservation.update({
      where: { id: row.id },
      data: { productionInvoiceId },
    });
    filled += 1;
  }
  console.log(`Đã lấp ${filled} dòng, bỏ qua ${skipped} dòng.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
