import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MfgRole, PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { MFG_ROLE_KEY } from '../../common/decorators/require-mfg-role.decorator';
import {
  PERMISSIONS_KEY,
  RequiredPermission,
} from '../../common/decorators/require-permissions.decorator';
import { ROLE_KEY } from '../../common/decorators/require-role.decorator';
import { FloorController } from './floor.controller';

/**
 * Ma trận phân quyền của TOÀN BỘ route `/floor/*` (QR tại máy).
 *
 * Vì sao cần: các guard toàn cục (Permissions/Role/MfgRole) là no-op khi route không gắn metadata, nên một route mới quên
 * `@RequirePermissions`/`@RequireRole` sẽ MỞ cho mọi tài khoản đã đăng nhập (kể cả công nhân xưởng) mà không test nào
 * báo. Test này khoá từng route với quyền/vai trò đúng, và bắt buộc ai thêm/xoá route phải cập nhật ma trận này.
 */

const QLSX = BUSINESS_ROLES.PRODUCTION_MANAGER;
const FLOOR_MFG = [MfgRole.PHOI, MfgRole.HAN, MfgRole.SON];

interface Rule {
  action: PermissionAction;
  /** Vai trò (tên Role) được gọi; bỏ trống = không giới hạn theo tên vai trò. */
  roles?: string[];
  /** mfgRole được gọi; bỏ trống = không giới hạn theo mfgRole. */
  mfg?: MfgRole[];
}

const { VIEW, CREATE, UPDATE, DELETE, APPROVE } = PermissionAction;
const qlsx = (action: PermissionAction): Rule => ({ action, roles: [QLSX] });

const MATRIX: Record<string, Rule> = {
  // công nhân: quét mã tại máy (chỉ tổ Phôi/Hàn/Sơn) - sắt chỉ Phôi nhận
  'GET scan/:token': { action: VIEW, mfg: FLOOR_MFG },
  'POST scan/:token/reports': { action: CREATE, mfg: FLOOR_MFG },
  'POST scan/:token/steel-issues/:id/receive': { action: CREATE, mfg: [MfgRole.PHOI] },
  // số của CHÍNH người gọi (id lấy từ token) nên không cần giới hạn vai trò
  'GET my-output': { action: VIEW },
  'GET my-stats': { action: VIEW },
  // báo cáo toàn xưởng: QLSX + Giám đốc + Admin (chỉ đọc); công nhân không gọi được
  'GET stats': { action: VIEW, roles: [QLSX, BUSINESS_ROLES.BOSS, DEFAULT_ROLES.ADMIN] },
  // QLSX
  'GET summary': qlsx(VIEW),
  'GET settings': qlsx(VIEW),
  'GET workstations': qlsx(VIEW),
  'POST workstations': qlsx(CREATE),
  'PATCH workstations/:id': qlsx(UPDATE),
  'POST workstations/:id/regenerate-token': qlsx(UPDATE),
  'GET workers': qlsx(VIEW),
  'POST workers': qlsx(CREATE),
  'PATCH workers/:id': qlsx(UPDATE),
  'POST workers/:id/reset-pin': qlsx(UPDATE),
  'POST workers/:id/unlock': qlsx(UPDATE),
  'GET queue': qlsx(VIEW),
  'GET queue/candidates': qlsx(VIEW),
  'POST queue': qlsx(CREATE),
  'POST queue/:stage/reorder': qlsx(UPDATE),
  'POST queue/:stage/advance': qlsx(UPDATE),
  'POST queue/:stage/reopen': qlsx(UPDATE),
  'GET queue/:stage/detail/:productionInvoiceId': qlsx(VIEW),
  'DELETE queue/:id': qlsx(DELETE),
  'GET review': qlsx(VIEW),
  'POST review/cut-bundles/:id/send-kcs': qlsx(APPROVE),
  'POST review/production-batches/:id/send-kcs': qlsx(APPROVE),
  'POST review/step-groups/send-kcs': qlsx(APPROVE),
  'POST reports/:id/reverse': qlsx(UPDATE),
};

function routes(): Map<string, object> {
  const found = new Map<string, object>();
  const proto = FloorController.prototype as unknown as Record<string, object>;
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor') continue;
    const handler = proto[name];
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
    if (method === undefined) continue;
    found.set(
      `${RequestMethod[method]} ${Reflect.getMetadata(PATH_METADATA, handler) as string}`,
      handler,
    );
  }
  return found;
}

const ROUTES = routes();

describe('FloorController - ma trận phân quyền', () => {
  it('có đúng các route trong ma trận (thêm/xoá route phải cập nhật ma trận này)', () => {
    expect([...ROUTES.keys()].sort()).toEqual(Object.keys(MATRIX).sort());
  });

  it.each(Object.entries(MATRIX))('%s', (key, rule) => {
    const handler = ROUTES.get(key) as object;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([
      { module: PERMISSION_MODULES.FLOOR_REPORT, action: rule.action },
    ] satisfies RequiredPermission[]);
    expect(Reflect.getMetadata(ROLE_KEY, handler)).toEqual(rule.roles);
    expect(Reflect.getMetadata(MFG_ROLE_KEY, handler)).toEqual(rule.mfg);
  });

  it('không route nào (và không cả controller) là @Public - mọi route cần đăng nhập', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, FloorController)).toBeUndefined();
    for (const handler of ROUTES.values())
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
  });

  it('GET chỉ cần quyền VIEW; POST/PATCH/DELETE không bao giờ chỉ cần VIEW (người chỉ xem không ghi được)', () => {
    for (const [key, rule] of Object.entries(MATRIX)) {
      if (key.startsWith('GET '))
        expect({ key, action: rule.action }).toEqual({ key, action: VIEW });
      else expect({ key, isView: rule.action === VIEW }).toEqual({ key, isView: false });
    }
  });

  it('Giám đốc (BOSS) và Admin chỉ được ĐỌC báo cáo - không route ghi nào mở cho họ', () => {
    const readOnlyRoles = [BUSINESS_ROLES.BOSS, DEFAULT_ROLES.ADMIN] as string[];
    for (const [key, rule] of Object.entries(MATRIX)) {
      const opened = (rule.roles ?? []).filter((r) => readOnlyRoles.includes(r));
      if (opened.length) expect({ key, method: key.split(' ')[0] }).toEqual({ key, method: 'GET' });
    }
  });

  it('route công nhân (scan/*) không đòi vai trò QLSX, route QLSX không mở cho theo mfgRole', () => {
    for (const [key, rule] of Object.entries(MATRIX)) {
      if (key.includes('scan/')) {
        expect({ key, roles: rule.roles }).toEqual({ key, roles: undefined });
        expect({ key, hasMfg: !!rule.mfg }).toEqual({ key, hasMfg: true });
      } else if (rule.roles?.includes(QLSX)) {
        expect({ key, mfg: rule.mfg }).toEqual({ key, mfg: undefined });
      }
    }
  });
});
