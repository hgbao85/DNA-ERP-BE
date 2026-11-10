/**
 * Tạo / cập nhật tài khoản thủ kho theo 9 kho (Đợt 7, người giữ kho anh Nhân chốt 02-10/11/2026). Chạy lại được: tài khoản đã có
 * (theo username) thì cập nhật họ tên, kho, quyền thủ kho; mật khẩu CHỈ đặt khi tạo mới (không ghi đè mật khẩu người dùng đã đổi).
 *
 *   npx ts-node --transpile-only prisma/seed-warehouse-keepers.ts           # xem trước (không ghi gì)
 *   npx ts-node --transpile-only prisma/seed-warehouse-keepers.ts --apply
 *
 * Mật khẩu ban đầu: SEED_KEEPER_PASSWORD, không có thì SEED_DEMO_PASSWORD / mặc định của seed-demo (bản chạy thử). Người giữ
 * nhiều kho: kho đầu tiên là "kho đang làm", các kho sau là "Giữ thêm kho" (đổi ở ô "Kho đang làm" cuối sidebar màn kho).
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { BUSINESS_ROLES } from '../src/common/constants/roles.constant';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

interface Keeper {
  username: string;
  name: string;
  /** Mã kho; phần tử đầu = kho đang làm. */
  warehouses: string[];
}

const TP1 = 'thanh-pham';
const TP2 = 'thanh-pham-1788485485362';
const TP3 = 'thanh-pham-1792489603061';

const KEEPERS: Keeper[] = [
  { username: 'kieulinh', name: 'Kiều Linh', warehouses: ['phoi-son-han', 'phoi-son-han-han-pa'] },
  { username: 'hung', name: 'Hùng', warehouses: ['phoi-son-han-phoi-pha', 'phoi-son-han-han-pha'] },
  // Kho Phụ kiện trước mắt do chị Quanh giữ; chị Diễm giữ thêm để thay khi chị Quanh nghỉ (anh Nhân 10/11).
  { username: 'diem', name: 'Diễm', warehouses: ['phoi-son-han-son-pa', 'vat-tu-tp'] },
  { username: 'quanh', name: 'Quanh', warehouses: ['vat-tu-tp'] },
  { username: 'trinh', name: 'Trinh', warehouses: [TP1, TP2] },
  { username: 'tuan', name: 'Tuấn', warehouses: [TP3] },
];

const apply = process.argv.includes('--apply');

async function main() {
  const codes = [...new Set(KEEPERS.flatMap((k) => k.warehouses))];
  const found = await prisma.warehouse.findMany({
    where: { code: { in: codes } },
    select: { code: true, name: true },
  });
  const nameOf = new Map(found.map((w) => [w.code, w.name]));
  const missing = codes.filter((c) => !nameOf.has(c));
  if (missing.length > 0) throw new Error(`Không có kho: ${missing.join(', ')}`);
  const role = await prisma.role.findFirst({
    where: { name: BUSINESS_ROLES.WAREHOUSE_STAFF },
    select: { id: true },
  });
  if (!role)
    throw new Error(`Chưa có vai trò ${BUSINESS_ROLES.WAREHOUSE_STAFF} - chạy seed chính trước`);

  const password = process.env.SEED_KEEPER_PASSWORD ?? process.env.SEED_DEMO_PASSWORD ?? 'demo1234';
  const hashed = await argon2.hash(password);

  for (const k of KEEPERS) {
    const existing = await prisma.user.findUnique({
      where: { username: k.username },
      select: { id: true },
    });
    const [active, ...extra] = k.warehouses;
    const data = {
      firstName: k.name,
      lastName: '',
      warehouseScope: active,
      warehouseScopes: extra.length > 0 ? k.warehouses : [],
      isActive: true,
    };
    console.log(
      `${existing ? 'CẬP NHẬT' : 'TẠO MỚI '} ${k.username.padEnd(9)} ${k.name.padEnd(10)} ${k.warehouses
        .map((c, i) => `${nameOf.get(c)}${i === 0 ? ' (đang làm)' : ''}`)
        .join(' + ')}`,
    );
    if (!apply) continue;
    const user = existing
      ? await prisma.user.update({ where: { id: existing.id }, data })
      : await prisma.user.create({ data: { ...data, username: k.username, password: hashed } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
  }
  console.log(apply ? `ĐÃ GHI ${KEEPERS.length} tài khoản.` : 'Xem trước - thêm --apply để ghi.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
