/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- script dựng dữ liệu thử (ngoài ứng dụng), gọi Prisma/service kiểu lỏng */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from 'D:/DNA-ERP-BE/src/generated/prisma/client';
const p = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const j = (x: any) => JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
const q = (s: string, ...a: any[]) =>
  p.$queryRawUnsafe(s, ...a).then((r) => console.log(s.split('\n')[0].slice(0, 90), '\n  ', j(r)));
(async () => {
  const so = await p.salesOrder.findUnique({ where: { orderCode: 'PB-DH-A' } });
  if (!so) {
    console.log('NO PB-DH-A');
    return p.$disconnect();
  }
  const it = await p.productionInvoiceItem.findFirstOrThrow({
    where: { salesOrderItem: { salesOrderId: so.id } },
  });
  const po = await p.productionOrder.findUnique({ where: { productionInvoiceItemId: it.id } });
  console.log(
    'SO',
    so.id,
    'item',
    j({
      id: it.id,
      pi: it.productionInvoiceId,
      lsx: it.lsxCode,
      status: it.prodApprovalStatus,
      wh: it.warehouseCode,
      ws: it.workshopId,
      qty: it.quantity,
    }),
  );
  console.log(
    'PO',
    j({ id: po?.id, poNumber: po?.poNumber, floor: po?.floorStage, qty: po?.quantity }),
  );
  await q(
    `select cp.id, cp.status from cutting_proposals cp join cutting_proposal_items ci on ci."cuttingProposalId"=cp.id where ci."productionInvoiceItemId"=$1::bigint`,
    String(it.id),
  );
  await q(
    `select r.id, m.code, r.quantity, r.status, r."stockLengthMm", r."warehouseId" from stock_reservations r join materials m on m.id=r."materialId" where r."productionInvoiceId"=$1::bigint order by m.code`,
    String(it.productionInvoiceId),
  );
  await q(
    `select pp.id, pp.status, pp."cuttingProposalId", pp."productionInvoiceId" from purchase_proposals pp where pp."productionInvoiceId"=$1::bigint or pp."cuttingProposalId" in (select "cuttingProposalId" from cutting_proposal_items where "productionInvoiceItemId"=$2::bigint)`,
    String(it.productionInvoiceId),
    String(it.id),
  );
  await q(
    `select i.id, i."proposalId", m.code, i."buyQty", i."orderQty", i."stockLengthMm", i.status, i."supplierOrderId", i."receiveWarehouseCode" from purchase_proposal_items i join materials m on m.id=i."materialId" join purchase_proposals pp on pp.id=i."proposalId" where pp."productionInvoiceId"=$1::bigint or pp."cuttingProposalId" in (select "cuttingProposalId" from cutting_proposal_items where "productionInvoiceItemId"=$2::bigint) order by m.code`,
    String(it.productionInvoiceId),
    String(it.id),
  );
  await q(
    `select b.id, pc.code, b.stage, b."reportedQty", b.status, (select count(*)::int from qc_reviews r where r."productionBatchId"=b.id) qc from production_batches b join piece pc on pc.id=b."pieceId" where b."productionOrderId"=$1::bigint order by b.id`,
    String(po!.id),
  );
  await q(
    `select w.code, pc.code piece, sq.qty from stock_quant sq join warehouses w on w.id=sq."warehouseId" join piece pc on pc.id=sq."pieceId" where sq."pieceId" in (334,335,336) order by 1,2`,
  );
  await q(
    `select w.code, ss.id seg, sq.qty from stock_quant sq join warehouses w on w.id=sq."warehouseId" join segment_spec ss on ss.id=sq."segmentSpecId" where ss.id in (select "segmentSpecId" from piece_bom where "bomRevisionId"=101) order by 1,2`,
  );
  await q(
    `select l.id, l."refType", l."refId", l.qty, fw.code fromw, tw.code tow, l."pieceId", l."segmentSpecId" from stock_ledger l join warehouses fw on fw.id=l."fromWarehouseId" join warehouses tw on tw.id=l."toWarehouseId" where l."createdAt" > now() - interval '2 hours' order by l.id`,
  );
  await q(
    `select "pieceId", sum("checkedQty")::int from transfer_check_results where "productionInvoiceItemId"=$1::bigint group by 1`,
    String(it.id),
  );
  await q(
    `select sum("boxesPacked")::int from packaging_records where "productionInvoiceItemId"=$1::bigint`,
    String(it.id),
  );
  await q(
    `select b.id, b."bookingNo", b.status, b."warehouseCode", b.etd, (select json_agg(json_build_object('item', l."productionInvoiceItemId", 'qty', l.qty)) from booking_lines l where l."bookingId"=b.id) lines from bookings b where "bookingNo"='PB-BK'`,
  );
  await q(
    `select "entityType", type, "entityId", count(*)::int from notifications where "createdAt" > now() - interval '2 hours' group by 1,2,3 order by 1,2`,
  );
  await q(`select count(*)::int from audit_logs where "correlationId"='PB-A-BUILD'`);
  await q(
    `select "tableName", count(*)::int from audit_logs where "createdAt" > now() - interval '2 hours' and ("correlationId" is null or "correlationId" <> 'PB-A-BUILD') group by 1`,
  );
  await q(`select * from warehouse_slip_counters`);
  await p.$disconnect();
})();
