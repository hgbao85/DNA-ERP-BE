/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- script dựng dữ liệu thử (ngoài ứng dụng), gọi Prisma/service kiểu lỏng */
/**
 * Dữ liệu thử đơn "PB-A" (phiên test kho 12/11) - dựng bằng service THẬT qua Nest application context.
 *
 *   Dựng :  cd D:\DNA-ERP-BE && NODE_PATH="D:/DNA-ERP-BE/node_modules" npx ts-node --transpile-only -P tsconfig.json <path>/build-pb-a.ts
 *   Dọn  :  ... build-pb-a.ts --clean
 *   Dọn rồi dựng lại: ... build-pb-a.ts --rebuild
 *   Chỉ in kế hoạch dọn (không xoá): ... build-pb-a.ts --clean --dry
 *
 * Nhận diện dữ liệu của script: đơn hàng PB-DH-A (-> dòng đơn -> PI item -> PI, lệnh SX), booking PB-BK. Mọi bảng có khoá ngoại
 * trỏ vào các dòng đó được dò theo đồ thị FK (pg_constraint) và xoá theo thứ tự con trước cha. Sổ kho (refId không có FK) dò theo
 * (refType, refId) rồi trả lại stock_quant trước khi xoá. Nhật ký audit dò theo correlationId = CLS id mà script đặt.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ClsService, CLS_ID } from 'nestjs-cls';
import { AppModule } from 'D:/DNA-ERP-BE/src/app.module';
import { PRISMA_SERVICE } from 'D:/DNA-ERP-BE/src/prisma/prisma.service';
import { SalesOrdersService } from 'D:/DNA-ERP-BE/src/modules/sales-orders/sales-orders.service';
import { CuttingProposalsService } from 'D:/DNA-ERP-BE/src/modules/cutting-proposals/cutting-proposals.service';
import { ProductionInvoicesService } from 'D:/DNA-ERP-BE/src/modules/production-invoices/production-invoices.service';
import { ProductionOrdersService } from 'D:/DNA-ERP-BE/src/modules/production-orders/production-orders.service';
import { ProductionBatchesService } from 'D:/DNA-ERP-BE/src/modules/production-batches/production-batches.service';
import { QcReviewsService } from 'D:/DNA-ERP-BE/src/modules/qc-reviews/qc-reviews.service';
import { WarehouseTransfersService } from 'D:/DNA-ERP-BE/src/modules/warehouse-transfers/warehouse-transfers.service';
import { IssueSlipsService } from 'D:/DNA-ERP-BE/src/modules/issue-slips/issue-slips.service';
import { WeavingIssuesService } from 'D:/DNA-ERP-BE/src/modules/weaving-issues/weaving-issues.service';
import { BookingsService } from 'D:/DNA-ERP-BE/src/modules/bookings/bookings.service';
import { PurchaseProposalsService } from 'D:/DNA-ERP-BE/src/modules/purchase-proposals/purchase-proposals.service';
import { SupplierOrdersService } from 'D:/DNA-ERP-BE/src/modules/purchase-proposals/supplier-orders.service';
import { PurchaseReceiptsService } from 'D:/DNA-ERP-BE/src/modules/purchase-proposals/purchase-receipts.service';
import { MaterialYieldIssuesService } from 'D:/DNA-ERP-BE/src/modules/material-yield-issues/material-yield-issues.service';
import { PackagingIssuesService } from 'D:/DNA-ERP-BE/src/modules/packaging-issues/packaging-issues.service';

const ORDER_CODE = 'PB-DH-A';
const LSX = 'PBA-1';
const BOOKING_NO = 'PB-BK';
const CORRELATION = 'PB-A-BUILD';
const PRODUCT = 'PB-SP1';
const CUSTOMER_ID = '11';
const WEAVING_POINT_ID = '6';
const WORKSHOP_ID = '1'; // PHU_AN
const FG_WAREHOUSE = 'thanh-pham';
const SON_PA = 'phoi-son-han-son-pa';
const SLIP_URL = 'https://example.com/pb-test.jpg';
const PAT_QTY = 16; // PB-C: 40 cần, làm 16, chừa 24

const args = process.argv.slice(2);
const CLEAN = args.includes('--clean');
const REBUILD = args.includes('--rebuild');
const DRY = args.includes('--dry');

const j = (x: unknown) => JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log('[pb-a]', ...a);

type Ctx = {
  app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
  cls: ClsService;
  prisma: any;
};

/** Chạy fn trong CLS của user. DB dev dùng chung + ở xa nên transaction 5s mặc định đôi khi hết giờ (P2028) - transaction đó
 *  đã rollback nên chạy lại an toàn (mọi lời gọi ghi đều có khoá idempotency hoặc chốt trạng thái). */
async function asUser<T>(ctx: Ctx, userId: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await ctx.cls.run(async () => {
        ctx.cls.set(CLS_ID, CORRELATION);
        ctx.cls.set('userId', userId);
        return fn();
      });
    } catch (e: any) {
      if (e?.code !== 'P2028' || attempt >= 4) throw e;
      log(`P2028 (transaction hết giờ) - thử lại lần ${attempt + 1}`);
      await sleep(1500);
    }
  }
}

// ─────────────────────────────────────────── BUILD ───────────────────────────────────────────

async function build(ctx: Ctx) {
  const { app, prisma } = ctx;
  const so = app.get(SalesOrdersService);
  const cp = app.get(CuttingProposalsService);
  const pis = app.get(ProductionInvoicesService);
  const pos = app.get(ProductionOrdersService);
  const pbs = app.get(ProductionBatchesService);
  const qc = app.get(QcReviewsService);
  const wts = app.get(WarehouseTransfersService);
  const slips = app.get(IssueSlipsService);
  const weaving = app.get(WeavingIssuesService);
  const bookings = app.get(BookingsService);

  const existing = await prisma.salesOrder.findUnique({ where: { orderCode: ORDER_CODE } });
  if (existing)
    throw new Error(`${ORDER_CODE} đã có (id ${existing.id}) - chạy --clean hoặc --rebuild`);
  if (await prisma.booking.findFirst({ where: { bookingNo: BOOKING_NO } }))
    throw new Error(`Booking ${BOOKING_NO} đã có - chạy --clean trước`);

  const U: Record<string, { id: string; mfgRole: string | null; roles: string[] }> = {};
  for (const name of [
    'sales',
    'khsx',
    'qlsx',
    'boss',
    'han',
    'son',
    'kcs',
    'diem',
    'trinh',
    'khotp',
    'nhan',
    'kieulinh',
    'phoi',
  ]) {
    const u = await prisma.user.findFirstOrThrow({ where: { username: name } });
    U[name] = { id: u.id, mfgRole: u.mfgRole ?? null, roles: [] };
  }
  const product = await prisma.mfgProduct.findFirstOrThrow({
    where: { id: 127n, factoryCode: PRODUCT },
  });
  const pieces = Object.fromEntries(
    (
      await prisma.piece.findMany({
        where: { mfgProductId: product.id, code: { in: ['PB-A', 'PB-B', 'PB-C'] } },
      })
    ).map((p: any) => [p.code, p.id.toString()]),
  ) as Record<'PB-A' | 'PB-B' | 'PB-C', string>;
  log('pieces', j(pieces));

  // 1. Đơn hàng
  const order = await asUser(ctx, U.sales.id, () =>
    so.create({
      orderCode: ORDER_CODE,
      customerId: CUSTOMER_ID,
      orderDate: new Date().toISOString(),
      items: [
        {
          mfgProductId: product.id.toString(),
          totalQty: 20,
          deliveryDate: new Date('2026-12-15T00:00:00.000Z').toISOString(),
        },
      ],
    } as any),
  );
  const piItem = await prisma.productionInvoiceItem.findFirstOrThrow({
    where: { salesOrderItem: { salesOrderId: BigInt(order.id) } },
  });
  const itemId = piItem.id.toString();
  log('salesOrder', order.id, 'piItem', itemId);

  // 2. Phương án cắt
  const proposal = await asUser(ctx, U.khsx.id, () =>
    cp.requestForBatch({ productionInvoiceItemIds: [itemId] } as any, U.khsx.id),
  );
  const t0 = Date.now();
  let prop: any;
  for (;;) {
    prop = await prisma.cuttingProposal.findUniqueOrThrow({ where: { id: BigInt(proposal.id) } });
    if (prop.status !== 'CALCULATING') break;
    if (Date.now() - t0 > 300_000) throw new Error('Solver quá 5 phút');
    await sleep(2000);
  }
  log(
    'proposal',
    proposal.id,
    prop.status,
    'infeasible',
    prop.hasInfeasibleLine,
    `${(Date.now() - t0) / 1000}s`,
  );
  if (prop.status !== 'DRAFT' || prop.hasInfeasibleLine)
    throw new Error(`Phương án cắt không dùng được: ${prop.status} ${prop.errorMessage ?? ''}`);

  // 3. claimSolo -> PI
  const pi = await asUser(ctx, U.khsx.id, () =>
    pis.claimSolo(itemId, { cuttingProposalId: proposal.id } as any),
  );
  const piId = pi.id;
  log('PI', piId, pi.code);

  // 4-7. LSX, gửi QLSX, gửi Sếp, Sếp duyệt
  await asUser(ctx, U.khsx.id, () =>
    pis.updateItemLsx(piId, itemId, LSX, { id: U.khsx.id, roles: ['KHSX'] }),
  );
  await asUser(ctx, U.khsx.id, () => pis.sendBatchToQlsx(piId, U.khsx.id));
  const fgWh = await prisma.warehouse.findUniqueOrThrow({ where: { code: FG_WAREHOUSE } });
  await asUser(ctx, U.qlsx.id, () =>
    pis.sendBatchToBoss(piId, FG_WAREHOUSE, fgWh.name, WORKSHOP_ID, U.qlsx.id),
  );
  await asUser(ctx, U.boss.id, () => pis.approveItem(piId, itemId, U.boss.id));
  // approve có thể chạy nền phần đề xuất mua - chờ proposal APPROVED
  for (let k = 0; k < 60; k++) {
    prop = await prisma.cuttingProposal.findUniqueOrThrow({ where: { id: BigInt(proposal.id) } });
    if (prop.status === 'APPROVED') break;
    await sleep(1000);
  }
  const po = await prisma.productionOrder.findUniqueOrThrow({
    where: { productionInvoiceItemId: piItem.id },
  });
  const poId = po.id.toString();
  log('cuttingProposal', prop.status, 'productionOrder', poId);
  if (prop.status !== 'APPROVED')
    throw new Error('Cutting proposal chưa APPROVED sau khi Sếp duyệt');

  // 8. Mua hàng: KHÔNG tạo đơn NCC, KHÔNG nhận.

  // 9. QLSX bắt đầu
  await asUser(ctx, U.qlsx.id, () => pos.startFloor(poId));
  log('startFloor ok');

  // 10. Báo sản lượng + KCS
  const report = async (pieceCode: 'PB-A' | 'PB-B', stage: 'HAN' | 'SON', qty: number) => {
    const reporter = stage === 'HAN' ? U.han : U.son;
    const role = reporter.mfgRole;
    const b = await asUser(ctx, reporter.id, () =>
      pbs.recordProductionBatch(
        poId,
        { pieceId: pieces[pieceCode], qty, stage } as any,
        reporter.id,
        role,
        `pb-a:${pieceCode}:${stage}:rec`,
      ),
    );
    await asUser(ctx, reporter.id, () => pbs.finishProductionBatch(b.id, reporter.id, role, null));
    await asUser(ctx, U.kcs.id, () =>
      qc.reviewProductionBatch(b.id, { failedQty: 0 } as any, U.kcs.id),
    );
    log(`batch ${pieceCode} ${stage} qty ${qty} -> id ${b.id} QC_DONE`);
  };
  await report('PB-A', 'HAN', 15);
  await report('PB-A', 'SON', 15);
  await report('PB-B', 'HAN', 30);
  await report('PB-B', 'SON', 30);

  // PB-C (pat): mua đúng dòng TAM-LA-01 của PB-A -> nhận -> xuất XK cho Phôi -> Phôi nhận -> báo công đoạn -> KCS -> kho Phôi PA
  const ppr = app.get(PurchaseProposalsService);
  const sos = app.get(SupplierOrdersService);
  const prs = app.get(PurchaseReceiptsService);
  const myi = app.get(MaterialYieldIssuesService);
  const tamla = await prisma.material.findUniqueOrThrow({ where: { code: 'TAM-LA-01' } });
  const tamItem = await prisma.purchaseProposalItem.findFirstOrThrow({
    where: { materialId: tamla.id, proposal: { productionInvoiceId: BigInt(piId) } },
  });
  const buy = Number(tamItem.buyQty);
  const bars = Math.ceil(buy);
  // Làm tròn lên số tấm nguyên bằng "sửa số mua" (orderQty) - đường thật của người mua, để nhận không bị tính "nhận vượt".
  if (bars > buy) {
    await asUser(ctx, U.nhan.id, () =>
      ppr.updateOrderQty(
        tamItem.proposalId.toString(),
        tamItem.id.toString(),
        { orderQty: bars } as any,
        U.nhan.id,
        [],
      ),
    );
  }
  const sup = await asUser(ctx, U.nhan.id, () =>
    sos.create({ supplierId: '8', itemIds: [tamItem.id.toString()] } as any, U.nhan.id, []),
  );
  await asUser(ctx, U.nhan.id, () => sos.approve(sup.id, SLIP_URL, U.nhan.id, []));
  log(
    'supplier order',
    sup.id,
    sup.code,
    'APPROVED, item',
    tamItem.id.toString(),
    `buy ${buy} -> order ${bars}`,
  );
  const nk = await asUser(ctx, U.kieulinh.id, () => prs.reserveSlipCode(U.kieulinh.id));
  const rec = await asUser(ctx, U.kieulinh.id, () =>
    prs.receive(
      {
        slipCode: nk.code,
        itemIds: [tamItem.id.toString()],
        unitRateQty: bars,
        deliveredQty: bars,
        supplierSlipUrls: [SLIP_URL],
        receiptSlipUrls: [SLIP_URL],
        weighSlipUrls: [SLIP_URL],
      } as any,
      U.kieulinh.id,
      'pb-a:receipt-tamla',
      'phoi-son-han',
    ),
  );
  log('purchase receipt', rec.id, rec.code, 'qty', rec.receivedQty);

  // Xuất la tấm cho Phôi qua phiếu XK (dòng MATERIAL_YIELD), đúng định mức còn lại
  const plan = await myi.getIssuePlan(poId);
  const tamPlan: any = plan.find((x: any) => x.materialId === tamla.id.toString());
  log('material-yield plan TAM-LA-01', j(tamPlan));
  const issueQty = tamPlan ? Number(tamPlan.remainingToIssue ?? tamPlan.requiredQty) : 1;
  const xk = await asUser(ctx, U.kieulinh.id, () =>
    slips.create(
      {
        recipientName: 'Tổ Phôi',
        lines: [
          {
            kind: 'MATERIAL_YIELD',
            materialId: tamla.id.toString(),
            productionOrderId: poId,
            qty: issueQty,
          },
        ],
      } as any,
      U.kieulinh.id,
      'phoi-son-han',
    ),
  );
  await asUser(ctx, U.kieulinh.id, () =>
    slips.confirm(xk.id, [SLIP_URL], U.kieulinh.id, 'phoi-son-han', 'pb-a:tamla-slip-confirm'),
  );
  const myIssue = await prisma.materialYieldIssue.findFirstOrThrow({
    where: { productionOrderId: BigInt(poId), materialId: tamla.id },
  });
  await asUser(ctx, U.phoi.id, () =>
    myi.receive(myIssue.id.toString(), {} as any, U.phoi.id, U.phoi.mfgRole),
  );
  log(
    'XK',
    xk.id,
    xk.code,
    'material-yield issue',
    myIssue.id.toString(),
    'qty',
    issueQty,
    'RECEIVED',
  );

  // Báo công đoạn PHOI theo processSteps của mảnh pat, KCS đạt từng công đoạn -> công đoạn cuối tự sinh lô PHOI QC_DONE
  const poRow = await prisma.productionOrder.findUniqueOrThrow({ where: { id: BigInt(poId) } });
  const patSteps: string[] = (
    await prisma.pieceMaterialYield.findMany({
      where: { bomRevisionId: poRow.bomRevisionId, pieceId: BigInt(pieces['PB-C']) },
    })
  ).flatMap((y: any) => y.processSteps);
  const STEP_ORDER = ['CAT', 'UON', 'DAP', 'DUC_LO'];
  const steps = [...new Set(patSteps)].sort(
    (a, b) => STEP_ORDER.indexOf(a) - STEP_ORDER.indexOf(b),
  );
  if (steps.length === 0) {
    const b = await asUser(ctx, U.phoi.id, () =>
      pbs.recordProductionBatch(
        poId,
        { pieceId: pieces['PB-C'], qty: PAT_QTY, stage: 'PHOI' } as any,
        U.phoi.id,
        U.phoi.mfgRole,
        'pb-a:PB-C:PHOI:rec',
      ),
    );
    await asUser(ctx, U.phoi.id, () =>
      pbs.finishProductionBatch(b.id, U.phoi.id, U.phoi.mfgRole, null),
    );
    await asUser(ctx, U.kcs.id, () =>
      qc.reviewProductionBatch(b.id, { failedQty: 0 } as any, U.kcs.id),
    );
    log(`PB-C PHOI qty ${PAT_QTY} batch ${b.id} QC_DONE`);
  } else {
    for (const step of steps) {
      await asUser(ctx, U.phoi.id, () =>
        pbs.recordPieceStepBatch(
          poId,
          { stage: 'PHOI', pieceId: pieces['PB-C'], step, qty: PAT_QTY } as any,
          U.phoi.id,
          U.phoi.mfgRole,
          `pb-a:PB-C:${step}`,
        ),
      );
      const bundle = await asUser(ctx, U.phoi.id, () =>
        pbs.submitPieceStep(
          poId,
          { pieceId: pieces['PB-C'], step } as any,
          U.phoi.id,
          U.phoi.mfgRole,
        ),
      );
      await asUser(ctx, U.kcs.id, () =>
        qc.reviewPieceStep(bundle.id, { failedQty: 0 } as any, U.kcs.id),
      );
      log(`PB-C step ${step} qty ${PAT_QTY} bundle ${bundle.id} QC_PASSED`);
    }
  }

  // PB-C từ kho Phôi PA -> thanh-pham
  const phoiPa = await prisma.warehouse.findUniqueOrThrow({ where: { code: 'phoi-son-han' } });
  const trC = await asUser(ctx, U.kieulinh.id, () =>
    wts.createPieceTransfer(
      {
        fromWarehouseId: phoiPa.id.toString(),
        toWarehouseId: fgWh.id.toString(),
        pieceItems: [{ productionOrderId: poId, pieceId: pieces['PB-C'], quantity: PAT_QTY }],
      } as any,
      'phoi-son-han',
      U.kieulinh.id,
      'pb-a:transfer-pb-c',
    ),
  );
  await asUser(ctx, U.trinh.id, () =>
    wts.confirm(trC.id, { signedSlipUrls: [SLIP_URL] } as any, U.trinh.id, null),
  );
  log('pieceTransfer PB-C', trC.id, trC.code, 'CONFIRMED');

  // 11. PB-B (không đan) 20 mảnh Sơn PA -> thanh-pham
  const sonPa = await prisma.warehouse.findUniqueOrThrow({ where: { code: SON_PA } });
  const tr = await asUser(ctx, U.diem.id, () =>
    wts.createPieceTransfer(
      {
        fromWarehouseId: sonPa.id.toString(),
        toWarehouseId: fgWh.id.toString(),
        pieceItems: [{ productionOrderId: poId, pieceId: pieces['PB-B'], quantity: 20 }],
      } as any,
      null,
      U.diem.id,
      'pb-a:transfer-pb-b',
    ),
  );
  await asUser(ctx, U.trinh.id, () =>
    wts.confirm(tr.id, { signedSlipUrls: [SLIP_URL] } as any, U.trinh.id, null),
  );
  log('pieceTransfer', tr.id, tr.code, 'CONFIRMED');

  // 12. PB-A (đan): phiếu xuất đan WEAVING_PIECE 10 mảnh -> PB-Đ, xác nhận, nhập đan 10
  const slip = await asUser(ctx, U.diem.id, () =>
    slips.create(
      {
        weavingPointId: WEAVING_POINT_ID,
        lines: [
          { kind: 'WEAVING_PIECE', pieceId: pieces['PB-A'], productionOrderId: poId, qty: 10 },
        ],
      } as any,
      U.diem.id,
      null,
    ),
  );
  await asUser(ctx, U.diem.id, () =>
    slips.confirm(slip.id, [SLIP_URL], U.diem.id, null, 'pb-a:weave-slip-confirm'),
  );
  log('weaving issue slip', slip.id, slip.code, 'ISSUED');
  const rc = await asUser(ctx, U.trinh.id, () =>
    weaving.receive(
      poId,
      { pieceId: pieces['PB-A'], weavingPointId: WEAVING_POINT_ID, qty: 10 } as any,
      U.trinh.id,
      null,
      'pb-a:weave-receipt',
    ),
  );
  log('weaving receipt', rc.id);

  // 13. Chuyền kiểm: 8 sản phẩm -> PB-A 8, PB-B 16, PB-C 16 -> cổng xuất vật tư đóng gói = 8
  await asUser(ctx, U.trinh.id, () =>
    pis.recordTransferCheck(
      piId,
      itemId,
      { pieceId: pieces['PB-A'], checkedQty: 8 } as any,
      U.trinh.id,
    ),
  );
  await asUser(ctx, U.trinh.id, () =>
    pis.recordTransferCheck(
      piId,
      itemId,
      { pieceId: pieces['PB-B'], checkedQty: 16 } as any,
      U.trinh.id,
    ),
  );
  await asUser(ctx, U.trinh.id, () =>
    pis.recordTransferCheck(
      piId,
      itemId,
      { pieceId: pieces['PB-C'], checkedQty: PAT_QTY } as any,
      U.trinh.id,
    ),
  );
  log(`transfer checks A=8 B=16 C=${PAT_QTY}`);
  const gate = await app.get(PackagingIssuesService).getBulkPlan([poId]);
  log(
    'packaging-issue plan',
    j(
      gate.map((g: any) => ({
        mat: g.materialCode,
        required: g.requiredQty,
        issued: g.issuedQty,
        remainingToIssue: g.remainingToIssue,
      })),
    ),
  );

  // 14. Đóng gói 6 thùng
  const pk = await asUser(ctx, U.trinh.id, () =>
    pis.recordPackaging(piId, itemId, { boxesPacked: 6 } as any, U.trinh.id),
  );
  log('packaging', j(pk));

  // 15. Booking PB-BK, DRAFT
  const bk = await asUser(ctx, U.sales.id, () =>
    bookings.create({
      bookingNo: BOOKING_NO,
      customerId: CUSTOMER_ID,
      pod: 'TEST',
      warehouseCode: FG_WAREHOUSE,
      etd: '2026-12-01',
      lines: [{ productionInvoiceItemId: itemId, qty: 8 }],
    } as any),
  );
  log('booking', bk.id, bk.status);
}

// ─────────────────────────────────────────── CLEAN ───────────────────────────────────────────

type FkEdge = { child: string; childCol: string; parent: string; parentCol: string };

function loadFkGraph(prisma: any): Promise<FkEdge[]> {
  return prisma.$queryRawUnsafe(`
    SELECT c.conrelid::regclass::text AS child, a.attname AS "childCol",
           c.confrelid::regclass::text AS parent, af.attname AS "parentCol"
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
    WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace AND array_length(c.conkey, 1) = 1`);
}

const unq = (s: string) => s.replace(/"/g, '');
/** Bảng chỉ "trỏ tới" dữ liệu của mình (dòng của người khác / master) - gỡ liên kết (SET NULL), không xoá. */
const NULLIFY_TABLES = new Set(['plan_forms']);
/** Không bao giờ đi xuống qua các bảng này. */
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
]);

async function clean(ctx: Ctx) {
  const { prisma } = ctx;
  const edges = (await loadFkGraph(prisma)).map((e) => ({
    child: unq(e.child),
    childCol: e.childCol,
    parent: unq(e.parent),
    parentCol: e.parentCol,
  }));
  const hasId = new Set<string>(
    (
      (await prisma.$queryRawUnsafe(
        `SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='id'`,
      )) as { table_name: string }[]
    ).map((r) => r.table_name),
  );
  const idType = new Map<string, string>(
    (
      (await prisma.$queryRawUnsafe(
        `SELECT table_name, data_type FROM information_schema.columns WHERE table_schema='public' AND column_name='id'`,
      )) as { table_name: string; data_type: string }[]
    ).map((r) => [r.table_name, r.data_type]),
  );

  // Gốc
  const roots: Record<string, Set<string>> = {};
  const add = (t: string, ids: (string | bigint)[]) => {
    roots[t] ??= new Set();
    ids.forEach((i) => roots[t].add(i.toString()));
  };
  const so = await prisma.salesOrder.findUnique({ where: { orderCode: ORDER_CODE } });
  if (so) add('sales_orders', [so.id]);
  const items = so
    ? await prisma.productionInvoiceItem.findMany({
        where: { salesOrderItem: { salesOrderId: so.id } },
        select: { id: true, productionInvoiceId: true },
      })
    : [];
  add(
    'production_invoice_items',
    items.map((i: any) => i.id),
  );
  const piIds = items.map((i: any) => i.productionInvoiceId).filter(Boolean);
  // PI chỉ xoá nếu mọi dòng của nó thuộc đơn này
  for (const piId of piIds) {
    const others = await prisma.productionInvoiceItem.count({
      where: { productionInvoiceId: piId, id: { notIn: items.map((i: any) => i.id) } },
    });
    if (others === 0) add('production_invoices', [piId]);
    else log(`CẢNH BÁO: PI ${piId} có dòng khác - không xoá PI`);
  }
  const itemIds = items.map((i: any) => i.id);
  const pos = await prisma.productionOrder.findMany({
    where: { productionInvoiceItemId: { in: itemIds } },
  });
  const poIds = pos.map((p: any) => p.id);
  add('production_orders', poIds);
  const cpIds = (
    await prisma.cuttingProposalItem.findMany({
      where: { productionInvoiceItemId: { in: itemIds } },
      select: { cuttingProposalId: true },
    })
  ).map((r: any) => r.cuttingProposalId);
  add('cutting_proposals', cpIds);
  const bks = await prisma.booking.findMany({
    where: { bookingNo: BOOKING_NO },
    select: { id: true },
  });
  add(
    'bookings',
    bks.map((b: any) => b.id),
  );
  // Phiếu (header là cha của dòng trỏ vào lệnh)
  const slipIds = (
    await prisma.issueSlipLine.findMany({
      where: { OR: [{ productionOrderId: { in: poIds } }, { productionInvoiceId: { in: piIds } }] },
      select: { slipId: true },
    })
  ).map((r: any) => r.slipId);
  add('issue_slips', slipIds);
  const trIds = (
    await prisma.warehouseTransferPieceItem.findMany({
      where: { productionOrderId: { in: poIds } },
      select: { transferId: true },
    })
  ).map((r: any) => r.transferId);
  add('warehouse_transfers', trIds);
  // Đơn đặt hàng NCC mà tester tạo từ dòng đề xuất của PB-A (mọi dòng thuộc PB-A)
  const ppItems = await prisma
    .$queryRawUnsafe(
      `SELECT ppi.id, ppi."supplierOrderId" FROM purchase_proposal_items ppi JOIN purchase_proposals pp ON pp.id = ppi."proposalId"
     WHERE pp."productionInvoiceId" = ANY($1::bigint[]) OR pp."cuttingProposalId" = ANY($2::bigint[])`,
      piIds.map(String),
      cpIds.map(String),
    )
    .catch((e: Error) => {
      log('(bỏ qua dò đơn NCC:', e.message.split('\n')[0], ')');
      return [];
    });
  const soIds = [
    ...new Set(
      (ppItems as any[])
        .map((r) => r.supplierOrderId)
        .filter(Boolean)
        .map(String),
    ),
  ];
  for (const sid of soIds) {
    const n = (await prisma.$queryRawUnsafe(
      `SELECT count(*)::int n FROM purchase_proposal_items WHERE "supplierOrderId" = $1::bigint AND NOT (id = ANY($2::bigint[]))`,
      sid,
      (ppItems as any[]).map((r) => String(r.id)),
    )) as { n: number }[];
    if (n[0].n === 0) add('supplier_orders', [sid]);
    else log(`CẢNH BÁO: đơn NCC ${sid} có dòng của đơn khác - không xoá`);
  }

  if (Object.values(roots).every((s) => s.size === 0)) {
    log('Không có gì để dọn');
  }

  // Lan theo FK xuống bảng con
  const found: Record<string, Set<string>> = {};
  const nullify: { table: string; col: string; ids: string[] }[] = [];
  const queue: [string, string[]][] = [];
  for (const [t, s] of Object.entries(roots)) {
    found[t] ??= new Set();
    const fresh = [...s].filter((x) => !found[t].has(x));
    fresh.forEach((x) => found[t].add(x));
    if (fresh.length) queue.push([t, fresh]);
  }
  const noIdDeletes: { table: string; col: string; ids: string[] }[] = [];
  while (queue.length) {
    const [parent, ids] = queue.shift()!;
    for (const e of edges.filter((x) => x.parent === parent && x.parentCol === 'id')) {
      if (STOP_TABLES.has(e.child)) continue;
      if (NULLIFY_TABLES.has(e.child)) {
        nullify.push({ table: e.child, col: e.childCol, ids });
        continue;
      }
      if (!hasId.has(e.child)) {
        noIdDeletes.push({ table: e.child, col: e.childCol, ids });
        continue;
      }
      const castP = idType.get(parent) === 'bigint' ? 'bigint' : 'text';
      const rows = (await prisma.$queryRawUnsafe(
        `SELECT id::text AS id FROM "${e.child}" WHERE "${e.childCol}"::text = ANY($1::text[])`,
        ids,
      )) as { id: string }[];
      void castP;
      found[e.child] ??= new Set();
      const fresh = rows.map((r) => r.id).filter((x) => !found[e.child].has(x));
      fresh.forEach((x) => found[e.child].add(x));
      if (fresh.length) queue.push([e.child, fresh]);
    }
  }

  // Sổ kho theo (refType, refId)
  const ids = (t: string) => [...(found[t] ?? [])];
  const ledger = (await prisma.$queryRawUnsafe(
    `SELECT id::text id, "fromWarehouseId", "toWarehouseId", "materialId", "segmentSpecId", "pieceId", "productVariantId", qty, "stockLengthMm", spec
     FROM stock_ledger WHERE
       ("refType" IN ('FRAME_OUTPUT','SEGMENT_CONSUME') AND "refId" = ANY($1::text[]))
    OR ("refType" IN ('WEAVING_ISSUE') AND "refId" = ANY($2::text[]))
    OR ("refType" IN ('WEAVING_ISSUE_MATERIAL') AND "refId" = ANY($3::text[]))
    OR ("refType" IN ('WAREHOUSE_TRANSFER') AND "refId" = ANY($4::text[]))
    OR ("refType" IN ('STEEL_ISSUE') AND "refId" = ANY($5::text[]))
    OR ("refType" IN ('MATERIAL_ISSUE') AND "refId" = ANY($6::text[]))
    OR ("refType" IN ('PACKAGING_ISSUE') AND "refId" = ANY($7::text[]))
    OR ("refType" IN ('MATERIAL_YIELD_CONSUME') AND "refId" = ANY($8::text[]))
    OR ("refType" IN ('PURCHASE') AND "refId" = ANY($9::text[]))`,
    ids('production_batches'),
    ids('weaving_issues'),
    ids('weaving_issue_materials'),
    ids('warehouse_transfers'),
    ids('steel_issues'),
    ids('material_issues'),
    ids('packaging_issues'),
    ids('material_yield_issues'),
    ids('purchase_proposals'),
  )) as any[];

  // Thông báo trỏ tới thực thể của mình
  const ENTITY_TABLE: Record<string, string> = {
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
    PIECE_STEP_BUNDLE: 'piece_step_bundles',
    PURCHASE_RECEIPT: 'purchase_receipts',
  };
  const notifIds: string[] = [];
  for (const [et, t] of Object.entries(ENTITY_TABLE)) {
    const tids = ids(t);
    if (!tids.length) continue;
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT id FROM notifications WHERE "entityType" = $1 AND "entityId" = ANY($2::text[])`,
      et,
      tids,
    )) as { id: string }[];
    notifIds.push(...rows.map((r) => r.id));
  }
  // WEAVING_ALLOCATION: entityId = "<poId>:<pieceId>:<pointId>"
  for (const poId of ids('production_orders')) {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT id FROM notifications WHERE "entityType" = 'WEAVING_ALLOCATION' AND "entityId" LIKE $1`,
      `${poId}:%`,
    )) as { id: string }[];
    notifIds.push(...rows.map((r) => r.id));
  }
  // Thông báo không gắn thực thể (QC_PASSED/QC_FAILED...) nhưng mang mã PI của mình trong data
  const piCodes = ids('production_invoices').length
    ? (
        (await prisma.$queryRawUnsafe(
          `SELECT code FROM production_invoices WHERE id = ANY($1::bigint[])`,
          ids('production_invoices'),
        )) as { code: string }[]
      ).map((r) => r.code)
    : [];
  if (piCodes.length) {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT id FROM notifications WHERE "entityId" IS NULL AND data->>'piCode' = ANY($1::text[])`,
      piCodes,
    )) as { id: string }[];
    notifIds.push(...rows.map((r) => r.id));
  }
  const audit = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int n FROM audit_logs WHERE "correlationId" = $1`,
    CORRELATION,
  )) as { n: number }[];
  const slipCodes = ids('issue_slips').length
    ? ((await prisma.$queryRawUnsafe(
        `SELECT code FROM issue_slips WHERE id = ANY($1::bigint[])`,
        ids('issue_slips'),
      )) as { code: string }[])
    : [];

  const nkCodes = ids('purchase_receipts').length
    ? (
        (await prisma.$queryRawUnsafe(
          `SELECT code FROM purchase_receipts WHERE id = ANY($1::bigint[]) AND code IS NOT NULL`,
          ids('purchase_receipts'),
        )) as { code: string }[]
      ).map((r) => r.code)
    : [];
  const supOrders = ids('supplier_orders').length
    ? ((await prisma.$queryRawUnsafe(
        `SELECT "supplierId"::text sid, year, seq FROM supplier_orders WHERE id = ANY($1::bigint[])`,
        ids('supplier_orders'),
      )) as { sid: string; year: number; seq: number }[])
    : [];
  log('Kế hoạch dọn:');
  for (const [t, s] of Object.entries(found)) if (s.size) log(`  ${t}: ${s.size}`);
  for (const d of noIdDeletes) log(`  (không id) ${d.table}.${d.col} theo ${d.ids.length} cha`);
  for (const n of nullify) log(`  SET NULL ${n.table}.${n.col} (${n.ids.length})`);
  log(
    `  stock_ledger: ${ledger.length}, notifications: ${new Set(notifIds).size}, audit_logs: ${audit[0].n}, slip codes: ${slipCodes.map((s) => s.code).join(',')} ${nkCodes.join(',')}, supplier orders: ${j(supOrders)}`,
  );
  if (DRY) return;

  // Thứ tự xoá: con trước cha (Kahn trên đồ thị con giữa các bảng tìm được)
  const tables = Object.keys(found).filter((t) => found[t].size);
  const sub = edges.filter(
    (e) => tables.includes(e.child) && tables.includes(e.parent) && e.child !== e.parent,
  );
  const order: string[] = [];
  const remaining = new Set(tables);
  while (remaining.size) {
    const ready = [...remaining].filter(
      (t) => !sub.some((e) => e.parent === t && remaining.has(e.child)),
    );
    if (!ready.length) throw new Error('Vòng FK: ' + [...remaining].join(','));
    ready.forEach((t) => {
      order.push(t);
      remaining.delete(t);
    });
  }
  const selfEdges = edges.filter((e) => e.child === e.parent && tables.includes(e.child));

  await prisma.$transaction(
    async (tx: any) => {
      // 1. trả tồn
      for (const l of ledger) {
        const leg = l.materialId
          ? {
              col: 'materialId',
              v: l.materialId,
              extra: `AND "stockLengthMm" = ${Number(l.stockLengthMm)} AND spec = $3`,
            }
          : l.segmentSpecId
            ? { col: 'segmentSpecId', v: l.segmentSpecId, extra: '' }
            : l.pieceId
              ? { col: 'pieceId', v: l.pieceId, extra: '' }
              : { col: 'productVariantId', v: l.productVariantId, extra: '' };
        const params = leg.extra
          ? [String(leg.v), String(l.qty), l.spec]
          : [String(leg.v), String(l.qty)];
        const upd = async (wh: string, sign: '-' | '+') => {
          const n = await tx.$executeRawUnsafe(
            `UPDATE stock_quant SET qty = qty ${sign} $2::numeric, "updatedAt" = now() WHERE "warehouseId" = ${BigInt(wh)} AND "${leg.col}" = $1::bigint ${leg.extra}`,
            ...params,
          );
          if (n !== 1)
            throw new Error(`stock_quant không khớp đúng 1 dòng (ledger ${l.id}, kho ${wh}): ${n}`);
        };
        await upd(String(l.toWarehouseId), '-');
        await upd(String(l.fromWarehouseId), '+');
      }
      if (ledger.length)
        await tx.$executeRawUnsafe(
          `DELETE FROM stock_ledger WHERE id = ANY($1::bigint[])`,
          ledger.map((l) => l.id),
        );
      // dòng tồn mảnh/đoạn về đúng 0 sau khi trả = dòng do trigger sinh ra từ bút toán của mình -> bỏ
      const pieceIds = [...new Set(ledger.filter((l) => l.pieceId).map((l) => String(l.pieceId)))];
      const segIds = [
        ...new Set(ledger.filter((l) => l.segmentSpecId).map((l) => String(l.segmentSpecId))),
      ];
      await tx.$executeRawUnsafe(
        `DELETE FROM stock_quant WHERE qty = 0 AND ("pieceId" = ANY($1::bigint[]) OR "segmentSpecId" = ANY($2::bigint[]))`,
        pieceIds,
        segIds,
      );
      // 2. thông báo
      if (notifIds.length) {
        await tx.$executeRawUnsafe(
          `DELETE FROM notification_recipients WHERE "notificationId" = ANY($1::text[])`,
          [...new Set(notifIds)],
        );
        await tx.$executeRawUnsafe(`DELETE FROM notifications WHERE id = ANY($1::text[])`, [
          ...new Set(notifIds),
        ]);
      }
      // 3. gỡ liên kết
      for (const n of nullify)
        await tx.$executeRawUnsafe(
          `UPDATE "${n.table}" SET "${n.col}" = NULL WHERE "${n.col}"::text = ANY($1::text[])`,
          n.ids,
        );
      for (const e of selfEdges)
        await tx.$executeRawUnsafe(
          `UPDATE "${e.child}" SET "${e.childCol}" = NULL WHERE id::text = ANY($1::text[])`,
          ids(e.child),
        );
      for (const d of noIdDeletes)
        await tx.$executeRawUnsafe(
          `DELETE FROM "${d.table}" WHERE "${d.col}"::text = ANY($1::text[])`,
          d.ids,
        );
      // 4. xoá theo thứ tự
      for (const t of order) {
        const n = await tx.$executeRawUnsafe(
          `DELETE FROM "${t}" WHERE id::text = ANY($1::text[])`,
          ids(t),
        );
        log(`  xoá ${t}: ${n}`);
      }
      // 5. nhật ký
      await tx.$executeRawUnsafe(`DELETE FROM audit_logs WHERE "correlationId" = $1`, CORRELATION);
      // 6. số NK đã giữ + bộ đếm số phiếu XK/NK: chỉ lùi nếu phiếu của mình là số cuối cùng của ngày đó
      if (nkCodes.length)
        await tx.$executeRawUnsafe(
          `DELETE FROM reserved_slip_codes WHERE code = ANY($1::text[])`,
          nkCodes,
        );
      for (const so of supOrders) {
        const n = await tx.$executeRawUnsafe(
          `UPDATE supplier_order_counters SET "lastSeq" = "lastSeq" - 1 WHERE "supplierId" = $1::bigint AND year = $2::int AND "lastSeq" = $3::int`,
          so.sid,
          so.year,
          so.seq,
        );
        log(`  bộ đếm đơn NCC ${so.sid}/${so.year}: ${n ? 'lùi 1' : 'giữ nguyên'}`);
      }
      // số lớn trước để 2 phiếu cùng ngày của mình lùi đúng lần lượt
      const parsed = [...slipCodes.map((x) => x.code), ...nkCodes]
        .map((code) => /^(XK|NK)-(\d{6})-(\d+)$/.exec(code))
        .filter((m): m is RegExpExecArray => !!m)
        .sort((a, b) => Number(b[3]) - Number(a[3]));
      for (const m of parsed) {
        const [, kind, day, seq] = m;
        const n = await tx.$executeRawUnsafe(
          `UPDATE warehouse_slip_counters SET "lastSeq" = "lastSeq" - 1 WHERE kind = $1 AND day = $2 AND "lastSeq" = $3::int`,
          kind,
          day,
          Number(seq),
        );
        log(`  bộ đếm ${kind} ${day}: ${n ? 'lùi 1' : 'giữ nguyên (đã có phiếu sau)'}`);
        await tx.$executeRawUnsafe(
          `DELETE FROM warehouse_slip_counters WHERE kind = $1 AND day = $2 AND "lastSeq" = 0`,
          kind,
          day,
        );
      }
    },
    { timeout: 120_000 },
  );
  log('Dọn xong');
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const ctx: Ctx = { app, cls: app.get(ClsService), prisma: app.get(PRISMA_SERVICE) };
  try {
    if (CLEAN || REBUILD) await clean(ctx);
    if (!CLEAN) await build(ctx);
  } finally {
    await sleep(1500); // để việc nền (thông báo/realtime) kịp xong trước khi đóng
    await app.close();
  }
}
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
