import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../src/common/constants/roles.constant';
import { PROTECTED_WAREHOUSE_CODES } from '../src/common/constants/protected-warehouse-codes.constant';
import {
  MATERIAL_GROUP_SYSTEM_KEYS,
  MaterialGroupSystemKey,
} from '../src/common/constants/material-group-system-keys.constant';
import { MATERIAL_GROUP_CODE_PREFIX } from '../src/common/constants/material-group-code-prefix.constant';
import { PrismaClient } from '../src/generated/prisma/client';
import { syncRbac } from '../src/common/rbac/sync-rbac';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/**
 * 3 kho vật lý (chuỗi chuyển kho nội bộ gốc) + 3 kho ảo bắt buộc phải seed sẵn
 * (docs/dna-erp-db-schema.html "warehouses"). Codes phải khớp 1-1 với
 * PROTECTED_WAREHOUSE_CODES - đây là danh sách duy nhất mà warehouses.service.ts chặn xoá.
 * "thanh-pham" là kho gốc duy nhất được phép có thêm instance khác (vd "thanh-pham-2") -
 * Admin tạo qua UI Kho như bình thường, không cần đụng tới seed này.
 */
const SEED_WAREHOUSES: { code: string; name: string; isVirtual: boolean; note?: string }[] = [
  {
    code: 'thanh-pham',
    name: 'Kho Bao bì/Thành phẩm',
    isVirtual: false,
    note: 'Bao bì đóng gói & thành phẩm hoàn chỉnh — cuối chuỗi chuyển kho nội bộ',
  },
  {
    code: 'vat-tu-tp',
    name: 'Kho Vật tư thành phẩm',
    isVirtual: false,
    note: 'Sơn, dây, vật tư tiêu hao sản xuất',
  },
  {
    code: 'phoi-son-han',
    name: 'Kho Phôi Sơn Hàn',
    isVirtual: false,
    note: 'Phôi kim loại, sơn, vật tư hàn — đầu chuỗi chuyển kho nội bộ',
  },
  {
    code: 'SUPPLIER',
    name: 'Nhà cung cấp (ảo)',
    isVirtual: true,
    note: 'Điểm xuất phát bút toán PURCHASE trên stock_ledger — không có tồn vật lý',
  },
  {
    code: 'PRODUCTION',
    name: 'Đang sản xuất (ảo)',
    isVirtual: true,
    note: 'Hàng đang trên chuyền — không có tồn vật lý',
  },
  {
    code: 'SCRAP',
    name: 'Phế liệu (ảo)',
    isVirtual: true,
    note: 'Điểm đến bút toán huỷ/phế — không có tồn vật lý',
  },
];

/**
 * 8 nhóm vật tư hệ thống bắt buộc phải seed sẵn - thay cho enum MaterialKind đã xoá (xem
 * material-group-system-keys.constant.ts). Trang Spec Sắt (Sắt/Dây/Đinh/Tán rút/Nút nhựa -
 * đều nhập chung trong 1 mảnh)/Sơn/Phụ kiện/Bao bì và skus.service.ts resolve group theo
 * `systemKey`, KHÔNG theo `name` - admin đổi tên nhóm trong Admin > Nhóm vật tư thoải mái
 * mà logic Spec vẫn đúng.
 */
const SEED_MATERIAL_GROUPS: { systemKey: MaterialGroupSystemKey; name: string }[] = [
  { systemKey: MATERIAL_GROUP_SYSTEM_KEYS.STEEL_BAR, name: 'Sắt' },
  { systemKey: MATERIAL_GROUP_SYSTEM_KEYS.WIRE, name: 'Dây' },
  { systemKey: MATERIAL_GROUP_SYSTEM_KEYS.NAIL, name: 'Đinh' },
  { systemKey: MATERIAL_GROUP_SYSTEM_KEYS.PAINT, name: 'Sơn' },
  { systemKey: MATERIAL_GROUP_SYSTEM_KEYS.ACCESSORY, name: 'Phụ kiện' },
  { systemKey: MATERIAL_GROUP_SYSTEM_KEYS.PACKAGING, name: 'Bao bì' },
  { systemKey: MATERIAL_GROUP_SYSTEM_KEYS.RIVET, name: 'Tán rút' },
  { systemKey: MATERIAL_GROUP_SYSTEM_KEYS.PLASTIC_BUTTON, name: 'Nút nhựa' },
];

async function main() {
  // 1-5. Permissions + Role + RolePermission - shared with the auto-sync that also runs on
  // every app boot (see main.ts), so this stays in lockstep even if someone forgets to re-run
  // this script after editing role-permissions.constant.ts (see src/common/rbac/sync-rbac.ts).
  await syncRbac(prisma);
  const admin = await prisma.role.findUniqueOrThrow({ where: { name: DEFAULT_ROLES.ADMIN } });

  // 6. SystemConfig singleton (id pinned to 1 by CHECK constraint).
  await prisma.systemConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, companyName: process.env.SEED_COMPANY_NAME ?? 'DNA ERP' },
  });

  // 7. Warehouses (Phase 2) — 6 vật lý + 3 ảo, seed cố định, không bao giờ xoá. Đặt trước
  // bước 8 (admin user) có chủ đích: danh mục/role không được phép phụ thuộc vào việc có
  // set SEED_ADMIN_EMAIL/PASSWORD hay không - 2 việc độc lập nhau.
  if (SEED_WAREHOUSES.length !== PROTECTED_WAREHOUSE_CODES.length) {
    throw new Error('SEED_WAREHOUSES phải khớp 1-1 với PROTECTED_WAREHOUSE_CODES');
  }
  for (const wh of SEED_WAREHOUSES) {
    if (!(PROTECTED_WAREHOUSE_CODES as readonly string[]).includes(wh.code)) {
      throw new Error(
        `SEED_WAREHOUSES có code lạ, không nằm trong PROTECTED_WAREHOUSE_CODES: ${wh.code}`,
      );
    }
    await prisma.warehouse.upsert({
      where: { code: wh.code },
      update: { name: wh.name, isVirtual: wh.isVirtual, note: wh.note },
      create: wh,
    });
  }

  // 7.5. Material groups hệ thống - cùng lý do đặt trước bước 8 như warehouses. KHÔNG dùng
  // upsert({ where: { systemKey } }) đơn giản: nếu nhóm đã tồn tại từ trước dưới đúng tên
  // mặc định (vd tạo tay qua Admin > Nhóm vật tư trước khi có systemKey) thì ADOPT (gán
  // systemKey vào, giữ nguyên id + mọi vật tư đang trỏ tới), không tạo trùng theo `name`
  // @unique. Nhóm đã có systemKey thì bỏ qua hẳn - KHÔNG ghi đè `name` mỗi lần chạy như
  // warehouse ở trên, vì sẽ xoá tác dụng nếu admin đã đổi tên hiển thị.
  if (SEED_MATERIAL_GROUPS.length !== Object.keys(MATERIAL_GROUP_SYSTEM_KEYS).length) {
    throw new Error('SEED_MATERIAL_GROUPS phải khớp 1-1 với MATERIAL_GROUP_SYSTEM_KEYS');
  }
  for (const g of SEED_MATERIAL_GROUPS) {
    const codePrefix = MATERIAL_GROUP_CODE_PREFIX[g.systemKey];
    const bySystemKey = await prisma.materialGroup.findUnique({
      where: { systemKey: g.systemKey },
    });
    if (bySystemKey) {
      // codePrefix cố định theo systemKey, không phải thứ admin tự sửa qua UI (khác `name`) -
      // đồng bộ lại nếu vì lý do gì đó lệch khỏi hằng số (vd sau backfill migration thủ công).
      if (bySystemKey.codePrefix !== codePrefix) {
        await prisma.materialGroup.update({ where: { id: bySystemKey.id }, data: { codePrefix } });
      }
      continue;
    }

    const byName = await prisma.materialGroup.findUnique({ where: { name: g.name } });
    if (byName) {
      await prisma.materialGroup.update({
        where: { id: byName.id },
        data: { systemKey: g.systemKey, codePrefix },
      });
    } else {
      await prisma.materialGroup.create({
        data: { name: g.name, systemKey: g.systemKey, codePrefix },
      });
    }
  }

  // 8. Super admin user.
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set to seed the admin user');
  }
  // Optional so existing deploys that haven't set this env var yet don't break;
  // falls back to the email's local-part (e.g. "admin@dna-erp.local" -> "admin").
  const adminUsername = process.env.SEED_ADMIN_USERNAME ?? adminEmail.split('@')[0];
  const hashedPassword = await argon2.hash(adminPassword);
  const user = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { username: adminUsername },
    create: {
      username: adminUsername,
      email: adminEmail,
      password: hashedPassword,
      firstName: 'Super',
      lastName: 'Admin',
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: admin.id } },
    update: {},
    create: { userId: user.id, roleId: admin.id },
  });

  const roleCount = 1 + Object.values(BUSINESS_ROLES).length; // ADMIN + business
  console.log(
    `Seed complete. Roles synced: ${roleCount}. Warehouses synced: ${SEED_WAREHOUSES.length}. Material groups synced: ${SEED_MATERIAL_GROUPS.length}. Admin: ${adminEmail}`,
  );
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
