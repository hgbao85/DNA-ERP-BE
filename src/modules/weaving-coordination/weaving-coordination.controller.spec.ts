import { ROLE_KEY } from '../../common/decorators/require-role.decorator';
import { WeavingCoordinationController } from './weaving-coordination.controller';

describe('WeavingCoordinationController - quyền route', () => {
  const proto = WeavingCoordinationController.prototype as unknown as Record<string, object>;
  const roles = (name: string) =>
    Reflect.getMetadata(ROLE_KEY, proto[name]) as string[] | undefined;

  it('ghi chú (POST) chỉ Admin + Điều phối đan; bảng / lịch sử không chặn vai (chỉ cần WEAVING_ISSUE:VIEW)', () => {
    expect(roles('createFollowUp')).toEqual(['ADMIN', 'WEAVING_COORDINATOR']);
    expect(roles('board')).toBeUndefined();
    expect(roles('followUps')).toBeUndefined();
  });
});
