import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Dựng `cutting_plan_coverage` cho các phương án cắt ĐÃ duyệt trước 2026-08-27 (bảng chưa tồn tại
 * lúc đó).
 *
 * CHẠY 1 LẦN:  npm run backfill:cutting-plan-coverage
 *
 * ------------------------------------------------------------------------------------------
 * BẮT BUỘC chạy, nếu không dữ liệu cũ KHÔNG được bất biến bảo vệ
 * ------------------------------------------------------------------------------------------
 * `claimCuttingPlanCoverage()` chặn phủ chồng bằng cách soi dòng phủ hiện có. SKU đã được 1 phương
 * án APPROVED phủ từ trước mà KHÔNG có dòng phủ thì lượt duyệt tiếp theo thấy "chưa ai phủ" và đi
 * tiếp - đúng ca phủ chồng mà bảng này sinh ra để chặn.
 *
 * ------------------------------------------------------------------------------------------
 * TỰ PHÁT HIỆN DỮ LIỆU ĐÃ HỎNG SẴN
 * ------------------------------------------------------------------------------------------
 * Nếu hiện đã có 2 phương án APPROVED cùng phủ 1 SKU (tức lỗi L2 ĐÃ nổ trên dữ liệu thật trước khi
 * có cổng chặn), script DỪNG và liệt kê ra thay vì chọn bừa 1 phương án làm chủ - việc chọn sai
 * khiến số liệu giữ chỗ/đề xuất mua lệch tiếp mà không ai biết. Cần người xem và quyết định phương
 * án nào giữ, phương án nào phải supersede thủ công.
 *
 * KHÔNG đụng tồn kho/giữ chỗ/trạng thái phương án - chỉ ghi bảng phủ. Chạy lại nhiều lần vô hại
 * (bỏ qua SKU đã có dòng phủ).
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const approved = await prisma.cuttingProposal.findMany({
    where: { status: 'APPROVED' },
    select: { id: true, productionOrderId: true, productionInvoiceId: true },
    orderBy: { approvedAt: 'asc' },
  });
  console.log(`Tìm thấy ${approved.length} phương án cắt đang APPROVED.`);

  // SKU -> các phương án APPROVED đang phủ nó. Dựng đầy đủ TRƯỚC khi ghi, để phát hiện phủ chồng
  // có sẵn (nếu ghi dần sẽ ăn lỗi trùng khoá giữa chừng, để lại bảng lấp dở).
  const ownersByOrder = new Map<string, bigint[]>();
  for (const p of approved) {
    const orderIds = p.productionOrderId
      ? [p.productionOrderId]
      : p.productionInvoiceId
        ? (
            await prisma.productionOrder.findMany({
              where: { productionInvoiceItem: { productionInvoiceId: p.productionInvoiceId } },
              select: { id: true },
            })
          ).map((o) => o.id)
        : [];
    for (const orderId of orderIds) {
      const key = orderId.toString();
      ownersByOrder.set(key, [...(ownersByOrder.get(key) ?? []), p.id]);
    }
  }

  const conflicts = [...ownersByOrder.entries()].filter(([, owners]) => owners.length > 1);
  if (conflicts.length > 0) {
    console.error('PHỦ CHỒNG ĐÃ CÓ SẴN - dừng lại, không tự chọn chủ:');
    for (const [orderId, owners] of conflicts) {
      console.error(
        `  ProductionOrder ${orderId} đang bị ${owners.length} phương án APPROVED cùng phủ: ${owners.join(', ')}`,
      );
    }
    throw new Error(
      `${conflicts.length} SKU bị phủ chồng - cần xử lý thủ công (chọn phương án giữ lại, ` +
        `supersede các phương án còn lại) rồi chạy lại script này.`,
    );
  }

  let created = 0;
  let skipped = 0;
  for (const [orderId, owners] of ownersByOrder) {
    const productionOrderId = BigInt(orderId);
    const existing = await prisma.cuttingPlanCoverage.findUnique({ where: { productionOrderId } });
    if (existing) {
      skipped += 1;
      continue;
    }
    await prisma.cuttingPlanCoverage.create({
      data: { productionOrderId, cuttingProposalId: owners[0] },
    });
    created += 1;
  }
  console.log(`Đã ghi ${created} dòng phủ, bỏ qua ${skipped} dòng đã có sẵn.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
