import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  BomRevisionStatus,
  PlanFormStatus,
  PrismaClient,
  ProcessStep,
} from '../src/generated/prisma/client';
import dinhMucData from './real-data/dinh-muc-j55-gtu.json';

/**
 * Định mức THẬT lấy nguyên văn từ file người dùng cung cấp:
 *   OneDrive/Tài liệu/Đông Nam Á/Mã nhà máy/định mức mảnh bàn ghế J55, ghế tình yêu.xlsx
 * (đã copy nội dung đã parse sẵn vào prisma/real-data/dinh-muc-j55-gtu.json - xem
 * scratchpad/parse_dinhmuc.py phiên làm việc 2026-09-21 để biết cách trích xuất).
 *
 * 4 sản phẩm thật: Bàn J55, Ghế J55, Ghế tình yêu, Bàn 8 Meiying J55 - dùng để test toàn bộ
 * workflow ERP với dữ liệu thật (thay vì fixture tự bịa như seed-cutting-fixture.ts trước đây).
 *
 * LƯU Ý DỮ LIỆU GỐC (đã soát, xem doc comment classifyMaterial trong parse_dinhmuc.py):
 * - 4 dòng ở "Ghế J55" mảnh A/B ghi TÊN "sắt hộp" nhưng quy cách lại "Ø21..." (ký hiệu đường
 *   kính) - đây là lỗi gõ ở file gốc, đã tin theo SỐ (Ø = tròn) thay vì TÊN khi tạo dữ liệu này.
 * - "pát 1-4", "chốt", "ô tròn lỗ dù" là phụ kiện rời (không phải cây sắt cắt theo chiều dài) -
 *   CHƯA seed ở đợt này (ngoài phạm vi PieceBom/SegmentSpec - thuộc nhóm Tán rút/Đinh, đi qua
 *   PieceMaterialItem theo mô hình hiện tại) - xem "CHƯA làm" ở changelog.
 * - "sắt hộp 10x10"/"sắt hộp 20x20" (2 cạnh bằng nhau) giữ NGUYÊN nhãn "hộp" như file gốc dù
 *   trực giác có thể gọi là "vuông" - không tự sửa vì không chắc quy ước xưởng dùng thế nào.
 *
 * Chạy: npx ts-node -r tsconfig-paths/register prisma/seed-real-products.ts
 * Chạy lại nhiều lần vô hại (upsert theo khoá duy nhất).
 */

interface Segment {
  material_name: string;
  material_class: 'VUONG' | 'HOP' | 'TRON' | 'OTHER';
  raw_spec: string;
  cross_section: string | null;
  thickness_mm: number | null;
  length_mm: number | null;
  qty_per_piece: number;
}
interface PieceDef {
  name: string;
  qty_per_unit: number;
  segments: Segment[];
}
interface ProductDef {
  title: string;
  pieces: PieceDef[];
}

const PRODUCTS = dinhMucData as ProductDef[];

/** Mã sản phẩm + tên hiển thị ngắn gọn, theo đúng thứ tự PRODUCTS trong JSON. */
const PRODUCT_META: { factoryCode: string; name: string }[] = [
  { factoryCode: 'BAN-J55', name: 'Bàn J55 (900×735×1420)' },
  { factoryCode: 'GHE-J55', name: 'Ghế J55 (500×875×445)' },
  { factoryCode: 'GHE-TINH-YEU', name: 'Ghế tình yêu (860×510×1225)' },
  { factoryCode: 'BAN-8-MEIYING-J55', name: 'Bàn 8 Meiying J55' },
];

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const rawPrisma = new PrismaClient({ adapter });

function materialCode(cls: 'VUONG' | 'HOP' | 'TRON', crossSection: string): string {
  if (cls === 'TRON') return `SAT-TRON-${crossSection}`;
  const kind = cls === 'VUONG' ? 'VUONG' : 'HOP';
  return `SAT-${kind}-${crossSection}`;
}
function materialName(cls: 'VUONG' | 'HOP' | 'TRON', crossSection: string): string {
  const kindLabel = cls === 'VUONG' ? 'vuông' : cls === 'HOP' ? 'hộp' : 'tròn';
  const dim = crossSection.startsWith('FI')
    ? `Ø${crossSection.slice(2)}`
    : crossSection.replace('X', '×');
  return `Sắt ${kindLabel} ${dim}`;
}

async function main() {
  await rawPrisma.$transaction(
    async (prisma) => {
      // Escape hatch cho toàn bộ thao tác dưới đây - upsert lại piece_bom/bom_piece của các
      // revision ACTIVE khi chạy lại script (chạy lại vô hại) sẽ bị trigger
      // assert_bom_revision_draft() (migration 20260921030000) chặn nếu không bật cờ này. Đây
      // đúng là ca "seed/khôi phục dữ liệu" mà escape hatch sinh ra để phục vụ.
      await prisma.$executeRawUnsafe(`SET LOCAL "dna.bom_maintenance" = 'on'`);

      const steelGroup = await prisma.materialGroup.findFirstOrThrow({
        where: { systemKey: 'STEEL_BAR' },
      });
      const steelWarehouse = await prisma.warehouse.findFirstOrThrow({
        where: { code: 'phoi-son-han' },
      });
      const khsxUser = await prisma.user.findFirstOrThrow({ where: { username: 'khsx' } });

      // ── 1. Vật tư sắt (10 loại, đã gộp trùng theo cross-section - xem parse_dinhmuc.py) ──
      const materialIdByKey = new Map<string, bigint>();
      const distinct = new Map<string, { cls: 'VUONG' | 'HOP' | 'TRON'; crossSection: string }>();
      for (const p of PRODUCTS) {
        for (const pc of p.pieces) {
          for (const s of pc.segments) {
            if (s.material_class === 'OTHER' || !s.cross_section) continue;
            const key = `${s.material_class}:${s.cross_section}`;
            distinct.set(key, { cls: s.material_class, crossSection: s.cross_section });
          }
        }
      }
      for (const [key, { cls, crossSection }] of distinct) {
        const code = materialCode(cls, crossSection);
        const m = await prisma.material.upsert({
          where: { code },
          create: {
            code,
            name: materialName(cls, crossSection),
            unit: 'cây',
            materialGroupId: steelGroup.id,
            warehouseId: steelWarehouse.id,
          },
          update: { name: materialName(cls, crossSection) },
        });
        materialIdByKey.set(key, m.id);
      }
      console.log(`✔ ${distinct.size} vật tư sắt`);

      // ── 2. SegmentSpec dùng chung (materialId, cutLengthMm) ──
      const segmentSpecId = new Map<string, bigint>();
      async function resolveSegmentSpec(
        cls: 'VUONG' | 'HOP' | 'TRON',
        crossSection: string,
        lengthMm: number,
      ): Promise<bigint> {
        const materialId = materialIdByKey.get(`${cls}:${crossSection}`)!;
        const cacheKey = `${materialId}:${lengthMm}`;
        const cached = segmentSpecId.get(cacheKey);
        if (cached) return cached;
        const spec = await prisma.segmentSpec.upsert({
          where: { materialId_cutLengthMm: { materialId, cutLengthMm: lengthMm } },
          create: { materialId, cutLengthMm: lengthMm },
          update: {},
        });
        segmentSpecId.set(cacheKey, spec.id);
        return spec.id;
      }

      // ── 3. Từng sản phẩm: BomRevision DRAFT -> chèn Piece/BomPiece/PieceBom -> ACTIVATE,
      //     rồi PlanForm APPROVED để Sales chọn được SKU (xem quy tắc ở thiết kế cũ). ──
      for (let i = 0; i < PRODUCTS.length; i++) {
        const def = PRODUCTS[i];
        const meta = PRODUCT_META[i];
        const product = await prisma.mfgProduct.upsert({
          where: { factoryCode: meta.factoryCode },
          create: { factoryCode: meta.factoryCode, name: meta.name },
          update: { name: meta.name },
        });

        const revision = await prisma.bomRevision.upsert({
          where: { mfgProductId_revNo: { mfgProductId: product.id, revNo: 1 } },
          create: { mfgProductId: product.id, revNo: 1, status: BomRevisionStatus.DRAFT },
          update: { status: BomRevisionStatus.DRAFT },
        });

        let cutCount = 0;
        for (const [pi, pc] of def.pieces.entries()) {
          const pieceCode = `P${pi + 1}`;
          const piece = await prisma.piece.upsert({
            where: { mfgProductId_code: { mfgProductId: product.id, code: pieceCode } },
            create: {
              mfgProductId: product.id,
              code: pieceCode,
              groupNumber: 1,
              pieceNumber: pi + 1,
              name: pc.name,
            },
            update: { name: pc.name },
          });

          await prisma.bomPiece.upsert({
            where: { bomRevisionId_pieceId: { bomRevisionId: revision.id, pieceId: piece.id } },
            create: {
              bomRevisionId: revision.id,
              pieceId: piece.id,
              qtyPerUnit: pc.qty_per_unit,
              // Đã chốt suốt phiên "Ghế J55 mới Goplus": phôi cắt xong luôn qua Hàn+Sơn, không
              // phân biệt được từ dữ liệu định mức thô này (không phải phạm vi "quy cách(mm)"),
              // dùng chuẩn hợp lý nhất cho khung sắt hàn.
              needsHan: true,
              needsSon: true,
            },
            update: { qtyPerUnit: pc.qty_per_unit, needsHan: true, needsSon: true },
          });

          for (const s of pc.segments) {
            if (s.material_class === 'OTHER' || !s.cross_section || s.length_mm == null) continue;
            const specId = await resolveSegmentSpec(s.material_class, s.cross_section, s.length_mm);
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
                qtyPerPiece: Math.round(s.qty_per_piece),
                processSteps: [ProcessStep.CAT],
              },
              update: { qtyPerPiece: Math.round(s.qty_per_piece) },
            });
            cutCount++;
          }
        }

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
              note: `${meta.factoryCode} - định mức thật từ file người dùng cung cấp`,
            },
          });
        }

        console.log(
          `✔ ${meta.factoryCode.padEnd(20)} product=${product.id} revision=${revision.id}  ${def.pieces.length} mảnh · ${cutCount} dòng cỡ đoạn`,
        );
      }
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
