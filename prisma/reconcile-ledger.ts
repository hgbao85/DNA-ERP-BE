import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

// Đối soát CHỈ ĐỌC: mọi dòng sổ cái có refId trỏ tới phiếu/bước không tồn tại.
// Chạy: npx ts-node -r tsconfig-paths/register prisma/reconcile-ledger.ts
// Thoát với mã 1 nếu có dòng mồ côi.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main(): Promise<number> {
  const recipeIssues = new Set(
    (await prisma.materialYieldRecipeIssue.findMany({ select: { id: true } })).map((r) =>
      r.id.toString(),
    ),
  );
  const yieldIssues = new Set(
    (await prisma.materialYieldIssue.findMany({ select: { id: true } })).map((r) =>
      r.id.toString(),
    ),
  );
  const steelIssues = new Set(
    (await prisma.steelIssue.findMany({ select: { id: true } })).map((r) => r.id.toString()),
  );
  const stepBundles = new Set(
    (await prisma.materialYieldStepBundle.findMany({ select: { id: true } })).map((r) =>
      r.id.toString(),
    ),
  );

  const checks: {
    refType: 'MATERIAL_YIELD_CONSUME' | 'STEEL_ISSUE' | 'MATERIAL_YIELD_RECIPE_OUTPUT';
    exists: (id: string) => boolean;
  }[] = [
    {
      refType: 'MATERIAL_YIELD_CONSUME',
      exists: (id) => recipeIssues.has(id) || yieldIssues.has(id),
    },
    { refType: 'STEEL_ISSUE', exists: (id) => steelIssues.has(id) },
    { refType: 'MATERIAL_YIELD_RECIPE_OUTPUT', exists: (id) => stepBundles.has(id) },
  ];

  let orphans = 0;
  for (const c of checks) {
    const rows = await prisma.stockLedger.findMany({
      where: { refType: c.refType },
      select: { id: true, refId: true, qty: true },
    });
    const bad = rows.filter((r) => !r.refId || !c.exists(r.refId));
    orphans += bad.length;
    console.log(`${c.refType}: ${rows.length} dòng, mồ côi ${bad.length}`);
    for (const r of bad) {
      console.log(`  ledger ${r.id} refId=${r.refId ?? 'null'} qty=${r.qty.toString()}`);
    }
  }
  return orphans;
}

main()
  .then((n) => {
    process.exitCode = n > 0 ? 1 : 0;
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
