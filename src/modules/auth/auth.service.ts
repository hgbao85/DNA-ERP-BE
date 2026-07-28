import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { AppConfig } from '../../config/configuration';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';
import { parseDurationMs } from '../../common/utils/duration.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { AuthUserProfile, UsersService } from '../users/users.service';
import { AuthTokensDto } from './dto/auth-tokens.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';

const REFRESH_TOKEN_BYTES = 64;

type TxClient = Pick<PrismaServiceType, 'refreshToken'>;

function derivePermissions(user: AuthUserProfile): string[] {
  const permissions = new Set<string>();
  for (const userRole of user.roles) {
    for (const rolePermission of userRole.role.permissions) {
      permissions.add(`${rolePermission.permission.module}:${rolePermission.permission.action}`);
    }
  }
  return [...permissions];
}

function deriveRoleNames(user: AuthUserProfile): string[] {
  return user.roles.map((userRole) => userRole.role.name);
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async login(dto: LoginDto, ip?: string): Promise<AuthTokensDto> {
    const user = await this.usersService.findAuthProfileByUsername(dto.username);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await argon2.verify(user.password, dto.password);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { accessToken, refreshToken } = await this.issueTokenPair(user, ip);
    return { accessToken, refreshToken };
  }

  async refresh(refreshToken: string, ip?: string): Promise<AuthTokensDto> {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersService.findAuthProfileById(stored.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Rotation: the old refresh token is revoked in the same transaction that
    // issues the new pair, so a crash mid-rotation can never leave two live tokens.
    return this.prisma.$transaction(async (tx) => {
      const issued = await this.issueTokenPair(user, ip, tx);
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: {
          revokedAt: new Date(),
          revokedByIp: ip,
          replacedByTokenId: issued.refreshTokenId,
        },
      });
      return { accessToken: issued.accessToken, refreshToken: issued.refreshToken };
    });
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.usersService.findAuthProfileById(userId);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await argon2.verify(user.password, dto.currentPassword);
    if (!passwordMatches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const hashedPassword = await argon2.hash(dto.newPassword);

    // Revoke every live refresh token so a changed password (e.g. after a suspected
    // leak) actually logs the account out everywhere else, not just on this device.
    // The current access token still works until it naturally expires (stateless JWT -
    // see JwtStrategy.validate, which never re-checks the DB), which is an accepted
    // trade-off already documented for account deletion/deactivation.
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { password: hashedPassword } });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  async logout(refreshToken: string, ip?: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.revokedAt) {
      return;
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), revokedByIp: ip },
    });
  }

  private async issueTokenPair(
    user: AuthUserProfile,
    ip: string | undefined,
    tx: TxClient = this.prisma,
  ): Promise<{ accessToken: string; refreshToken: string; refreshTokenId: string }> {
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      roles: deriveRoleNames(user),
      permissions: derivePermissions(user),
      mfgRole: user.mfgRole,
      warehouseScope: user.warehouseScope,
    };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get('jwt.accessSecret', { infer: true }),
      expiresIn: this.configService.get('jwt.accessExpiresIn', { infer: true }),
    });

    const rawRefreshToken = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const refreshExpiresIn = this.configService.get('jwt.refreshExpiresIn', { infer: true });
    const created = await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(rawRefreshToken),
        expiresAt: new Date(Date.now() + parseDurationMs(refreshExpiresIn)),
        createdByIp: ip,
      },
    });

    return { accessToken, refreshToken: rawRefreshToken, refreshTokenId: created.id };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
