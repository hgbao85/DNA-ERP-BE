import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { NetworkAccessGuard } from './network-access.guard';
import { NetworkAccessService } from './network-access.service';

describe('NetworkAccessGuard', () => {
  let network: { assertAccountAllowed: jest.Mock };
  let guard: NetworkAccessGuard;

  const ctx = (req: Record<string, unknown>) =>
    ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;

  beforeEach(() => {
    network = { assertAccountAllowed: jest.fn().mockResolvedValue(undefined) };
    guard = new NetworkAccessGuard(network as unknown as NetworkAccessService);
  });

  it('route công khai (chưa có user, vd đăng nhập) -> bỏ qua, không kiểm tra gì', async () => {
    expect(await guard.canActivate(ctx({ ip: '8.8.8.8' }))).toBe(true);
    expect(network.assertAccountAllowed).not.toHaveBeenCalled();
  });

  it('có user: kiểm tra theo vai trò + IP của request', async () => {
    const user = { id: 'u', roles: ['FLOOR_WORKER'], mfgRole: 'PHOI' };
    expect(await guard.canActivate(ctx({ user, ip: '203.0.113.5' }))).toBe(true);
    expect(network.assertAccountAllowed).toHaveBeenCalledWith(user, '203.0.113.5');
  });

  it('ngoài mạng công ty -> 403 lan ra (request bị chặn)', async () => {
    network.assertAccountAllowed.mockRejectedValue(new ForbiddenException('ngoài mạng'));
    await expect(
      guard.canActivate(ctx({ user: { roles: ['FLOOR_WORKER'], mfgRole: 'PHOI' }, ip: '8.8.8.8' })),
    ).rejects.toThrow(ForbiddenException);
  });
});
