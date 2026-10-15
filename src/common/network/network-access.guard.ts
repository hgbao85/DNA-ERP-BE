import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { NetworkAccessService } from './network-access.service';

/**
 * Chặn MỌI request của tài khoản công nhân / tổ Phôi-Hàn-Sơn khi không ở mạng công ty (2026-10-13). Chạy ngay sau JwtAuthGuard
 * (cần `request.user`); route công khai (đăng nhập...) không có user nên bỏ qua - đăng nhập/refresh/đặt PIN tự kiểm tra trong
 * AuthService. Nhờ guard này, công nhân mang điện thoại ra khỏi mạng công ty là mất quyền NGAY (không chờ token 15 phút hết hạn).
 * Danh sách IP rỗng = tắt, không tốn gì ngoài 1 lần đọc bộ nhớ đệm.
 */
@Injectable()
export class NetworkAccessGuard implements CanActivate {
  constructor(private readonly network: NetworkAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) return true;
    await this.network.assertAccountAllowed(user, request.ip);
    return true;
  }
}
