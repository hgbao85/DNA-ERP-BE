import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Lấp `cutting_proposal_lines.buyBars` cho phương án cắt duyệt TRƯỚC 2026-08-26 (cột chưa tồn tại
 * lúc đó).
 *
 * CHẠY 1 LẦN:  npm run backfill:buy-bars
 *
 * ------------------------------------------------------------------------------------------
 * BẮT BUỘC chạy trước khi dùng cơ chế netting (L1)
 * ------------------------------------------------------------------------------------------
 * `CuttingProposalsService.computeNetRequirementByMaterial()` tính nhu cầu gộp bằng
 * `Σ buyBars` của mọi dòng phương án còn hiệu lực. Dòng có buyBars=NULL được cộng 0 (cố ý không
 * đoán bừa) - nghĩa là nếu KHÔNG backfill, nhu cầu của mọi phương án duyệt trước 2026-08-26 sẽ bị
 * tính THIẾU, và lượt duyệt SKU tiếp theo của cùng PI sẽ ghi đè dòng kế hoạch bằng con số hụt.
 *
 * ------------------------------------------------------------------------------------------
 * VÌ SAO SUY ĐƯỢC CHÍNH XÁC
 * ------------------------------------------------------------------------------------------
 * `buyBars` = phần PHẢI MUA của riêng dòng đó = đúng con số đã ghi vào
 * `PurchaseProposalItem.buyQty` lúc approve() tạo đề xuất mua cho chính phương án ấy.
 *
 * Điều này chỉ đúng khi 1 PurchaseProposal ứng với ĐÚNG 1 CuttingProposal - tức cơ chế gộp
 * "1 PI = 1 form" (2026-08-25) CHƯA từng chạy. Script tự KIỂM điều kiện đó trước khi ghi
 * (`purchase_proposals.productionInvoiceId` phải NULL toàn bộ) và dừng ngay nếu không thoả, thay vì
 * lấp số sai âm thầm.
 *
 * Dòng không tìm được PurchaseProposalItem tương ứng = approve() không tạo đề xuất mua cho vật tư
 * đó. Chỉ xảy ra khi dòng bị loại khỏi `buyableLines` (feasible=false hoặc totalBars=0) - script
 * đã lọc feasible=true nên rơi vào đây nghĩa là totalBars=0, buyBars đúng bằng 0.
 *
 * KHÔNG đụng solver, KHÔNG đụng tồn kho/giữ chỗ/trạng thái - chỉ ghi 1 cột số thuần, đọc lại từ dữ
 * liệu ĐÃ CÓ SẴN. Chạy lại nhiều lần vô hại (chỉ đụng dòng còn NULL).
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Điều kiện an toàn: cơ chế gộp chưa chạy thì 1 phiếu mua = 1 phương án cắt, buyQty mới suy
  // ngược về buyBars được. Nếu đã gộp, buyQty là TỔNG của nhiều phương án - không tách lại được,
  // phải dựng lại bằng cách khác (dừng để người xử lý, không đoán).
  const mergedCount = await prisma.purchaseProposal.count({
    where: { productionInvoiceId: { not: null } },
  });
  if (mergedCount > 0) {
    throw new Error(
      `Có ${mergedCount} phiếu mua đã đi qua cơ chế gộp (productionInvoiceId khác NULL) - ` +
        `buyQty của chúng là TỔNG nhiều phương án cắt, KHÔNG suy ngược về buyBars từng dòng được. ` +
        `Dừng lại để tránh lấp số sai. Cần dựng lại buyBars bằng cách khác cho các phiếu này.`,
    );
  }

  const lines = await prisma.cuttingProposalLine.findMany({
    where: { buyBars: null, feasible: true, cuttingProposal: { status: 'APPROVED' } },
    select: { id: true, cuttingProposalId: true, materialId: true, totalBars: true },
  });
  console.log(`Tìm thấy ${lines.length} dòng phương án cắt (APPROVED) thiếu buyBars.`);

  let filled = 0;
  let zeroed = 0;
  for (const line of lines) {
    const purchaseItem = await prisma.purchaseProposalItem.findFirst({
      where: {
        materialId: line.materialId,
        proposal: { cuttingProposalId: line.cuttingProposalId },
      },
      select: { buyQty: true },
    });
    // Không có dòng mua tương ứng -> approve() đã loại vật tư này khỏi buyableLines (totalBars=0),
    // không phải mua gì cả.
    const buyBars = purchaseItem ? Math.round(purchaseItem.buyQty.toNumber()) : 0;
    await prisma.cuttingProposalLine.update({ where: { id: line.id }, data: { buyBars } });
    if (purchaseItem) filled += 1;
    else zeroed += 1;
  }
  console.log(
    `Đã lấp ${filled} dòng theo buyQty của đề xuất mua, ${zeroed} dòng đặt 0 (không có nhu cầu mua).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
