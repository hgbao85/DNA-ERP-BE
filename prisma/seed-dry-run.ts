/**
 * BẢN THỬ CHỈ ĐỌC của `prisma/seed.ts` (2026-10-15): so DB đang trỏ tới với kết quả mà seed SẼ tạo, KHÔNG ghi gì.
 * Chạy: DATABASE_URL=<db> npx ts-node -r tsconfig-paths/register prisma/seed-dry-run.ts
 * Chỉ in tên vai trò/quyền/kho (không in dữ liệu cá nhân). Phần kho: sao chép từ seed.ts (seed.ts tự chạy khi import nên không import được).
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PERMISSION_MODULES } from '../src/common/constants/permission-modules.constant';
import {
  ROLE_GRANTS,
  UNIVERSAL_BUSINESS_GRANTS,
} from '../src/common/constants/role-permissions.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../src/common/constants/roles.constant';
import { PermissionAction, PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const ALL_ACTIONS = Object.values(PermissionAction);
const ALL_MODULES = Object.values(PERMISSION_MODULES);
const key = (module: string, action: string) => `${module}:${action}`;

// Sao chép từ seed.ts (SEED_WAREHOUSES): code -> [name, isVirtual, note]
const SEED_WAREHOUSES: Record<string, [string, boolean, string]> = {
  'thanh-pham': [
    'Kho thành phẩm',
    false,
    'Bao bì đóng gói & thành phẩm hoàn chỉnh — cuối chuỗi chuyển kho nội bộ',
  ],
  'vat-tu-tp': ['Kho Vật tư thành phẩm', false, 'Sơn, dây, vật tư tiêu hao sản xuất'],
  'phoi-son-han': [
    'Kho Phôi Sơn Hàn',
    false,
    'Phôi kim loại, sơn, vật tư hàn — đầu chuỗi chuyển kho nội bộ',
  ],
  SUPPLIER: [
    'Nhà cung cấp (ảo)',
    true,
    'Điểm xuất phát bút toán PURCHASE trên stock_ledger — không có tồn vật lý',
  ],
  PRODUCTION: ['Đang sản xuất (ảo)', true, 'Hàng đang trên chuyền — không có tồn vật lý'],
  SCRAP: ['Phế liệu (ảo)', true, 'Điểm đến bút toán huỷ/phế — không có tồn vật lý'],
  OPENING_BALANCE: [
    'Đối ứng tồn kho ban đầu/điều chỉnh (ảo)',
    true,
    'Điểm đối ứng cho bút toán khai báo tồn kho ban đầu lúc tạo vật tư, và cho "Sửa nhanh tồn kho" ở Admin > Vật tư / trang Kho (cả tăng lẫn giảm) — không có tồn vật lý',
  ],
};

function groupByModule(keys: string[]): string {
  const m = new Map<string, string[]>();
  for (const k of keys) {
    const [mod, act] = k.split(':');
    m.set(mod, [...(m.get(mod) ?? []), act]);
  }
  return [...m.entries()].map(([mod, acts]) => `${mod}(${acts.join('/')})`).join(', ');
}

async function main() {
  const allKeys = ALL_MODULES.flatMap((m) => ALL_ACTIONS.map((a) => key(m, a)));
  const dbPerms = await prisma.permission.findMany({ select: { module: true, action: true } });
  const dbPermKeys = new Set(dbPerms.map((p) => key(p.module, p.action)));
  const missingPerms = allKeys.filter((k) => !dbPermKeys.has(k));
  console.log(
    `== QUYỀN: trong code ${allKeys.length}, trong DB ${dbPerms.length}, SẼ TẠO MỚI ${missingPerms.length}`,
  );
  console.log(`   module mới: ${groupByModule(missingPerms)}`);
  const extra = [...dbPermKeys].filter((k) => !allKeys.includes(k));
  console.log(
    `   quyền có trong DB nhưng không còn trong code (seed không xoá bảng permissions): ${extra.length} -> ${groupByModule(extra)}`,
  );
  if (extra.length) {
    const used = await prisma.rolePermission.findMany({
      where: {
        permission: {
          OR: extra.map((k) => ({
            module: k.split(':')[0],
            action: k.split(':')[1] as PermissionAction,
          })),
        },
      },
      select: { role: { select: { name: true } } },
    });
    console.log(
      `   số lượt gán các quyền thừa đó cho vai trò: ${used.length} (${[...new Set(used.map((u) => u.role.name))].join(', ') || 'không vai trò nào'})`,
    );
  }

  // Đích của từng vai trò do seed quản lý (đúng logic seed.ts)
  const desired = new Map<string, Set<string>>();
  desired.set(DEFAULT_ROLES.ADMIN, new Set(allKeys));
  desired.set(
    BUSINESS_ROLES.BOSS,
    new Set(allKeys.filter((k) => k.endsWith(':VIEW') || k.endsWith(':APPROVE'))),
  );
  for (const name of Object.values(BUSINESS_ROLES)) {
    if (name === BUSINESS_ROLES.BOSS) continue;
    const grants = [...UNIVERSAL_BUSINESS_GRANTS, ...(ROLE_GRANTS[name] ?? [])];
    const set = new Set<string>();
    for (const g of grants) {
      const actions = g.actions === 'ALL' ? ALL_ACTIONS : g.actions;
      for (const a of actions) set.add(key(g.module, a));
    }
    desired.set(name, set);
  }

  const roles = await prisma.role.findMany({
    select: {
      name: true,
      permissions: { select: { permission: { select: { module: true, action: true } } } },
    },
  });
  const roleByName = new Map(roles.map((r) => [r.name, r]));

  console.log('\n== VAI TRÒ do seed quản lý: hiện có -> đích | THÊM | GỠ');
  let totalRemove = 0;
  for (const [name, want] of desired) {
    const role = roleByName.get(name);
    if (!role) {
      console.log(`${name.padEnd(32)} CHƯA CÓ trong DB -> seed sẽ TẠO MỚI với ${want.size} quyền`);
      continue;
    }
    const have = new Set(
      role.permissions.map((rp) => key(rp.permission.module, rp.permission.action)),
    );
    const add = [...want].filter((k) => !have.has(k));
    const remove = [...have].filter((k) => !want.has(k));
    totalRemove += remove.length;
    console.log(
      `${name.padEnd(32)} ${String(have.size).padStart(3)} -> ${String(want.size).padStart(3)} | +${add.length} | -${remove.length}`,
    );
    if (add.length) console.log(`     THÊM: ${groupByModule(add)}`);
    if (remove.length) console.log(`     GỠ  : ${groupByModule(remove)}`);
  }
  const others = roles.filter((r) => !desired.has(r.name)).map((r) => r.name);
  console.log(
    `\nVai trò KHÔNG do seed quản lý (seed không đụng): ${others.join(', ') || '(không có)'}`,
  );
  console.log(`TỔNG số quyền sẽ bị GỠ khỏi vai trò hiện có: ${totalRemove}`);

  console.log('\n== KHO: seed sẽ ghi đè name/isVirtual/note của 7 kho cố định');
  const whs = await prisma.warehouse.findMany({
    select: { code: true, name: true, isVirtual: true, note: true },
  });
  const whByCode = new Map(whs.map((w) => [w.code, w]));
  for (const [code, [name, isVirtual, note]] of Object.entries(SEED_WAREHOUSES)) {
    const w = whByCode.get(code);
    if (!w) {
      console.log(`${code.padEnd(16)} CHƯA CÓ -> sẽ tạo`);
      continue;
    }
    const diffs = [
      w.name !== name ? `tên "${w.name}" -> "${name}"` : '',
      w.isVirtual !== isVirtual ? `isVirtual ${w.isVirtual} -> ${isVirtual}` : '',
      (w.note ?? null) !== note ? 'ghi chú khác' : '',
    ].filter(Boolean);
    console.log(
      `${code.padEnd(16)} ${diffs.length ? 'SẼ ĐỔI: ' + diffs.join('; ') : 'giữ nguyên'}`,
    );
  }
  console.log(
    `Kho khác trong DB (không đụng): ${
      whs
        .filter((w) => !(w.code in SEED_WAREHOUSES))
        .map((w) => w.code)
        .join(', ') || '(không có)'
    }`,
  );

  console.log('\n== NHÓM VẬT TƯ hệ thống');
  const groups = await prisma.materialGroup.findMany({
    select: { name: true, systemKey: true, codePrefix: true },
  });
  console.log(
    groups.map((g) => `${g.systemKey ?? '(chưa có systemKey)'}:${g.codePrefix ?? '-'}`).join(', '),
  );

  console.log('\n== TÀI KHOẢN ADMIN (seed cần email admin CÓ SẴN; email lạ sẽ TẠO admin mới)');
  const admins = await prisma.user.count({
    where: { roles: { some: { role: { name: DEFAULT_ROLES.ADMIN } } }, deletedAt: null },
  });
  console.log(`Số tài khoản có vai trò ADMIN: ${admins}`);
  const floorRole = roleByName.get(BUSINESS_ROLES.FLOOR_WORKER);
  console.log(`Vai trò FLOOR_WORKER hiện ${floorRole ? 'CÓ' : 'CHƯA có'} trong DB`);
}

main()
  .catch((e) => {
    console.error('Dry-run lỗi:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
