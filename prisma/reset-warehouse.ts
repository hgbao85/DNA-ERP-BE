import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../src/generated/prisma/client';

// Reset toàn bộ dữ liệu giao dịch liên quan đến kho về 0 (tồn kho, phiếu xuất/nhập, đề xuất mua,
// phương án cắt, lệnh sản xuất, đơn hàng, báo công đoạn, KCS...). GIỮ NGUYÊN dữ liệu master:
// vật tư, nhóm vật tư, kho, SKU/BOM, khách hàng, nhà cung cấp, người dùng, quyền.
//
// Chạy (từ D:\DNA-ERP-BE):
//   set CONFIRM_RESET=YES && npx ts-node -r tsconfig-paths/register prisma/reset-warehouse.ts
// Không có CONFIRM_RESET=YES thì script chỉ in số liệu, KHÔNG xoá gì.
// Toàn bộ thao tác nằm trong MỘT transaction: lỗi giữa chừng thì không có thay đổi nào.

const TABLES = [
  'stock_ledger',
  'stock_quant',
  'stock_reservations',
  'warehouse_transfer_reservations',
  'warehouse_transfer_items',
  'warehouse_transfer_piece_items',
  'warehouse_transfers',
  'material_issues',
  'material_yield_issues',
  'material_yield_recipe_issues',
  'steel_issues',
  'packaging_issues',
  'packaging_records',
  'weaving_issues',
  'weaving_issue_materials',
  'weaving_receipts',
  'transfer_check_results',
  'transfer_check_defects',
  'cut_pattern_segments',
  'cut_bundles',
  'cutting_proposal_pattern_segments',
  'cutting_proposal_patterns',
  'cutting_proposal_lines',
  'cutting_plan_coverage',
  'cutting_proposal_items',
  'cutting_proposals',
  'purchase_proposal_quotes',
  'purchase_proposal_items',
  'purchase_proposals',
  'inspection_kho_result_items',
  'inspection_kho_results',
  'material_inspection_requests',
  'qc_review_segments',
  'qc_reviews',
  'step_batch_segments',
  'step_batches',
  'step_bundles',
  'piece_step_batches',
  'piece_step_bundles',
  'production_batches',
  'material_yield_step_batches',
  'material_yield_step_bundles',
  'production_invoice_item_stages',
  'production_invoice_items',
  'production_invoices',
  'production_orders',
  'sales_order_items',
  'sales_orders',
  'office_supply_ledger_entries',
  'notification_recipients',
  'notifications',
];

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function snapshot(label: string) {
  const rows = await prisma.$queryRaw<{ t: string; n: bigint }[]>(Prisma.sql`
    SELECT 'stock_ledger' AS t, count(*) AS n FROM stock_ledger
    UNION ALL SELECT 'stock_quant', count(*) FROM stock_quant
    UNION ALL SELECT 'production_orders', count(*) FROM production_orders
    UNION ALL SELECT 'purchase_proposals', count(*) FROM purchase_proposals
    UNION ALL SELECT 'sales_orders', count(*) FROM sales_orders
    UNION ALL SELECT 'materials (giữ)', count(*) FROM materials
    UNION ALL SELECT 'mfg_products (giữ)', count(*) FROM mfg_products
    UNION ALL SELECT 'users (giữ)', count(*) FROM users
    UNION ALL SELECT 'warehouses (giữ)', count(*) FROM warehouses`);
  console.log(`${label}: ` + rows.map((r) => `${r.t}=${r.n}`).join(' | '));
}

async function main() {
  await snapshot('TRƯỚC');
  if (process.env.CONFIRM_RESET !== 'YES') {
    console.log('Chưa có CONFIRM_RESET=YES - không xoá gì. Xem hướng dẫn đầu file.');
    return;
  }
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE plan_forms SET "productionInvoiceId" = NULL, "salesOrderId" = NULL`,
      );
      await tx.$executeRawUnsafe(`UPDATE office_supplies SET quantity = 0`);
      await tx.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')}`);
    },
    { timeout: 60000 },
  );
  await snapshot('SAU');
}

main()
  .catch((e) => {
    console.error('LỖI - transaction đã rollback, không có thay đổi:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
