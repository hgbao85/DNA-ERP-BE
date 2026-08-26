import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Lấp `cutting_proposal_lines.lengthSource` VÀ `purchase_proposal_items.stockLengthMm` cho dữ
 * liệu tính TRƯỚC 2026-08-26 (2 cột chưa tồn tại lúc đó).
 *
 * CHẠY 1 LẦN:  npm run backfill:length-source
 *
 * ------------------------------------------------------------------------------------------
 * VÌ SAO BACKFILL ĐƯỢC (khác pieceSummary - đợt đó phải bung lại BOM)
 * ------------------------------------------------------------------------------------------
 * Solver LUÔN gửi `length_source` trong `purchase_plan[]` cho mọi dòng feasible (xác nhận trực
 * tiếp trên rawResponse đã lưu của các phương án cũ nhất, 2026-08-11) - code cũ chỉ đơn giản
 * KHÔNG ĐỌC field đó ra cột riêng, không phải solver thiếu dữ liệu. `CuttingProposal.rawResponse`
 * lưu NGUYÊN VĂN response gốc nên vẫn còn đủ để đọc lại, không cần gọi lại solver hay bung BOM.
 *
 * `PurchaseProposalItem.stockLengthMm` chỉ cần copy từ chính CuttingProposalLine tương ứng
 * (join qua PurchaseProposal.cuttingProposalId + materialId) - số đó đã đúng, chỉ chưa có cột.
 *
 * KHÔNG đụng solver, KHÔNG đụng trạng thái/tồn kho/mua hàng - chỉ ghi 2 cột JSON/scalar thuần
 * hiển thị, đọc lại từ dữ liệu ĐÃ CÓ SẴN. Chạy lại nhiều lần vô hại (chỉ đụng dòng còn NULL).
 *
 * Phát hiện lúc review 2026-08-26: PO-1 (PurchaseProposal id=4, đang PURCHASING) thực ra cần đặt
 * cây 5600mm (đã cắt được, không phải cây chuẩn 6000mm) nhưng màn Mua hàng không hiện gì vì
 * stockLengthMm NULL - rủi ro đặt nhầm cỡ cây thật nếu không vá.
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

interface SolverPurchasePlanItem {
  material: string;
  feasible: boolean;
  length_source?: string;
}

interface SolverRawResponse {
  purchase_plan?: SolverPurchasePlanItem[];
}

async function backfillLengthSource(): Promise<number> {
  const lines = await prisma.cuttingProposalLine.findMany({
    where: { lengthSource: null, feasible: true },
    select: { id: true, materialId: true, cuttingProposalId: true },
  });
  console.log(`lengthSource: tìm thấy ${lines.length} dòng cần lấp.`);

  const rawByProposalId = new Map<string, SolverRawResponse | null>();
  let filled = 0;
  let skipped = 0;

  for (const line of lines) {
    const proposalKey = line.cuttingProposalId.toString();
    let raw = rawByProposalId.get(proposalKey);
    if (raw === undefined) {
      const proposal = await prisma.cuttingProposal.findUnique({
        where: { id: line.cuttingProposalId },
        select: { rawResponse: true },
      });
      raw = (proposal?.rawResponse as SolverRawResponse | null) ?? null;
      rawByProposalId.set(proposalKey, raw);
    }

    const item = raw?.purchase_plan?.find((p) => p.material === line.materialId.toString());
    if (!item?.length_source) {
      skipped++;
      continue;
    }

    await prisma.cuttingProposalLine.update({
      where: { id: line.id },
      data: { lengthSource: item.length_source },
    });
    filled++;
  }

  console.log(
    `lengthSource: đã lấp ${filled} dòng, bỏ qua ${skipped} (rawResponse không có field này).`,
  );
  return filled;
}

async function backfillPurchaseStockLength(): Promise<number> {
  const items = await prisma.purchaseProposalItem.findMany({
    where: { stockLengthMm: null },
    select: {
      id: true,
      materialId: true,
      proposal: { select: { cuttingProposalId: true } },
    },
  });
  console.log(`stockLengthMm: tìm thấy ${items.length} dòng đề xuất mua cần lấp.`);

  let filled = 0;
  let skipped = 0;

  for (const item of items) {
    const cuttingProposalId = item.proposal.cuttingProposalId;
    if (!cuttingProposalId) {
      skipped++; // nhánh kiểm tra vật tư (InspectionKhoResultItem) - không có cutting proposal gốc
      continue;
    }
    const line = await prisma.cuttingProposalLine.findFirst({
      where: { cuttingProposalId, materialId: item.materialId },
      select: { bestStockLengthMm: true },
    });
    if (line?.bestStockLengthMm == null) {
      skipped++;
      continue;
    }

    await prisma.purchaseProposalItem.update({
      where: { id: item.id },
      data: { stockLengthMm: line.bestStockLengthMm },
    });
    filled++;
  }

  console.log(
    `stockLengthMm: đã lấp ${filled} dòng, bỏ qua ${skipped} (không tra được dòng phương án cắt gốc).`,
  );
  return filled;
}

async function main(): Promise<void> {
  await backfillLengthSource();
  await backfillPurchaseStockLength();
}

main()
  .catch((error) => {
    console.error('Backfill lengthSource/stockLengthMm thất bại:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
