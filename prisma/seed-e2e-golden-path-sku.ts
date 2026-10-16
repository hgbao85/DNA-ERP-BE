import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  BomRevisionStatus,
  PlanFormStatus,
  PrismaClient,
  ProcessStep,
} from '../src/generated/prisma/client';

/**
 * Tái tạo fixture SKU "test" mà e2e/golden-path.spec.ts (FE) cần - đã bị xoá trong đợt dọn DB dev
 * 2026-09-24/25 ("xoá 27 SKU thử"). 1 sản phẩm tối giản, đủ để đi hết golden path thật qua browser:
 * PO -> duyệt SKU -> PI -> đề xuất cắt sắt -> mua hàng -> Nhập kho.
 *
 * factoryCode PHẢI bắt đầu bằng "test" (chữ thường) - FE picker SKU (OrderManagementPage.tsx)
 * render `<strong>{code}</strong> — {name}`, test click `getByRole('button', { name: /^test/ })`
 * (regex không có flag 'i', phân biệt hoa/thường).
 *
 * Material "SAT-TEST-E2E" set buyerId = user "nhan" (2026-10-16: golden-path.spec.ts dùng tài
 * khoản "nhan" cho bước "Mua hàng xác nhận Sếp đã duyệt" - PurchaseProposal route theo
 * Material.buyerId, xem src/utils/purchasingRouting.ts). warehouseId = kho "phoi-son-han" để
 * khopsh (warehouseScope phoi-son-han) nhận hàng được.
 *
 * Chạy: npx ts-node -r tsconfig-paths/register prisma/seed-e2e-golden-path-sku.ts
 * Chạy lại nhiều lần vô hại (upsert theo khoá duy nhất).
 */

const FACTORY_CODE = 'test';
const PRODUCT_NAME = 'test — Ghế E2E tối giản';
const MATERIAL_CODE = 'SAT-TEST-E2E';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const rawPrisma = new PrismaClient({ adapter });

async function main() {
  await rawPrisma.$transaction(
    async (prisma) => {
      await prisma.$executeRawUnsafe(`SET LOCAL "dna.bom_maintenance" = 'on'`);

      const steelGroup = await prisma.materialGroup.findFirstOrThrow({
        where: { systemKey: 'STEEL_BAR' },
      });
      const steelWarehouse = await prisma.warehouse.findFirstOrThrow({
        where: { code: 'phoi-son-han' },
      });
      const khsxUser = await prisma.user.findFirstOrThrow({ where: { username: 'khsx' } });
      const nhanUser = await prisma.user.findFirstOrThrow({ where: { username: 'nhan' } });

      const material = await prisma.material.upsert({
        where: { code: MATERIAL_CODE },
        create: {
          code: MATERIAL_CODE,
          name: 'Sắt tròn test E2E Ø21',
          unit: 'cây',
          materialGroupId: steelGroup.id,
          warehouseId: steelWarehouse.id,
          buyerId: nhanUser.id,
        },
        update: { warehouseId: steelWarehouse.id, buyerId: nhanUser.id },
      });

      const spec = await prisma.segmentSpec.upsert({
        where: { materialId_cutLengthMm: { materialId: material.id, cutLengthMm: 500 } },
        create: { materialId: material.id, cutLengthMm: 500 },
        update: {},
      });

      // MfgProduct.factoryCode KHÔNG còn unique (2026-09-25, xem prisma schema) - không thể
      // upsert({where:{factoryCode}}) nữa, tự find-or-create.
      const existingProduct = await prisma.mfgProduct.findFirst({
        where: { factoryCode: FACTORY_CODE },
      });
      const product = existingProduct
        ? await prisma.mfgProduct.update({
            where: { id: existingProduct.id },
            data: { name: PRODUCT_NAME },
          })
        : await prisma.mfgProduct.create({
            data: { factoryCode: FACTORY_CODE, name: PRODUCT_NAME },
          });

      const revision = await prisma.bomRevision.upsert({
        where: { mfgProductId_revNo: { mfgProductId: product.id, revNo: 1 } },
        create: { mfgProductId: product.id, revNo: 1, status: BomRevisionStatus.DRAFT },
        update: { status: BomRevisionStatus.DRAFT },
      });

      const piece = await prisma.piece.upsert({
        where: { mfgProductId_code: { mfgProductId: product.id, code: 'P1' } },
        create: {
          mfgProductId: product.id,
          code: 'P1',
          groupNumber: 1,
          pieceNumber: 1,
          name: 'Khung test',
        },
        update: {},
      });

      await prisma.bomPiece.upsert({
        where: { bomRevisionId_pieceId: { bomRevisionId: revision.id, pieceId: piece.id } },
        create: {
          bomRevisionId: revision.id,
          pieceId: piece.id,
          qtyPerUnit: 1,
          needsHan: true,
          needsSon: true,
        },
        update: { qtyPerUnit: 1, needsHan: true, needsSon: true },
      });

      await prisma.pieceBom.upsert({
        where: {
          bomRevisionId_pieceId_segmentSpecId: {
            bomRevisionId: revision.id,
            pieceId: piece.id,
            segmentSpecId: spec.id,
          },
        },
        create: {
          bomRevisionId: revision.id,
          mfgProductId: product.id,
          pieceId: piece.id,
          segmentSpecId: spec.id,
          qtyPerPiece: 1,
          processSteps: [ProcessStep.CAT],
        },
        update: { qtyPerPiece: 1 },
      });

      await prisma.bomRevision.update({
        where: { id: revision.id },
        data: { status: BomRevisionStatus.ACTIVE },
      });

      const existingPlan = await prisma.planForm.findFirst({
        where: { mfgProductId: product.id, salesOrderId: null },
        select: { id: true },
      });
      if (!existingPlan) {
        await prisma.planForm.create({
          data: {
            mfgProductId: product.id,
            status: PlanFormStatus.APPROVED,
            createdById: khsxUser.id,
            note: 'Fixture e2e/golden-path.spec.ts - tái tạo 2026-10-16 (bản gốc bị xoá lúc dọn DB dev)',
          },
        });
      }

      console.log(
        `✔ SKU "${FACTORY_CODE}" product=${product.id} revision=${revision.id} material=${material.id}(buyerId=${material.buyerId})`,
      );
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

main()
  .then(() => rawPrisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await rawPrisma.$disconnect();
    process.exit(1);
  });
