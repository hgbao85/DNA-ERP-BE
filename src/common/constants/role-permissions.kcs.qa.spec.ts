import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from './permission-modules.constant';
import { ROLE_GRANTS } from './role-permissions.constant';
import { BUSINESS_ROLES } from './roles.constant';

/**
 * P1 (18/11/2026) - UB10b: KCS_STAFF có FLOOR_REPORT:VIEW, KHÔNG có CREATE (AC3);
 * quyền FLOOR_REPORT của mọi vai khác giữ nguyên như bản chụp trước P1.
 * Test thuần, không DB.
 */
const ALL_ACTIONS = Object.values(PermissionAction) as string[];

type AnyGrant = { module: string; actions: string[] | 'ALL' };

/** Gộp mọi grant FLOOR_REPORT của 1 vai thành danh sách action (đã sắp xếp, bỏ trùng). */
function floorReportActions(role: string): string[] {
  const grants = (ROLE_GRANTS as Record<string, AnyGrant[] | undefined>)[role] ?? [];
  const set = new Set<string>();
  for (const g of grants) {
    if (g.module !== PERMISSION_MODULES.FLOOR_REPORT) continue;
    for (const a of g.actions === 'ALL' ? ALL_ACTIONS : g.actions) set.add(a);
  }
  return [...set].sort();
}

describe('P1 UB10b - quyền FLOOR_REPORT của KCS_STAFF (AC3)', () => {
  it('AC3: KCS_STAFF có FLOOR_REPORT:VIEW', () => {
    expect(floorReportActions(BUSINESS_ROLES.KCS_STAFF)).toContain('VIEW');
  });

  it('AC3: KCS_STAFF KHÔNG có FLOOR_REPORT:CREATE (chỉ đúng VIEW)', () => {
    const actions = floorReportActions(BUSINESS_ROLES.KCS_STAFF);
    expect(actions).not.toContain('CREATE');
    expect(actions).toEqual(['VIEW']);
  });

  it('AC3: các quyền KCS_STAFF có từ trước vẫn còn (QC_REVIEW CRU, PRODUCTION_BATCH)', () => {
    const grants = ROLE_GRANTS[BUSINESS_ROLES.KCS_STAFF] ?? [];
    const qc = grants.find((g) => g.module === PERMISSION_MODULES.QC_REVIEW);
    expect(qc?.actions).toEqual(
      expect.arrayContaining([
        PermissionAction.CREATE,
        PermissionAction.VIEW,
        PermissionAction.UPDATE,
      ]),
    );
    expect(grants.some((g) => g.module === PERMISSION_MODULES.PRODUCTION_BATCH)).toBe(true);
  });
});

describe('P1 UB10b - quyền FLOOR_REPORT các vai khác không đổi (mốc trước P1)', () => {
  const baseline: Record<string, string[]> = {
    [BUSINESS_ROLES.PRODUCTION_MANAGER]: ['APPROVE', 'CREATE', 'DELETE', 'UPDATE', 'VIEW'],
    [BUSINESS_ROLES.PHOI_STAFF]: ['CREATE', 'VIEW'],
    [BUSINESS_ROLES.HAN_STAFF]: ['CREATE', 'VIEW'],
    [BUSINESS_ROLES.SON_STAFF]: ['CREATE', 'VIEW'],
    [BUSINESS_ROLES.FLOOR_WORKER]: ['CREATE', 'VIEW'],
  };

  it.each(Object.entries(baseline))('vai %s giữ nguyên FLOOR_REPORT', (role, expected) => {
    expect(floorReportActions(role)).toEqual(expected);
  });

  it('mọi vai còn lại (trừ KCS_STAFF) vẫn KHÔNG có FLOOR_REPORT', () => {
    const others = Object.keys(ROLE_GRANTS).filter(
      (r) => r !== BUSINESS_ROLES.KCS_STAFF && !(r in baseline),
    );
    expect(others.length).toBeGreaterThan(0);
    for (const role of others) {
      expect({ role, actions: floorReportActions(role) }).toEqual({ role, actions: [] });
    }
  });
});
