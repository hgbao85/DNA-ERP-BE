/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- script dựng dữ liệu thử (ngoài ứng dụng), gọi Prisma/service kiểu lỏng */
/**
 * Đưa bộ dữ liệu thử PB về TRẠNG THÁI SẠCH: xoá MỌI THỨ thuộc PB trừ dữ liệu nền của prisma/seed-test-phan-b.ts
 * (khách "PB Khách thử", NCC "PB NCC Thép"/"PB NCC Sơn", điểm đan PB-Đ, sản phẩm PB-SP1/PB-SP2 + BOM, liên kết NCC-vật tư).
 * Chạy lại bao nhiêu lần cũng được (lần sau không còn gì để xoá).
 *
 *   cd D:\DNA-ERP-BE
 *   NODE_PATH="D:/DNA-ERP-BE/node_modules" npx ts-node --transpile-only -P tsconfig.json prisma/test-data-phan-b/reset-pb.ts --dry   # chỉ in
 *   NODE_PATH="D:/DNA-ERP-BE/node_modules" npx ts-node --transpile-only -P tsconfig.json prisma/test-data-phan-b/reset-pb.ts         # xoá thật
 *
 * Neo nhận diện: đơn hàng của khách PB, dòng đơn/PI item của sản phẩm PB, PI chứa các dòng đó, NCC PB (đơn đặt hàng, phiếu nhận,
 * bộ đếm số đơn), điểm đan PB-Đ, tồn đầu kỳ PB-OPEN (refId 'PB-OPEN'). Từ các neo đó dò tiếp theo đồ thị khoá ngoại (pg_constraint)
 * xuống mọi bảng con, cộng các liên kết không có FK (dòng phiếu XK, sổ kho refType/refId, giữ chỗ, thông báo, audit log).
 *
 * An toàn: DỪNG (không xoá gì) nếu một PI / phương án cắt / đơn đặt hàng / phiếu XK / phiếu chuyển kho / phiếu nhận / booking
 * có cả dòng KHÔNG thuộc PB, hoặc nếu sổ kho có dòng chạm mảnh PB mà không giải thích được. Sổ kho được trừ ngược khỏi stock_quant
 * (đúng bucket kho + mã + chiều dài + quy cách) trước khi xoá; bucket về đúng 0 mà không còn bút toán nào khác thì xoá luôn.
 * Bộ đếm số phiếu NK/XK theo ngày chỉ xoá khi MỌI số phiếu của ngày đó đều thuộc PB.
 * Dùng PrismaClient thô (không qua audit extension), 1 transaction.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from 'D:/DNA-ERP-BE/src/generated/prisma/client';

const DRY = process.argv.includes('--dry');
const CUSTOMER_ID = '11';
const PRODUCT_IDS = ['127', '128'];
const SUPPLIER_IDS = ['8', '9'];
const WEAVING_POINT_ID = '6';
const LSX_CODES = ['PBA-1', 'PBP-1', 'PBG-1', 'PBG-2', 'PBD-1'];
const BOOKING_NOS = ['PB-BK'];
const OPENING_REF = 'PB-OPEN';
const COUNTER_DAYS = ['261110', '261111'];
const AUDIT_CORRELATIONS = ['PB-A-BUILD', 'PB-OPEN'];

// Kết nối trực tiếp (không qua pooler): pooled.db.prisma.io đôi lúc trả về kết nối bị client khác đặt search_path='' ->
// "relation ... does not exist" giữa chừng.
const raw = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL,
  }),
});
const j = (x: unknown) => JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
const log = (...a: unknown[]) => console.log('[reset-pb]', ...a);

type Ids = Set<string>;
const found: Record<string, Ids> = {};
const ids = (t: string) => [...(found[t] ?? [])];
const add = (t: string, xs: (string | bigint | number | null | undefined)[]) => {
  found[t] ??= new Set();
  let n = 0;
  for (const x of xs) {
    if (x == null) continue;
    const s = x.toString();
    if (!found[t].has(s)) {
      found[t].add(s);
      n++;
    }
  }
  return n;
};
const problems: string[] = [];

async function col(sql: string, ...p: unknown[]): Promise<string[]> {
  const rows: Record<string, unknown>[] = await raw.$queryRawUnsafe(sql, ...p);
  return rows
    .map((r) => String(Object.values(r)[0]))
    .filter((x) => x !== 'null' && x !== 'undefined');
}

/** Bảng không bao giờ xoá (nền/master) - không đi xuống qua chúng. */
const STOP_TABLES = new Set([
  'users',
  'materials',
  'piece',
  'warehouses',
  'mfg_products',
  'bom_revision',
  'sales_customers',
  'segment_spec',
  'suppliers',
  'workshops',
  'weaving_points',
  'material_yield_recipes',
  'plan_forms',
  'roles',
  'permissions',
  'defect_reasons',
  'workstations',
  'material_groups',
  'product_variants',
]);
/** Bảng nền chỉ "trỏ tới" dữ liệu PB: gỡ liên kết (SET NULL), không xoá. */
const NULLIFY: { table: string; col: string; parent: string }[] = [
  { table: 'plan_forms', col: 'salesOrderId', parent: 'sales_orders' },
  { table: 'plan_forms', col: 'productionInvoiceId', parent: 'production_invoices' },
];

type FkEdge = { child: string; childCol: string; parent: string; parentCol: string; del: string };

async function loadFk(): Promise<FkEdge[]> {
  const rows: any[] = await raw.$queryRawUnsafe(`
    SELECT replace(c.conrelid::regclass::text,'"','') AS child, a.attname::text AS "childCol",
           replace(c.confrelid::regclass::text,'"','') AS parent, af.attname::text AS "parentCol", c.confdeltype::text AS del
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
    WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace AND array_length(c.conkey, 1) = 1`);
  return rows;
}

// ───────────────────────────────────────────── thu thập ─────────────────────────────────────────────
async function collect() {
  const edges = await loadFk();
  const tablesWithId = new Set(
    await col(
      `SELECT table_name::text FROM information_schema.columns WHERE table_schema='public' AND column_name='id'`,
    ),
  );

  // 1. Neo: đơn hàng / dòng đơn / PI item / PI / lệnh SX
  add(
    'sales_orders',
    await col(
      `SELECT id FROM sales_orders WHERE "customerId" = $1::bigint OR id IN (SELECT "salesOrderId" FROM sales_order_items WHERE "mfgProductId" = ANY($2::bigint[]))`,
      CUSTOMER_ID,
      PRODUCT_IDS,
    ),
  );
  add(
    'sales_order_items',
    await col(
      `SELECT id FROM sales_order_items WHERE "salesOrderId" = ANY($1::bigint[]) OR "mfgProductId" = ANY($2::bigint[])`,
      ids('sales_orders'),
      PRODUCT_IDS,
    ),
  );
  add(
    'production_invoice_items',
    await col(
      `SELECT id FROM production_invoice_items WHERE "mfgProductId" = ANY($1::bigint[]) OR "salesOrderId" = ANY($2::bigint[]) OR "salesOrderItemId" = ANY($3::bigint[])`,
      PRODUCT_IDS,
      ids('sales_orders'),
      ids('sales_order_items'),
    ),
  );
  add(
    'production_invoices',
    await col(
      `SELECT DISTINCT "productionInvoiceId" FROM production_invoice_items WHERE id = ANY($1::bigint[]) AND "productionInvoiceId" IS NOT NULL
     UNION SELECT id FROM production_invoices WHERE "salesOrderId" = ANY($2::bigint[])`,
      ids('production_invoice_items'),
      ids('sales_orders'),
    ),
  );
  add(
    'production_orders',
    await col(
      `SELECT id FROM production_orders WHERE "productionInvoiceItemId" = ANY($1::bigint[]) OR "mfgProductId" = ANY($2::bigint[])`,
      ids('production_invoice_items'),
      PRODUCT_IDS,
    ),
  );
  add(
    'cutting_proposals',
    await col(
      `SELECT DISTINCT "cuttingProposalId" FROM cutting_proposal_items WHERE "productionInvoiceItemId" = ANY($1::bigint[]) OR "mfgProductId" = ANY($4::bigint[])
     UNION SELECT id FROM cutting_proposals WHERE "productionInvoiceId" = ANY($2::bigint[]) OR "productionOrderId" = ANY($3::bigint[])`,
      ids('production_invoice_items'),
      ids('production_invoices'),
      ids('production_orders'),
      PRODUCT_IDS,
    ),
  );
  add(
    'purchase_proposals',
    await col(
      `SELECT id FROM purchase_proposals WHERE "productionInvoiceId" = ANY($1::bigint[]) OR "cuttingProposalId" = ANY($2::bigint[])`,
      ids('production_invoices'),
      ids('cutting_proposals'),
    ),
  );
  add(
    'purchase_proposal_items',
    await col(
      `SELECT id FROM purchase_proposal_items WHERE "proposalId" = ANY($1::bigint[])`,
      ids('purchase_proposals'),
    ),
  );
  // dòng mua lại (reorderOfItemId) của dòng PB
  for (let k = 0; k < 5; k++) {
    if (
      !add(
        'purchase_proposal_items',
        await col(
          `SELECT id FROM purchase_proposal_items WHERE "reorderOfItemId" = ANY($1::bigint[])`,
          ids('purchase_proposal_items'),
        ),
      )
    )
      break;
  }
  // 2. Neo NCC PB
  add(
    'supplier_orders',
    await col(
      `SELECT id FROM supplier_orders WHERE "supplierId" = ANY($1::bigint[])
     UNION SELECT DISTINCT "supplierOrderId" FROM purchase_proposal_items WHERE id = ANY($2::bigint[]) AND "supplierOrderId" IS NOT NULL`,
      SUPPLIER_IDS,
      ids('purchase_proposal_items'),
    ),
  );
  add(
    'purchase_receipt_logs',
    await col(
      `SELECT id FROM purchase_receipt_logs WHERE "itemId" = ANY($1::bigint[])`,
      ids('purchase_proposal_items'),
    ),
  );
  add(
    'purchase_receipts',
    await col(
      `SELECT id FROM purchase_receipts WHERE "supplierOrderId" = ANY($1::bigint[])
     UNION SELECT DISTINCT "receiptId" FROM purchase_receipt_logs WHERE id = ANY($2::bigint[]) AND "receiptId" IS NOT NULL`,
      ids('supplier_orders'),
      ids('purchase_receipt_logs'),
    ),
  );
  add(
    'purchase_proposal_quotes',
    await col(
      `SELECT id FROM purchase_proposal_quotes WHERE "itemId" = ANY($1::bigint[]) OR "supplierId" = ANY($2::bigint[])`,
      ids('purchase_proposal_items'),
      SUPPLIER_IDS,
    ),
  );
  // 3. Neo điểm đan PB-Đ + phiếu XK
  for (const t of ['weaving_issues', 'weaving_issue_materials', 'weaving_receipts']) {
    add(
      t,
      await col(
        `SELECT id FROM "${t}" WHERE "weavingPointId" = $1::bigint OR "productionOrderId" = ANY($2::bigint[])`,
        WEAVING_POINT_ID,
        ids('production_orders'),
      ),
    );
  }
  for (const t of [
    'material_issues',
    'material_yield_issues',
    'packaging_issues',
    'production_batches',
    'piece_step_batches',
    'piece_step_bundles',
    'step_batches',
    'step_bundles',
    'cut_bundles',
  ]) {
    add(
      t,
      await col(
        `SELECT id FROM "${t}" WHERE "productionOrderId" = ANY($1::bigint[])`,
        ids('production_orders'),
      ),
    );
  }
  for (const t of [
    'steel_issues',
    'material_yield_recipe_issues',
    'material_yield_step_batches',
    'material_yield_step_bundles',
    'floor_queue_entries',
    'floor_reports',
    'step_batches',
    'step_bundles',
  ]) {
    add(
      t,
      await col(
        `SELECT id FROM "${t}" WHERE "productionInvoiceId" = ANY($1::bigint[])`,
        ids('production_invoices'),
      ),
    );
  }
  add(
    'issue_slips',
    await col(
      `SELECT id FROM issue_slips WHERE "weavingPointId" = $1::bigint
     UNION SELECT DISTINCT "slipId" FROM issue_slip_lines WHERE "productionOrderId" = ANY($2::bigint[]) OR "productionInvoiceId" = ANY($3::bigint[])
        OR "steelIssueId" = ANY($4::bigint[]) OR "materialIssueId" = ANY($5::bigint[]) OR "weavingIssueId" = ANY($6::bigint[])
        OR "weavingIssueMaterialId" = ANY($7::bigint[]) OR "materialYieldIssueId" = ANY($8::bigint[])
        OR "materialYieldRecipeIssueId" = ANY($9::bigint[]) OR "packagingIssueId" = ANY($10::bigint[])
        OR "pieceId" IN (SELECT id FROM piece WHERE "mfgProductId" = ANY($11::bigint[]))`,
      WEAVING_POINT_ID,
      ids('production_orders'),
      ids('production_invoices'),
      ids('steel_issues'),
      ids('material_issues'),
      ids('weaving_issues'),
      ids('weaving_issue_materials'),
      ids('material_yield_issues'),
      ids('material_yield_recipe_issues'),
      ids('packaging_issues'),
      PRODUCT_IDS,
    ),
  );
  // phiếu cặp (mảnh + vật tư kèm)
  for (let k = 0; k < 3; k++) {
    if (
      !add(
        'issue_slips',
        await col(
          `SELECT id FROM issue_slips WHERE "pairedSlipId" = ANY($1::bigint[]) UNION SELECT "pairedSlipId" FROM issue_slips WHERE id = ANY($1::bigint[]) AND "pairedSlipId" IS NOT NULL`,
          ids('issue_slips'),
        ),
      )
    )
      break;
  }
  add(
    'warehouse_transfers',
    await col(
      `SELECT id FROM warehouse_transfers WHERE "productionInvoiceId" = ANY($1::bigint[])
     UNION SELECT DISTINCT "transferId" FROM warehouse_transfer_piece_items WHERE "productionOrderId" = ANY($2::bigint[])
        OR "pieceId" IN (SELECT id FROM piece WHERE "mfgProductId" = ANY($3::bigint[]))`,
      ids('production_invoices'),
      ids('production_orders'),
      PRODUCT_IDS,
    ),
  );
  add(
    'bookings',
    await col(
      `SELECT id FROM bookings WHERE "customerId" = $1::bigint OR "bookingNo" = ANY($2::text[])
     UNION SELECT DISTINCT "bookingId" FROM booking_lines WHERE "productionInvoiceItemId" = ANY($3::bigint[]) OR "salesOrderItemId" = ANY($4::bigint[])`,
      CUSTOMER_ID,
      BOOKING_NOS,
      ids('production_invoice_items'),
      ids('sales_order_items'),
    ),
  );
  add(
    'deadline_change_batches',
    await col(
      `SELECT DISTINCT "batchId" FROM deadline_change_requests WHERE "productionInvoiceItemId" = ANY($1::bigint[])`,
      ids('production_invoice_items'),
    ),
  );

  // 4. Lan theo FK xuống bảng con
  const noId: { table: string; col: string; parent: string }[] = [];
  const queue = Object.keys(found).map((t) => [t, ids(t)] as [string, string[]]);
  while (queue.length) {
    const [parent, pids] = queue.shift()!;
    if (!pids.length) continue;
    for (const e of edges.filter((x) => x.parent === parent && x.parentCol === 'id')) {
      if (STOP_TABLES.has(e.child)) continue;
      if (!tablesWithId.has(e.child)) {
        if (!noId.some((n) => n.table === e.child && n.col === e.childCol))
          noId.push({ table: e.child, col: e.childCol, parent });
        continue;
      }
      const rows = await col(
        `SELECT id::text FROM "${e.child}" WHERE "${e.childCol}"::text = ANY($1::text[])`,
        pids,
      );
      const before = new Set(found[e.child] ?? []);
      add(e.child, rows);
      const fresh = rows.filter((r) => !before.has(r));
      if (fresh.length) queue.push([e.child, fresh]);
    }
  }

  // 5. Kiểm "không lẫn dữ liệu ngoài PB"
  const pbItems = new Set(ids('production_invoice_items'));
  const check = async (label: string, sql: string, ...p: unknown[]) => {
    const bad = await col(sql, ...p);
    if (bad.length) problems.push(`${label}: ${bad.slice(0, 20).join(',')}`);
  };
  await check(
    'PI item không phải sản phẩm PB / đơn PB',
    `SELECT id FROM production_invoice_items WHERE id = ANY($1::bigint[]) AND NOT ("mfgProductId" = ANY($2::bigint[])) AND ("salesOrderId" IS NULL OR NOT ("salesOrderId" = ANY($3::bigint[])))`,
    [...pbItems],
    PRODUCT_IDS,
    ids('sales_orders'),
  );
  await check(
    'dòng đơn hàng PB của sản phẩm lạ',
    `SELECT id FROM sales_order_items WHERE id = ANY($1::bigint[]) AND NOT ("mfgProductId" = ANY($2::bigint[])) AND NOT ("salesOrderId" IN (SELECT id FROM sales_orders WHERE "customerId" = $3::bigint))`,
    ids('sales_order_items'),
    PRODUCT_IDS,
    CUSTOMER_ID,
  );
  await check(
    'lệnh SX không thuộc PI item PB',
    `SELECT id FROM production_orders WHERE id = ANY($1::bigint[]) AND NOT ("productionInvoiceItemId" = ANY($2::bigint[]))`,
    ids('production_orders'),
    [...pbItems],
  );
  await check(
    'phương án cắt chứa SKU lạ',
    `SELECT id FROM cutting_proposal_items WHERE id = ANY($1::bigint[]) AND NOT ("productionInvoiceItemId" = ANY($2::bigint[])) AND NOT ("mfgProductId" = ANY($3::bigint[]))`,
    ids('cutting_proposal_items'),
    [...pbItems],
    PRODUCT_IDS,
  );
  await check(
    'đề xuất mua không thuộc PI/phương án PB',
    `SELECT id FROM purchase_proposal_items WHERE id = ANY($1::bigint[]) AND NOT ("proposalId" = ANY($2::bigint[]))`,
    ids('purchase_proposal_items'),
    ids('purchase_proposals'),
  );
  await check(
    'đơn đặt hàng chứa dòng mua lạ',
    `SELECT id FROM purchase_proposal_items WHERE "supplierOrderId" = ANY($1::bigint[]) AND NOT (id = ANY($2::bigint[]))`,
    ids('supplier_orders'),
    ids('purchase_proposal_items'),
  );
  await check(
    'phiếu nhận chứa dòng mua lạ',
    `SELECT id FROM purchase_receipt_logs WHERE "receiptId" = ANY($1::bigint[]) AND NOT ("itemId" = ANY($2::bigint[]))`,
    ids('purchase_receipts'),
    ids('purchase_proposal_items'),
  );
  await check(
    'báo giá NCC PB cho dòng mua lạ',
    `SELECT id FROM purchase_proposal_quotes WHERE id = ANY($1::bigint[]) AND NOT ("itemId" = ANY($2::bigint[]))`,
    ids('purchase_proposal_quotes'),
    ids('purchase_proposal_items'),
  );
  await check(
    'phiếu XK có dòng của lệnh/PI lạ',
    `SELECT id FROM issue_slip_lines WHERE "slipId" = ANY($1::bigint[]) AND (
       ("productionOrderId" IS NOT NULL AND NOT ("productionOrderId" = ANY($2::bigint[])))
       OR ("productionInvoiceId" IS NOT NULL AND NOT ("productionInvoiceId" = ANY($3::bigint[])))
       OR ("productionOrderId" IS NULL AND "productionInvoiceId" IS NULL AND kind::text <> 'SHARED'))`,
    ids('issue_slips'),
    ids('production_orders'),
    ids('production_invoices'),
  );
  await check(
    'phiếu XK chỉ có dòng Dùng chung (không xác định được của PB)',
    `SELECT id FROM issue_slips s WHERE id = ANY($1::bigint[]) AND "weavingPointId" IS DISTINCT FROM $2::bigint
       AND NOT EXISTS (SELECT 1 FROM issue_slip_lines l WHERE l."slipId" = s.id AND (l."productionOrderId" IS NOT NULL OR l."productionInvoiceId" IS NOT NULL))`,
    ids('issue_slips'),
    WEAVING_POINT_ID,
  );
  await check(
    'phiếu chuyển kho có dòng mảnh của lệnh lạ',
    `SELECT id FROM warehouse_transfer_piece_items WHERE "transferId" = ANY($1::bigint[]) AND NOT ("productionOrderId" = ANY($2::bigint[]))`,
    ids('warehouse_transfers'),
    ids('production_orders'),
  );
  await check(
    'phiếu chuyển kho của PI lạ',
    `SELECT id FROM warehouse_transfers WHERE id = ANY($1::bigint[]) AND "productionInvoiceId" IS NOT NULL AND NOT ("productionInvoiceId" = ANY($2::bigint[]))`,
    ids('warehouse_transfers'),
    ids('production_invoices'),
  );
  await check(
    'phiếu chuyển kho vật tư không gắn PI (không xác định được của PB)',
    `SELECT t.id FROM warehouse_transfers t WHERE id = ANY($1::bigint[]) AND t."productionInvoiceId" IS NULL AND EXISTS (SELECT 1 FROM warehouse_transfer_items i WHERE i."transferId" = t.id)`,
    ids('warehouse_transfers'),
  );
  await check(
    'booking có dòng lạ',
    `SELECT id FROM booking_lines WHERE "bookingId" = ANY($1::bigint[]) AND NOT ("productionInvoiceItemId" = ANY($2::bigint[]))`,
    ids('bookings'),
    [...pbItems],
  );
  await check(
    'đợt đổi hạn có dòng lạ',
    `SELECT id FROM deadline_change_requests WHERE "batchId" = ANY($1::bigint[]) AND NOT ("productionInvoiceItemId" = ANY($2::bigint[]))`,
    ids('deadline_change_batches'),
    [...pbItems],
  );
  for (const t of ['weaving_issues', 'weaving_issue_materials', 'weaving_receipts']) {
    await check(
      `${t} điểm đan PB-Đ của lệnh lạ`,
      `SELECT id FROM "${t}" WHERE id = ANY($1::bigint[]) AND NOT ("productionOrderId" = ANY($2::bigint[]))`,
      ids(t),
      ids('production_orders'),
    );
  }

  // 6. Giữ chỗ (không FK cứng)
  add(
    'stock_reservations',
    await col(
      `SELECT id FROM stock_reservations WHERE "productionInvoiceId" = ANY($1::bigint[])
       OR ("refType"::text = 'CUTTING_PROPOSAL' AND "refId" = ANY($2::text[]))
       OR ("refType"::text = 'PURCHASE_PROPOSAL' AND "refId" = ANY($3::text[]))
       OR ("refType"::text IN ('PRODUCTION_INVOICE','CONSUMABLE_MATERIAL_PURCHASE','MATERIAL_YIELD_RECIPE_PURCHASE','PIECE_MATERIAL_YIELD_PURCHASE') AND "refId" = ANY($1::text[]))`,
      ids('production_invoices'),
      ids('cutting_proposals'),
      ids('purchase_proposals'),
    ),
  );
  // giữ chỗ do phiếu chuyển kho PB dời đi (warehouse_transfer_reservations là con FK của warehouse_transfers - đã lan ở bước 4)

  // 7. Sổ kho theo (refType, refId)
  const L = (rt: string, t: string, keyPrefix?: string) =>
    keyPrefix
      ? {
          sql: `("refType"::text = '${rt}' AND "refId" = ANY($X::text[]) AND "idempotencyKey" LIKE '${keyPrefix}%')`,
          v: ids(t),
        }
      : { sql: `("refType"::text = '${rt}' AND "refId" = ANY($X::text[]))`, v: ids(t) };
  const parts = [
    L('PURCHASE', 'purchase_proposals'),
    L('STEEL_ISSUE', 'steel_issues'),
    L('SEGMENT_CONSUME', 'production_batches'),
    L('FRAME_OUTPUT', 'production_batches'),
    L('QC_SCRAP', 'production_batches'),
    L('MATERIAL_ISSUE', 'material_issues'),
    L('WAREHOUSE_TRANSFER', 'warehouse_transfers'),
    L('PACKAGING_ISSUE', 'packaging_issues'),
    L('MATERIAL_YIELD_CONSUME', 'material_yield_issues', 'material-yield-issue:'),
    L('MATERIAL_YIELD_CONSUME', 'material_yield_recipe_issues', 'material-yield-recipe-issue:'),
    L('MATERIAL_YIELD_RECIPE_OUTPUT', 'material_yield_step_bundles'),
    L('WEAVING_ISSUE_MATERIAL', 'weaving_issue_materials'),
    L('WEAVING_ISSUE', 'weaving_issues'),
    L('ISSUE_SLIP_SHARED', 'issue_slip_lines'),
  ];
  const where = parts.map((p, i) => p.sql.replace('$X', `$${i + 1}`)).join(' OR ');
  add(
    'stock_ledger',
    await col(`SELECT id FROM stock_ledger WHERE ${where}`, ...parts.map((p) => p.v)),
  );
  // tồn đầu kỳ PB
  add(
    'stock_ledger',
    await col(
      `SELECT id FROM stock_ledger WHERE "refType"::text = 'ADJUST' AND "refId" = $1 AND "idempotencyKey" LIKE $2`,
      OPENING_REF,
      `${OPENING_REF}:%`,
    ),
  );
  // lưới an toàn: bút toán chạm mảnh PB mà không thuộc nhóm trên
  await check(
    'sổ kho chạm mảnh PB không giải thích được',
    `SELECT id FROM stock_ledger WHERE "pieceId" IN (SELECT id FROM piece WHERE "mfgProductId" = ANY($1::bigint[])) AND NOT (id = ANY($2::bigint[]))`,
    PRODUCT_IDS,
    ids('stock_ledger'),
  );

  // 8. Thông báo
  const NOTIF: Record<string, string> = {
    PRODUCTION_INVOICE: 'production_invoices',
    PRODUCTION_INVOICE_ITEM: 'production_invoice_items',
    PRODUCTION_ORDER: 'production_orders',
    CUTTING_PROPOSAL: 'cutting_proposals',
    PURCHASE_PROPOSAL: 'purchase_proposals',
    PURCHASE_PROPOSAL_ITEM: 'purchase_proposal_items',
    PRODUCTION_BATCH: 'production_batches',
    QC_REVIEW: 'qc_reviews',
    WAREHOUSE_TRANSFER: 'warehouse_transfers',
    ISSUE_SLIP: 'issue_slips',
    WEAVING_ISSUE: 'weaving_issues',
    WEAVING_RECEIPT: 'weaving_receipts',
    TRANSFER_CHECK_RESULT: 'transfer_check_results',
    SALES_ORDER: 'sales_orders',
    BOOKING: 'bookings',
    SUPPLIER_ORDER: 'supplier_orders',
    MATERIAL_YIELD_ISSUE: 'material_yield_issues',
    MATERIAL_ISSUE: 'material_issues',
    PACKAGING_ISSUE: 'packaging_issues',
    PIECE_STEP_BUNDLE: 'piece_step_bundles',
    PURCHASE_RECEIPT: 'purchase_receipts',
    STEEL_ISSUE: 'steel_issues',
    FLOOR_QUEUE_ENTRY: 'floor_queue_entries',
    MATERIAL_YIELD_RECIPE_ISSUE: 'material_yield_recipe_issues',
    CUT_BUNDLE: 'cut_bundles',
    STEP_BUNDLE: 'step_bundles',
  };
  for (const [et, t] of Object.entries(NOTIF)) {
    if (ids(t).length)
      add(
        'notifications',
        await col(
          `SELECT id FROM notifications WHERE "entityType" = $1 AND "entityId" = ANY($2::text[])`,
          et,
          ids(t),
        ),
      );
  }
  add(
    'notifications',
    await col(
      `SELECT id FROM notifications WHERE "entityType" = 'WEAVING_ALLOCATION' AND split_part("entityId", ':', 1) = ANY($1::text[])`,
      ids('production_orders'),
    ),
  );
  const piCodes = ids('production_invoices').length
    ? await col(
        `SELECT code FROM production_invoices WHERE id = ANY($1::bigint[])`,
        ids('production_invoices'),
      )
    : [];
  add(
    'notifications',
    await col(
      `SELECT id FROM notifications WHERE "entityId" IS NULL AND (data->>'piCode' = ANY($1::text[]) OR title LIKE ANY($2::text[]))`,
      piCodes,
      LSX_CODES.map((c) => `${c}:%`),
    ),
  );
  // lưới an toàn theo tiêu đề (tên nền PB chỉ có trong dữ liệu PB)
  add(
    'notifications',
    await col(
      `SELECT id FROM notifications WHERE title LIKE ANY($1::text[]) OR message LIKE ANY($1::text[])`,
      [
        '%PB NCC Thép%',
        '%PB NCC Sơn%',
        '%PB Điểm đan thử%',
        '%PB-DH-%',
        '%PB-SP1%',
        '%PB-SP2%',
        ...LSX_CODES.map((c) => `%${c}%`),
      ],
    ),
  );

  // 9. Audit log: (model, recordId) của mọi dòng bị xoá + correlationId của script dựng
  const modelOf = parseModelMap();
  const auditPairs: { model: string[]; ids: string[] }[] = [];
  for (const t of Object.keys(found)) {
    if (!ids(t).length || t === 'notifications') continue;
    auditPairs.push({ model: [modelOf.get(t) ?? t, t], ids: ids(t) });
  }
  const auditIds = new Set<string>();
  for (const p of auditPairs) {
    for (const x of await col(
      `SELECT id FROM audit_logs WHERE "tableName" = ANY($1::text[]) AND "recordId" = ANY($2::text[])`,
      p.model,
      p.ids,
    ))
      auditIds.add(x);
  }
  for (const x of await col(
    `SELECT id FROM audit_logs WHERE "correlationId" = ANY($1::text[])`,
    AUDIT_CORRELATIONS,
  ))
    auditIds.add(x);
  for (const x of await col(
    `SELECT id FROM audit_logs WHERE "tableName" = 'SupplierOrderCounter' AND split_part("recordId", ':', 1) = ANY($1::text[])`,
    SUPPLIER_IDS,
  ))
    auditIds.add(x);

  // 10. Số phiếu
  const nkCodes = ids('purchase_receipts').length
    ? await col(
        `SELECT code FROM purchase_receipts WHERE id = ANY($1::bigint[]) AND code IS NOT NULL`,
        ids('purchase_receipts'),
      )
    : [];
  const xkCodes = ids('issue_slips').length
    ? await col(
        `SELECT code FROM issue_slips WHERE id = ANY($1::bigint[]) AND code IS NOT NULL`,
        ids('issue_slips'),
      )
    : [];
  const shipCodes = ids('bookings').length
    ? await col(
        `SELECT "shipSlipCode" FROM bookings WHERE id = ANY($1::bigint[]) AND "shipSlipCode" IS NOT NULL`,
        ids('bookings'),
      )
    : [];
  const pbCodes = new Set([...nkCodes, ...xkCodes, ...shipCodes]);
  const counterDeletes: { kind: string; day: string }[] = [];
  const counterKeeps: string[] = [];
  // ngày cần xét = 2 ngày dựng/diễn tập ban đầu + mọi ngày có phiếu PB (vd ngày test 12/11)
  const days = [
    ...new Set([
      ...COUNTER_DAYS,
      ...[...pbCodes]
        .map((x) => /^(?:NK|XK)-(\d{6})-/.exec(x)?.[1])
        .filter((d): d is string => !!d),
    ]),
  ].sort();
  for (const day of days) {
    // "phiếu" của ngày = số đã dùng thật (phiếu XK, phiếu nhận NK, phiếu xuất booking). Số NK chỉ giữ chỗ mà chưa dùng
    // (reserved_slip_codes không có phiếu nhận) không phải phiếu: xoá cùng bộ đếm để không đụng số cấp lại.
    const all = await col(
      `SELECT code FROM issue_slips WHERE code LIKE $1 UNION SELECT code FROM purchase_receipts WHERE code LIKE $1
       UNION SELECT "shipSlipCode" FROM bookings WHERE "shipSlipCode" LIKE $1`,
      `%-${day}-%`,
    );
    const foreign = all.filter((c) => !pbCodes.has(c));
    const rows = await col(`SELECT kind FROM warehouse_slip_counters WHERE day = $1`, day);
    if (foreign.length) counterKeeps.push(`${day} (có số không thuộc PB: ${foreign.join(',')})`);
    else if (rows.length) {
      rows.forEach((kind) => counterDeletes.push({ kind, day }));
      const unused = await col(
        `SELECT code FROM reserved_slip_codes r WHERE code LIKE $1 AND NOT EXISTS (SELECT 1 FROM purchase_receipts p WHERE p.code = r.code)`,
        `%-${day}-%`,
      );
      unused.forEach((x) => pbCodes.add(x));
      if (unused.length)
        log(`  số NK giữ chỗ chưa dùng ngày ${day} (xoá cùng bộ đếm): ${unused.join(',')}`);
    }
  }
  const reservedCodes = [...pbCodes];

  return {
    edges,
    noId,
    auditIds: [...auditIds],
    reservedCodes,
    counterDeletes,
    counterKeeps,
    piCodes,
  };
}

function parseModelMap(): Map<string, string> {
  const src = readFileSync('D:/DNA-ERP-BE/prisma/schema.prisma', 'utf8');
  const m = new Map<string, string>();
  for (const block of src.split(/\nmodel /).slice(1)) {
    const name = block.split(/\s/)[0];
    const map = /@@map\("([^"]+)"\)/.exec(block);
    m.set(map ? map[1] : name, name);
  }
  return m;
}

// ───────────────────────────────────────────── xoá ─────────────────────────────────────────────
async function main() {
  const c = await collect();
  log(DRY ? 'CHẾ ĐỘ --dry (chỉ in, không xoá)' : 'XOÁ THẬT');
  log('Số dòng sẽ xoá theo bảng:');
  for (const [t, s] of Object.entries(found).sort()) if (s.size) log(`  ${t.padEnd(36)} ${s.size}`);
  for (const n of c.noId) log(`  (bảng không id, xoá theo ${n.col} -> ${n.parent}) ${n.table}`);
  log(`  audit_logs ${c.auditIds.length}`);
  log(`  reserved_slip_codes theo số: ${c.reservedCodes.length}`);
  log(
    `  supplier_order_counters NCC ${SUPPLIER_IDS.join(',')}: ${(await col(`SELECT "supplierId" FROM supplier_order_counters WHERE "supplierId" = ANY($1::bigint[])`, SUPPLIER_IDS)).length}`,
  );
  log(
    `  warehouse_slip_counters xoá: ${j(c.counterDeletes)}; giữ: ${c.counterKeeps.join('; ') || '-'}`,
  );
  const nullCounts: string[] = [];
  for (const n of NULLIFY) {
    const k = ids(n.parent).length
      ? (
          await col(
            `SELECT id FROM "${n.table}" WHERE "${n.col}"::text = ANY($1::text[])`,
            ids(n.parent),
          )
        ).length
      : 0;
    if (k) nullCounts.push(`${n.table}.${n.col}=${k}`);
  }
  log(`  SET NULL: ${nullCounts.join(' ') || '-'}`);
  if (ids('sales_orders').length)
    log(
      '  đơn hàng:',
      (
        await col(
          `SELECT "orderCode" FROM sales_orders WHERE id = ANY($1::bigint[])`,
          ids('sales_orders'),
        )
      ).join(','),
    );
  if (c.piCodes.length) log('  PI:', c.piCodes.join(','));
  if (problems.length) {
    log('DỪNG - phát hiện dữ liệu ngoài PB lẫn vào, KHÔNG xoá gì:');
    problems.forEach((p) => log('  - ' + p));
    process.exitCode = 2;
    return;
  }
  if (DRY) return;

  const tables = Object.keys(found).filter(
    (t) => found[t].size && t !== 'stock_ledger' && t !== 'notifications',
  );
  const sub = c.edges.filter(
    (e) => tables.includes(e.child) && tables.includes(e.parent) && e.child !== e.parent,
  );
  const order: string[] = [];
  const remaining = new Set(tables);
  while (remaining.size) {
    const ready = [...remaining].filter(
      (t) => !sub.some((e) => e.parent === t && remaining.has(e.child)),
    );
    if (!ready.length) throw new Error('Vòng FK: ' + [...remaining].join(','));
    ready.sort().forEach((t) => {
      order.push(t);
      remaining.delete(t);
    });
  }
  const selfEdges = c.edges.filter((e) => e.child === e.parent && tables.includes(e.child));

  await raw.$transaction(
    async (tx) => {
      const ex = (sql: string, ...p: unknown[]) => tx.$executeRawUnsafe(sql, ...p);
      // 1. trả ngược stock_quant theo đúng bucket của trigger
      const led: any[] = await tx.$queryRawUnsafe(
        `SELECT id, "fromWarehouseId" f, "toWarehouseId" t, "materialId" m, "segmentSpecId" s, "pieceId" p, "productVariantId" v, qty::text q, "stockLengthMm" l, spec
       FROM stock_ledger WHERE id = ANY($1::bigint[]) ORDER BY id DESC`,
        ids('stock_ledger'),
      );
      const touched: { w: string; col: string; key: string; l?: number; spec?: string }[] = [];
      for (const r of led) {
        for (const [w, sign] of [
          [r.t, '-'],
          [r.f, '+'],
        ] as const) {
          let n: number;
          if (r.m != null) {
            n = await ex(
              `UPDATE stock_quant SET qty = qty ${sign} $1::numeric, "updatedAt" = now() WHERE "warehouseId"=$2::bigint AND "materialId"=$3::bigint AND "stockLengthMm"=$4::int AND spec=$5`,
              r.q,
              String(w),
              String(r.m),
              Number(r.l),
              r.spec ?? '',
            );
            touched.push({
              w: String(w),
              col: 'materialId',
              key: String(r.m),
              l: Number(r.l),
              spec: r.spec ?? '',
            });
          } else {
            const colName =
              r.s != null ? 'segmentSpecId' : r.p != null ? 'pieceId' : 'productVariantId';
            const key = String(r.s ?? r.p ?? r.v);
            n = await ex(
              `UPDATE stock_quant SET qty = qty ${sign} $1::numeric, "updatedAt" = now() WHERE "warehouseId"=$2::bigint AND "${colName}"=$3::bigint`,
              r.q,
              String(w),
              key,
            );
            touched.push({ w: String(w), col: colName, key });
          }
          if (n !== 1)
            throw new Error(`stock_quant không khớp đúng 1 dòng (ledger ${r.id}, kho ${w}): ${n}`);
        }
      }
      const counts: string[] = [];
      if (led.length)
        counts.push(
          `stock_ledger=${await ex(`DELETE FROM stock_ledger WHERE id = ANY($1::bigint[])`, ids('stock_ledger'))}`,
        );
      // 2. thông báo (recipients cascade)
      if (ids('notifications').length) {
        await ex(
          `DELETE FROM notification_recipients WHERE "notificationId" = ANY($1::text[])`,
          ids('notifications'),
        );
        counts.push(
          `notifications=${await ex(`DELETE FROM notifications WHERE id = ANY($1::text[])`, ids('notifications'))}`,
        );
      }
      // 3. gỡ liên kết bảng nền + tự tham chiếu
      for (const n of NULLIFY)
        if (ids(n.parent).length)
          await ex(
            `UPDATE "${n.table}" SET "${n.col}" = NULL WHERE "${n.col}"::text = ANY($1::text[])`,
            ids(n.parent),
          );
      for (const e of selfEdges)
        await ex(
          `UPDATE "${e.child}" SET "${e.childCol}" = NULL WHERE id::text = ANY($1::text[])`,
          ids(e.child),
        );
      await ex(
        `UPDATE purchase_proposal_items SET "reorderOfItemId" = NULL WHERE id = ANY($1::bigint[])`,
        ids('purchase_proposal_items'),
      );
      for (const d of c.noId)
        if (ids(d.parent).length)
          counts.push(
            `${d.table}=${await ex(`DELETE FROM "${d.table}" WHERE "${d.col}"::text = ANY($1::text[])`, ids(d.parent))}`,
          );
      // 4. xoá con trước cha
      for (const t of order) {
        const n = await ex(`DELETE FROM "${t}" WHERE id::text = ANY($1::text[])`, ids(t));
        counts.push(`${t}=${n}`);
        if (n !== found[t].size) throw new Error(`${t}: xoá ${n} khác dự kiến ${found[t].size}`);
      }
      // 5. bucket tồn về 0 và không còn bút toán nào -> do PB tạo, xoá
      let quantDel = 0;
      const seen = new Set<string>();
      for (const b of touched) {
        const k = j(b);
        if (seen.has(k)) continue;
        seen.add(k);
        const extra = b.col === 'materialId' ? ` AND "stockLengthMm"=$3::int AND spec=$4` : '';
        const p = b.col === 'materialId' ? [b.w, b.key, b.l, b.spec] : [b.w, b.key];
        quantDel += await ex(
          `DELETE FROM stock_quant WHERE "warehouseId"=$1::bigint AND "${b.col}"=$2::bigint${extra} AND qty = 0
         AND NOT EXISTS (SELECT 1 FROM stock_ledger WHERE ("fromWarehouseId"=$1::bigint OR "toWarehouseId"=$1::bigint) AND "${b.col}"=$2::bigint${extra})`,
          ...p,
        );
      }
      quantDel += await ex(
        `DELETE FROM stock_quant WHERE qty = 0 AND "pieceId" IN (SELECT id FROM piece WHERE "mfgProductId" = ANY($1::bigint[]))`,
        PRODUCT_IDS,
      );
      counts.push(`stock_quant(0)=${quantDel}`);
      // 6. audit, số phiếu, bộ đếm
      if (c.auditIds.length)
        counts.push(
          `audit_logs=${await ex(`DELETE FROM audit_logs WHERE id = ANY($1::text[])`, c.auditIds)}`,
        );
      if (c.reservedCodes.length)
        counts.push(
          `reserved_slip_codes=${await ex(`DELETE FROM reserved_slip_codes WHERE code = ANY($1::text[])`, c.reservedCodes)}`,
        );
      counts.push(
        `supplier_order_counters=${await ex(`DELETE FROM supplier_order_counters WHERE "supplierId" = ANY($1::bigint[])`, SUPPLIER_IDS)}`,
      );
      let wsc = 0;
      for (const d of c.counterDeletes)
        wsc += await ex(
          `DELETE FROM warehouse_slip_counters WHERE kind = $1 AND day = $2`,
          d.kind,
          d.day,
        );
      counts.push(`warehouse_slip_counters=${wsc}`);
      log('Đã xoá:', counts.join(' '));
    },
    { timeout: 180_000, maxWait: 20_000 },
  );
  log('Xong');
}

main()
  .catch((e) => {
    console.error('LỖI:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await raw.$disconnect();
  });
