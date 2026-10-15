import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Xoá SẠCH 1 SKU (PlanForm) + toàn bộ dữ liệu định mức RIÊNG của nó: BomRevision mà chính nó sở
 * hữu (sourcePlanFormId, @unique - 1 PlanForm có tối đa 1 revision), 6 bảng dòng con của revision
 * đó (BomPiece/PieceBom/PieceMaterialItem/PieceMaterialYield/ConsumableBom/BomAccessoryItem),
 * PlanFormManhReview/PlanFormDetailReview, Notification "SKU_*" liên quan, và AuditLog của
 * PlanForm/BomRevision đó. Dựng từ quy trình đã làm tay khi QA tính năng "Admin ghi đè định mức
 * SKU đã duyệt" (2026-10-15) - lúc đó phải tạo SKU/sản phẩm test, chạy hết luồng duyệt, rồi dọn
 * tay bằng raw SQL vì SkusService.remove() KHÔNG đụng tới BomRevision/dòng con của nó (chỉ xoá
 * PlanForm + 2 review, để lại BomRevision mồ côi - sourcePlanFormId chỉ SET NULL, không CASCADE,
 * xem migration 20260731160000). Script này gói lại đúng việc đó cho lần sau, KHÔNG phải xoá tay
 * từng dòng SQL nữa.
 *
 * CHẠY 1 SKU:      npm run delete-sku -- <planFormId> [--with-product] [--dry-run]
 * CHẠY TẤT CẢ:     npm run delete-sku -- --all [--with-product] [--dry-run]
 *
 * `--all` (2026-10-15, dùng khi dọn SKU/Product còn sót lại SAU `reset-warehouse-v2.ts` - xem
 * doc comment ở đó): quét MỌI PlanForm trong DB, áp CÙNG 4 lớp kiểm an toàn dưới đây cho TỪNG
 * SKU - SKU nào qua được thì xoá, SKU nào bị chặn thì BỎ QUA (không dừng cả lượt chạy) và báo rõ
 * lý do ở cuối. KHÔNG có cờ nào bỏ qua lớp kiểm an toàn - muốn ép xoá 1 SKU đang bị chặn phải tự
 * dọn dữ liệu chặn trước (xem ví dụ trong changelog), script này cố ý không cung cấp đường tắt.
 *
 * AN TOÀN (áp dụng cho MỌI SKU, cả 2 chế độ) - script TỪ CHỐI xoá (không đổi gì) nếu phát hiện
 * SKU này không còn là "SKU nháp/test" nữa mà đã có dữ liệu THẬT bám vào:
 *   - PlanForm.productionInvoiceId đã gắn (SKU đã thật sự được gộp vào 1 PI)
 *   - có WarehouseTransfer nào tham chiếu planFormId này (đã có phiếu chuyển kho thật)
 *   - có MaterialInspectionRequest nào tham chiếu (đã có lệnh kiểm tra vật tư thật)
 *   - BomRevision của SKU này đã bị ÍT NHẤT 1 ProductionOrder ghim bomRevisionId (đã có lệnh sản
 *     xuất thật chạy trên đúng bản định mức này - xoá sẽ làm ProductionOrder trỏ vào hư không)
 *
 * `--with-product`: xoá LUÔN MfgProduct + Piece/Part của sản phẩm - CHỈ khi đây là PlanForm DUY
 * NHẤT từng tạo cho product đó (đếm trước, lệch 0 thì tự bỏ qua phần này kèm cảnh báo, KHÔNG xoá
 * nhầm master data còn SKU khác dùng chung). Mọi FK khác trỏ vào mfg_products (ProductVariant,
 * ProductionInvoiceItem.mfgProductId, SalesOrderItem...) mà script không biết hết - để nguyên cho
 * Postgres tự chặn bằng FK constraint (RESTRICT) nếu có, lúc đó transaction CỦA RIÊNG SKU đó
 * rollback (ở chế độ --all, các SKU khác đã xoá xong trước đó KHÔNG bị ảnh hưởng - mỗi SKU 1
 * transaction độc lập) - chạy lại KHÔNG kèm --with-product cho đúng SKU đó là xong việc chính.
 *
 * `--dry-run`: chỉ in kế hoạch (số dòng sẽ xoá ở từng bảng), KHÔNG xoá gì.
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function usageAndExit(message: string): never {
  console.error(message);
  console.error('Dùng: npm run delete-sku -- <planFormId> [--with-product] [--dry-run]');
  console.error('  hoặc: npm run delete-sku -- --all [--with-product] [--dry-run]');
  process.exit(1);
}

type Outcome =
  | { status: 'deleted'; label: string }
  | { status: 'blocked'; label: string; reasons: string[] }
  | { status: 'dry-run'; label: string; plan: string[] };

/** Xử lý ĐÚNG 1 SKU - dùng chung cho cả chế độ 1-id và --all, để 2 đường không lệch logic. */
async function processOne(
  planFormId: bigint,
  opts: { withProduct: boolean; dryRun: boolean },
): Promise<Outcome> {
  const pf = await prisma.planForm.findUnique({
    where: { id: planFormId },
    include: { mfgProduct: true },
  });
  if (!pf) {
    return {
      status: 'blocked',
      label: `SKU #${planFormId}`,
      reasons: ['Không tìm thấy PlanForm này.'],
    };
  }
  const label = `SKU #${planFormId} — ${pf.mfgProduct.factoryCode} (${pf.mfgProduct.name}), status=${pf.status}`;

  // ── Kiểm an toàn: có dữ liệu THẬT nào phụ thuộc vào SKU này không ───────────────────────────
  const blockers: string[] = [];

  if (pf.productionInvoiceId != null) {
    blockers.push(
      `PlanForm đã gắn productionInvoiceId=${pf.productionInvoiceId} - SKU này đã thật sự vào 1 PI, không phải SKU nháp/test.`,
    );
  }

  const transferCount = await prisma.warehouseTransfer.count({ where: { planFormId } });
  if (transferCount > 0) {
    blockers.push(
      `Có ${transferCount} WarehouseTransfer tham chiếu SKU này (đã có chuyển kho thật).`,
    );
  }

  const inspectionCount = await prisma.materialInspectionRequest.count({ where: { planFormId } });
  if (inspectionCount > 0) {
    blockers.push(
      `Có ${inspectionCount} MaterialInspectionRequest tham chiếu SKU này (đã có lệnh kiểm tra vật tư thật).`,
    );
  }

  const revision = await prisma.bomRevision.findFirst({ where: { sourcePlanFormId: planFormId } });
  if (revision) {
    const orderCount = await prisma.productionOrder.count({
      where: { bomRevisionId: revision.id },
    });
    if (orderCount > 0) {
      blockers.push(
        `BomRevision #${revision.id} (status=${revision.status}) đã bị ${orderCount} ProductionOrder ghim - đã có lệnh sản xuất thật dùng bản định mức này.`,
      );
    }
  }

  if (blockers.length > 0) {
    return { status: 'blocked', label, reasons: blockers };
  }

  // ── --with-product: chỉ an toàn khi đây là PlanForm DUY NHẤT của product này ────────────────
  let productSafeToDelete = false;
  const plan: string[] = [
    `PlanForm #${planFormId} + PlanFormManhReview/PlanFormDetailReview`,
    `Notification (entityType=SKU, entityId=${planFormId}) + NotificationRecipient (cascade)`,
  ];
  if (opts.withProduct) {
    const otherPlanForms = await prisma.planForm.count({
      where: { mfgProductId: pf.mfgProductId, id: { not: planFormId } },
    });
    if (otherPlanForms > 0) {
      plan.push(
        `[--with-product bị bỏ qua] Sản phẩm "${pf.mfgProduct.factoryCode}" còn ${otherPlanForms} SKU khác - không xoá product/piece chung.`,
      );
    } else {
      productSafeToDelete = true;
    }
  }

  const pieceIds: bigint[] = [];
  if (revision) {
    const [
      bomPieceCount,
      pieceBomCount,
      materialItemCount,
      materialYieldCount,
      consumableCount,
      accessoryCount,
    ] = await Promise.all([
      prisma.bomPiece.count({ where: { bomRevisionId: revision.id } }),
      prisma.pieceBom.count({ where: { bomRevisionId: revision.id } }),
      prisma.pieceMaterialItem.count({ where: { bomRevisionId: revision.id } }),
      prisma.pieceMaterialYield.count({ where: { bomRevisionId: revision.id } }),
      prisma.consumableBom.count({ where: { bomRevisionId: revision.id } }),
      prisma.bomAccessoryItem.count({ where: { bomRevisionId: revision.id } }),
    ]);
    plan.push(
      `BomRevision #${revision.id} (status=${revision.status}) + dòng con: bomPiece=${bomPieceCount}, pieceBom=${pieceBomCount}, pieceMaterialItem=${materialItemCount}, pieceMaterialYield=${materialYieldCount}, consumableBom=${consumableCount}, bomAccessoryItem=${accessoryCount}`,
    );
  } else {
    plan.push('(SKU chưa từng có BomRevision nào)');
  }
  plan.push(`AuditLog của PlanForm${revision ? ' + BomRevision' : ''} này`);
  if (productSafeToDelete) {
    const pieces = await prisma.piece.findMany({
      where: { mfgProductId: pf.mfgProductId },
      select: { id: true },
    });
    pieceIds.push(...pieces.map((p) => p.id));
    const partCount = await prisma.part.count({ where: { mfgProductId: pf.mfgProductId } });
    plan.push(
      `MfgProduct #${pf.mfgProductId} (${pf.mfgProduct.factoryCode}) + Piece (${pieceIds.length}) + Part (${partCount}) + AuditLog tương ứng`,
    );
  } else if (opts.withProduct) {
    plan.push('MfgProduct/Piece/Part: GIỮ LẠI (sản phẩm còn SKU khác dùng chung)');
  }

  if (opts.dryRun) {
    return { status: 'dry-run', label, plan };
  }

  // ── Thực thi (1 transaction RIÊNG cho SKU này - ở chế độ --all, lỗi ở 1 SKU không làm rollback
  // các SKU khác đã xoá xong trước đó) ─────────────────────────────────────────────────────────
  await prisma.$transaction(async (tx) => {
    if (revision) {
      // Escape hatch (migration 20260921030000_bom_line_items_immutable_when_published) - bắt
      // buộc nếu revision đã ACTIVE/RETIRED (trigger assert_bom_revision_draft() chặn write
      // thẳng), vô hại nếu còn DRAFT.
      await tx.$executeRawUnsafe(`SET LOCAL "dna.bom_maintenance" = 'on'`);
      await tx.bomPiece.deleteMany({ where: { bomRevisionId: revision.id } });
      await tx.pieceBom.deleteMany({ where: { bomRevisionId: revision.id } });
      await tx.pieceMaterialItem.deleteMany({ where: { bomRevisionId: revision.id } });
      await tx.pieceMaterialYield.deleteMany({ where: { bomRevisionId: revision.id } });
      await tx.consumableBom.deleteMany({ where: { bomRevisionId: revision.id } });
      await tx.bomAccessoryItem.deleteMany({ where: { bomRevisionId: revision.id } });
      await tx.bomRevision.delete({ where: { id: revision.id } });
    }

    await tx.planFormManhReview.deleteMany({ where: { planFormId } });
    await tx.planFormDetailReview.deleteMany({ where: { planFormId } });
    await tx.notification.deleteMany({
      where: { entityType: 'SKU', entityId: planFormId.toString() },
    });
    await tx.planForm.delete({ where: { id: planFormId } });

    await tx.auditLog.deleteMany({
      where: {
        OR: [
          { tableName: 'PlanForm', recordId: planFormId.toString() },
          ...(revision ? [{ tableName: 'BomRevision', recordId: revision.id.toString() }] : []),
        ],
      },
    });

    if (productSafeToDelete) {
      await tx.piece.deleteMany({ where: { mfgProductId: pf.mfgProductId } });
      await tx.part.deleteMany({ where: { mfgProductId: pf.mfgProductId } });
      await tx.mfgProduct.delete({ where: { id: pf.mfgProductId } });
      await tx.auditLog.deleteMany({
        where: {
          OR: [
            { tableName: 'MfgProduct', recordId: pf.mfgProductId.toString() },
            ...(pieceIds.length
              ? [{ tableName: 'Piece', recordId: { in: pieceIds.map((p) => p.toString()) } }]
              : []),
          ],
        },
      });
    }
  });

  return { status: 'deleted', label };
}

function printOutcome(o: Outcome): void {
  console.log(`\n${o.label}`);
  if (o.status === 'blocked') {
    console.log('  [TỪ CHỐI XOÁ]');
    for (const r of o.reasons) console.log(`    - ${r}`);
  } else if (o.status === 'dry-run') {
    console.log('  [--dry-run] Kế hoạch xoá:');
    for (const p of o.plan) console.log(`    - ${p}`);
  } else {
    console.log('  Đã xoá xong.');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const idArg = args.find((a) => !a.startsWith('--'));
  const all = args.includes('--all');
  const withProduct = args.includes('--with-product');
  const dryRun = args.includes('--dry-run');

  if (all && idArg) {
    usageAndExit('Không dùng "--all" cùng với 1 planFormId cụ thể - chọn 1 trong 2.');
  }
  if (!all && (!idArg || !/^\d+$/.test(idArg))) {
    usageAndExit('Thiếu hoặc sai planFormId (phải là số nguyên), hoặc dùng --all để xoá mọi SKU.');
  }

  if (!all) {
    const outcome = await processOne(BigInt(idArg!), { withProduct, dryRun });
    printOutcome(outcome);
    if (outcome.status === 'blocked') process.exitCode = 1;
    return;
  }

  // ── Chế độ --all: quét MỌI PlanForm, xử lý TUẦN TỰ (không parallel - mỗi SKU 1 transaction
  // riêng, chạy đồng thời dễ đụng lock DB vô ích) ─────────────────────────────────────────────
  const allPlanForms = await prisma.planForm.findMany({
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  console.log(`--all: tìm thấy ${allPlanForms.length} SKU trong hệ thống.`);

  let deleted = 0;
  let blocked = 0;
  const blockedDetails: string[] = [];
  for (const { id } of allPlanForms) {
    const outcome = await processOne(id, { withProduct, dryRun });
    printOutcome(outcome);
    if (outcome.status === 'blocked') {
      blocked += 1;
      blockedDetails.push(`${outcome.label}: ${outcome.reasons.join('; ')}`);
    } else if (outcome.status === 'deleted') {
      deleted += 1;
    }
  }

  console.log('\n=== TỔNG KẾT ===');
  if (dryRun) {
    console.log(`[--dry-run] ${allPlanForms.length} SKU - không xoá gì, chỉ in kế hoạch ở trên.`);
  } else {
    console.log(`Đã xoá ${deleted}/${allPlanForms.length} SKU. Bị chặn: ${blocked}.`);
    if (blockedDetails.length) {
      console.log('Chi tiết SKU bị chặn (giữ lại, không đổi gì):');
      for (const d of blockedDetails) console.log(`  - ${d}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
