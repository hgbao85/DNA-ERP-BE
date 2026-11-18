import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { derivePermissions, deriveRoleNames } from './auth-profile.util';

/** Trạng thái tài khoản đọc lại từ DB - đè lên phần tương ứng trong access token. */
export interface LiveAuth {
  roles: string[];
  permissions: string[];
  mfgRole: string | null;
}

/** Bao lâu đọc lại DB 1 lần cho mỗi tài khoản: khoá / đổi quyền có hiệu lực trong chừng này thay vì tới 15 phút. */
export const LIVE_AUTH_TTL_MS = 30_000;
const MAX_CACHED_USERS = 5_000;

/**
 * B5 (danh sách lỗi 16/11, 17/11/2026): access token sống 15 phút và trước đây JwtStrategy KHÔNG đối chiếu DB - khoá tài
 * khoản / xoá / đổi vai trò mất tới 15 phút mới có hiệu lực. Nay mỗi request đối chiếu tài khoản (đọc DB tối đa 1 lần / 30
 * giây / tài khoản): không còn hoạt động hoặc đã xoá -> 401; vai trò, quyền, tổ (mfgRole) lấy theo DB.
 * Phạm vi kho (warehouseScope) VẪN theo token: đổi kho đang làm cấp token mới cho đúng phiên đó (switchWarehouse), mỗi phiên
 * có thể đang ở 1 kho khác nhau.
 */
@Injectable()
export class LiveAuthService {
  private readonly cache = new Map<string, { at: number; live: LiveAuth | null }>();

  constructor(private readonly usersService: UsersService) {}

  async get(userId: string): Promise<LiveAuth | null> {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < LIVE_AUTH_TTL_MS) return hit.live;
    const user = await this.usersService.findAuthProfileById(userId);
    const live: LiveAuth | null =
      user && user.isActive
        ? {
            roles: deriveRoleNames(user),
            permissions: derivePermissions(user),
            mfgRole: user.mfgRole,
          }
        : null;
    if (this.cache.size >= MAX_CACHED_USERS) this.cache.clear();
    this.cache.set(userId, { at: Date.now(), live });
    return live;
  }

  /** Bỏ bản nhớ của 1 tài khoản (vd ngay sau khi chính BE này khoá / đổi quyền). */
  invalidate(userId: string): void {
    this.cache.delete(userId);
  }
}
