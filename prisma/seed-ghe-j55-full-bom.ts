import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { BomRevisionStatus, PrismaClient, ProcessStep } from '../src/generated/prisma/client';

/**
 * Định mức THẬT đầy đủ của "Ghế J55" (5 mảnh: Khung tựa, Tay trái, Tay phải, Mê ngồi, Hông
 * trước) - người dùng chép trực tiếp từ màn "Danh sách định mức mảnh" bên PRODUCTION (2026-09-22),
 * để tái hiện đúng ca "1 SKU (không gộp) tự nó đã có 7 loại sắt -> vẫn bị timeout" mà bản seed cũ
 * (`seed-real-products.ts`, revNo=1, 4 mảnh giả A/B/C/D) không phản ánh được.
 *
 * revNo=1 hiện có của GHE-J55 GIỮ NGUYÊN (không đụng, không đổi tên piece A/B/C/D - dữ liệu lịch
 * sử của mọi ProductionOrder đã ghim revNo=1 phải bất biến). Script này tạo THÊM revNo=2 với piece
 * code MỚI (không trùng P1-P4 cũ) rồi ACTIVATE - từ nay PO/PI mới cho GHE-J55 dùng bản đầy đủ này.
 *
 * Bỏ qua CÓ CHỦ Ý: Dây/Đinh/Tán rút/Thanh nhôm (nhóm khác Sắt - đi qua PieceMaterialItem, không
 * phải PieceBom/SegmentSpec) - không ảnh hưởng gì tới guard đếm "số loại sắt" của
 * CuttingProposalsService.runSolverAndSave(), ngoài phạm vi test này.
 *
 * Chạy: npx ts-node -r tsconfig-paths/register prisma/seed-ghe-j55-full-bom.ts
 * Chạy lại nhiều lần vô hại (upsert theo khoá duy nhất, trừ bước RETIRED/ACTIVATE ở cuối).
 */

interface Seg {
  code: string;
  name: string;
  cutLengthMm: number;
  qtyPerPiece: number;
  steps: ProcessStep[];
}
interface PieceDef {
  code: string;
  name: string;
  segments: Seg[];
}

const TRON21 = { code: 'SAT-TRON-FI21', name: 'Sắt tròn Ø21' }; // đã có (id=4)
const HOP1020 = { code: 'SAT-HOP-10X20', name: 'Sắt hộp 10×20' }; // đã có (id=6)
const VUONG20 = { code: 'SAT-VUONG-20X20', name: 'Sắt vuông 20×20' }; // đã có (id=8)
const VUONG12 = { code: 'SAT-VUONG-12X12', name: 'Sắt vuông 12×12' }; // đã có (id=7)
const VUONG10 = { code: 'SAT-VUONG-10X10', name: 'Sắt vuông 10×10' }; // MỚI
const PHI4 = { code: 'SAT-PHI-4', name: 'Sắt phi 4' }; // MỚI
const PHI6 = { code: 'SAT-PHI-6', name: 'Sắt phi Ø6' }; // MỚI

const PIECES: PieceDef[] = [
  {
    code: 'KHUNG-TUA',
    name: 'Khung tựa',
    segments: [
      { ...TRON21, cutLengthMm: 500, qtyPerPiece: 1, steps: [ProcessStep.CAT, ProcessStep.UON] },
      { ...TRON21, cutLengthMm: 255, qtyPerPiece: 2, steps: [ProcessStep.CAT] },
      {
        ...HOP1020,
        cutLengthMm: 470,
        qtyPerPiece: 2,
        steps: [ProcessStep.CAT, ProcessStep.UON, ProcessStep.DAP],
      },
      { ...VUONG20, cutLengthMm: 405, qtyPerPiece: 1, steps: [ProcessStep.CAT, ProcessStep.TAN] },
      { ...VUONG12, cutLengthMm: 405, qtyPerPiece: 1, steps: [ProcessStep.CAT, ProcessStep.UON] },
      { ...PHI4, cutLengthMm: 60, qtyPerPiece: 4, steps: [ProcessStep.CAT] },
      { ...PHI6, cutLengthMm: 30, qtyPerPiece: 2, steps: [ProcessStep.CAT] },
    ],
  },
  {
    code: 'TAY-TRAI',
    name: 'Tay trái',
    segments: [
      {
        ...TRON21,
        cutLengthMm: 615,
        qtyPerPiece: 1,
        steps: [ProcessStep.CAT, ProcessStep.TOP_DAU, ProcessStep.UON, ProcessStep.TAN],
      },
      {
        ...TRON21,
        cutLengthMm: 600,
        qtyPerPiece: 1,
        steps: [ProcessStep.CAT, ProcessStep.TAN, ProcessStep.XE],
      },
      { ...VUONG10, cutLengthMm: 510, qtyPerPiece: 1, steps: [ProcessStep.CAT, ProcessStep.UON] },
      { ...VUONG10, cutLengthMm: 500, qtyPerPiece: 1, steps: [ProcessStep.CAT, ProcessStep.UON] },
      { ...VUONG10, cutLengthMm: 441, qtyPerPiece: 1, steps: [ProcessStep.CAT, ProcessStep.UON] },
      { ...HOP1020, cutLengthMm: 445, qtyPerPiece: 1, steps: [ProcessStep.CAT, ProcessStep.TAN] },
      { ...PHI4, cutLengthMm: 185, qtyPerPiece: 1, steps: [ProcessStep.CAT] },
      { ...PHI4, cutLengthMm: 60, qtyPerPiece: 2, steps: [ProcessStep.CAT] },
      { ...HOP1020, cutLengthMm: 20, qtyPerPiece: 1, steps: [ProcessStep.CAT] },
    ],
  },
  {
    code: 'TAY-PHAI',
    name: 'Tay phải',
    segments: [
      {
        ...TRON21,
        cutLengthMm: 615,
        qtyPerPiece: 1,
        steps: [ProcessStep.CAT, ProcessStep.TOP_DAU, ProcessStep.UON, ProcessStep.TAN],
      },
      {
        ...TRON21,
        cutLengthMm: 600,
        qtyPerPiece: 1,
        steps: [ProcessStep.CAT, ProcessStep.TAN, ProcessStep.XE],
      },
      // Nguyên văn màn nguồn chỉ tick "Uốn" cho dòng 510mm (không có "Cắt") - giữ đúng như hiển
      // thị, không tự suy diễn thêm bước.
      { ...VUONG10, cutLengthMm: 510, qtyPerPiece: 1, steps: [ProcessStep.UON] },
      { ...VUONG10, cutLengthMm: 500, qtyPerPiece: 1, steps: [ProcessStep.CAT, ProcessStep.UON] },
      { ...VUONG10, cutLengthMm: 441, qtyPerPiece: 1, steps: [ProcessStep.CAT, ProcessStep.UON] },
      { ...HOP1020, cutLengthMm: 445, qtyPerPiece: 1, steps: [ProcessStep.CAT, ProcessStep.TAN] },
      { ...PHI4, cutLengthMm: 185, qtyPerPiece: 1, steps: [ProcessStep.CAT] },
      { ...PHI4, cutLengthMm: 60, qtyPerPiece: 2, steps: [ProcessStep.CAT] },
      { ...HOP1020, cutLengthMm: 20, qtyPerPiece: 1, steps: [ProcessStep.CAT] },
    ],
  },
  {
    code: 'ME-NGOI',
    name: 'Mê ngồi',
    segments: [
      { ...VUONG20, cutLengthMm: 460, qtyPerPiece: 1, steps: [ProcessStep.CAT, ProcessStep.TAN] },
      { ...HOP1020, cutLengthMm: 430, qtyPerPiece: 2, steps: [ProcessStep.CAT, ProcessStep.DAP] },
      { ...HOP1020, cutLengthMm: 425, qtyPerPiece: 1, steps: [ProcessStep.CAT, ProcessStep.DAP] },
      { ...PHI6, cutLengthMm: 60, qtyPerPiece: 4, steps: [ProcessStep.CAT] },
    ],
  },
  {
    code: 'HONG-TRUOC',
    name: 'Hông trước',
    segments: [
      { ...HOP1020, cutLengthMm: 460, qtyPerPiece: 1, steps: [ProcessStep.CAT, ProcessStep.DAP] },
      { ...HOP1020, cutLengthMm: 190, qtyPerPiece: 2, steps: [ProcessStep.CAT, ProcessStep.DAP] },
      { ...VUONG12, cutLengthMm: 441, qtyPerPiece: 1, steps: [ProcessStep.CAT, ProcessStep.UON] },
      { ...PHI4, cutLengthMm: 60, qtyPerPiece: 2, steps: [ProcessStep.CAT] },
    ],
  },
];

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
      const product = await prisma.mfgProduct.findUniqueOrThrow({
        where: { factoryCode: 'GHE-J55' },
      });

      // ── 1. 3 vật tư sắt MỚI (10×10 vuông, phi 4, phi Ø6) - 4 loại còn lại tái dùng sẵn có ──
      const materialIdByCode = new Map<string, bigint>();
      for (const def of [TRON21, HOP1020, VUONG20, VUONG12, VUONG10, PHI4, PHI6]) {
        const m = await prisma.material.upsert({
          where: { code: def.code },
          create: {
            code: def.code,
            name: def.name,
            unit: 'cây',
            materialGroupId: steelGroup.id,
            warehouseId: steelWarehouse.id,
          },
          update: {},
        });
        materialIdByCode.set(def.code, m.id);
      }
      console.log(`✔ 7 vật tư sắt sẵn sàng (3 mới: VUONG-10X10, PHI-4, PHI-6)`);

      // ── 2. Revision MỚI (revNo=2) - KHÔNG đụng revNo=1 (piece A/B/C/D lịch sử giữ nguyên) ──
      const revision = await prisma.bomRevision.upsert({
        where: { mfgProductId_revNo: { mfgProductId: product.id, revNo: 2 } },
        create: { mfgProductId: product.id, revNo: 2, status: BomRevisionStatus.DRAFT },
        update: { status: BomRevisionStatus.DRAFT },
      });

      const segmentSpecId = new Map<string, bigint>();
      async function resolveSpec(materialCode: string, lengthMm: number): Promise<bigint> {
        const materialId = materialIdByCode.get(materialCode)!;
        const key = `${materialId}:${lengthMm}`;
        const cached = segmentSpecId.get(key);
        if (cached) return cached;
        const spec = await prisma.segmentSpec.upsert({
          where: { materialId_cutLengthMm: { materialId, cutLengthMm: lengthMm } },
          create: { materialId, cutLengthMm: lengthMm },
          update: {},
        });
        segmentSpecId.set(key, spec.id);
        return spec.id;
      }

      let cutCount = 0;
      for (const [pi, pc] of PIECES.entries()) {
        const piece = await prisma.piece.upsert({
          where: { mfgProductId_code: { mfgProductId: product.id, code: pc.code } },
          create: {
            mfgProductId: product.id,
            code: pc.code,
            groupNumber: 1,
            pieceNumber: pi + 5, // tiếp theo P1-P4 cũ, tránh đụng số
            name: pc.name,
          },
          update: { name: pc.name },
        });

        await prisma.bomPiece.upsert({
          where: { bomRevisionId_pieceId: { bomRevisionId: revision.id, pieceId: piece.id } },
          create: {
            bomRevisionId: revision.id,
            pieceId: piece.id,
            qtyPerUnit: 3, // "×3/SKU" đúng như màn nguồn
            isWoven: true, // màn nguồn hiện "✓ Có đan" cho cả 5 mảnh
            needsHan: true,
            needsSon: true,
          },
          update: { qtyPerUnit: 3, isWoven: true, needsHan: true, needsSon: true },
        });

        for (const s of pc.segments) {
          const specId = await resolveSpec(s.code, s.cutLengthMm);
          await prisma.pieceBom.upsert({
            where: {
              bomRevisionId_pieceId_segmentSpecId: {
                bomRevisionId: revision.id,
                pieceId: piece.id,
                segmentSpecId: specId,
              },
            },
            create: {
              bomRevisionId: revision.id,
              mfgProductId: product.id,
              pieceId: piece.id,
              segmentSpecId: specId,
              qtyPerPiece: s.qtyPerPiece,
              processSteps: s.steps,
            },
            update: { qtyPerPiece: s.qtyPerPiece, processSteps: s.steps },
          });
          cutCount++;
        }
      }

      // ── 3. Activate rev2, retire rev1 (mirror BomRevisionsService.activateInTransaction) ──
      await prisma.bomRevision.updateMany({
        where: { mfgProductId: product.id, status: BomRevisionStatus.ACTIVE },
        data: { status: BomRevisionStatus.RETIRED },
      });
      await prisma.bomRevision.update({
        where: { id: revision.id },
        data: { status: BomRevisionStatus.ACTIVE },
      });

      console.log(
        `✔ GHE-J55 revNo=2 (id=${revision.id}) ACTIVE - ${PIECES.length} mảnh · ${cutCount} dòng cỡ đoạn · 7 loại sắt`,
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
