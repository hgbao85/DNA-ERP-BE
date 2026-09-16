import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  BomRevisionStatus,
  PlanFormStatus,
  PrismaClient,
  ProcessStep,
} from '../src/generated/prisma/client';

/**
 * Định mức demo THẬT cho bộ bàn ghế sắt ngoài trời — chạy:
 *   npx ts-node -r tsconfig-paths/register prisma/seed-cutting-fixture.ts
 *
 * VÌ SAO CẦN: DB demo không có định mức sắt nào chạy được (`E2E-BAN-01` có revision ACTIVE khai 3
 * mảnh nhưng 0 dòng `PieceBom`, tức chưa mảnh nào được gắn cỡ đoạn), nên solver luôn dừng ở
 * `buildBomRows` với "BomRevision ... không có dòng định mức mảnh nào" — không thử được bất kỳ
 * nhánh nào của luồng cắt/gộp/ngưỡng đặc cách bằng dữ liệu thật.
 *
 * ---------------------------------------------------------------------------------------------
 * NGUỒN SỐ LIỆU
 * ---------------------------------------------------------------------------------------------
 * `BAN-J55` chép NGUYÊN VĂN định mức Bàn J55 trong `docs/PHAN_TICH_HE_THONG_CatSat.md` (mục
 * II.3.1, phía FE) — bảng định mức thật kèm kết quả solver đã được kiểm chứng bằng tay trong cùng
 * tài liệu. Đây là **chuẩn vàng**: chạy 500 bộ phải ra lại đúng các số dưới đây.
 *
 *   | Loại sắt        | Cỡ đoạn (mm)        | Nhu cầu/500 bộ         | Kết quả tài liệu        |
 *   |-----------------|---------------------|------------------------|-------------------------|
 *   | sắt hộp 25×50   | 930 / 765 / 695/200 | 1000/1000/1000/2000    | 6000mm · 467 cây · 0.18%|
 *   | sắt vuông 50×50 | 660                 | 2000                   | 6000mm · 223 cây · 0.85%|
 *   | sắt vuông 20×20 | 840                 | 500                    | vét cạn 6740mm · 63 cây · 0.18% |
 *
 * LƯU Ý cấu hình: tài liệu chạy với chiều dài chuẩn {5850, 6000} và dải vét cạn 5000→**7000**.
 * `SystemConfig` hiện tại là {6000} và dải 5000→**6000**, nên loại 20×20 KHÔNG thể ra 6740mm —
 * cây chuẩn 6000 cho 1.88% (> ngưỡng 1%) và vét cạn bị chặn trần ở 6000. Đó là ca thật để thử
 * "ngưỡng đặc cách" (hoặc nới `solverMaxLengthMm` lên 7000 để tái lập đúng số tài liệu).
 *
 * 3 sản phẩm còn lại là bộ cùng họ dùng CHUNG 3 loại sắt đó (gộp đợt cắt chỉ có nghĩa khi các SKU
 * cắt chung một loại sắt). Kích thước đặt theo chuẩn nội thất thông dụng:
 *   - Bàn ăn cao 700-800mm → J55: chân 660 + khung 25×50 + mặt ≈ 720mm.
 *   - Ghế ăn: cao ghế 450-480mm (J55: chân 430 + khung 25 ≈ 455), sâu ngồi 400-450mm, lưng tựa
 *     cao 410-510mm trên mặt ngồi.
 *   - Chênh lệch mặt bàn ↔ mặt ghế 280-320mm (720 − 455 = 265-290mm tuỳ độ dày mặt).
 * Nguồn kích thước: hướng dẫn kích thước ghế ăn tiêu chuẩn (popmaison, picketandrail, yezhifurniture).
 *
 * Chạy lại nhiều lần vô hại (upsert theo khoá duy nhất).
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/** Nhóm "Sắt" (systemKey STEEL_BAR) và Kho Phôi Sơn Hàn - giống hệt vật tư sắt đã có sẵn. */
const STEEL_GROUP_ID = 1n;
const STEEL_WAREHOUSE_ID = 3n;
/** Tài khoản KHSX (demo) đứng tên phiếu định mức - PlanForm.createdById bắt buộc. */
const KHSX_USER_ID = 'e2889ce0-e9fb-4963-ac19-e53c293a68b7';

const STEELS = [
  { code: 'SAT-VUONG-50X50', name: 'Sắt vuông 50×50' },
  { code: 'SAT-HOP-25X50', name: 'Sắt hộp 25×50' },
  { code: 'SAT-VUONG-20X20', name: 'Sắt vuông 20×20' },
];

/** 1 dòng = 1 mảnh; `cuts` = các đoạn sắt mảnh đó cần (1 mảnh có thể dùng NHIỀU loại sắt). */
interface PieceDef {
  code: string;
  name: string;
  /** SL mảnh / 1 bộ sản phẩm (BomPiece.qtyPerUnit). */
  qtyPerUnit: number;
  needsHan?: boolean;
  needsSon?: boolean;
  cuts: { steel: string; cutLengthMm: number; qtyPerPiece: number }[];
}

const PRODUCTS: { code: string; name: string; pieces: PieceDef[] }[] = [
  {
    code: 'BAN-J55',
    name: 'Bàn ăn J55 (mặt ~980×815, cao ~720mm)',
    pieces: [
      {
        code: 'P1',
        name: 'Chân bàn',
        qtyPerUnit: 4,
        needsHan: true,
        needsSon: true,
        cuts: [
          { steel: 'SAT-VUONG-50X50', cutLengthMm: 660, qtyPerPiece: 1 },
          { steel: 'SAT-HOP-25X50', cutLengthMm: 200, qtyPerPiece: 1 },
        ],
      },
      {
        code: 'P2',
        name: 'Đoạn dài',
        qtyPerUnit: 2,
        needsHan: true,
        needsSon: true,
        cuts: [{ steel: 'SAT-HOP-25X50', cutLengthMm: 930, qtyPerPiece: 1 }],
      },
      {
        code: 'P3',
        name: 'Đoạn ngắn',
        qtyPerUnit: 2,
        needsHan: true,
        needsSon: true,
        cuts: [{ steel: 'SAT-HOP-25X50', cutLengthMm: 765, qtyPerPiece: 1 }],
      },
      {
        code: 'P4',
        name: 'Giằng bàn',
        qtyPerUnit: 1,
        needsHan: true,
        cuts: [{ steel: 'SAT-VUONG-20X20', cutLengthMm: 840, qtyPerPiece: 1 }],
      },
      {
        code: 'P5',
        name: 'Viền bàn',
        qtyPerUnit: 2,
        needsHan: true,
        needsSon: true,
        cuts: [{ steel: 'SAT-HOP-25X50', cutLengthMm: 695, qtyPerPiece: 1 }],
      },
    ],
  },
  {
    code: 'GHE-J55',
    name: 'Ghế ăn J55 (ngồi 450×420, cao ngồi ~455mm)',
    pieces: [
      {
        code: 'P1',
        name: 'Chân ghế',
        qtyPerUnit: 4,
        needsHan: true,
        needsSon: true,
        cuts: [{ steel: 'SAT-VUONG-50X50', cutLengthMm: 430, qtyPerPiece: 1 }],
      },
      {
        code: 'P2',
        name: 'Khung ngồi dọc',
        qtyPerUnit: 2,
        needsHan: true,
        needsSon: true,
        cuts: [{ steel: 'SAT-HOP-25X50', cutLengthMm: 450, qtyPerPiece: 1 }],
      },
      {
        code: 'P3',
        name: 'Khung ngồi ngang',
        qtyPerUnit: 2,
        needsHan: true,
        needsSon: true,
        cuts: [{ steel: 'SAT-HOP-25X50', cutLengthMm: 420, qtyPerPiece: 1 }],
      },
      {
        code: 'P4',
        name: 'Trụ tựa lưng',
        qtyPerUnit: 2,
        needsHan: true,
        needsSon: true,
        cuts: [{ steel: 'SAT-VUONG-20X20', cutLengthMm: 450, qtyPerPiece: 1 }],
      },
      {
        code: 'P5',
        name: 'Ngang tựa lưng',
        qtyPerUnit: 2,
        needsHan: true,
        cuts: [{ steel: 'SAT-VUONG-20X20', cutLengthMm: 420, qtyPerPiece: 1 }],
      },
    ],
  },
  {
    code: 'GHE-TY-J55',
    name: 'Ghế tình yêu J55 (băng 2 chỗ, rộng 1200mm)',
    pieces: [
      {
        code: 'P1',
        name: 'Chân ghế',
        qtyPerUnit: 4,
        needsHan: true,
        needsSon: true,
        cuts: [{ steel: 'SAT-VUONG-50X50', cutLengthMm: 430, qtyPerPiece: 1 }],
      },
      {
        code: 'P2',
        name: 'Khung ngồi dài',
        qtyPerUnit: 2,
        needsHan: true,
        needsSon: true,
        cuts: [{ steel: 'SAT-HOP-25X50', cutLengthMm: 1200, qtyPerPiece: 1 }],
      },
      {
        code: 'P3',
        name: 'Khung ngồi ngang',
        qtyPerUnit: 2,
        needsHan: true,
        needsSon: true,
        cuts: [{ steel: 'SAT-HOP-25X50', cutLengthMm: 450, qtyPerPiece: 1 }],
      },
      {
        code: 'P4',
        name: 'Trụ tựa lưng',
        qtyPerUnit: 2,
        needsHan: true,
        needsSon: true,
        cuts: [{ steel: 'SAT-VUONG-20X20', cutLengthMm: 450, qtyPerPiece: 1 }],
      },
      {
        code: 'P5',
        name: 'Ngang tựa lưng',
        qtyPerUnit: 1,
        needsHan: true,
        cuts: [{ steel: 'SAT-VUONG-20X20', cutLengthMm: 1160, qtyPerPiece: 1 }],
      },
    ],
  },
  {
    code: 'BAN-TRA-J55',
    name: 'Bàn trà J55 (mặt ~900×500, cao ~450mm)',
    pieces: [
      {
        code: 'P1',
        name: 'Chân bàn trà',
        qtyPerUnit: 4,
        needsHan: true,
        needsSon: true,
        cuts: [{ steel: 'SAT-VUONG-50X50', cutLengthMm: 390, qtyPerPiece: 1 }],
      },
      {
        code: 'P2',
        name: 'Viền dài',
        qtyPerUnit: 2,
        needsHan: true,
        needsSon: true,
        cuts: [{ steel: 'SAT-HOP-25X50', cutLengthMm: 900, qtyPerPiece: 1 }],
      },
      {
        code: 'P3',
        name: 'Viền ngắn',
        qtyPerUnit: 2,
        needsHan: true,
        needsSon: true,
        cuts: [{ steel: 'SAT-HOP-25X50', cutLengthMm: 500, qtyPerPiece: 1 }],
      },
      {
        code: 'P4',
        name: 'Giằng bàn trà',
        qtyPerUnit: 1,
        needsHan: true,
        cuts: [{ steel: 'SAT-VUONG-20X20', cutLengthMm: 860, qtyPerPiece: 1 }],
      },
    ],
  },
];

/** Bộ SKU tổng hợp tạm ở lần chạy trước - dọn đi để danh sách SKU chỉ còn định mức thật. */
const OBSOLETE_PRODUCT_CODES = ['CUT-A-1495', 'CUT-B-1990', 'CUT-C-2500', 'CUT-D-0985'];

async function dropObsoleteFixtures() {
  const stale = await prisma.mfgProduct.findMany({
    where: { factoryCode: { in: OBSOLETE_PRODUCT_CODES } },
    select: { id: true, factoryCode: true },
  });
  for (const p of stale) {
    const used = await prisma.productionInvoiceItem.count({ where: { mfgProductId: p.id } });
    if (used > 0) {
      console.log(`· bỏ qua dọn ${p.factoryCode}: đã có ${used} SKU trong lệnh sản xuất`);
      continue;
    }
    const revs = await prisma.bomRevision.findMany({
      where: { mfgProductId: p.id },
      select: { id: true },
    });
    const revIds = revs.map((r) => r.id);
    await prisma.pieceBom.deleteMany({ where: { bomRevisionId: { in: revIds } } });
    await prisma.bomPiece.deleteMany({ where: { bomRevisionId: { in: revIds } } });
    await prisma.bomRevision.deleteMany({ where: { id: { in: revIds } } });
    await prisma.piece.deleteMany({ where: { mfgProductId: p.id } });
    await prisma.mfgProduct.delete({ where: { id: p.id } });
    console.log(`· đã dọn SKU tổng hợp tạm ${p.factoryCode}`);
  }
}

async function main() {
  await dropObsoleteFixtures();

  const steelIdByCode = new Map<string, bigint>();
  for (const s of STEELS) {
    const m = await prisma.material.upsert({
      where: { code: s.code },
      create: {
        code: s.code,
        name: s.name,
        unit: 'cây',
        materialGroupId: STEEL_GROUP_ID,
        warehouseId: STEEL_WAREHOUSE_ID,
      },
      update: { name: s.name },
    });
    steelIdByCode.set(s.code, m.id);
  }

  for (const prod of PRODUCTS) {
    const product = await prisma.mfgProduct.upsert({
      where: { factoryCode: prod.code },
      create: { factoryCode: prod.code, name: prod.name },
      update: { name: prod.name },
    });

    const revision = await prisma.bomRevision.upsert({
      where: { mfgProductId_revNo: { mfgProductId: product.id, revNo: 1 } },
      create: { mfgProductId: product.id, revNo: 1, status: BomRevisionStatus.ACTIVE },
      update: { status: BomRevisionStatus.ACTIVE },
    });

    for (const [i, pc] of prod.pieces.entries()) {
      const piece = await prisma.piece.upsert({
        where: { mfgProductId_code: { mfgProductId: product.id, code: pc.code } },
        create: {
          mfgProductId: product.id,
          code: pc.code,
          groupNumber: 1,
          pieceNumber: i + 1,
          name: pc.name,
        },
        update: { name: pc.name },
      });

      await prisma.bomPiece.upsert({
        where: { bomRevisionId_pieceId: { bomRevisionId: revision.id, pieceId: piece.id } },
        create: {
          bomRevisionId: revision.id,
          pieceId: piece.id,
          qtyPerUnit: pc.qtyPerUnit,
          needsHan: pc.needsHan ?? false,
          needsSon: pc.needsSon ?? false,
        },
        update: {
          qtyPerUnit: pc.qtyPerUnit,
          needsHan: pc.needsHan ?? false,
          needsSon: pc.needsSon ?? false,
        },
      });

      for (const cut of pc.cuts) {
        const materialId = steelIdByCode.get(cut.steel)!;
        const spec = await prisma.segmentSpec.upsert({
          where: { materialId_cutLengthMm: { materialId, cutLengthMm: cut.cutLengthMm } },
          create: { materialId, cutLengthMm: cut.cutLengthMm },
          update: {},
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
            qtyPerPiece: cut.qtyPerPiece,
            processSteps: [ProcessStep.CAT],
          },
          update: { qtyPerPiece: cut.qtyPerPiece },
        });
      }
    }

    // Sales chỉ chọn được SKU có PlanForm (phiếu định mức) đã APPROVED - không phải đọc thẳng
    // mfg_products (xem OrderManagementPage.tsx "SKU đã duyệt"). Không có dòng này thì 4 SKU trên
    // dựng xong vẫn không đặt hàng được.
    const planned = await prisma.planForm.findFirst({
      where: { mfgProductId: product.id, salesOrderId: null },
      select: { id: true },
    });
    if (!planned) {
      await prisma.planForm.create({
        data: {
          mfgProductId: product.id,
          status: PlanFormStatus.APPROVED,
          createdById: KHSX_USER_ID,
          note: prod.code,
        },
      });
    }

    const cutCount = prod.pieces.reduce((n, p) => n + p.cuts.length, 0);
    console.log(
      `✔ ${prod.code.padEnd(12)} product=${product.id} revision=${revision.id}  ${prod.pieces.length} mảnh · ${cutCount} dòng cỡ đoạn`,
    );
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
