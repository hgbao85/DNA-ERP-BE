/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-floating-promises -- đọc metadata decorator từ prototype; service mock trả undefined */
import { Reflector } from '@nestjs/core';
import { MfgRole, PermissionAction } from '../../generated/prisma/client';
import { MFG_ROLE_KEY } from '../../common/decorators/require-mfg-role.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { ROLE_KEY } from '../../common/decorators/require-role.decorator';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { ProductionInvoicesController } from './production-invoices.controller';
import { ProductionInvoicesService } from './production-invoices.service';
import { PieceMaterialYieldPurchaseService } from './piece-material-yield-purchase.service';

/** Phần A – Đợt 2: kiểm metadata quyền của 2 route mới (số LSX, đổi xưởng) và việc truyền workshopId/roles xuống service. */
describe('ProductionInvoicesController (Phần A – Đợt 2)', () => {
  const reflector = new Reflector();
  const proto = ProductionInvoicesController.prototype;
  const meta = <T>(key: string, handler: (...args: never[]) => unknown): T | undefined =>
    reflector.get<T>(key, handler);

  it('PATCH :id/items/:itemId/lsx - UPDATE + (KHSX hoặc ADMIN)', () => {
    expect(meta(PERMISSIONS_KEY, proto.updateItemLsx)).toEqual([
      { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action: PermissionAction.UPDATE },
    ]);
    expect(meta(ROLE_KEY, proto.updateItemLsx)).toEqual([
      BUSINESS_ROLES.PRODUCTION_PLANNER,
      DEFAULT_ROLES.ADMIN,
    ]);
  });

  it('PATCH :id/workshop - APPROVE + mfgRole PRODUCTION_MANAGER (giống send-to-boss)', () => {
    expect(meta(PERMISSIONS_KEY, proto.changeWorkshop)).toEqual([
      { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action: PermissionAction.APPROVE },
    ]);
    expect(meta(MFG_ROLE_KEY, proto.changeWorkshop)).toEqual([MfgRole.PRODUCTION_MANAGER]);
    expect(meta(MFG_ROLE_KEY, proto.sendItemToBoss)).toEqual(
      meta(MFG_ROLE_KEY, proto.changeWorkshop),
    );
  });

  describe('truyền tham số xuống service', () => {
    const service = {
      updateItemLsx: jest.fn(),
      changeWorkshop: jest.fn(),
      sendItemToBoss: jest.fn(),
      sendBatchToBoss: jest.fn(),
    };
    const controller = new ProductionInvoicesController(
      service as unknown as ProductionInvoicesService,
      {} as PieceMaterialYieldPurchaseService,
    );

    it('updateItemLsx truyền id + roles của người gọi', () => {
      controller.updateItemLsx('7', '20', { lsxCode: 'MY-313' }, {
        id: 'u1',
        roles: ['ADMIN'],
      } as never);
      expect(service.updateItemLsx).toHaveBeenCalledWith('7', '20', 'MY-313', {
        id: 'u1',
        roles: ['ADMIN'],
      });
    });

    it('changeWorkshop / send-to-boss / send-to-boss-batch truyền workshopId', () => {
      controller.changeWorkshop('7', { workshopId: '4', reason: 'quá tải' }, 'u1');
      expect(service.changeWorkshop).toHaveBeenCalledWith('7', '4', 'quá tải', 'u1');

      controller.sendItemToBoss(
        '7',
        '20',
        { warehouseCode: 'tp', warehouseName: 'Kho', workshopId: '3' },
        'u1',
      );
      expect(service.sendItemToBoss).toHaveBeenCalledWith('7', '20', 'tp', 'Kho', '3', 'u1');

      controller.sendBatchToBoss(
        '7',
        { warehouseCode: 'tp', warehouseName: 'Kho', workshopId: '3', itemIds: ['20'] },
        'u1',
      );
      expect(service.sendBatchToBoss).toHaveBeenCalledWith('7', 'tp', 'Kho', '3', 'u1', ['20']);
    });
  });
});
