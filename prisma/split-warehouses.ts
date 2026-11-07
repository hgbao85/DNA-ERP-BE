/**
 * Đợt 7 - chuyển vật tư Hàn/Sơn từ kho chung cũ 'phoi-son-han' (nay là Kho Phôi Phú An) sang Kho Hàn Phú An / Kho Sơn Phú An,
 * và gắn kho nhận Phước An cho các dòng mua chưa nhận của lệnh xưởng Phước An. Chạy NGÀY KIỂM KÊ (12/11/2026), sau khi
 * migration 20261107090000_warehouse_kind_workshop đã lên.
 *
 *   npx ts-node --transpile-only prisma/split-warehouses.ts                  # xem trước (không ghi gì)
 *   npx ts-node --transpile-only prisma/split-warehouses.ts --plan-file x.csv  # xem trước với bảng phân loại sửa tay
 *   npx ts-node --transpile-only prisma/split-warehouses.ts --apply [--plan-file x.csv]
 *   ... --rehearse [--plan-file x.csv]   # chạy y hệt --apply trong 1 transaction rồi HOÀN TÁC (diễn tập trên DB thật)
 *
 * Phân loại tự động vật tư đang ở kho cũ:
 *   - nhóm Sắt (STEEL_BAR), tên có "đá cắt"                                 -> giữ ở kho Phôi
 *   - nhóm Tán rút (RIVET)                                                  -> kho Hàn  (bản v8: tán rút thuộc kho Hàn)
 *   - định mức tiêu hao (consumable_bom) chỉ dùng ở công đoạn HAN / chỉ SON -> kho Hàn / kho Sơn
 *   - còn lại                                                               -> CẦN XEM (không chạy --apply được tới khi
 *     có trong --plan-file)
 * --plan-file: CSV 2 cột `mã vật tư,PHOI|HAN|SON` (dòng đầu là tiêu đề hoặc không đều được) - ghi đè phân loại tự động.
 *
 * Mỗi vật tư chuyển: đổi Material.warehouseId, chuyển toàn bộ tồn (mọi chiều dài/quy cách) bằng bút toán WAREHOUSE_SPLIT
 * (idempotencyKey cố định -> chạy lại không ghi 2 lần), chuyển giữ chỗ ACTIVE sang kho mới. Tất cả trong 1 transaction.
 * Báo (không tự sửa): tồn âm, giữ chỗ chuyển kho nội bộ, phiếu xuất XK nháp, giữ chỗ Phôi/Hàn của lệnh Phước An đang nằm ở
 * kho Phú An, thủ kho còn gắn kho cũ.
 */
import 'dotenv/config';
import * as fs from 'fs';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  Prisma,
  PrismaClient,
  PurchaseProposalStatus,
  StockLedgerRefType,
  WarehouseKind,
} from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const ROOT = 'phoi-son-han';
const TARGET_CODE: Partial<Record<WarehouseKind, string>> = {
  HAN: 'phoi-son-han-han-pa',
  SON: 'phoi-son-han-son-pa',
};
type Kind = 'PHOI' | 'HAN' | 'SON';

const args = process.argv.slice(2);
const rehearse = args.includes('--rehearse');
const apply = args.includes('--apply') || rehearse;
class Rollback extends Error {}
const planFileIdx = args.indexOf('--plan-file');
const planFile = planFileIdx >= 0 ? args[planFileIdx + 1] : null;

function readPlanFile(file: string): Map<string, Kind> {
  const map = new Map<string, Kind>();
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const [code, kind] = raw.split(',').map((s) => s.trim());
    if (!code || !kind) continue;
    const k = kind.toUpperCase();
    if (k === 'PHOI' || k === 'HAN' || k === 'SON') map.set(code, k);
    else if (!/^(kind|kho|loai)/i.test(kind))
      throw new Error(`Dòng "${raw}": loại kho phải là PHOI, HAN hoặc SON`);
  }
  return map;
}

async function main() {
  const root = await prisma.warehouse.findUnique({ where: { code: ROOT } });
  const han = await prisma.warehouse.findUnique({ where: { code: TARGET_CODE.HAN! } });
  const son = await prisma.warehouse.findUnique({ where: { code: TARGET_CODE.SON! } });
  if (!root || !han || !son || root.kind !== WarehouseKind.PHOI) {
    throw new Error(
      'Chưa có 9 kho - chạy `npx prisma migrate deploy` (migration 20261107090000) trước',
    );
  }
  const targetOf: Record<'HAN' | 'SON', typeof han> = { HAN: han, SON: son };
  const override = planFile ? readPlanFile(planFile) : new Map<string, Kind>();
  const actor = await prisma.user.findFirst({
    where: { roles: { some: { role: { name: 'ADMIN' } } }, deletedAt: null },
    select: { id: true },
  });

  // ── 1. Phân loại vật tư đang ở kho cũ ──────────────────────────────────────────────────────────
  const materials = await prisma.material.findMany({
    where: { warehouseId: root.id, deletedAt: null },
    select: { id: true, code: true, name: true, materialGroup: { select: { systemKey: true } } },
    orderBy: { code: 'asc' },
  });
  const stageRows = await prisma.$queryRaw<{ materialId: bigint; stage: string }[]>`
    SELECT DISTINCT "materialId", stage::text AS stage FROM consumable_bom
    WHERE "materialId" IN (${Prisma.join(materials.length ? materials.map((m) => m.id) : [0n])})`;
  const stagesOf = new Map<string, Set<string>>();
  for (const r of stageRows) {
    const k = r.materialId.toString();
    if (!stagesOf.has(k)) stagesOf.set(k, new Set());
    stagesOf.get(k)!.add(r.stage);
  }
  const plan: { id: bigint; code: string; name: string; kind: Kind | null; why: string }[] = [];
  for (const m of materials) {
    const stages = [...(stagesOf.get(m.id.toString()) ?? [])];
    let kind: Kind | null = null;
    let why = '';
    if (override.has(m.code)) [kind, why] = [override.get(m.code)!, 'bảng sửa tay'];
    else if (m.materialGroup?.systemKey === 'STEEL_BAR') [kind, why] = ['PHOI', 'nhóm Sắt'];
    else if (/đá cắt/i.test(m.name)) [kind, why] = ['PHOI', 'đá cắt'];
    else if (m.materialGroup?.systemKey === 'RIVET') [kind, why] = ['HAN', 'nhóm Tán rút'];
    else if (stages.length === 1 && stages[0] === 'HAN')
      [kind, why] = ['HAN', 'định mức chỉ dùng ở Hàn'];
    else if (stages.length === 1 && stages[0] === 'SON')
      [kind, why] = ['SON', 'định mức chỉ dùng ở Sơn'];
    else why = stages.length ? `định mức dùng ở ${stages.join('+')}` : 'không có định mức tiêu hao';
    plan.push({ id: m.id, code: m.code, name: m.name, kind, why });
  }
  console.log(`\n=== Phân loại ${plan.length} vật tư đang ở kho ${ROOT} ===`);
  for (const k of ['PHOI', 'HAN', 'SON', null] as const) {
    const rows = plan.filter((p) => p.kind === k);
    console.log(`\n${k ?? 'CẦN XEM (ghi vào --plan-file)'}: ${rows.length}`);
    for (const p of rows) console.log(`  ${p.code.padEnd(12)} ${p.name}  (${p.why})`);
  }
  const unresolved = plan.filter((p) => p.kind === null);

  // ── 2. Tồn / giữ chỗ của vật tư sẽ chuyển ─────────────────────────────────────────────────────
  const moving = plan.filter((p) => p.kind === 'HAN' || p.kind === 'SON');
  const movingIds = moving.map((p) => p.id);
  const quants = movingIds.length
    ? await prisma.stockQuant.findMany({
        where: { warehouseId: root.id, materialId: { in: movingIds }, NOT: { qty: 0 } },
      })
    : [];
  const negative = quants.filter((q) => q.qty.lt(0));
  const reservations = movingIds.length
    ? await prisma.stockReservation.count({
        where: { warehouseId: root.id, materialId: { in: movingIds }, status: 'ACTIVE' },
      })
    : 0;
  const transferRes = movingIds.length
    ? await prisma.warehouseTransferReservation.count({
        where: { warehouseId: root.id, materialId: { in: movingIds } },
      })
    : 0;
  const draftSlips = await prisma.issueSlip.count({
    where: { warehouseId: root.id, status: 'DRAFT' },
  });
  console.log(`\n=== Sẽ chuyển ${moving.length} vật tư sang kho Hàn/Sơn Phú An ===`);
  console.log(`  ${quants.length} dòng tồn khác 0, ${reservations} dòng giữ chỗ ACTIVE`);
  for (const q of quants) {
    const p = moving.find((x) => x.id === q.materialId)!;
    console.log(
      `  ${p.code.padEnd(12)} -> ${p.kind}  tồn ${q.qty.toString()}${q.stockLengthMm ? ` (cây ${q.stockLengthMm}mm)` : ''}${q.spec ? ` [${q.spec}]` : ''}`,
    );
  }
  if (negative.length)
    console.log(`  !! ${negative.length} dòng tồn ÂM - kiểm kê lại trước khi chuyển`);
  if (transferRes)
    console.log(`  !! ${transferRes} giữ chỗ chuyển kho nội bộ còn mở - xử lý phiếu chuyển trước`);
  if (draftSlips)
    console.log(
      `  !! ${draftSlips} phiếu xuất XK nháp ở kho cũ - xác nhận hoặc huỷ trước khi chuyển`,
    );

  // ── 3. Lệnh xưởng Phước An ───────────────────────────────────────────────────────────────────
  const pha = await prisma.workshop.findUnique({ where: { code: 'PHUOC_AN' } });
  const phaWarehouses = pha
    ? await prisma.warehouse.findMany({ where: { workshopId: pha.id } })
    : [];
  const phaPiIds = pha
    ? (
        await prisma.productionInvoiceItem.findMany({
          where: { workshopId: pha.id },
          select: { productionInvoiceId: true },
          distinct: ['productionInvoiceId'],
        })
      )
        .map((r) => r.productionInvoiceId)
        .filter((x): x is bigint => x != null)
    : [];
  const boundKinds = [WarehouseKind.PHOI, WarehouseKind.HAN];
  const phaOpenItems = phaPiIds.length
    ? await prisma.purchaseProposalItem.findMany({
        where: {
          proposal: { productionInvoiceId: { in: phaPiIds } },
          status: { not: PurchaseProposalStatus.PURCHASED },
          receiveWarehouseCode: null,
          material: { warehouse: { kind: { in: boundKinds } } },
        },
        select: {
          id: true,
          material: { select: { code: true, warehouse: { select: { kind: true } } } },
        },
      })
    : [];
  const phaReservations = phaPiIds.length
    ? await prisma.stockReservation.count({
        where: {
          productionInvoiceId: { in: phaPiIds },
          status: 'ACTIVE',
          warehouse: { kind: { in: boundKinds }, workshopId: { not: pha!.id } },
        },
      })
    : 0;
  console.log(`\n=== Lệnh xưởng Phước An: ${phaPiIds.length} lệnh ===`);
  console.log(`  ${phaOpenItems.length} dòng mua Phôi/Hàn chưa nhận -> gắn kho nhận Phước An`);
  if (phaReservations) {
    console.log(
      `  !! ${phaReservations} giữ chỗ Phôi/Hàn của lệnh Phước An đang nằm ở kho Phú An - hàng thật ở Phú An, xuất sắt sẽ bị chặn tới khi xử lý tay (chuyển hàng + chuyển giữ chỗ)`,
    );
  }

  // ── 4. Thủ kho còn gắn kho cũ ────────────────────────────────────────────────────────────────
  const staff = await prisma.user.findMany({
    where: { warehouseScope: ROOT, deletedAt: null, isActive: true },
    select: { username: true, mfgRole: true },
  });
  console.log(`\n=== ${staff.length} tài khoản đang gắn kho ${ROOT} (nay là Kho Phôi Phú An) ===`);
  for (const u of staff) console.log(`  ${u.username}${u.mfgRole ? ` (${u.mfgRole})` : ''}`);
  console.log(
    '  -> thủ kho Hàn/Sơn/Phước An: Admin > Người dùng đổi sang đúng kho mới, đăng nhập lại.',
  );

  if (!apply) {
    console.log('\n(Xem trước - chưa ghi gì. Thêm --apply để chạy.)');
    return;
  }
  if (unresolved.length)
    throw new Error(`Còn ${unresolved.length} vật tư CẦN XEM - ghi vào --plan-file rồi chạy lại`);
  if (negative.length || transferRes || draftSlips) {
    throw new Error(
      'Còn tồn âm / giữ chỗ chuyển kho / phiếu XK nháp ở kho cũ - xử lý trước khi --apply',
    );
  }
  if (!actor) throw new Error('Không tìm thấy tài khoản ADMIN để ghi người tạo bút toán');

  await prisma
    .$transaction(
      async (tx) => {
        for (const p of moving) {
          const target = targetOf[p.kind as 'HAN' | 'SON'];
          for (const q of quants.filter((x) => x.materialId === p.id)) {
            await tx.stockLedger.create({
              data: {
                fromWarehouseId: root.id,
                toWarehouseId: target.id,
                materialId: p.id,
                qty: q.qty,
                stockLengthMm: q.stockLengthMm,
                spec: q.spec,
                refType: StockLedgerRefType.WAREHOUSE_SPLIT,
                refId: p.id.toString(),
                idempotencyKey: `warehouse-split:${p.id}:${q.stockLengthMm}:${q.spec}`,
                note: `Chia 9 kho: chuyển sang ${target.name}`,
                createdById: actor.id,
              },
            });
          }
          await tx.stockReservation.updateMany({
            where: { warehouseId: root.id, materialId: p.id, status: 'ACTIVE' },
            data: { warehouseId: target.id },
          });
          await tx.material.update({ where: { id: p.id }, data: { warehouseId: target.id } });
        }
        for (const it of phaOpenItems) {
          const w = phaWarehouses.find((x) => x.kind === it.material.warehouse?.kind);
          if (!w) throw new Error(`Xưởng Phước An chưa có kho ${it.material.warehouse?.kind}`);
          await tx.purchaseProposalItem.update({
            where: { id: it.id },
            data: { receiveWarehouseCode: w.code },
          });
        }
        if (rehearse) {
          const moved = await tx.material.count({
            where: { id: { in: movingIds }, warehouseId: { in: [han.id, son.id] } },
          });
          const left = await tx.stockQuant.count({
            where: { warehouseId: root.id, materialId: { in: movingIds }, NOT: { qty: 0 } },
          });
          console.log(`
[diễn tập] đã đổi kho ${moved}/${moving.length} vật tư, tồn còn ở kho cũ: ${left} dòng - HOÀN TÁC`);
          throw new Rollback();
        }
      },
      { timeout: 120_000 },
    )
    .catch((e) => {
      if (!(e instanceof Rollback)) throw e;
    });
  if (rehearse) return;
  console.log(
    `\nĐÃ CHẠY: chuyển ${moving.length} vật tư, gắn kho nhận Phước An cho ${phaOpenItems.length} dòng mua.`,
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
