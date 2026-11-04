/**
 * Nạp bảng % hao hụt khi mua mặc định (bản yêu cầu v8 mục 7.9, anh Nhân chốt vòng 3–4) vào
 * Material.purchaseWastePercentage.
 *
 *   Sắt (trừ sắt cắt bằng phần mềm), la tấm, thép dây ........ 1%
 *   Dây đan .................................................. 1%
 *   Bulon, đinh, nút, tán .................................... 1,5%
 *   Carton, thùng, tem, nhãn, gối, HDLR ...................... 0%
 *   Sơn, xốp, nệm và các loại còn lại ........................ 1,5%
 *
 * Danh mục không có cột "loại hao hụt", nên phân loại theo nhóm vật tư + tên (xem classify()).
 * Sắt nhóm con "Phần mềm" bị bỏ qua: loại này không có % hao hụt mua (xem
 * MaterialsService.resolveWasteFields).
 *
 * Mặc định chỉ IN RA danh sách thay đổi, không ghi. Thêm --apply để ghi; trước khi ghi, số cũ của
 * mọi vật tư bị đổi được lưu vào prisma/backups/purchase-waste-<thời điểm>.json để hoàn tác bằng
 * --restore <file>.
 *
 *   npm run apply:purchase-waste-defaults                 (xem trước)
 *   npm run apply:purchase-waste-defaults -- --apply      (ghi)
 *   npm run apply:purchase-waste-defaults -- --restore prisma/backups/purchase-waste-xxx.json
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

/** Tên bắt đầu bằng 1 trong các từ này -> 0% (carton, thùng, tem, nhãn, gối, HDLR và giấy in đi kèm). */
const ZERO_PREFIXES = [
  'thùng',
  'carton',
  'tem',
  'nhãn',
  'gối',
  'hdlr',
  'barcode',
  'tờ label',
  'poster',
  'chữ dán',
];

type Row = {
  id: bigint;
  code: string;
  name: string;
  groupKey: string | null;
  steelSubGroup: string | null;
  current: number | null;
};

function classify(m: Row): { pct: number; rule: string } | null {
  if (m.groupKey === 'STEEL_BAR') {
    if ((m.steelSubGroup ?? 'SOFTWARE') === 'SOFTWARE') return null;
    return { pct: 1, rule: 'Sắt (không phải phần mềm), la tấm' };
  }
  if (m.groupKey === 'WIRE') return { pct: 1, rule: 'Dây đan' };
  const name = m.name.trim().toLowerCase();
  if (ZERO_PREFIXES.some((p) => name.startsWith(p))) {
    return { pct: 0, rule: 'Carton, thùng, tem, nhãn, gối, HDLR' };
  }
  if (['NAIL', 'PLASTIC_BUTTON', 'RIVET'].includes(m.groupKey ?? '')) {
    return { pct: 1.5, rule: 'Bulon, đinh, nút, tán' };
  }
  return { pct: 1.5, rule: 'Sơn, xốp, nệm và các loại còn lại' };
}

async function loadRows(): Promise<Row[]> {
  const ms = await prisma.material.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      code: true,
      name: true,
      steelSubGroup: true,
      purchaseWastePercentage: true,
      materialGroup: { select: { systemKey: true } },
    },
    orderBy: { code: 'asc' },
  });
  return ms.map((m) => ({
    id: m.id,
    code: m.code,
    name: m.name,
    groupKey: m.materialGroup?.systemKey ?? null,
    steelSubGroup: m.steelSubGroup,
    current: m.purchaseWastePercentage?.toNumber() ?? null,
  }));
}

async function restore(file: string) {
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    id: string;
    code: string;
    old: number | null;
  }[];
  await prisma.$transaction(
    saved.map((s) =>
      prisma.material.update({
        where: { id: BigInt(s.id) },
        data: { purchaseWastePercentage: s.old },
      }),
    ),
  );
  console.log(`Đã trả lại số cũ cho ${saved.length} vật tư từ ${file}`);
}

async function main() {
  const args = process.argv.slice(2);
  const restoreIdx = args.indexOf('--restore');
  if (restoreIdx >= 0) return restore(args[restoreIdx + 1]);
  const apply = args.includes('--apply');

  const rows = await loadRows();
  const changes: (Row & { pct: number; rule: string })[] = [];
  const byRule = new Map<string, { total: number; changed: number }>();
  let skipped = 0;
  for (const r of rows) {
    const c = classify(r);
    if (!c) {
      skipped++;
      continue;
    }
    const stat = byRule.get(c.rule) ?? { total: 0, changed: 0 };
    stat.total++;
    if (r.current !== c.pct) {
      stat.changed++;
      changes.push({ ...r, ...c });
    }
    byRule.set(c.rule, stat);
  }

  console.log(`Tổng ${rows.length} vật tư; bỏ qua ${skipped} sắt phần mềm.`);
  for (const [rule, s] of byRule) console.log(`  ${rule}: ${s.total} vật tư, đổi ${s.changed}`);
  console.log(`\nSẽ đổi ${changes.length} vật tư:`);
  for (const c of changes) {
    console.log(`  ${c.code}\t${c.current ?? 'trống'} -> ${c.pct}\t${c.name}`);
  }

  if (!apply) {
    console.log('\nChưa ghi gì. Thêm --apply để ghi.');
    return;
  }
  if (changes.length === 0) return;

  const dir = path.join(__dirname, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `purchase-waste-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  fs.writeFileSync(
    file,
    JSON.stringify(
      changes.map((c) => ({ id: c.id.toString(), code: c.code, old: c.current })),
      null,
      2,
    ),
  );

  const byPct = new Map<number, bigint[]>();
  for (const c of changes) byPct.set(c.pct, [...(byPct.get(c.pct) ?? []), c.id]);
  await prisma.$transaction(
    [...byPct].map(([pct, ids]) =>
      prisma.material.updateMany({
        where: { id: { in: ids } },
        data: { purchaseWastePercentage: pct },
      }),
    ),
  );
  console.log(`\nĐã ghi ${changes.length} vật tư. Số cũ lưu ở ${file}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
