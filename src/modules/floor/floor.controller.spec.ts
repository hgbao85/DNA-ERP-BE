import 'reflect-metadata';
import { ForbiddenException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MfgRole, PermissionAction } from '../../generated/prisma/client';
import { SEND_KCS_REMOVED_MESSAGE } from '../../common/constants/legacy-floor-report.constant';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { MFG_ROLE_KEY } from '../../common/decorators/require-mfg-role.decorator';
import {
  PERMISSIONS_KEY,
  RequiredPermission,
} from '../../common/decorators/require-permissions.decorator';
import { ROLE_KEY } from '../../common/decorators/require-role.decorator';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdvanceQueueDto, QueueWorkshopDto } from './dto/floor-queue.dto';
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

type PermissionModuleKey = (typeof PERMISSION_MODULES)[keyof typeof PERMISSION_MODULES];

interface Rule {
  action: PermissionAction;
  /** Module quyền; bỏ trống = FLOOR_REPORT (đa số route /floor/*). */
  module?: PermissionModuleKey;
  /** Vai trò (tên Role) được gọi; bỏ trống = không giới hạn theo tên vai trò. */
  roles?: string[];
  /** mfgRole được gọi; bỏ trống = không giới hạn theo mfgRole. */
  mfg?: MfgRole[];
}

const { VIEW, CREATE, UPDATE, DELETE, APPROVE } = PermissionAction;
const qlsx = (action: PermissionAction): Rule => ({ action, roles: [QLSX] });
const qlsxAdmin = (action: PermissionAction): Rule => ({
  action,
  roles: [QLSX, DEFAULT_ROLES.ADMIN],
});
/** Route ghi được mở cho Admin (21/11/2026): chỉ phần Máy & tem QR. */
const ADMIN_WRITE_ROUTES = [
  'POST workstations',
  'PATCH workstations/:id',
  'POST workstations/:id/regenerate-token',
];
/** KCS chốt để chấm (P1): quyền chấm QC_REVIEW:CREATE + chỉ tài khoản KCS_STAFF. */
const kcsClose: Rule = {
  module: PERMISSION_MODULES.QC_REVIEW,
  action: CREATE,
  roles: [BUSINESS_ROLES.KCS_STAFF],
};

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
  // đo năng suất máy cắt (C4a, 14/11/2026): cùng quyền với stats, chỉ đọc
  'GET stats/cut-machines': {
    action: VIEW,
    roles: [QLSX, BUSINESS_ROLES.BOSS, DEFAULT_ROLES.ADMIN],
  },
  // QLSX
  'GET summary': qlsx(VIEW),
  // Máy & tem QR: QLSX + Admin (21/11/2026 - Admin cũng thêm / đổi mã / tắt máy được)
  'GET settings': qlsxAdmin(VIEW),
  'GET workstations': qlsxAdmin(VIEW),
  'POST workstations': qlsxAdmin(CREATE),
  'PATCH workstations/:id': qlsxAdmin(UPDATE),
  'POST workstations/:id/regenerate-token': qlsxAdmin(UPDATE),
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
  // chia máy cắt (B1, 13/11/2026)
  'GET cut-allocation': qlsx(VIEW),
  'GET cut-allocation/log': qlsx(VIEW), // nhật ký điều chuyển (C, 14/11/2026)
  'POST cut-allocation/auto': qlsx(CREATE),
  'POST cut-allocation/add': qlsx(CREATE),
  'POST cut-allocation/reorder': qlsx(UPDATE),
  'PATCH cut-allocation/:id': qlsx(UPDATE),
  'POST cut-allocation/:id/split': qlsx(CREATE),
  'DELETE cut-allocation/:id': qlsx(DELETE),
  // KCS xem đợt đang mở để chấm (P1): QLSX + KCS_STAFF, không lọc xưởng với KCS
  'GET review': { action: VIEW, roles: [QLSX, BUSINESS_ROLES.KCS_STAFF] },
  'POST review/cut-bundles/:id/send-kcs': qlsx(APPROVE),
  'POST review/production-batches/:id/send-kcs': qlsx(APPROVE),
  'POST review/step-groups/send-kcs': qlsx(APPROVE),
  'POST reports/:id/reverse': qlsx(UPDATE),
  // KCS tự chốt để chấm (P1, 18/11/2026) - 5 loại đợt
  'POST kcs/cut-bundles/:id/close': kcsClose,
  'POST kcs/step-groups/close': kcsClose,
  'POST kcs/production-batches/:id/close': kcsClose,
  'POST kcs/piece-step-groups/close': kcsClose,
  'POST kcs/material-yield-groups/close': kcsClose,
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
      { module: rule.module ?? PERMISSION_MODULES.FLOOR_REPORT, action: rule.action },
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

  it('Giám đốc (BOSS) chỉ được ĐỌC; Admin chỉ ghi được phần Máy & tem QR', () => {
    for (const [key, rule] of Object.entries(MATRIX)) {
      const roles = rule.roles ?? [];
      if (roles.includes(BUSINESS_ROLES.BOSS))
        expect({ key, method: key.split(' ')[0] }).toEqual({ key, method: 'GET' });
      if (roles.includes(DEFAULT_ROLES.ADMIN) && !ADMIN_WRITE_ROUTES.includes(key))
        expect({ key, method: key.split(' ')[0] }).toEqual({ key, method: 'GET' });
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

describe('FloorController - KCS xem / chốt, QLSX bỏ gửi KCS (P1)', () => {
  let review: Record<string, jest.Mock>;
  let controller: FloorController;

  beforeEach(() => {
    review = {
      listOpen: jest.fn().mockResolvedValue({ cutBundles: [] }),
      closeCutBundle: jest.fn().mockResolvedValue({ id: '1' }),
      closeStepGroup: jest.fn().mockResolvedValue({ id: '2' }),
      closeProductionBatch: jest.fn().mockResolvedValue({ id: '3' }),
      closePieceStepGroup: jest.fn().mockResolvedValue({ id: '4' }),
      closeMaterialYieldGroup: jest.fn().mockResolvedValue({ id: '5' }),
    };
    controller = new FloorController(
      {} as never,
      {} as never,
      review as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('3 route send-kcs cũ: trả 403 đúng câu SEND_KCS_REMOVED_MESSAGE, không gọi service', () => {
    for (const call of [
      () => controller.sendCutBundle(),
      () => controller.sendProductionBatch(),
      () => controller.sendStepGroup(),
    ]) {
      expect(call).toThrow(ForbiddenException);
      expect(call).toThrow(SEND_KCS_REMOVED_MESSAGE);
    }
    expect(Object.values(review).every((m) => m.mock.calls.length === 0)).toBe(true);
  });

  it('GET review: QLSX (kể cả vừa QLSX vừa KCS) lọc xưởng; KCS không có vai QLSX thì KHÔNG lọc xưởng', async () => {
    await controller.listOpen({ stage: 'PHOI' }, 'u1', [QLSX]);
    expect(review.listOpen).toHaveBeenLastCalledWith('PHOI', undefined, 'u1', true);
    await controller.listOpen({ stage: 'HAN', productionInvoiceId: '9' }, 'u2', [
      QLSX,
      BUSINESS_ROLES.KCS_STAFF,
    ]);
    expect(review.listOpen).toHaveBeenLastCalledWith('HAN', '9', 'u2', true);
    await controller.listOpen({ stage: 'SON' }, 'u3', [BUSINESS_ROLES.KCS_STAFF]);
    expect(review.listOpen).toHaveBeenLastCalledWith('SON', undefined, 'u3', false);
  });

  it('5 route close chuyển đúng body + người chốt cho FloorReviewService', async () => {
    await controller.closeCutBundle('11', 'k1');
    expect(review.closeCutBundle).toHaveBeenCalledWith('11', 'k1');
    const stepDto = {
      productionInvoiceId: '1',
      materialId: '2',
      step: 'UON',
      productionOrderId: null,
      workerId: null,
    } as never;
    await controller.closeStepGroup(stepDto, 'k1');
    expect(review.closeStepGroup).toHaveBeenCalledWith(stepDto, 'k1');
    await controller.closeProductionBatch('12', 'k1');
    expect(review.closeProductionBatch).toHaveBeenCalledWith('12', 'k1');
    const pieceDto = { productionOrderId: '3', pieceId: '4', step: 'UON' } as never;
    await controller.closePieceStepGroup(pieceDto, 'k1');
    expect(review.closePieceStepGroup).toHaveBeenCalledWith(pieceDto, 'k1');
    const yieldDto = { productionInvoiceId: '5', recipeId: '6', step: 'DAP' } as never;
    await controller.closeMaterialYieldGroup(yieldDto, 'k1');
    expect(review.closeMaterialYieldGroup).toHaveBeenCalledWith(yieldDto, 'k1');
  });
});

describe('FloorController - chia máy cắt + Chuyển lệnh tiếp', () => {
  const board = { workshop: { id: '5' }, rows: [], warnings: [] };
  const allocated = [{ productionInvoiceId: '100', piCode: 'PI-100', steelGaps: [] }];
  let admin: { advance: jest.Mock };
  let cutAllocation: { auto: jest.Mock; add: jest.Mock };
  let followUp: { afterAllocated: jest.Mock };
  let controller: FloorController;

  beforeEach(() => {
    admin = { advance: jest.fn().mockResolvedValue('queue') };
    cutAllocation = {
      auto: jest.fn().mockResolvedValue({ board, allocated }),
      add: jest.fn().mockResolvedValue({ board, allocated }),
    };
    followUp = { afterAllocated: jest.fn().mockResolvedValue(undefined) };
    controller = new FloorController(
      admin as never,
      {} as never,
      {} as never,
      {} as never,
      cutAllocation as never,
      followUp as never,
      {} as never,
    );
  });

  it('auto: chia xong gọi follow-up (source MANUAL) rồi chỉ trả board', async () => {
    const dto = { workshopId: '5', mode: 'append' } as never;
    expect(await controller.cutAllocationAuto(dto, 'u1')).toBe(board);
    expect(cutAllocation.auto).toHaveBeenCalledWith('u1', dto);
    expect(followUp.afterAllocated).toHaveBeenCalledWith({
      workshopId: '5',
      orders: allocated,
      source: 'MANUAL',
    });
  });

  it('add: chia xong gọi follow-up (source MANUAL) rồi chỉ trả board (không có allocated)', async () => {
    const dto = { workshopId: '5', productionInvoiceId: '100', materialId: '7' } as never;
    const res = await controller.cutAllocationAdd(dto, 'u1');
    expect(res).toBe(board);
    expect(res).not.toHaveProperty('allocated');
    expect(followUp.afterAllocated).toHaveBeenCalledWith({
      workshopId: '5',
      orders: allocated,
      source: 'MANUAL',
    });
  });

  it('chia lỗi (400 lệnh chưa Bắt đầu) -> không gọi follow-up', async () => {
    cutAllocation.add.mockRejectedValue(new Error('chưa Bắt đầu'));
    await expect(controller.cutAllocationAdd({} as never, 'u1')).rejects.toThrow('chưa Bắt đầu');
    expect(followUp.afterAllocated).not.toHaveBeenCalled();
  });

  it('advance truyền expectedRunningPiId xuống service (null vẫn giữ là null, không gửi = undefined)', async () => {
    await controller.advance('PHOI', 'u1', { workshopId: '5', expectedRunningPiId: '10' });
    expect(admin.advance).toHaveBeenLastCalledWith('PHOI', 'u1', '5', '10');
    await controller.advance('PHOI', 'u1', { workshopId: '5', expectedRunningPiId: null });
    expect(admin.advance).toHaveBeenLastCalledWith('PHOI', 'u1', '5', null);
    await controller.advance('HAN', 'u1', { workshopId: '5' });
    expect(admin.advance).toHaveBeenLastCalledWith('HAN', 'u1', '5', undefined);
  });
});

describe('AdvanceQueueDto (validate)', () => {
  const check = async (body: unknown) => {
    const dto = plainToInstance(AdvanceQueueDto, body);
    return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  };

  it('nhận expectedRunningPiId dạng chuỗi số, null, hoặc không gửi', async () => {
    expect(await check({ workshopId: '5', expectedRunningPiId: '10' })).toEqual([]);
    expect(await check({ expectedRunningPiId: null })).toEqual([]);
    expect(await check({})).toEqual([]);
  });

  it('chuỗi không phải số -> lỗi; reopen (QueueWorkshopDto) không nhận trường này', async () => {
    expect(await check({ expectedRunningPiId: 'abc' })).not.toEqual([]);
    const reopen = plainToInstance(QueueWorkshopDto, { expectedRunningPiId: '1' });
    expect(await validate(reopen, { whitelist: true, forbidNonWhitelisted: true })).not.toEqual([]);
  });
});
