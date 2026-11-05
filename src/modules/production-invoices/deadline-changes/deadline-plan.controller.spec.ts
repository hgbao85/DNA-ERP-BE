/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any -- prisma/port/response mock */
import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PermissionAction } from '../../../generated/prisma/client';
import { PERMISSIONS_KEY } from '../../../common/decorators/require-permissions.decorator';
import { ROLE_KEY } from '../../../common/decorators/require-role.decorator';
import { PERMISSION_MODULES } from '../../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../../common/constants/roles.constant';
import { CommitDeadlinePlanDto, DeadlinePlanController } from './deadline-plan.controller';

describe('DeadlinePlanController', () => {
  const reflector = new Reflector();
  const proto = DeadlinePlanController.prototype;
  const meta = <T>(key: string, handler: (...args: never[]) => unknown) =>
    reflector.get<T>(key, handler);

  const excel = { exportPlan: jest.fn(), preview: jest.fn() };
  const port = { saveEntries: jest.fn() };
  const controller = new DeadlinePlanController(excel as any, port as any);
  const user = { id: 'u1', roles: ['PRODUCTION_PLANNER'] } as any;

  beforeEach(() => jest.clearAllMocks());

  it('export: VIEW + (KHSX, ADMIN, BOSS)', () => {
    expect(meta(PERMISSIONS_KEY, proto.exportPlan)).toEqual([
      { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action: PermissionAction.VIEW },
    ]);
    expect(meta(ROLE_KEY, proto.exportPlan)).toEqual([
      BUSINESS_ROLES.PRODUCTION_PLANNER,
      DEFAULT_ROLES.ADMIN,
      BUSINESS_ROLES.BOSS,
    ]);
  });

  it('preview + commit: UPDATE + (KHSX, ADMIN) - Sếp không sửa', () => {
    for (const h of [proto.preview, proto.commit]) {
      expect(meta(PERMISSIONS_KEY, h)).toEqual([
        { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action: PermissionAction.UPDATE },
      ]);
      expect(meta(ROLE_KEY, h)).toEqual([BUSINESS_ROLES.PRODUCTION_PLANNER, DEFAULT_ROLES.ADMIN]);
    }
  });

  describe('export', () => {
    const res = () => {
      const r: any = {};
      r.status = jest.fn(() => r);
      r.set = jest.fn(() => r);
      r.end = jest.fn(() => r);
      return r;
    };

    it('trả file nhị phân thẳng (không bọc), có Content-Disposition; scope mặc định all', async () => {
      const buf = Buffer.from('xlsx');
      excel.exportPlan.mockResolvedValue({
        fileName: 'ke-hoach-san-xuat-20261105-1000.xlsx',
        buffer: buf,
      });
      const r = res();
      await controller.exportPlan(undefined, r);
      expect(excel.exportPlan).toHaveBeenCalledWith('all');
      expect(r.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Disposition': 'attachment; filename="ke-hoach-san-xuat-20261105-1000.xlsx"',
          'Access-Control-Expose-Headers': 'Content-Disposition',
        }),
      );
      expect(r.end).toHaveBeenCalledWith(buf);
    });

    it('scope=approved chuyển xuống; scope lạ => 400', async () => {
      excel.exportPlan.mockResolvedValue({ fileName: 'a.xlsx', buffer: Buffer.alloc(1) });
      await controller.exportPlan('approved', res());
      expect(excel.exportPlan).toHaveBeenCalledWith('approved');
      await expect(controller.exportPlan('zzz', res())).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('preview', () => {
    it('thiếu file / sai đuôi => 400; hợp lệ chuyển buffer + tên file', async () => {
      expect(() => controller.preview(undefined)).toThrow(BadRequestException);
      expect(() =>
        controller.preview({ originalname: 'a.xls', buffer: Buffer.alloc(1) } as any),
      ).toThrow(BadRequestException);
      excel.preview.mockResolvedValue({ ok: true });
      const buf = Buffer.from('x');
      await controller.preview({ originalname: 'Kế hoạch.XLSX', buffer: buf } as any);
      expect(excel.preview).toHaveBeenCalledWith(buf, 'Kế hoạch.XLSX');
    });
  });

  describe('commit', () => {
    const dto = {
      fileName: 'a.xlsx',
      items: [{ itemId: '1', newValues: { materialDeadline: '2026-11-10' } }],
    } as any;

    it('thiếu Idempotency-Key => 400, không ghi', () => {
      expect(() => controller.commit(dto, user, undefined)).toThrow(BadRequestException);
      expect(() => controller.commit(dto, user, '  ')).toThrow(BadRequestException);
      expect(port.saveEntries).not.toHaveBeenCalled();
    });

    it('gọi saveEntries(EXCEL, strict=false, note, idempotencyKey)', async () => {
      port.saveEntries.mockResolvedValue({ applied: [], batch: null, skipped: [] });
      await controller.commit(dto, user, 'key-1');
      expect(port.saveEntries).toHaveBeenCalledWith(
        { id: 'u1', roles: ['PRODUCTION_PLANNER'] },
        dto.items,
        'EXCEL',
        { strict: false, note: 'Excel: a.xlsx', idempotencyKey: 'key-1' },
      );
    });
  });

  describe('CommitDeadlinePlanDto', () => {
    const check = (plain: unknown) =>
      validate(plainToInstance(CommitDeadlinePlanDto, plain), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

    it('hợp lệ', async () => {
      expect(
        await check({
          fileName: 'a.xlsx',
          items: [
            {
              itemId: '12',
              newValues: { 'stage.FRAME': '2026-11-10' },
              expectedOld: { 'stage.FRAME': null },
            },
          ],
        }),
      ).toHaveLength(0);
    });

    it.each([
      ['itemId không phải số', { itemId: 'abc', newValues: { materialDeadline: '2026-11-10' } }],
      ['ngày sai định dạng', { itemId: '1', newValues: { materialDeadline: '10/11/2026' } }],
      ['ngày không có thật', { itemId: '1', newValues: { materialDeadline: '2026-02-31' } }],
      ['khoá mốc lạ', { itemId: '1', newValues: { deliveryDeadline: '2026-11-10' } }],
    ])('từ chối: %s', async (_name, item) => {
      expect((await check({ fileName: 'a.xlsx', items: [item] })).length).toBeGreaterThan(0);
    });

    it('từ chối quá 2.000 dòng và danh sách rỗng', async () => {
      const item = { itemId: '1', newValues: { materialDeadline: '2026-11-10' } };
      expect(
        (await check({ fileName: 'a.xlsx', items: Array(2001).fill(item) })).length,
      ).toBeGreaterThan(0);
      expect((await check({ fileName: 'a.xlsx', items: [] })).length).toBeGreaterThan(0);
    });
  });
});
