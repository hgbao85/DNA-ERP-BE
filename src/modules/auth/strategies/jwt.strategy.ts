import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../../common/interfaces/cls-store.interface';
import { AppConfig } from '../../../config/configuration';
import { AuthenticatedUser, JwtPayload } from '../../../common/interfaces/jwt-payload.interface';

// Ưu tiên cookie httpOnly access_token (browser tự đính kèm); fallback Authorization header cho
// Swagger "Try it out"/Postman/script không chạy qua cookie, hoặc FE cũ chưa deploy bản mới.
const cookieExtractor = (req: Request): string | null =>
  (req?.cookies?.['access_token'] as string | undefined) ?? null;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService<AppConfig, true>,
    private readonly cls: ClsService<AppClsStore>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.accessSecret', { infer: true }),
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    this.cls.set('userId', payload.sub);
    return {
      id: payload.sub,
      username: payload.username,
      email: payload.email,
      roles: payload.roles,
      permissions: payload.permissions,
      mfgRole: payload.mfgRole,
      warehouseScope: payload.warehouseScope,
    };
  }
}
