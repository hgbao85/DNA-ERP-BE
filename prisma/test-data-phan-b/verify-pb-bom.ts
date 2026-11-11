/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- script dựng dữ liệu thử (ngoài ứng dụng), gọi Prisma/service kiểu lỏng */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { AppModule } from 'D:/DNA-ERP-BE/src/app.module';
import { SalesOrdersService } from 'D:/DNA-ERP-BE/src/modules/sales-orders/sales-orders.service';
import { CuttingProposalsService } from 'D:/DNA-ERP-BE/src/modules/cutting-proposals/cutting-proposals.service';
import { PRISMA_SERVICE } from 'D:/DNA-ERP-BE/src/prisma/prisma.service';

const j = (x: unknown) => JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FACTORY = process.argv[2] ?? 'PB-SP1';
const ORDER_CODE = `PB-VERIFY-${FACTORY}`;

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const cls = app.get(ClsService);
  const prisma: any = app.get(PRISMA_SERVICE);
  const so = app.get(SalesOrdersService);
  const cp = app.get(CuttingProposalsService);
  const sales = await prisma.user.findFirstOrThrow({ where: { username: 'sales' } });
  const khsx = await prisma.user.findFirstOrThrow({ where: { username: 'khsx' } });
  const customer = await prisma.customer.findFirstOrThrow({ where: { name: 'PB Khách thử' } });
  const product = await prisma.mfgProduct.findFirstOrThrow({ where: { factoryCode: FACTORY } });

  let orderId: string | null = null;
  try {
    await cls.run(async () => {
      cls.set('userId', sales.id);
      const old = await prisma.salesOrder.findUnique({ where: { orderCode: ORDER_CODE } });
      if (old) throw new Error(`${ORDER_CODE} còn sót từ lần trước (id ${old.id})`);
      const deliv = new Date(Date.now() + 30 * 86400_000).toISOString();
      const order = await so.create({
        orderCode: ORDER_CODE,
        customerId: customer.id.toString(),
        orderDate: new Date().toISOString(),
        items: [{ mfgProductId: product.id.toString(), totalQty: 10, deliveryDate: deliv }],
      });
      orderId = order.id;
      const piItem = await prisma.productionInvoiceItem.findFirstOrThrow({
        where: { salesOrderItem: { salesOrderId: BigInt(order.id) } },
      });
      console.log('salesOrder', order.id, 'piItem', piItem.id.toString(), 'qty', piItem.quantity);
      cls.set('userId', khsx.id);
      const proposal = await cp.requestForBatch(
        { productionInvoiceItemIds: [piItem.id.toString()] },
        khsx.id,
      );
      console.log('proposal', proposal.id, 'status', proposal.status);
      const t0 = Date.now();
      let p: any;
      for (;;) {
        p = await prisma.cuttingProposal.findUniqueOrThrow({
          where: { id: BigInt(proposal.id) },
          include: { lines: { include: { material: { select: { code: true } } } } },
        });
        if (p.status !== 'CALCULATING' || Date.now() - t0 > 240_000) break;
        await sleep(2000);
      }
      console.log(
        'RESULT',
        j({
          status: p.status,
          hasInfeasibleLine: p.hasInfeasibleLine,
          hasOverThreshold: p.hasOverThreshold,
          totalBarsAll: p.totalBarsAll,
          wastePct: p.wastePercentage,
          error: p.errorMessage,
          secs: (Date.now() - t0) / 1000,
          lines: p.lines.map((l: any) => ({
            mat: l.material.code,
            feasible: l.feasible,
            stockLen: l.bestStockLengthMm,
            totalBars: l.totalBars,
            buyBars: l.buyBars,
            wastePct: l.wastePercentage,
          })),
        }),
      );
    });
  } finally {
    // Dọn: phương án cắt (mọi lượt gắn PI item của đơn thử) rồi đơn hàng.
    if (orderId) {
      await cls.run(async () => {
        cls.set('userId', sales.id);
        const items = await prisma.productionInvoiceItem.findMany({
          where: { salesOrderItem: { salesOrderId: BigInt(orderId!) } },
          select: { id: true },
        });
        const propIds = (
          await prisma.cuttingProposalItem.findMany({
            where: { productionInvoiceItemId: { in: items.map((i: any) => i.id) } },
            select: { cuttingProposalId: true },
          })
        ).map((r: any) => r.cuttingProposalId);
        // đợi nếu còn CALCULATING để tiến trình nền không ghi đè sau khi xoá
        for (let k = 0; k < 60; k++) {
          const calc = await prisma.cuttingProposal.count({
            where: { id: { in: propIds }, status: 'CALCULATING' },
          });
          if (!calc) break;
          await sleep(3000);
        }
        const lineIds = (
          await prisma.cuttingProposalLine.findMany({
            where: { cuttingProposalId: { in: propIds } },
            select: { id: true },
          })
        ).map((l: any) => l.id);
        const patIds = (
          await prisma.cuttingProposalPattern.findMany({
            where: { lineId: { in: lineIds } },
            select: { id: true },
          })
        ).map((x: any) => x.id);
        await prisma.cuttingProposalPatternSegment.deleteMany({
          where: { patternId: { in: patIds } },
        });
        await prisma.cuttingProposalPattern.deleteMany({ where: { id: { in: patIds } } });
        await prisma.cuttingProposalLine.deleteMany({ where: { id: { in: lineIds } } });
        await prisma.cuttingProposal.deleteMany({ where: { id: { in: propIds } } });
        await so.remove(orderId!);
        console.log('cleaned order', orderId, 'proposals', j(propIds));
      });
    }
    await app.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
