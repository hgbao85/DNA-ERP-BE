import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../../common/interfaces/cls-store.interface';
import { AppConfig } from '../../../config/configuration';
import { AuthenticatedUser, JwtPayload } from '../../../common/interfaces/jwt-payload.interface';
import { LiveAuthService } from '../live-auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService<AppConfig, true>,
    private readonly cls: ClsService<AppClsStore>,
    private readonly liveAuth: LiveAuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.accessSecret', { infer: true }),
    });
  }

  /** B5 (17/11): đối chiếu tài khoản với DB (LiveAuthService, đọc lại tối đa 30 giây / lần) - khoá / xoá / đổi quyền có hiệu
   *  lực ngay thay vì đợi access token hết hạn 15 phút. */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const live = await this.liveAuth.get(payload.sub);
    if (!live) {
      throw new UnauthorizedException('Tài khoản không còn hoạt động. Đăng nhập lại.');
    }
    this.cls.set('userId', payload.sub);
    return {
      id: payload.sub,
      username: payload.username,
      email: payload.email,
      roles: live.roles,
      permissions: live.permissions,
      mfgRole: live.mfgRole,
      warehouseScope: payload.warehouseScope,
    };
  }
}
