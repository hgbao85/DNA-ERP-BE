import type { Response } from 'express';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { parseDurationMs } from '../../common/utils/duration.util';
import type { AuthTokensDto } from './dto/auth-tokens.dto';

/**
 * Nguồn sự thật DUY NHẤT cho cookie option của access/refresh token - login/refresh/logout
 * PHẢI dùng chung 2 hàm này thay vì tự viết res.cookie()/clearCookie() riêng, để 3 nơi không
 * bao giờ lệch path/maxAge/flag với nhau.
 *
 * domain KHÔNG được set: browser chỉ nói chuyện với origin của chính nó (proxy Next.js relay
 * sang BE thật ở tầng server-to-server) - set domain trỏ vào Render sẽ khiến browser từ chối
 * cookie vì không khớp host đã request. Để trống cũng giúp Vercel preview deploy (domain ngẫu
 * nhiên mỗi lần) tự động nhận cookie đúng phạm vi mà không cần cấu hình gì thêm.
 */
export function setAuthCookies(
  res: Response,
  tokens: AuthTokensDto,
  configService: ConfigService<AppConfig, true>,
): void {
  const isProd = configService.get('env', { infer: true }) === 'production';
  const base = { httpOnly: true, secure: isProd, sameSite: 'lax' as const };

  res.cookie('access_token', tokens.accessToken, {
    ...base,
    path: '/api',
    maxAge: parseDurationMs(configService.get('jwt.accessExpiresIn', { infer: true })),
  });
  res.cookie('refresh_token', tokens.refreshToken, {
    ...base,
    path: '/api/v1/auth',
    maxAge: parseDurationMs(configService.get('jwt.refreshExpiresIn', { infer: true })),
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie('access_token', { path: '/api' });
  res.clearCookie('refresh_token', { path: '/api/v1/auth' });
}
