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
 * Điều này chỉ đúng khi tra được ĐÚNG dòng `PurchaseProposalItem` mà chính phương án cắt này đã
 * tạo ra - tức `proposal.cuttingProposalId` còn trỏ về đúng phương án của dòng. Cơ chế gộp
 * "1 PI = 1 form" (2026-08-25) có thể GHI ĐÈ `cuttingProposalId` của 1 proposal sang phương án MỚI
 * HƠN khi 2 phương án cùng PI lần lượt ghi vào chung 1 proposal (xem nhánh `existingProposal` ở
 * `CuttingProposalsService.approve()`) - lúc đó buyQty đã là netted-total, không tách ngược về
 * buyBars của phương án CŨ được nữa.
 *
 * Script KHÔNG chặn theo tín hiệu thô "có phiếu nào đã gộp chưa" (`productionInvoiceId != null`) -
 * proposal luôn mang `productionInvoiceId` ngay từ phiếu ĐẦU TIÊN của 1 PI dù chưa có gì bị gộp
 * (đó là khoá để lần SAU tìm ra "đề xuất còn mở" mà ghi tiếp vào, không phải bằng chứng đã gộp).
 * Thay vào đó DÒ TRƯỚC (dry-run, không ghi) toàn bộ dòng cần lấp: dòng nào có `totalBars > 0`
 * (nghĩa là THẬT SỰ có nhu cầu mua) mà KHÔNG tìm được `PurchaseProposalItem` khớp
 * `(materialId, cuttingProposalId)` mới là dấu hiệu bị ghi đè - dừng ngay và liệt kê, không đoán.
 *
 * Dòng không tìm được PurchaseProposalItem tương ứng NHƯNG `totalBars = 0` = approve() không tạo
 * đề xuất mua cho vật tư đó (bị loại khỏi `buyableLines`) - hợp lệ, buyBars đúng bằng 0.
 *
 * KHÔNG đụng solver, KHÔNG đụng tồn kho/giữ chỗ/trạng thái - chỉ ghi 1 cột số thuần, đọc lại từ dữ
 * liệu ĐÃ CÓ SẴN. Chạy lại nhiều lần vô hại (chỉ đụng dòng còn NULL).
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const lines = await prisma.cuttingProposalLine.findMany({
    where: { buyBars: null, feasible: true, cuttingProposal: { status: 'APPROVED' } },
    select: { id: true, cuttingProposalId: true, materialId: true, totalBars: true },
  });
  console.log(`Tìm thấy ${lines.length} dòng phương án cắt (APPROVED) thiếu buyBars.`);

  // Dò trước (KHÔNG ghi) - tách dòng khớp được (an toàn) khỏi dòng có nhu cầu thật (totalBars > 0)
  // mà không tìm được PurchaseProposalItem khớp (cuttingProposalId của proposal đã bị merge ghi đè
  // sang phương án khác) - CHẶN NGAY nếu có, không đoán số sai.
  const resolved: { id: bigint; buyBars: number }[] = [];
  const dangerous: (typeof lines)[number][] = [];
  for (const line of lines) {
    const purchaseItem = await prisma.purchaseProposalItem.findFirst({
      where: {
        materialId: line.materialId,
        proposal: { cuttingProposalId: line.cuttingProposalId },
      },
      select: { buyQty: true },
    });
    if (purchaseItem) {
      resolved.push({ id: line.id, buyBars: Math.round(purchaseItem.buyQty.toNumber()) });
    } else if (line.totalBars === 0) {
      resolved.push({ id: line.id, buyBars: 0 });
    } else {
      dangerous.push(line);
    }
  }

  if (dangerous.length > 0) {
    throw new Error(
      `${dangerous.length} dòng có nhu cầu thật (totalBars > 0) nhưng KHÔNG tìm được ` +
        `PurchaseProposalItem khớp - cuttingProposalId trên phiếu mua đã bị cơ chế gộp ghi đè sang ` +
        `phương án khác, buyQty hiện tại là netted-total, KHÔNG suy ngược về buyBars được. ` +
        `Dừng lại để tránh lấp số sai. Dòng cần xử lý thủ công: ` +
        `${dangerous.map((l) => `line ${l.id} (phương án ${l.cuttingProposalId}, vật tư ${l.materialId})`).join('; ')}`,
    );
  }

  let filled = 0;
  let zeroed = 0;
  for (const r of resolved) {
    await prisma.cuttingProposalLine.update({ where: { id: r.id }, data: { buyBars: r.buyBars } });
    if (r.buyBars > 0) filled += 1;
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
