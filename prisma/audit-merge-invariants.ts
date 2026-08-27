import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * ĐỐI CHIẾU dữ liệu trước khi triển khai đợt sửa "gộp 1 PI = 1 đề xuất mua" (changelog
 * 2026-08-27). CHỈ ĐỌC - không ghi một byte nào, chạy trên production an toàn.
 *
 * CHẠY:  npm run audit:merge-invariants
 *
 * ------------------------------------------------------------------------------------------
 * DÙNG LÚC NÀO
 * ------------------------------------------------------------------------------------------
 * Chạy SAU `prisma migrate deploy` (cần các cột/bảng mới để soi) và TRƯỚC khi chạy backfill +
 * deploy code mới. Trả lời 2 câu:
 *
 *   1. 6 lỗi trong changelog đã NỔ trên dữ liệu thật chưa? (trên máy dev thì chưa - production có
 *      thể khác, và nếu đã nổ thì phải xử lý số liệu lệch TRƯỚC, không phải cứ deploy là xong)
 *   2. 3 script backfill sắp tới có chạy trót lọt không, hay sẽ dừng vì giả định không đúng?
 *
 * Mã thoát: 0 = sạch, đi tiếp được. 1 = có mục cần xử lý trước (đọc phần TỔNG KẾT ở cuối).
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

interface Finding {
  code: string;
  title: string;
  blocking: boolean;
  rows: unknown[];
  hint: string;
}

const findings: Finding[] = [];

function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
}

function report(f: Omit<Finding, 'rows'> & { rows: unknown[] }) {
  findings.push(f);
  const mark = f.rows.length === 0 ? 'OK  ' : f.blocking ? 'CHẶN' : 'LƯU Ý';
  console.log(`\n[${mark}] ${f.code} — ${f.title}`);
  if (f.rows.length === 0) {
    console.log('       không có dòng nào.');
    return;
  }
  console.log(`       ${f.rows.length} dòng:`);
  for (const r of f.rows.slice(0, 20)) console.log(`         ${toJson(r)}`);
  if (f.rows.length > 20) console.log(`         ... và ${f.rows.length - 20} dòng nữa`);
  console.log(`       -> ${f.hint}`);
}

async function main() {
  console.log('=== ĐỐI CHIẾU BẤT BIẾN "gộp 1 PI = 1 đề xuất mua" (CHỈ ĐỌC) ===');

  // ── Quy mô dữ liệu, để đọc các con số dưới trong ngữ cảnh ────────────────────────────────
  const scale = await prisma.$queryRaw<Record<string, bigint>[]>`
    SELECT
      (SELECT COUNT(*) FROM cutting_proposals WHERE status='APPROVED')          AS "phuongAnDaDuyet",
      (SELECT COUNT(*) FROM purchase_proposals)                                 AS "phieuMua",
      (SELECT COUNT(*) FROM purchase_proposals WHERE "productionInvoiceId" IS NOT NULL) AS "phieuMuaDaGop",
      (SELECT COUNT(*) FROM production_invoices)                                AS "pi",
      (SELECT COUNT(*) FROM cutting_proposal_lines WHERE "lengthSource"='scan') AS "dongCayDatRieng"
  `;
  console.log('\nQUY MÔ:', toJson(scale[0]));

  // ── L2: 1 SKU bị NHIỀU phương án APPROVED cùng phủ ───────────────────────────────────────
  // Đây là lỗi nặng nhất: cùng nhu cầu lập kế hoạch 2 lần -> giữ chỗ tồn 2 lần + mua trùng.
  // Cũng chính là điều kiện làm `backfill:cutting-plan-coverage` dừng lại.
  report({
    code: 'L2',
    title: '1 SKU (ProductionOrder) bị nhiều phương án cắt APPROVED cùng phủ',
    blocking: true,
    hint:
      'Chọn phương án giữ lại, supersede các phương án còn lại (và soát lại giữ chỗ/đề xuất mua ' +
      'chúng đã tạo) TRƯỚC khi chạy backfill:cutting-plan-coverage.',
    rows: await prisma.$queryRaw`
      SELECT po."poNumber", COUNT(*) AS "soPhuongAn", ARRAY_AGG(cp.id ORDER BY cp.id) AS "phuongAn"
      FROM cutting_proposals cp
      LEFT JOIN production_orders po_direct ON po_direct.id = cp."productionOrderId"
      LEFT JOIN production_invoice_items pii ON pii."productionInvoiceId" = cp."productionInvoiceId"
      LEFT JOIN production_orders po_merged ON po_merged."productionInvoiceItemId" = pii.id
      JOIN production_orders po ON po.id = COALESCE(po_direct.id, po_merged.id)
      WHERE cp.status = 'APPROVED'
      GROUP BY po."poNumber"
      HAVING COUNT(*) > 1
    `,
  });

  // ── L7: 1 loại sắt trong 1 PI bị chốt 2 cỡ cây khác nhau ─────────────────────────────────
  report({
    code: 'L7',
    title: '1 loại sắt trong cùng 1 PI bị 2 phương án chốt 2 cỡ cây khác nhau',
    blocking: true,
    hint:
      'Đề xuất mua đang mang cỡ cây của phương án ghi trước - Mua hàng có thể đã/đang đặt SAI cỡ ' +
      'cho phần của SKU kia. Đối chiếu với đơn đã đặt trước khi deploy.',
    rows: await prisma.$queryRaw`
      SELECT pi.code AS "pi", m.code AS "vatTu",
             ARRAY_AGG(DISTINCT cpl."bestStockLengthMm") AS "cacCoCay"
      FROM cutting_proposal_lines cpl
      JOIN cutting_proposals cp ON cp.id = cpl."cuttingProposalId"
      LEFT JOIN production_orders po ON po.id = cp."productionOrderId"
      LEFT JOIN production_invoice_items pii2 ON pii2.id = po."productionInvoiceItemId"
      JOIN production_invoices pi
        ON pi.id = COALESCE(cp."productionInvoiceId", pii2."productionInvoiceId")
      JOIN materials m ON m.id = cpl."materialId"
      WHERE cp.status = 'APPROVED' AND cpl."bestStockLengthMm" IS NOT NULL
      GROUP BY pi.code, m.code
      HAVING COUNT(DISTINCT cpl."bestStockLengthMm") > 1
    `,
  });

  // ── L6: 1 phiếu mua có ≥2 dòng cùng vật tư ───────────────────────────────────────────────
  // FE cũ khoá theo materialId -> báo giá/duyệt/nhận hàng có thể đã ghi vào NHẦM dòng.
  report({
    code: 'L6',
    title: '1 phiếu mua có từ 2 dòng trở lên cùng 1 vật tư',
    blocking: false,
    hint:
      'FE trước 2026-08-27 khoá theo materialId nên báo giá/duyệt giá/nhận hàng có thể đã ghi vào ' +
      'nhầm dòng. Đối chiếu receivedQty của các dòng này với phiếu nhập kho thật.',
    rows: await prisma.$queryRaw`
      SELECT ppi."proposalId" AS "phieuMua", m.code AS "vatTu", COUNT(*) AS "soDong",
             ARRAY_AGG(ppi.status::text ORDER BY ppi.id) AS "trangThai"
      FROM purchase_proposal_items ppi
      JOIN materials m ON m.id = ppi."materialId"
      GROUP BY ppi."proposalId", m.code
      HAVING COUNT(*) > 1
    `,
  });

  // ── L3: dòng sắt trên phiếu mua mất cỡ cây ───────────────────────────────────────────────
  report({
    code: 'L3',
    title: 'Dòng sắt trên phiếu mua thiếu stockLengthMm dù phương án cắt có tính ra',
    blocking: false,
    hint:
      'Mua hàng không thấy badge "cây Nmm" nên có thể đã đặt mặc định 6000mm. Chạy ' +
      'backfill:length-source để lấp, rồi đối chiếu với đơn đã đặt.',
    rows: await prisma.$queryRaw`
      SELECT pp.id AS "phieuMua", m.code AS "vatTu",
             cpl."bestStockLengthMm" AS "coCayPhuongAn", cpl."lengthSource" AS "nguon"
      FROM purchase_proposal_items ppi
      JOIN purchase_proposals pp ON pp.id = ppi."proposalId"
      JOIN materials m ON m.id = ppi."materialId"
      JOIN cutting_proposal_lines cpl
        ON cpl."cuttingProposalId" = pp."cuttingProposalId" AND cpl."materialId" = ppi."materialId"
      WHERE ppi."stockLengthMm" IS NULL AND cpl."bestStockLengthMm" IS NOT NULL
    `,
  });

  // ── L5: PI có ≥2 phương án APPROVED (điều kiện cần để giữ chỗ cộng nhầm) ─────────────────
  report({
    code: 'L5',
    title: 'PI có từ 2 phương án cắt APPROVED trở lên (điều kiện để giữ chỗ cộng nhầm)',
    blocking: false,
    hint:
      'Với các PI này, hàng mua về TRƯỚC bản sửa có thể đã cộng vào giữ chỗ của SKU khác. Đối ' +
      'chiếu StockReservation.quantity với tổng đã nhận nếu Phôi từng báo thiếu sắt bất thường.',
    rows: await prisma.$queryRaw`
      SELECT pi.code AS "pi", COUNT(*) AS "soPhuongAnApproved"
      FROM cutting_proposals cp
      LEFT JOIN production_orders po ON po.id = cp."productionOrderId"
      LEFT JOIN production_invoice_items pii ON pii.id = po."productionInvoiceItemId"
      JOIN production_invoices pi
        ON pi.id = COALESCE(cp."productionInvoiceId", pii."productionInvoiceId")
      WHERE cp.status = 'APPROVED'
      GROUP BY pi.code
      HAVING COUNT(*) > 1
    `,
  });

  // ── Giả định của backfill:buy-bars ───────────────────────────────────────────────────────
  // KHÔNG dùng tín hiệu thô "có phiếu nào productionInvoiceId != null" - cột đó được set ngay từ
  // phiếu ĐẦU TIÊN của 1 PI (khoá để tìm "đề xuất còn mở" lần sau), không phải bằng chứng đã gộp.
  // Soi ĐÚNG điều kiện nguy hiểm thật (khớp logic dry-run của backfill-buy-bars.ts): dòng có nhu
  // cầu thật (totalBars > 0) mà không tìm được PurchaseProposalItem khớp (materialId,
  // cuttingProposalId) - nghĩa là cuttingProposalId trên phiếu mua đã bị merge ghi đè sang phương
  // án khác, buyQty hiện tại là netted-total, không tách ngược được.
  report({
    code: 'BF1',
    title:
      'Dòng phương án cắt có nhu cầu thật nhưng buyQty gốc đã bị merge ghi đè (backfill sẽ dừng)',
    blocking: true,
    hint:
      'cuttingProposalId trên phiếu mua đã bị ghi đè sang phương án khác - buyQty hiện tại là ' +
      'netted-total, không tách ngược về buyBars của phương án này được. Cần dựng buyBars bằng ' +
      'cách khác cho các dòng này trước khi chạy backfill:buy-bars.',
    rows: await prisma.$queryRaw`
      SELECT cpl.id AS "dong", cpl."cuttingProposalId" AS "phuongAn", cpl."materialId" AS "vatTu",
             cpl."totalBars" AS "soCay"
      FROM cutting_proposal_lines cpl
      JOIN cutting_proposals cp ON cp.id = cpl."cuttingProposalId"
      WHERE cp.status = 'APPROVED' AND cpl.feasible = true AND cpl."buyBars" IS NULL
        AND cpl."totalBars" > 0
        AND NOT EXISTS (
          SELECT 1 FROM purchase_proposal_items ppi
          JOIN purchase_proposals pp ON pp.id = ppi."proposalId"
          WHERE ppi."materialId" = cpl."materialId" AND pp."cuttingProposalId" = cpl."cuttingProposalId"
        )
    `,
  });

  // ── Việc backfill sẽ phải làm (thông tin, không phải lỗi) ────────────────────────────────
  const todo = await prisma.$queryRaw<Record<string, bigint>[]>`
    SELECT
      (SELECT COUNT(*) FROM cutting_proposal_lines cpl
         JOIN cutting_proposals cp ON cp.id = cpl."cuttingProposalId"
        WHERE cp.status='APPROVED' AND cpl.feasible=true AND cpl."buyBars" IS NULL) AS "buyBarsCanLap",
      -- CHỈ đếm dòng ACTIVE: loadPool() lọc status=ACTIVE nên dòng RELEASED thiếu
      -- productionInvoiceId là vô hại (backfill cố ý bỏ qua chúng khi không suy được PI).
      (SELECT COUNT(*) FROM stock_reservations
        WHERE "refType"='CUTTING_PROPOSAL' AND "productionInvoiceId" IS NULL
          AND status='ACTIVE')                                                      AS "giuChoCanLap",
      (SELECT COUNT(*) FROM cutting_plan_coverage)                                   AS "dongPhuHienCo"
  `;
  console.log('\n[INFO] Việc 3 script backfill sẽ làm:', toJson(todo[0]));

  // ── Tổng kết ─────────────────────────────────────────────────────────────────────────────
  const blocking = findings.filter((f) => f.blocking && f.rows.length > 0);
  const warnings = findings.filter((f) => !f.blocking && f.rows.length > 0);
  console.log('\n=== TỔNG KẾT ===');
  if (blocking.length === 0 && warnings.length === 0) {
    console.log('Sạch - chưa lỗi nào nổ. Chạy 3 script backfill rồi deploy code mới được.');
    return;
  }
  if (warnings.length > 0) {
    console.log(`LƯU Ý (không chặn, nhưng nên soát): ${warnings.map((f) => f.code).join(', ')}`);
  }
  if (blocking.length > 0) {
    console.log(
      `CHẶN - phải xử lý trước khi backfill/deploy: ${blocking.map((f) => f.code).join(', ')}`,
    );
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
