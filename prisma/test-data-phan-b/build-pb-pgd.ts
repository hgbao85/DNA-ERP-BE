/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/restrict-template-expressions -- script dựng dữ liệu thử (ngoài ứng dụng), gọi Prisma/service kiểu lỏng */
/**
 * Dựng dữ liệu thử PB-P / PB-G / PB-D cho buổi test kho 12/11 - gọi service THẬT (Nest application context + cls).
 *
 *   cd D:\DNA-ERP-BE
 *   NODE_PATH="D:/DNA-ERP-BE/node_modules" npx ts-node --transpile-only -P tsconfig.json <đường dẫn>/build-pb-pgd.ts           # dọn rồi dựng lại
 *   NODE_PATH="D:/DNA-ERP-BE/node_modules" npx ts-node --transpile-only -P tsconfig.json <đường dẫn>/build-pb-pgd.ts --clean   # chỉ dọn
 *   ... build-pb-pgd.ts --report                                                                                          # chỉ in hiện trạng
 *
 * Dọn = xoá MỌI THỨ gắn với đơn PB-DH-P / PB-DH-G / PB-DH-D và LSX PBP-1 / PBG-1 / PBG-2 / PBD-1 bằng PrismaClient thô (không qua
 * audit extension), trong 1 transaction: FK RESTRICT nào còn trỏ vào dòng sắp xoá sẽ làm rollback toàn bộ (lưới an toàn).
 * Sổ kho (stock_ledger) do luồng này sinh ra được xoá và stock_quant được trừ ngược đúng bucket.
 * KHÔNG lùi: supplier_order_counters / warehouse_slip_counters (số đã cấp không cấp lại - đúng nghiệp vụ).
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from 'D:/DNA-ERP-BE/src/generated/prisma/client';

const SO_CODES = ['PB-DH-P', 'PB-DH-G', 'PB-DH-D'];
const LSX_CODES = ['PBP-1', 'PBG-1', 'PBG-2', 'PBD-1'];
const URL = 'https://example.com/pb-test.jpg';
const FG = 'thanh-pham';

const raw = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const j = (x: unknown) => JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(...a);

// ───────────────────────────────────────────── thu thập ─────────────────────────────────────────────
type Coll = Record<string, bigint[]>;

async function q(sql: string, ...params: unknown[]): Promise<bigint[]> {
  const rows: { id: bigint }[] = await raw.$queryRawUnsafe(sql, ...params);
  return [...new Set(rows.map((r) => BigInt(r.id)))];
}
const A = (ids: bigint[]) => ids.map((x) => x.toString());

async function collect(): Promise<{ c: Coll; slipCodes: string[]; problems: string[] }> {
  const c: Coll = {};
  const problems: string[] = [];
  c.sales_orders = await q(
    `SELECT id FROM sales_orders WHERE "orderCode" = ANY($1::text[])`,
    SO_CODES,
  );
  c.sales_order_items = await q(
    `SELECT id FROM sales_order_items WHERE "salesOrderId" = ANY($1::bigint[])`,
    A(c.sales_orders),
  );
  c.production_invoice_items = await q(
    `SELECT id FROM production_invoice_items WHERE "salesOrderId" = ANY($1::bigint[]) OR "salesOrderItemId" = ANY($2::bigint[]) OR "lsxCode" = ANY($3::text[])`,
    A(c.sales_orders),
    A(c.sales_order_items),
    LSX_CODES,
  );
  c.production_invoices = await q(
    `SELECT DISTINCT "productionInvoiceId" AS id FROM production_invoice_items WHERE id = ANY($1::bigint[]) AND "productionInvoiceId" IS NOT NULL
     UNION SELECT id FROM production_invoices WHERE "salesOrderId" = ANY($2::bigint[])`,
    A(c.production_invoice_items),
    A(c.sales_orders),
  );
  const foreignItems = await q(
    `SELECT id FROM production_invoice_items WHERE "productionInvoiceId" = ANY($1::bigint[]) AND NOT (id = ANY($2::bigint[]))`,
    A(c.production_invoices),
    A(c.production_invoice_items),
  );
  if (foreignItems.length) problems.push(`PI của PB chứa SKU lạ: ${A(foreignItems)}`);
  c.production_invoice_item_stages = await q(
    `SELECT id FROM production_invoice_item_stages WHERE "productionInvoiceItemId" = ANY($1::bigint[])`,
    A(c.production_invoice_items),
  );
  c.production_orders = await q(
    `SELECT id FROM production_orders WHERE "productionInvoiceItemId" = ANY($1::bigint[])`,
    A(c.production_invoice_items),
  );
  c.cutting_proposals = await q(
    `SELECT DISTINCT "cuttingProposalId" AS id FROM cutting_proposal_items WHERE "productionInvoiceItemId" = ANY($1::bigint[])
     UNION SELECT id FROM cutting_proposals WHERE "productionInvoiceId" = ANY($2::bigint[]) OR "productionOrderId" = ANY($3::bigint[])`,
    A(c.production_invoice_items),
    A(c.production_invoices),
    A(c.production_orders),
  );
  const foreignCpi = await q(
    `SELECT id FROM cutting_proposal_items WHERE "cuttingProposalId" = ANY($1::bigint[]) AND NOT ("productionInvoiceItemId" = ANY($2::bigint[]))`,
    A(c.cutting_proposals),
    A(c.production_invoice_items),
  );
  if (foreignCpi.length)
    problems.push(`phương án cắt của PB chứa SKU lạ: cutting_proposal_items ${A(foreignCpi)}`);
  c.cutting_proposal_items = await q(
    `SELECT id FROM cutting_proposal_items WHERE "cuttingProposalId" = ANY($1::bigint[])`,
    A(c.cutting_proposals),
  );
  c.cutting_proposal_lines = await q(
    `SELECT id FROM cutting_proposal_lines WHERE "cuttingProposalId" = ANY($1::bigint[])`,
    A(c.cutting_proposals),
  );
  c.cutting_proposal_patterns = await q(
    `SELECT id FROM cutting_proposal_patterns WHERE "lineId" = ANY($1::bigint[])`,
    A(c.cutting_proposal_lines),
  );
  c.cutting_proposal_pattern_segments = await q(
    `SELECT id FROM cutting_proposal_pattern_segments WHERE "patternId" = ANY($1::bigint[])`,
    A(c.cutting_proposal_patterns),
  );
  c.purchase_proposals = await q(
    `SELECT id FROM purchase_proposals WHERE "productionInvoiceId" = ANY($1::bigint[]) OR "cuttingProposalId" = ANY($2::bigint[])`,
    A(c.production_invoices),
    A(c.cutting_proposals),
  );
  c.purchase_proposal_items = await q(
    `SELECT id FROM purchase_proposal_items WHERE "proposalId" = ANY($1::bigint[])`,
    A(c.purchase_proposals),
  );
  c.purchase_proposal_quotes = await q(
    `SELECT id FROM purchase_proposal_quotes WHERE "itemId" = ANY($1::bigint[])`,
    A(c.purchase_proposal_items),
  );
  c.purchase_receipt_logs = await q(
    `SELECT id FROM purchase_receipt_logs WHERE "itemId" = ANY($1::bigint[])`,
    A(c.purchase_proposal_items),
  );
  c.supplier_orders = await q(
    `SELECT DISTINCT "supplierOrderId" AS id FROM purchase_proposal_items WHERE id = ANY($1::bigint[]) AND "supplierOrderId" IS NOT NULL`,
    A(c.purchase_proposal_items),
  );
  const foreignSoItems = await q(
    `SELECT id FROM purchase_proposal_items WHERE "supplierOrderId" = ANY($1::bigint[]) AND NOT (id = ANY($2::bigint[]))`,
    A(c.supplier_orders),
    A(c.purchase_proposal_items),
  );
  if (foreignSoItems.length)
    problems.push(`đơn đặt hàng của PB chứa dòng mua lạ: ${A(foreignSoItems)}`);
  c.purchase_receipts = await q(
    `SELECT id FROM purchase_receipts WHERE "supplierOrderId" = ANY($1::bigint[])
     UNION SELECT DISTINCT "receiptId" AS id FROM purchase_receipt_logs WHERE id = ANY($2::bigint[]) AND "receiptId" IS NOT NULL`,
    A(c.supplier_orders),
    A(c.purchase_receipt_logs),
  );
  const slipRows: { code: string }[] = await raw.$queryRawUnsafe(
    `SELECT code FROM purchase_receipts WHERE id = ANY($1::bigint[]) AND code IS NOT NULL`,
    A(c.purchase_receipts),
  );
  const slipCodes = slipRows.map((r) => r.code);
  c.production_batches = await q(
    `SELECT id FROM production_batches WHERE "productionOrderId" = ANY($1::bigint[])`,
    A(c.production_orders),
  );
  c.qc_reviews = await q(
    `SELECT id FROM qc_reviews WHERE "productionBatchId" = ANY($1::bigint[])`,
    A(c.production_batches),
  );
  c.qc_review_segments = await q(
    `SELECT id FROM qc_review_segments WHERE "qcReviewId" = ANY($1::bigint[])`,
    A(c.qc_reviews),
  );
  c.floor_reports = await q(
    `SELECT id FROM floor_reports WHERE "productionBatchId" = ANY($1::bigint[]) OR "productionInvoiceId" = ANY($2::bigint[])`,
    A(c.production_batches),
    A(c.production_invoices),
  );
  c.floor_report_lines = await q(
    `SELECT id FROM floor_report_lines WHERE "floorReportId" = ANY($1::bigint[])`,
    A(c.floor_reports),
  );
  c.floor_queue_entries = await q(
    `SELECT id FROM floor_queue_entries WHERE "productionInvoiceId" = ANY($1::bigint[])`,
    A(c.production_invoices),
  );
  c.stock_reservations = await q(
    `SELECT id FROM stock_reservations WHERE "productionInvoiceId" = ANY($1::bigint[])
       OR ("refType" = 'CUTTING_PROPOSAL' AND "refId" = ANY($2::text[]))
       OR ("refType" IN ('PRODUCTION_INVOICE','CONSUMABLE_MATERIAL_PURCHASE','MATERIAL_YIELD_RECIPE_PURCHASE','PIECE_MATERIAL_YIELD_PURCHASE') AND "refId" = ANY($1::text[]))`,
    A(c.production_invoices),
    A(c.cutting_proposals),
  );
  c.stock_ledger = await q(
    `SELECT id FROM stock_ledger WHERE ("refType" = 'PURCHASE' AND "refId" = ANY($1::text[]))
       OR ("refType" IN ('FRAME_OUTPUT','SEGMENT_CONSUME','QC_SCRAP') AND "refId" = ANY($2::text[]))
       OR "idempotencyKey" LIKE ANY(SELECT "idempotencyKey" || ':%' FROM purchase_receipts WHERE id = ANY($3::bigint[]))`,
    A(c.purchase_proposals),
    A(c.production_batches),
    A(c.purchase_receipts),
  );
  return { c, slipCodes, problems };
}

const NOTIF_TYPES: Record<string, string> = {
  PRODUCTION_INVOICE: 'production_invoices',
  PRODUCTION_INVOICE_ITEM: 'production_invoice_items',
  PRODUCTION_ORDER: 'production_orders',
  CUTTING_PROPOSAL: 'cutting_proposals',
  PURCHASE_PROPOSAL: 'purchase_proposals',
  PRODUCTION_BATCH: 'production_batches',
  QC_REVIEW: 'qc_reviews',
  FLOOR_QUEUE_ENTRY: 'floor_queue_entries',
  SALES_ORDER: 'sales_orders',
  SUPPLIER_ORDER: 'supplier_orders',
  PURCHASE_RECEIPT: 'purchase_receipts',
};
const AUDIT_MODELS: Record<string, string> = {
  sales_orders: 'SalesOrder',
  sales_order_items: 'SalesOrderItem',
  production_invoice_items: 'ProductionInvoiceItem',
  production_invoices: 'ProductionInvoice',
  production_invoice_item_stages: 'ProductionInvoiceItemStage',
  production_orders: 'ProductionOrder',
  cutting_proposals: 'CuttingProposal',
  cutting_proposal_items: 'CuttingProposalItem',
  cutting_proposal_lines: 'CuttingProposalLine',
  purchase_proposals: 'PurchaseProposal',
  purchase_proposal_items: 'PurchaseProposalItem',
  supplier_orders: 'SupplierOrder',
  purchase_receipts: 'PurchaseReceipt',
  stock_reservations: 'StockReservation',
  production_batches: 'ProductionBatch',
  qc_reviews: 'QcReview',
  floor_reports: 'FloorReport',
  floor_queue_entries: 'FloorQueueEntry',
  stock_ledger: 'StockLedger',
};
// con trước, cha sau
const DELETE_ORDER = [
  'qc_review_segments',
  'qc_reviews',
  'floor_report_lines',
  'floor_reports',
  'production_batches',
  'purchase_receipt_logs',
  'purchase_proposal_quotes',
  'stock_ledger',
  'purchase_receipts',
  'purchase_proposal_items',
  'supplier_orders',
  'purchase_proposals',
  'stock_reservations',
  'cutting_proposal_pattern_segments',
  'cutting_proposal_patterns',
  'cutting_proposal_lines',
  'cutting_proposal_items',
  'cutting_proposals',
  'production_orders',
  'floor_queue_entries',
  'production_invoice_item_stages',
  'production_invoice_items',
  'production_invoices',
  'sales_order_items',
  'sales_orders',
];

async function clean(): Promise<void> {
  // phương án cắt còn CALCULATING của chính tiến trình khác đang chạy: chờ một chút cho solver ghi xong
  for (let k = 0; k < 20; k++) {
    const { c } = await collect();
    const n: { n: number }[] = await raw.$queryRawUnsafe(
      `SELECT count(*)::int n FROM cutting_proposals WHERE id = ANY($1::bigint[]) AND status = 'CALCULATING'`,
      A(c.cutting_proposals),
    );
    if (!n[0].n) break;
    log('  chờ solver đang chạy...');
    await sleep(3000);
  }
  const { c, slipCodes, problems } = await collect();
  if (problems.length) throw new Error('DỪNG - không dọn: ' + problems.join(' | '));
  const total = Object.values(c).reduce((s, v) => s + v.length, 0);
  log(
    'Dọn:',
    Object.entries(c)
      .filter(([, v]) => v.length)
      .map(([k, v]) => `${k}=${v.length}`)
      .join(' '),
    `slipCodes=${slipCodes.length}`,
  );
  if (total === 0) {
    const n = await raw.$executeRawUnsafe(
      `DELETE FROM notifications WHERE "entityType" IS NULL AND title LIKE ANY($1::text[])`,
      LSX_CODES.map((x) => `${x}:%`),
    );
    log(`  (không có gì để dọn${n ? `, xoá ${n} thông báo sót theo số LSX` : ''})`);
    return;
  }

  await raw.$transaction(
    async (tx) => {
      const ex = (sql: string, ...p: unknown[]) => tx.$executeRawUnsafe(sql, ...p);
      // thông báo trỏ vào thực thể của PB (recipients cascade)
      let notif = 0;
      for (const [type, table] of Object.entries(NOTIF_TYPES)) {
        if (!c[table]?.length) continue;
        notif += await ex(
          `DELETE FROM notifications WHERE "entityType" = $1 AND "entityId" = ANY($2::text[])`,
          type,
          A(c[table]),
        );
      }
      // QC_PASSED... không gắn entity (entityType NULL), tiêu đề bắt đầu bằng số LSX ("PBP-1: KCS duyệt đạt"); mã PI bị cấp lại
      // sau khi xoá nên không khớp theo data.piCode được.
      notif += await ex(
        `DELETE FROM notifications WHERE "entityType" IS NULL AND title LIKE ANY($1::text[])`,
        LSX_CODES.map((c) => `${c}:%`),
      );
      let audits = 0;
      for (const [table, model] of Object.entries(AUDIT_MODELS)) {
        if (!c[table]?.length) continue;
        audits += await ex(
          `DELETE FROM audit_logs WHERE "tableName" = $1 AND "recordId" = ANY($2::text[])`,
          model,
          A(c[table]),
        );
      }
      // trừ ngược stock_quant theo đúng bucket của trigger fn_sync_stock_quant
      const led: any[] = await tx.$queryRawUnsafe(
        `SELECT "fromWarehouseId" f, "toWarehouseId" t, "materialId" m, "segmentSpecId" s, "pieceId" p, "productVariantId" v, qty::text q, "stockLengthMm" l, spec
       FROM stock_ledger WHERE id = ANY($1::bigint[])`,
        A(c.stock_ledger),
      );
      const touched: { w: bigint; col: string; key: bigint; l?: number; spec?: string }[] = [];
      for (const r of led) {
        for (const [w, sign] of [
          [r.t, '-'],
          [r.f, '+'],
        ] as const) {
          if (r.m != null) {
            await ex(
              `UPDATE stock_quant SET qty = qty ${sign} $1::numeric, "updatedAt" = now() WHERE "warehouseId"=$2 AND "materialId"=$3 AND "stockLengthMm"=$4 AND spec=$5`,
              r.q,
              w,
              r.m,
              r.l,
              r.spec,
            );
            touched.push({ w, col: 'materialId', key: r.m, l: r.l, spec: r.spec });
          } else {
            const col =
              r.s != null ? 'segmentSpecId' : r.p != null ? 'pieceId' : 'productVariantId';
            const key = r.s ?? r.p ?? r.v;
            await ex(
              `UPDATE stock_quant SET qty = qty ${sign} $1::numeric, "updatedAt" = now() WHERE "warehouseId"=$2 AND "${col}"=$3`,
              r.q,
              w,
              key,
            );
            touched.push({ w, col, key });
          }
        }
      }
      const counts: string[] = [];
      for (const t of DELETE_ORDER) {
        if (!c[t]?.length) continue;
        const n = await ex(`DELETE FROM "${t}" WHERE id = ANY($1::bigint[])`, A(c[t]));
        counts.push(`${t}=${n}`);
      }
      if (slipCodes.length)
        counts.push(
          `reserved_slip_codes=${await ex(`DELETE FROM reserved_slip_codes WHERE code = ANY($1::text[])`, slipCodes)}`,
        );
      // bucket stock_quant về 0 và không còn bút toán nào => do chính luồng này tạo ra, xoá
      let quantDel = 0;
      for (const b of touched) {
        const extra =
          b.col === 'materialId'
            ? ` AND "stockLengthMm"=${Number(b.l)} AND spec='${String(b.spec).replace(/'/g, "''")}'`
            : '';
        const ledgerExtra =
          b.col === 'materialId'
            ? ` AND "stockLengthMm"=${Number(b.l)} AND spec='${String(b.spec).replace(/'/g, "''")}'`
            : '';
        quantDel += await ex(
          `DELETE FROM stock_quant sq WHERE "warehouseId"=$1 AND "${b.col}"=$2${extra} AND qty = 0
         AND NOT EXISTS (SELECT 1 FROM stock_ledger WHERE ("fromWarehouseId"=$1 OR "toWarehouseId"=$1) AND "${b.col}"=$2${ledgerExtra})`,
          b.w,
          b.key,
        );
      }
      log(
        '  đã xoá:',
        counts.join(' '),
        `notifications=${notif} audit_logs=${audits} stock_quant(0)=${quantDel}`,
      );
    },
    { timeout: 120_000 },
  );
}

// ───────────────────────────────────────────── dựng ─────────────────────────────────────────────
async function build(): Promise<void> {
  const { NestFactory } = await import('@nestjs/core');
  const { ClsService } = await import('nestjs-cls');
  const { AppModule } = await import('D:/DNA-ERP-BE/src/app.module');
  const { SalesOrdersService } =
    await import('D:/DNA-ERP-BE/src/modules/sales-orders/sales-orders.service');
  const { CuttingProposalsService } =
    await import('D:/DNA-ERP-BE/src/modules/cutting-proposals/cutting-proposals.service');
  const { ProductionInvoicesService } =
    await import('D:/DNA-ERP-BE/src/modules/production-invoices/production-invoices.service');
  const { SupplierOrdersService } =
    await import('D:/DNA-ERP-BE/src/modules/purchase-proposals/supplier-orders.service');
  const { PurchaseReceiptsService } =
    await import('D:/DNA-ERP-BE/src/modules/purchase-proposals/purchase-receipts.service');
  const { ProductionOrdersService } =
    await import('D:/DNA-ERP-BE/src/modules/production-orders/production-orders.service');
  const { ProductionBatchesService } =
    await import('D:/DNA-ERP-BE/src/modules/production-batches/production-batches.service');
  const { QcReviewsService } =
    await import('D:/DNA-ERP-BE/src/modules/qc-reviews/qc-reviews.service');
  const { ConsumableMaterialPurchaseService } =
    await import('D:/DNA-ERP-BE/src/modules/production-invoices/consumable-material-purchase.service');
  const { PieceMaterialYieldPurchaseService } =
    await import('D:/DNA-ERP-BE/src/modules/production-invoices/piece-material-yield-purchase.service');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const cls = app.get(ClsService);
    const so = app.get(SalesOrdersService);
    const cp = app.get(CuttingProposalsService);
    const pis = app.get(ProductionInvoicesService);
    const sup = app.get(SupplierOrdersService);
    const rec = app.get(PurchaseReceiptsService);
    const pos = app.get(ProductionOrdersService);
    const pbs = app.get(ProductionBatchesService);
    const qcs = app.get(QcReviewsService);
    const consumablePurchase = app.get(ConsumableMaterialPurchaseService);
    const yieldPurchase = app.get(PieceMaterialYieldPurchaseService);

    const U: Record<string, any> = {};
    for (const u of await raw.user.findMany({
      where: {
        username: {
          in: ['sales', 'khsx', 'qlsx', 'boss', 'han', 'kcs', 'nhan', 'nghi', 'kieulinh', 'diem'],
        },
      },
      include: { roles: { include: { role: true } } },
    }))
      U[u.username] = { ...u, roleNames: (u as any).roles.map((r: any) => r.role.name) };
    const as = <T>(user: string, fn: () => Promise<T>): Promise<T> =>
      cls.run(async () => {
        cls.set('userId', U[user].id);
        return fn();
      });

    const customer = await raw.customer.findFirstOrThrow({ where: { name: 'PB Khách thử' } });
    const prod = async (fc: string) =>
      raw.mfgProduct.findFirstOrThrow({ where: { factoryCode: fc } });
    const SP1 = await prod('PB-SP1');
    const SP2 = await prod('PB-SP2');
    const fgWh = await raw.warehouse.findUniqueOrThrow({ where: { code: FG } });
    const wsPhuAn = await raw.workshop.findFirstOrThrow({ where: { code: 'PHU_AN' } });
    const wsPhuocAn = await raw.workshop.findFirstOrThrow({ where: { code: 'PHUOC_AN' } });

    const createOrder = async (code: string, lines: { p: any; qty: number; d: string }[]) => {
      const order: any = await as('sales', () =>
        so.create({
          orderCode: code,
          customerId: customer.id.toString(),
          orderDate: new Date().toISOString(),
          items: lines.map((l) => ({
            mfgProductId: l.p.id.toString(),
            totalQty: l.qty,
            deliveryDate: new Date(l.d + 'T00:00:00+07:00').toISOString(),
          })),
        } as any),
      );
      const items = [];
      for (const l of lines) {
        items.push(
          await raw.productionInvoiceItem.findFirstOrThrow({
            where: { salesOrderId: BigInt(order.id), mfgProductId: l.p.id },
            orderBy: { id: 'asc' },
          }),
        );
      }
      log(`  ${code}: salesOrder ${order.id}, piItems ${items.map((i) => i.id).join(',')}`);
      return { orderId: BigInt(order.id), items };
    };

    const solve = async (itemIds: bigint[]) => {
      const p: any = await as('khsx', () =>
        cp.requestForBatch({ productionInvoiceItemIds: itemIds.map(String) } as any, U.khsx.id),
      );
      const t0 = Date.now();
      for (;;) {
        const r = await raw.cuttingProposal.findUniqueOrThrow({ where: { id: BigInt(p.id) } });
        if (r.status !== 'CALCULATING') {
          if (r.status !== 'DRAFT' || r.hasInfeasibleLine)
            throw new Error(
              `Phương án ${p.id} ${r.status} infeasible=${r.hasInfeasibleLine} ${r.errorMessage ?? ''}`,
            );
          log(`  phương án cắt ${p.id} DRAFT sau ${Math.round((Date.now() - t0) / 1000)}s`);
          return r.id;
        }
        if (Date.now() - t0 > 300_000) throw new Error(`Phương án ${p.id} tính quá 5 phút`);
        await sleep(2000);
      }
    };

    const sendToBoss = async (
      piId: bigint,
      items: { id: bigint; lsx: string }[],
      workshopId: bigint,
    ) => {
      for (const it of items) {
        await as('khsx', () =>
          pis.updateItemLsx(piId.toString(), it.id.toString(), it.lsx, {
            id: U.khsx.id,
            roles: U.khsx.roleNames,
          }),
        );
      }
      await as('khsx', () => pis.sendBatchToQlsx(piId.toString(), U.khsx.id));
      await as('qlsx', () =>
        pis.sendBatchToBoss(piId.toString(), FG, fgWh.name, workshopId.toString(), U.qlsx.id),
      );
    };

    const afterApprove = async (piId: bigint, cpId: bigint, label: string) => {
      const prop = await raw.cuttingProposal.findUniqueOrThrow({ where: { id: cpId } });
      if (prop.status !== 'APPROVED')
        throw new Error(
          `${label}: phương án cắt ${cpId} sau duyệt là ${prop.status} (duyệt Sếp lỗi ngầm?)`,
        );
      // Trigger mua vật tư không-sắt chạy ngầm trong approve, lỗi chỉ log (vd transaction 5s hết hạn trên DB dev ở xa) và
      // KHÔNG có route thử lại khi phương án đã APPROVED -> gọi lại đúng service đó (idempotent, upsert) cho tới khi đủ dòng.
      const ensure = async (
        codes: string[],
        svc: { computeAndUpsertProposals(id: string): Promise<unknown> },
        name: string,
      ) => {
        for (let k = 0; ; k++) {
          const have = await raw.purchaseProposalItem.findMany({
            where: { proposal: { productionInvoiceId: piId }, material: { code: { in: codes } } },
            select: { material: { select: { code: true } } },
          });
          const missing = codes.filter((c) => !have.some((h) => h.material.code === c));
          if (!missing.length) return;
          if (k >= 4)
            throw new Error(`${label}: vẫn thiếu dòng mua ${missing} sau ${k} lần gọi lại ${name}`);
          log(
            `  ${label}: thiếu dòng mua ${missing.join(',')} sau duyệt -> gọi lại ${name} (lần ${k + 1})`,
          );
          try {
            await svc.computeAndUpsertProposals(piId.toString());
          } catch (e) {
            log(`    lỗi: ${(e as Error).message.split(String.fromCharCode(10)).slice(-1)[0]}`);
          }
        }
      };
      await ensure(['TAM-LA-01'], yieldPurchase, 'PieceMaterialYieldPurchaseService');
      await ensure(
        ['TR-001', 'VTK-001', 'VTK-002', 'VTK-004', 'VTK-352'],
        consumablePurchase,
        'ConsumableMaterialPurchaseService',
      );
      const orders = await raw.productionOrder.findMany({
        where: { productionInvoiceItem: { productionInvoiceId: piId } },
        orderBy: { id: 'asc' },
      });
      for (const o of orders) await as('qlsx', () => pos.startFloor(o.id.toString()));
      log(
        `  ${label}: PI ${piId} duyệt xong, proposal APPROVED, lệnh SX ${orders.map((o) => o.id).join(',')} đã Bắt đầu`,
      );
      return orders;
    };

    const ppItems = async (piId: bigint, codes: string[]) =>
      raw.purchaseProposalItem.findMany({
        where: { proposal: { productionInvoiceId: piId }, material: { code: { in: codes } } },
        include: { material: true },
        orderBy: { id: 'asc' },
      });

    /** qtyOverride: nhận ít hơn số còn lại (nhận thiếu, dòng vẫn PURCHASING) - dùng cho PB-G sơn bột 15 / 20,3. */
    const receiveAll = async (
      keeper: string,
      scope: string,
      items: any[],
      qtyOverride?: number,
    ) => {
      // mỗi lần nhận: cùng vật tư + cùng chiều dài + cùng quy cách + cùng kho nhận + cùng đơn
      const groups = new Map<string, any[]>();
      for (const it of items) {
        const k = [
          it.materialId,
          it.stockLengthMm,
          it.spec ?? '',
          it.receiveWarehouseCode,
          it.supplierOrderId,
        ].join('|');
        groups.set(k, [...(groups.get(k) ?? []), it]);
      }
      for (const g of groups.values()) {
        const fresh = await raw.purchaseProposalItem.findMany({
          where: { id: { in: g.map((x) => x.id) } },
          include: { material: { include: { materialGroup: true } } },
        });
        const remaining = fresh.reduce(
          (s, x) => s + Number(x.orderQty ?? x.buyQty) - Number(x.receivedQty),
          0,
        );
        const qty = qtyOverride ?? Math.round(remaining * 10000) / 10000;
        const { code } = await rec.reserveSlipCode(U[keeper].id);
        const isSteel =
          fresh[0].material.materialGroup?.systemKey === 'SAT' ||
          /^SAT-/.test(fresh[0].material.code);
        await as(keeper, () =>
          rec.receive(
            {
              slipCode: code,
              itemIds: fresh.map((x) => x.id.toString()),
              unitRateQty: qty,
              deliveredQty: qty,
              supplierSlipUrls: [URL],
              receiptSlipUrls: [URL],
              weighSlipUrls: isSteel ? [URL] : [],
            } as any,
            U[keeper].id,
            `pb-pgd:${randomUUID()}`,
            scope,
          ),
        );
        log(
          `  nhận ${fresh[0].material.code} len=${fresh[0].stockLengthMm} qty=${qty} phiếu ${code} (${keeper}, ${scope})`,
        );
      }
    };

    // ── A) PB-P: 1 SKU, Phước An, HAN mảnh PB-B 10 + KCS ─────────────────────────────────────
    log('== PB-P');
    {
      const { items } = await createOrder('PB-DH-P', [{ p: SP1, qty: 10, d: '2026-12-20' }]);
      const it = items[0];
      const cpId = await solve([it.id]);
      const pi: any = await as('khsx', () =>
        pis.claimSolo(it.id.toString(), { cuttingProposalId: cpId.toString() } as any),
      );
      const piId = BigInt(pi.id);
      await sendToBoss(piId, [{ id: it.id, lsx: 'PBP-1' }], wsPhuocAn.id);
      await as('boss', () => pis.approveItem(piId.toString(), it.id.toString(), U.boss.id));
      const [po] = await afterApprove(piId, cpId, 'PB-P');
      const pieceB = await raw.piece.findFirstOrThrow({
        where: { mfgProductId: SP1.id, code: 'PB-B' },
      });
      const batch: any = await as('han', () =>
        pbs.recordProductionBatch(
          po.id.toString(),
          { pieceId: pieceB.id.toString(), qty: 10, stage: 'HAN' } as any,
          U.han.id,
          U.han.mfgRole,
        ),
      );
      await as('han', () =>
        pbs.finishProductionBatch(batch.id, U.han.id, U.han.mfgRole, U.han.warehouseScope),
      );
      await as('kcs', () => qcs.reviewProductionBatch(batch.id, { failedQty: 0 } as any, U.kcs.id));
      log(`  HAN batch ${batch.id} 10 mảnh PB-B -> KCS đạt`);
    }

    // ── B) PB-G: 1 PI gộp 2 SKU, Phú An, mua + nhận sơn bột ─────────────────────────────────
    log('== PB-G');
    {
      const { items } = await createOrder('PB-DH-G', [
        { p: SP1, qty: 10, d: '2026-12-05' },
        { p: SP2, qty: 10, d: '2026-12-12' },
      ]);
      const cpId = await solve(items.map((i) => i.id));
      const pi: any = await as('khsx', () =>
        pis.mergeItems(
          {
            productionInvoiceItemIds: items.map((i) => i.id.toString()),
            cuttingProposalId: cpId.toString(),
          } as any,
          U.khsx.id,
        ),
      );
      const piId = BigInt(pi.id);
      // Hạn giao 05/12 vs 12/12 -> mốc cần sắt tự đề xuất 17/11 vs 24/11, vượt khung gộp 3 ngày (SystemConfig.solverMergeWindowDays=3)
      // => sendBatchToQlsx() chặn. KHSX "Sửa thời hạn" (luồng thật) kéo mốc Mua VT khung của SKU 2 về 19/11 rồi mới gửi.
      await as('khsx', () =>
        pis.updateItemsDeadlines(
          piId.toString(),
          {
            items: [
              { itemId: items[1].id.toString(), materialDeadline: '2026-11-19T00:00:00+07:00' },
            ],
          } as any,
          { id: U.khsx.id, roles: U.khsx.roleNames },
        ),
      );
      await sendToBoss(
        piId,
        [
          { id: items[0].id, lsx: 'PBG-1' },
          { id: items[1].id, lsx: 'PBG-2' },
        ],
        wsPhuAn.id,
      );
      await as('boss', () => pis.approveBatch(piId.toString(), U.boss.id));
      await afterApprove(piId, cpId, 'PB-G');
      const paint = await ppItems(piId, ['VTK-004']);
      if (!paint.length) throw new Error('PB-G: không có dòng mua VTK-004');
      const order: any = await as('nghi', () =>
        sup.create(
          { supplierId: '9', itemIds: paint.map((x) => x.id.toString()) } as any,
          U.nghi.id,
          U.nghi.roleNames,
        ),
      );
      await as('nghi', () => sup.approve(order.id, URL, U.nghi.id, U.nghi.roleNames));
      log(
        `  đơn đặt hàng ${order.id} (NCC 9) sơn bột ${paint.map((x) => x.id).join(',')} đã duyệt`,
      );
      const fresh = await raw.purchaseProposalItem.findMany({
        where: { id: { in: paint.map((x) => x.id) } },
      });
      // 12/11: chỉ nhận 15 (không đủ 20,3) để ca chặn ưu tiên SKU sớm xảy ra: SKU 1 (PBG-1, hạn 05/12) cần ~10,15 nên
      // SKU 2 (PBG-2) chỉ còn xuất được ~4,85.
      await receiveAll('diem', 'phoi-son-han-son-pa', fresh, 15);
    }

    // ── C) PB-D: 1 SKU, Phú An, mua SAT-001+TR-001 nhận đủ, SAT-002 đặt chưa nhận ───────────
    log('== PB-D');
    {
      const { items } = await createOrder('PB-DH-D', [{ p: SP2, qty: 10, d: '2026-12-25' }]);
      const it = items[0];
      const cpId = await solve([it.id]);
      const pi: any = await as('khsx', () =>
        pis.claimSolo(it.id.toString(), { cuttingProposalId: cpId.toString() } as any),
      );
      const piId = BigInt(pi.id);
      await sendToBoss(piId, [{ id: it.id, lsx: 'PBD-1' }], wsPhuAn.id);
      await as('boss', () => pis.approveItem(piId.toString(), it.id.toString(), U.boss.id));
      await afterApprove(piId, cpId, 'PB-D');
      const first = await ppItems(piId, ['SAT-001', 'TR-001']);
      const second = await ppItems(piId, ['SAT-002']);
      if (!first.length || !second.length)
        throw new Error(
          `PB-D: thiếu dòng mua (SAT-001/TR-001=${first.length}, SAT-002=${second.length})`,
        );
      const o1: any = await as('nhan', () =>
        sup.create(
          { supplierId: '8', itemIds: first.map((x) => x.id.toString()) } as any,
          U.nhan.id,
          U.nhan.roleNames,
        ),
      );
      await as('nhan', () => sup.approve(o1.id, URL, U.nhan.id, U.nhan.roleNames));
      const o2: any = await as('nhan', () =>
        sup.create(
          { supplierId: '8', itemIds: second.map((x) => x.id.toString()) } as any,
          U.nhan.id,
          U.nhan.roleNames,
        ),
      );
      await as('nhan', () => sup.approve(o2.id, URL, U.nhan.id, U.nhan.roleNames));
      log(`  đơn 1 ${o1.id} (SAT-001+TR-001) + đơn 2 ${o2.id} (SAT-002) đã duyệt`);
      const fresh = await raw.purchaseProposalItem.findMany({
        where: { id: { in: first.map((x) => x.id) } },
      });
      await receiveAll('kieulinh', 'phoi-son-han', fresh);
    }
  } finally {
    await app.close();
  }
}

// ───────────────────────────────────────────── báo cáo ─────────────────────────────────────────────
async function report(): Promise<void> {
  const whs = new Map(
    (await raw.warehouse.findMany({ select: { id: true, code: true } })).map((w) => [w.id, w.code]),
  );
  for (const code of SO_CODES) {
    const order = await raw.salesOrder.findUnique({ where: { orderCode: code } });
    if (!order) {
      log(`${code}: (không có)`);
      continue;
    }
    const items = await raw.productionInvoiceItem.findMany({
      where: { salesOrderId: order.id },
      orderBy: { id: 'asc' },
      include: { mfgProduct: true, productionOrder: true, workshop: true },
    });
    const piIds = [
      ...new Set(items.map((i) => i.productionInvoiceId).filter((x): x is bigint => x != null)),
    ];
    log(`\n${code}: salesOrder ${order.id}`);
    for (const i of items) {
      log(
        `  item ${i.id} ${i.mfgProduct.factoryCode} qty ${i.quantity} PI ${i.productionInvoiceId} LSX ${i.lsxCode} ${i.prodApprovalStatus} kho ${i.warehouseCode} xưởng ${i.workshop?.code} PO ${i.productionOrder ? `${i.productionOrder.id}(${i.productionOrder.floorStage})` : '-'}`,
      );
    }
    for (const piId of piIds) {
      const pi = await raw.productionInvoice.findUniqueOrThrow({ where: { id: piId } });
      const cps = await raw.cuttingProposal.findMany({
        where: { productionInvoiceId: piId },
        select: { id: true, status: true },
      });
      log(`  PI ${piId} ${pi.code} merged=${pi.isMerged} proposals ${j(cps)}`);
      const ppi = await raw.purchaseProposalItem.findMany({
        where: { proposal: { productionInvoiceId: piId } },
        include: { material: true, receiptLogs: true },
        orderBy: { id: 'asc' },
      });
      for (const x of ppi) {
        log(
          `    mua ${x.id} ${x.material.code} buy=${x.buyQty} order=${x.orderQty ?? '-'} recv=${x.receivedQty} len=${x.stockLengthMm} kho=${x.receiveWarehouseCode} ${x.status} đơn=${x.supplierOrderId ?? '-'} receipts=${x.receiptLogs.length}`,
        );
      }
      const res = await raw.stockReservation.findMany({
        where: { productionInvoiceId: piId },
        include: { material: true },
        orderBy: { id: 'asc' },
      });
      for (const r of res)
        log(
          `    giữ chỗ ${r.id} ${r.material.code} ${r.quantity} len=${r.stockLengthMm} ${r.status} ${r.refType} kho=${whs.get(r.warehouseId)}`,
        );
      const poIds = items
        .filter((i) => i.productionInvoiceId === piId)
        .flatMap((i) => (i.productionOrder ? [i.productionOrder.id] : []));
      const batches = await raw.productionBatch.findMany({
        where: { productionOrderId: { in: poIds } },
        include: { qcReviews: true, piece: true } as any,
      });
      for (const b of batches as any[]) {
        const fo = await raw.stockLedger.findMany({
          where: { refId: b.id.toString(), refType: { in: ['FRAME_OUTPUT', 'SEGMENT_CONSUME'] } },
        });
        log(
          `    batch ${b.id} ${b.stage} ${b.piece.code} qty=${b.reportedQty} ${b.status} qc=${b.qcReviews.map((q: any) => q.id).join(',')} ledger=${fo.map((l) => `${l.refType}:${whs.get(l.fromWarehouseId)}->${whs.get(l.toWarehouseId)} ${l.qty}`).join('; ')}`,
        );
      }
    }
    const pp = await raw.purchaseProposal.findMany({
      where: { productionInvoiceId: { in: piIds } },
      select: { id: true },
    });
    const led = await raw.stockLedger.findMany({
      where: { refType: 'PURCHASE', refId: { in: pp.map((x) => x.id.toString()) } },
      include: { material: true },
    });
    for (const l of led)
      log(
        `  nhập kho ${l.material?.code} ${l.qty} len=${l.stockLengthMm} -> ${whs.get(l.toWarehouseId)}`,
      );
  }
  const quants = await raw.stockQuant.findMany({
    where: { NOT: { qty: 0 } },
    include: { material: true, piece: true, segmentSpec: true } as any,
  });
  log('\nstock_quant ≠ 0 (toàn DB):');
  for (const s of quants as any[])
    log(
      `  ${whs.get(s.warehouseId)} ${s.material?.code ?? (s.piece ? 'piece ' + s.piece.code + '#' + s.pieceId : 'seg#' + s.segmentSpecId)} len=${s.stockLengthMm} ${s.qty}`,
    );
}

async function main() {
  const mode = process.argv.includes('--clean')
    ? 'clean'
    : process.argv.includes('--report')
      ? 'report'
      : 'build';
  if (mode === 'report') return report();
  log('== Dọn dữ liệu PB-P/G/D cũ');
  await clean();
  if (mode === 'clean') return;
  await build();
  await report();
}

main()
  .catch((e) => {
    console.error('LỖI:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await raw.$disconnect();
    setTimeout(() => process.exit(), 500);
  });
