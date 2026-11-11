/* eslint-disable @typescript-eslint/no-unsafe-return -- script dựng dữ liệu thử (ngoài ứng dụng), gọi Prisma/service kiểu lỏng */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  AccessoryItemKind,
  BomRevisionStatus,
  MfgStage,
  PlanFormStatus,
  PrismaClient,
  ProcessStep,
} from '../src/generated/prisma/client';

/**
 * Dữ liệu thử "Phần B" (kho/mua hàng) - CHỈ tạo/xoá dòng mang tiền tố PB, không đụng sản phẩm,
 * vật tư, người dùng có sẵn (chỉ THÊM liên kết MaterialSupplier từ NCC PB tới vật tư có sẵn).
 *
 *   Tạo / cập nhật : npx ts-node --transpile-only prisma/seed-test-phan-b.ts
 *   Dọn sạch       : npx ts-node --transpile-only prisma/seed-test-phan-b.ts --clean
 *
 * Tạo: khách "PB Khách thử", NCC "PB NCC Thép" + "PB NCC Sơn", điểm đan "PB-Đ", 2 sản phẩm
 * PB-SP1/PB-SP2 (mỗi cái 1 BomRevision ACTIVE revNo=1 + PlanForm APPROVED làm sourcePlanForm),
 * không có BomOption. Mỗi BOM đủ các đường vật tư:
 *   PB-A "PB mảnh đan"      needsHan+needsSon+isWoven: sắt SAT-001/SAT-002 (PieceBom) + Dây DAY-010,
 *                            Đinh DINH-001, Nút NN-001 (includeInWeaving), chân nhôm CHAN-NHOM-01
 *                            (VTTP, includeInWeaving - recipe có sẵn CHAN-NHOM-01 <- SAT-015).
 *   PB-B "PB mảnh không đan" needsHan+needsSon: sắt SAT-001/SAT-002 + Tán rút TR-001.
 *   PB-C "PB mảnh pat"       chỉ Phôi (needsHan=false, needsSon=false): PieceMaterialYield TAM-LA-01.
 *   ConsumableBom HAN: VTK-001 dây hàn, VTK-002 CO2; SON: VTK-004 sơn bột (CHUNG cho 2 SKU).
 *   BomAccessoryItem PACKAGING: VTK-352 thùng carton.
 * Chạy lại: nếu revision chưa có ProductionOrder nào ghim thì dựng lại toàn bộ dòng BOM cho đúng định
 * nghĩa dưới đây; nếu đã có thì giữ nguyên BOM (chỉ báo).
 */

const CLEAN = process.argv.includes('--clean');
const CUSTOMER_NAME = 'PB Khách thử';
const SUP_STEEL = 'PB NCC Thép';
const SUP_PAINT = 'PB NCC Sơn';
const WEAVING_CODE = 'PB-Đ';
const PLAN_NOTE = 'PB seed-test-phan-b';

type Seg = { mat: string; len: number; qty: number; steps: ProcessStep[] };
interface ProductDef {
  factoryCode: string;
  name: string;
  segA: Seg[];
  segB: Seg[];
}
const { CAT, UON, DAP, DUC_LO } = ProcessStep;
const PRODUCTS: ProductDef[] = [
  {
    factoryCode: 'PB-SP1',
    name: 'PB Ghế thử 1',
    segA: [
      { mat: 'SAT-001', len: 600, qty: 2, steps: [CAT, UON] },
      { mat: 'SAT-002', len: 450, qty: 2, steps: [CAT] },
    ],
    segB: [
      { mat: 'SAT-002', len: 800, qty: 1, steps: [CAT, DAP] },
      { mat: 'SAT-001', len: 400, qty: 2, steps: [CAT] },
    ],
  },
  {
    factoryCode: 'PB-SP2',
    name: 'PB Ghế thử 2',
    segA: [
      { mat: 'SAT-001', len: 650, qty: 2, steps: [CAT, UON] },
      { mat: 'SAT-002', len: 500, qty: 2, steps: [CAT] },
    ],
    segB: [
      { mat: 'SAT-002', len: 900, qty: 1, steps: [CAT, DAP] },
      { mat: 'SAT-001', len: 420, qty: 2, steps: [CAT] },
    ],
  },
];
// Vật tư phẳng của mảnh (PieceMaterialItem)
const PIECE_A_LINES = [
  { mat: 'DAY-010', qty: 1, inWeave: false }, // Dây - luôn đi kèm xuất đan
  { mat: 'DINH-001', qty: 2, inWeave: false }, // Đinh - luôn đi kèm xuất đan
  { mat: 'NN-001', qty: 4, inWeave: true }, // Nút nhựa - tick đi kèm
  { mat: 'CHAN-NHOM-01', qty: 4, inWeave: true }, // VTTP chân nhôm - tick đi kèm (nhu cầu recipe)
];
const PIECE_B_LINES = [{ mat: 'TR-001', qty: 4, inWeave: false }]; // Tán rút
const PAT = { mat: 'TAM-LA-01', piecesPerBar: 100, qtyPerPiece: 2, steps: [CAT, DUC_LO] };
const CONSUMABLES = [
  { stage: MfgStage.HAN, mat: 'VTK-001', qty: 1 },
  { stage: MfgStage.HAN, mat: 'VTK-002', qty: 1 },
  { stage: MfgStage.SON, mat: 'VTK-004', qty: 1 },
];
const PACKAGING = [{ mat: 'VTK-352', qty: 1 }];
const SUPPLIER_MATERIALS: Record<string, { mat: string; price: number }[]> = {
  [SUP_STEEL]: [
    { mat: 'SAT-001', price: 30000 },
    { mat: 'SAT-002', price: 35000 },
    { mat: 'TAM-LA-01', price: 500000 },
    { mat: 'SAT-015', price: 200000 },
    { mat: 'TR-001', price: 200 },
  ],
  [SUP_PAINT]: [
    { mat: 'VTK-004', price: 90000 },
    { mat: 'VTK-352', price: 25000 },
    { mat: 'VTK-001', price: 150000 },
    { mat: 'VTK-002', price: 20000 },
    { mat: 'DAY-010', price: 60000 },
    { mat: 'DINH-001', price: 100 },
    { mat: 'NN-001', price: 300 },
  ],
};

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function mat(tx: Tx, code: string) {
  const m = await tx.material.findUnique({ where: { code }, include: { materialGroup: true } });
  if (!m) throw new Error(`Thiếu vật tư ${code}`);
  if (!m.warehouseId) throw new Error(`Vật tư ${code} chưa có warehouseId`);
  return m;
}

async function seed() {
  const out: Record<string, unknown> = {};
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL "dna.bom_maintenance" = 'on'`);
      const khsx = await tx.user.findFirstOrThrow({ where: { username: 'khsx' } });

      // 1. Khách / NCC / điểm đan
      const customer =
        (await tx.customer.findFirst({ where: { name: CUSTOMER_NAME } })) ??
        (await tx.customer.create({
          data: { name: CUSTOMER_NAME, country: 'VN', note: PLAN_NOTE },
        }));
      out.customer = customer.id;
      const suppliers: Record<string, bigint> = {};
      for (const [name, mats] of Object.entries(SUPPLIER_MATERIALS)) {
        const s =
          (await tx.supplier.findFirst({ where: { name } })) ??
          (await tx.supplier.create({ data: { name, phone: '0900000000' } }));
        await tx.supplier.update({
          where: { id: s.id },
          data: { isActive: true, deletedAt: null },
        });
        suppliers[name] = s.id;
        for (const sm of mats) {
          const m = await mat(tx, sm.mat);
          await tx.materialSupplier.upsert({
            where: { materialId_supplierId: { materialId: m.id, supplierId: s.id } },
            create: { materialId: m.id, supplierId: s.id, price: sm.price, leadTimeDays: 3 },
            update: { price: sm.price },
          });
        }
      }
      out.suppliers = suppliers;
      const wp = await tx.weavingPoint.upsert({
        where: { code: WEAVING_CODE },
        create: { code: WEAVING_CODE, fullName: 'PB Điểm đan thử', isActive: true },
        update: { isActive: true, deletedAt: null },
      });
      out.weavingPoint = wp.id;

      // Recipe chân nhôm: dùng recipe có sẵn nếu có, nếu chưa thì tạo (CHAN-NHOM-01 <- SAT-015).
      const chan = await mat(tx, 'CHAN-NHOM-01');
      const thanhNhom = await mat(tx, 'SAT-015');
      let recipe = await tx.materialYieldRecipe.findUnique({
        where: { outputMaterialId: chan.id },
      });
      if (!recipe) {
        recipe = await tx.materialYieldRecipe.create({
          data: {
            outputMaterialId: chan.id,
            inputMaterialId: thanhNhom.id,
            piecesPerBar: 12,
            processSteps: [CAT],
          },
        });
        out.recipeCreated = true;
      }
      out.recipe = { id: recipe.id, piecesPerBar: recipe.piecesPerBar, isActive: recipe.isActive };

      // 2. Sản phẩm + BOM
      const prods: unknown[] = [];
      for (const def of PRODUCTS) {
        const existing = await tx.mfgProduct.findFirst({
          where: { factoryCode: def.factoryCode },
        });
        const product = existing
          ? await tx.mfgProduct.update({ where: { id: existing.id }, data: { name: def.name } })
          : await tx.mfgProduct.create({
              data: {
                factoryCode: def.factoryCode,
                name: def.name,
                description: PLAN_NOTE,
                boxLengthCm: 95,
                boxWidthCm: 28,
                boxHeightCm: 53.5,
                boxesPerSet: 1,
                boxVolumeM3: 0.1423,
                loadContFormula: 477,
                loadCont: 477,
              },
            });
        const plan =
          (await tx.planForm.findFirst({
            where: { mfgProductId: product.id, note: PLAN_NOTE },
          })) ??
          (await tx.planForm.create({
            data: {
              mfgProductId: product.id,
              status: PlanFormStatus.APPROVED,
              createdById: khsx.id,
              customerName: CUSTOMER_NAME,
              note: PLAN_NOTE,
            },
          }));
        let revision = await tx.bomRevision.findUnique({
          where: { mfgProductId_revNo: { mfgProductId: product.id, revNo: 1 } },
        });
        if (!revision) {
          revision = await tx.bomRevision.create({
            data: {
              mfgProductId: product.id,
              revNo: 1,
              status: BomRevisionStatus.DRAFT,
              sourcePlanFormId: plan.id,
            },
          });
        }
        const pinned = await tx.productionOrder.count({ where: { bomRevisionId: revision.id } });
        const pieceDefs = [
          { code: 'PB-A', name: 'PB mảnh đan', groupNumber: 1, isWoven: true },
          { code: 'PB-B', name: 'PB mảnh không đan', groupNumber: 2, isWoven: false },
          { code: 'PB-C', name: 'PB mảnh pat', groupNumber: 3, isWoven: false },
        ];
        const pieces: Record<string, bigint> = {};
        for (const [i, pd] of pieceDefs.entries()) {
          const p = await tx.piece.upsert({
            where: { mfgProductId_code: { mfgProductId: product.id, code: pd.code } },
            create: {
              mfgProductId: product.id,
              code: pd.code,
              name: pd.name,
              groupNumber: pd.groupNumber,
              pieceNumber: i + 1,
              isWoven: pd.isWoven,
              weavingPrice: pd.isWoven ? 50000 : null,
            },
            update: { name: pd.name, isWoven: pd.isWoven },
          });
          pieces[pd.code] = p.id;
        }

        if (pinned > 0) {
          console.warn(
            `! ${def.factoryCode}: revision ${revision.id} đã có ${pinned} ProductionOrder ghim - giữ nguyên BOM`,
          );
        } else {
          const r = { bomRevisionId: revision.id };
          await tx.bomAccessoryItem.deleteMany({ where: r });
          await tx.consumableBom.deleteMany({ where: r });
          await tx.pieceMaterialYield.deleteMany({ where: r });
          await tx.pieceMaterialItem.deleteMany({ where: r });
          await tx.pieceBom.deleteMany({ where: r });
          await tx.bomPiece.deleteMany({ where: r });

          const base = { bomRevisionId: revision.id, mfgProductId: product.id };
          await tx.bomPiece.createMany({
            data: [
              {
                ...r,
                pieceId: pieces['PB-A'],
                qtyPerUnit: 1,
                needsHan: true,
                needsSon: true,
                isWoven: true,
              },
              {
                ...r,
                pieceId: pieces['PB-B'],
                qtyPerUnit: 2,
                needsHan: true,
                needsSon: true,
                isWoven: false,
              },
              {
                ...r,
                pieceId: pieces['PB-C'],
                qtyPerUnit: 2,
                needsHan: false,
                needsSon: false,
                isWoven: false,
              },
            ],
          });
          for (const [pieceCode, segs] of [
            ['PB-A', def.segA],
            ['PB-B', def.segB],
          ] as const) {
            for (const s of segs) {
              const m = await mat(tx, s.mat);
              const spec = await tx.segmentSpec.upsert({
                where: { materialId_cutLengthMm: { materialId: m.id, cutLengthMm: s.len } },
                create: { materialId: m.id, cutLengthMm: s.len },
                update: {},
              });
              await tx.pieceBom.create({
                data: {
                  ...base,
                  pieceId: pieces[pieceCode],
                  segmentSpecId: spec.id,
                  qtyPerPiece: s.qty,
                  processSteps: s.steps,
                },
              });
            }
          }
          for (const [pieceCode, lines] of [
            ['PB-A', PIECE_A_LINES],
            ['PB-B', PIECE_B_LINES],
          ] as const) {
            for (const l of lines) {
              const m = await mat(tx, l.mat);
              await tx.pieceMaterialItem.create({
                data: {
                  ...base,
                  pieceId: pieces[pieceCode],
                  materialId: m.id,
                  qtyPerPiece: l.qty,
                  includeInWeaving: l.inWeave,
                },
              });
            }
          }
          const la = await mat(tx, PAT.mat);
          await tx.pieceMaterialYield.create({
            data: {
              ...base,
              pieceId: pieces['PB-C'],
              materialId: la.id,
              piecesPerBar: PAT.piecesPerBar,
              qtyPerPiece: PAT.qtyPerPiece,
              processSteps: PAT.steps,
            },
          });
          for (const c of CONSUMABLES) {
            const m = await mat(tx, c.mat);
            await tx.consumableBom.create({
              data: { ...r, stage: c.stage, materialId: m.id, qtyPerUnit: c.qty },
            });
          }
          for (const a of PACKAGING) {
            const m = await mat(tx, a.mat);
            await tx.bomAccessoryItem.create({
              data: {
                ...r,
                materialId: m.id,
                kind: AccessoryItemKind.PACKAGING,
                qtyPerUnit: a.qty,
              },
            });
          }
          // Sản phẩm PB chỉ có đúng 1 revision -> không có ACTIVE nào khác phải RETIRED.
          await tx.bomRevision.update({
            where: { id: revision.id },
            data: { status: BomRevisionStatus.ACTIVE, sourcePlanFormId: plan.id },
          });
        }
        prods.push({
          factoryCode: def.factoryCode,
          productId: product.id,
          revisionId: revision.id,
          planFormId: plan.id,
          pieces,
        });
      }
      out.products = prods;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
  console.log(JSON.stringify(out, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
}

async function clean() {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL "dna.bom_maintenance" = 'on'`);
      const products = await tx.mfgProduct.findMany({
        where: { factoryCode: { in: PRODUCTS.map((p) => p.factoryCode) } },
      });
      const productIds = products.map((p) => p.id);
      const busy = {
        salesOrderItems: await tx.salesOrderItem.count({
          where: { mfgProductId: { in: productIds } },
        }),
        piItems: await tx.productionInvoiceItem.count({
          where: { mfgProductId: { in: productIds } },
        }),
        productionOrders: await tx.productionOrder.count({
          where: { mfgProductId: { in: productIds } },
        }),
      };
      if (Object.values(busy).some((n) => n > 0)) {
        throw new Error(
          `Sản phẩm PB còn dữ liệu nghiệp vụ ${JSON.stringify(busy)} - dọn đơn hàng/PI/lệnh của PB trước rồi chạy lại --clean`,
        );
      }
      const revisions = await tx.bomRevision.findMany({
        where: { mfgProductId: { in: productIds } },
      });
      const revIds = revisions.map((r) => r.id);
      const specIds = (
        await tx.pieceBom.findMany({
          where: { bomRevisionId: { in: revIds } },
          select: { segmentSpecId: true },
        })
      ).map((r) => r.segmentSpecId);
      const r = { bomRevisionId: { in: revIds } };
      await tx.bomAccessoryItem.deleteMany({ where: r });
      await tx.consumableBom.deleteMany({ where: r });
      await tx.pieceMaterialYield.deleteMany({ where: r });
      await tx.pieceMaterialItem.deleteMany({ where: r });
      await tx.pieceBom.deleteMany({ where: r });
      await tx.bomPiece.deleteMany({ where: r });
      await tx.bomOption.deleteMany({ where: r });
      await tx.bomRevision.deleteMany({ where: { id: { in: revIds } } });
      const plans = await tx.planForm.findMany({ where: { mfgProductId: { in: productIds } } });
      const planIds = plans.map((p) => p.id);
      await tx.planFormManhReview.deleteMany({ where: { planFormId: { in: planIds } } });
      await tx.planFormDetailReview.deleteMany({ where: { planFormId: { in: planIds } } });
      await tx.planForm.deleteMany({ where: { id: { in: planIds } } });
      await tx.piece.deleteMany({ where: { mfgProductId: { in: productIds } } });
      await tx.mfgProduct.deleteMany({ where: { id: { in: productIds } } });

      // SegmentSpec (materialId, chiều dài) dùng chung toàn hệ thống - chỉ xoá spec không còn ai dùng.
      let specsDeleted = 0;
      for (const id of [...new Set(specIds.map(String))].map(BigInt)) {
        const [pb, partb, led, q, cps] = await Promise.all([
          tx.pieceBom.count({ where: { segmentSpecId: id } }),
          tx.partBom.count({ where: { segmentSpecId: id } }),
          tx.stockLedger.count({ where: { segmentSpecId: id } }),
          tx.stockQuant.count({ where: { segmentSpecId: id } }),
          tx.cuttingProposalPatternSegment.count({ where: { segmentSpecId: id } }),
        ]);
        if (pb + partb + led + q + cps === 0) {
          await tx.segmentSpec.delete({ where: { id } });
          specsDeleted++;
        }
      }

      const sups = await tx.supplier.findMany({ where: { name: { in: [SUP_STEEL, SUP_PAINT] } } });
      const supIds = sups.map((s) => s.id);
      const supOrders = await tx.supplierOrder.count({ where: { supplierId: { in: supIds } } });
      if (supOrders > 0) throw new Error(`NCC PB còn ${supOrders} đơn đặt hàng - dọn trước`);
      await tx.materialSupplier.deleteMany({ where: { supplierId: { in: supIds } } });
      await tx.supplierOrderCounter.deleteMany({ where: { supplierId: { in: supIds } } });
      await tx.supplier.deleteMany({ where: { id: { in: supIds } } });
      await tx.customer.deleteMany({ where: { name: CUSTOMER_NAME } });
      await tx.weavingPoint.deleteMany({ where: { code: WEAVING_CODE } });
      console.log(
        `✔ Đã dọn: ${products.length} sản phẩm, ${revIds.length} revision, ${planIds.length} plan form, ${specsDeleted} segment spec, ${supIds.length} NCC, khách + điểm đan PB`,
      );
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

(CLEAN ? clean() : seed())
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
