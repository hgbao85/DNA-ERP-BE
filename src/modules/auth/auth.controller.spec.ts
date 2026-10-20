/* eslint-disable @typescript-eslint/unbound-method --
   Đọc metadata (Reflect) gắn trên hàm xử lý route, không bao giờ gọi hàm - cùng cách `materials.controller.spec.ts`. */
import 'reflect-metadata';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AuthController } from './auth.controller';

/**
 * Bề mặt KHÔNG cần đăng nhập của app công nhân (đăng nhập / đặt PIN lần đầu / hỏi trạng thái PIN) và giới hạn tần suất
 * của nó. Người dùng đã CHỐT giữ 8 lần/phút/IP cho đăng nhập + đặt PIN (2026-10-15, mỗi công nhân 1 điện thoại + 1 tài khoản)
 * - test này khoá con số đó và bắt buộc ai đổi nó phải sửa test có chủ đích, đồng thời bảo đảm không route "me"/"đổi mật
 * khẩu" nào vô tình thành @Public.
 */

const handler = (name: keyof AuthController) => AuthController.prototype[name] as unknown as object;
const isPublic = (name: keyof AuthController) =>
  Reflect.getMetadata(IS_PUBLIC_KEY, handler(name)) === true;
const limitOf = (name: keyof AuthController) => ({
  limit: Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler(name)) as number | undefined,
  ttl: Reflect.getMetadata(`${THROTTLER_TTL}default`, handler(name)) as number | undefined,
});

describe('AuthController - route công khai và giới hạn tần suất', () => {
  it.each(['login', 'pinStatus', 'pinSetup', 'refresh', 'logout'] as const)(
    '%s là @Public',
    (name) => {
      expect(isPublic(name)).toBe(true);
    },
  );

  it.each(['me', 'changePassword'] as const)('%s KHÔNG @Public (cần access token)', (name) => {
    expect(isPublic(name)).toBe(false);
  });

  it.each([
    ['login', 8],
    ['pinSetup', 8],
    ['pinStatus', 60],
  ] as const)('%s giới hạn %i lần/phút/IP', (name, limit) => {
    expect(limitOf(name)).toEqual({ limit, ttl: 60_000 });
  });

  it('pin-status nới hơn đăng nhập (nó chỉ trả cờ, không thử mật khẩu) nhưng vẫn có giới hạn', () => {
    expect(limitOf('pinStatus').limit).toBeGreaterThan(limitOf('login').limit as number);
    expect(limitOf('pinStatus').limit).toBeDefined();
  });
});
