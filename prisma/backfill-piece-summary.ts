import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client';

/**
 * Lấp `cutting_proposal_lines.pieceSummary` cho các phương án tính TRƯỚC 2026-08-25 (cột chưa
 * tồn tại nên `pieces[]` solver trả về bị vứt đi) - để bản in "Hướng dẫn cắt" của Phôi có bảng
 * TỔNG KẾT (SL cần / SL cắt / tên mảnh) giống "In kết quả" của MC Laser.
 *
 * CHẠY 1 LẦN sau `prisma migrate deploy`:  npm run backfill:piece-summary
 *
 * ------------------------------------------------------------------------------------------
 * VÌ SAO KHÔNG GỌI LẠI SOLVER (quan trọng)
 * ------------------------------------------------------------------------------------------
 * "Tính lại" sinh một CuttingProposal MỚI; vì nhu cầu đó đã có bản APPROVED nên tự-duyệt bị
 * chặn (CuttingProposalsService.autoApproveBlockReason nhánh (b)) - bản mới nằm DRAFT, màn Hướng
 * dẫn cắt vẫn đọc bản APPROVED cũ, tức là KHÔNG lấp được gì. Duyệt tay bản mới thì lại trừ tồn
 * kho lần 2 + đẻ đề xuất mua trùng (SUPERSEDED không hoàn kho, không huỷ đề xuất mua cũ), và đổi
 * luôn bộ pattern dưới chân Phôi đang cắt dở.
 *
 * Nên script này KHÔNG đụng solver, KHÔNG đụng trạng thái/tồn kho/mua hàng. Nó chỉ:
 *   - SL cần   : bung lại định mức từ `bomRevisionId` mà lệnh SX ĐÃ GHIM (không đọc định mức
 *                hiện hành) - ra đúng con số đã gửi solver lúc đó, không phải ước lượng.
 *   - SL cắt   : cộng từ chính các pattern ĐÃ LƯU của phương án đó.
 *   - Tên mảnh : PieceBom.piece.name của cùng bomRevision.
 * và ghi đúng 1 cột JSON thuần hiển thị. Chạy lại nhiều lần vô hại (chỉ đụng dòng còn null).
 *
 * Công thức nhu cầu sao chép từ CuttingProposalsService.buildBomRows/buildInvoiceJob:
 *   SL cần 1 cỡ đoạn = Σ (BomPiece.qtyPerUnit × PieceBom.qtyPerPiece × ProductionOrder.quantity)
 * Phương án neo vào PI gộp thì cộng qua TẤT CẢ lệnh SX trong PI (đúng như lúc gửi solver).
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

interface PieceSummaryRow {
  size: number;
  demand: number;
  produced: number;
  names: string[];
}

/** Nhu cầu + tên mảnh của 1 bomRevision, nhân sẵn số bộ. Khoá `"{materialId}:{cutLengthMm}"` -
 *  dựng y hệt buildBomRows (`.toNumber()` TRƯỚC khi ghép, không ghép thẳng Decimal: "930.0" và
 *  "930" là 2 khoá khác nhau). */
async function accumulate(
  bomRevisionId: bigint,
  quantity: number,
  demand: Map<string, number>,
  names: Map<string, string[]>,
): Promise<void> {
  const [pieceBoms, bomPieces] = await Promise.all([
    prisma.pieceBom.findMany({
      where: { bomRevisionId },
      include: { piece: true, segmentSpec: true },
    }),
    prisma.bomPiece.findMany({ where: { bomRevisionId } }),
  ]);
  const qtyPerUnitByPieceId = new Map(bomPieces.map((bp) => [bp.pieceId, bp.qtyPerUnit]));

  for (const row of pieceBoms) {
    const key = `${row.segmentSpec.materialId}:${row.segmentSpec.cutLengthMm.toNumber()}`;
    const qtyPerUnit = qtyPerUnitByPieceId.get(row.pieceId) ?? 0;
    demand.set(key, (demand.get(key) ?? 0) + qtyPerUnit * row.qtyPerPiece * quantity);

    const existing = names.get(key);
    if (existing) {
      if (!existing.includes(row.piece.name)) existing.push(row.piece.name);
    } else {
      names.set(key, [row.piece.name]);
    }
  }
}

async function main(): Promise<void> {
  // Chỉ dòng feasible mới có gì để tổng kết (solver không trả pieces[] cho dòng infeasible - xem
  // api/views.py), và phải còn pattern thì mới tính được "SL cắt". Prisma.DbNull = cột SQL NULL
  // (khác Prisma.JsonNull - giá trị JSON `null` nằm trong ô).
  const lines = await prisma.cuttingProposalLine.findMany({
    where: { pieceSummary: { equals: Prisma.DbNull }, feasible: true },
    include: {
      patterns: { include: { segments: { include: { segmentSpec: true } } } },
      cuttingProposal: {
        select: { id: true, productionOrderId: true, productionInvoiceId: true },
      },
    },
  });

  console.log(`Tìm thấy ${lines.length} dòng cần lấp pieceSummary.`);
  let filled = 0;
  let skipped = 0;

  // 1 phương án thường có nhiều dòng (nhiều loại sắt) dùng CHUNG một bộ định mức - cache theo
  // proposalId để không bung lại BOM cho từng dòng.
  const cache = new Map<string, { demand: Map<string, number>; names: Map<string, string[]> }>();

  for (const line of lines) {
    if (line.patterns.length === 0) {
      skipped++;
      continue;
    }

    const proposal = line.cuttingProposal;
    const cacheKey = proposal.id.toString();
    let bom = cache.get(cacheKey);
    if (!bom) {
      const demand = new Map<string, number>();
      const names = new Map<string, string[]>();
      if (proposal.productionOrderId) {
        const order = await prisma.productionOrder.findUnique({
          where: { id: proposal.productionOrderId },
          select: { bomRevisionId: true, quantity: true },
        });
        if (order) await accumulate(order.bomRevisionId, order.quantity, demand, names);
      } else if (proposal.productionInvoiceId) {
        const pi = await prisma.productionInvoice.findUnique({
          where: { id: proposal.productionInvoiceId },
          include: { items: { include: { productionOrder: true } } },
        });
        for (const item of pi?.items ?? []) {
          if (!item.productionOrder) continue;
          await accumulate(
            item.productionOrder.bomRevisionId,
            item.productionOrder.quantity,
            demand,
            names,
          );
        }
      }
      bom = { demand, names };
      cache.set(cacheKey, bom);
    }

    // SL cắt: cộng theo cỡ đoạn qua mọi pattern của dòng này.
    const producedBySize = new Map<number, number>();
    for (const pattern of line.patterns) {
      for (const segment of pattern.segments) {
        const size = segment.segmentSpec.cutLengthMm.toNumber();
        producedBySize.set(
          size,
          (producedBySize.get(size) ?? 0) + segment.countPerBar * pattern.barCount,
        );
      }
    }
    if (producedBySize.size === 0) {
      skipped++;
      continue;
    }

    const summary: PieceSummaryRow[] = [...producedBySize.entries()]
      .sort((a, b) => b[0] - a[0]) // size giảm dần - cùng chiều với bảng cắt chi tiết ở FE
      .map(([size, produced]) => {
        const key = `${line.materialId}:${size}`;
        return {
          size,
          demand: bom.demand.get(key) ?? 0,
          produced,
          names: bom.names.get(key) ?? [],
        };
      });

    await prisma.cuttingProposalLine.update({
      where: { id: line.id },
      data: { pieceSummary: summary as unknown as Prisma.InputJsonValue },
    });
    filled++;
  }

  console.log(`Đã lấp ${filled} dòng, bỏ qua ${skipped} dòng (không có pattern để tổng kết).`);
}

main()
  .catch((error) => {
    console.error('Backfill pieceSummary thất bại:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
