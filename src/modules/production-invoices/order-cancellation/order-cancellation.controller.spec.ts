import 'reflect-metadata';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../../common/constants/roles.constant';
import { ROLE_KEY } from '../../../common/decorators/require-role.decorator';
import { OrderCancellationController } from './order-cancellation.controller';

/**
 * Gác vai của 2 route "Hàng của SKU đã huỷ" (Q5/Q6, 24/11/2026). 26/11/2026: Sếp được XEM (GET goods) nhưng KHÔNG được chuyển
 * hàng (POST :id/transfer-goods) - chuyển hàng là việc của KHSX và Admin.
 */
describe('OrderCancellationController - vai của hàng SKU đã huỷ', () => {
  const proto = OrderCancellationController.prototype as unknown as Record<string, object>;
  const rolesOf = (handler: string) =>
    (Reflect.getMetadata(ROLE_KEY, proto[handler]) ?? []) as string[];

  it('GET goods: KHSX, Sếp, Admin đều xem được', () => {
    const roles = rolesOf('listGoods');
    expect(roles).toEqual(
      expect.arrayContaining([
        BUSINESS_ROLES.PRODUCTION_PLANNER,
        BUSINESS_ROLES.BOSS,
        DEFAULT_ROLES.ADMIN,
      ]),
    );
    expect(roles).toHaveLength(3);
  });

  it('POST transfer-goods: vẫn chỉ KHSX và Admin, Sếp KHÔNG chuyển được', () => {
    const roles = rolesOf('transferGoods');
    expect(roles).toEqual([BUSINESS_ROLES.PRODUCTION_PLANNER, DEFAULT_ROLES.ADMIN]);
    expect(roles).not.toContain(BUSINESS_ROLES.BOSS);
  });
});
