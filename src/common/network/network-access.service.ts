import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { isIpAllowed, isNetworkRestrictedAccount } from '../utils/ip-allowlist.util';

/** Thông báo cho người dùng bị chặn - FE hiện nguyên văn ở màn đăng nhập. */
export const NETWORK_NOT_ALLOWED_MESSAGE =
  'Tài khoản công nhân chỉ dùng được khi nối mạng (Wi-Fi) của công ty. Nối Wi-Fi công ty rồi thử lại.';

/** Danh sách IP đọc từ DB được nhớ chừng này giây (mỗi request đều kiểm tra, không thể đọc DB mỗi lần). */
const CACHE_SECONDS = 30;

/**
 * Giới hạn mạng công ty cho tài khoản công nhân (2026-10-13). Danh sách IP: SystemConfig.floorAllowedIps (Admin sửa ở Cấu hình hệ
 * thống), RỖNG = tắt. Nhớ 30 giây (nhiều instance BE thì đổi danh sách có hiệu lực chậm nhất 30 giây); Admin sửa xong
 * gọi `invalidate()` để instance đang xử lý có hiệu lực ngay.
 */
@Injectable()
export class NetworkAccessService {
  private readonly logger = new Logger(NetworkAccessService.name);
  private cache: { ips: string[]; at: number } | null = null;

  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async allowedIps(): Promise<string[]> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < CACHE_SECONDS * 1000) return this.cache.ips;
    try {
      const config = await this.prisma.systemConfig.findUnique({
        where: { id: 1 },
        select: { floorAllowedIps: true },
      });
      this.cache = { ips: config?.floorAllowedIps ?? [], at: now };
    } catch (e) {
      // DB lỗi thoáng qua: dùng danh sách đã nhớ nếu có (không đổi quyết định đột ngột); chưa có gì thì để lỗi bay ra.
      if (this.cache) {
        this.logger.warn(`Không đọc được danh sách IP, dùng bản đã nhớ: ${(e as Error).message}`);
        return this.cache.ips;
      }
      throw e;
    }
    return this.cache.ips;
  }

  invalidate(): void {
    this.cache = null;
  }

  /** Giới hạn đang BẬT (danh sách có ít nhất 1 IP)? */
  async isEnforced(): Promise<boolean> {
    return (await this.allowedIps()).length > 0;
  }

  async isAllowed(clientIp: string | undefined | null): Promise<boolean> {
    return isIpAllowed(clientIp, await this.allowedIps());
  }

  /**
   * Tài khoản này có được dùng từ IP này không (không ném lỗi). Tài khoản không thuộc diện giới hạn (Sếp, QLSX, KCS, Admin...)
   * luôn được phép; công nhân / tổ Phôi-Hàn-Sơn thì IP phải nằm trong danh sách (danh sách rỗng = tắt = được phép).
   */
  async isAccountAllowed(
    account: { roles: string[]; mfgRole: string | null },
    clientIp: string | undefined | null,
  ): Promise<boolean> {
    if (!isNetworkRestrictedAccount(account)) return true;
    return this.isAllowed(clientIp);
  }

  /** Như `isAccountAllowed` nhưng ném 403 kèm thông báo cho người dùng khi bị chặn. */
  async assertAccountAllowed(
    account: { roles: string[]; mfgRole: string | null },
    clientIp: string | undefined | null,
  ): Promise<void> {
    if (!(await this.isAccountAllowed(account, clientIp))) {
      throw new ForbiddenException(NETWORK_NOT_ALLOWED_MESSAGE);
    }
  }
}
