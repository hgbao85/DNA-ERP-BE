import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { AppConfig } from '../../config/configuration';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';
import { parseDurationMs } from '../../common/utils/duration.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { AuthUserProfile, UsersService } from '../users/users.service';
import { BUSINESS_ROLES } from '../../common/constants/roles.constant';
import { isWeakPin, LOCK_MINUTES, MAX_FAILED_LOGINS } from '../../common/utils/pin.util';
import { NetworkAccessService } from '../../common/network/network-access.service';
import { isNetworkRestrictedAccount } from '../../common/utils/ip-allowlist.util';
import { AuthTokensDto } from './dto/auth-tokens.dto';
import { PinSetupDto } from './dto/pin-setup.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';

const REFRESH_TOKEN_BYTES = 64;

/** FE đọc message này để chuyển sang màn "đặt PIN lần đầu" (xem FloorScanApp). */
export const PIN_SETUP_REQUIRED = 'PIN_SETUP_REQUIRED';

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
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly network: NetworkAccessService,
  ) {}

  /** Tài khoản có thuộc diện giới hạn mạng công ty không (công nhân / tổ Phôi-Hàn-Sơn) - xem ip-allowlist.util. */
  private isNetworkRestricted(user: AuthUserProfile): boolean {
    return isNetworkRestrictedAccount({ roles: deriveRoleNames(user), mfgRole: user.mfgRole });
  }

  async login(dto: LoginDto, ip?: string): Promise<AuthTokensDto> {
    const user = await this.usersService.findAuthProfileByUsername(dto.username);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Tài khoản công nhân xưởng (PIN 6 số): chưa có PIN -> đặt lần đầu; sai 5 lần -> khoá tạm.
    const isFloorWorker = user.roles.some((r) => r.role.name === BUSINESS_ROLES.FLOOR_WORKER);
    const networkRestricted = this.isNetworkRestricted(user);
    if (isFloorWorker) {
      if (user.pinPending) {
        // Đặt PIN lần đầu cũng phải ở mạng công ty (không để người ngoài giành đặt PIN trước công nhân).
        if (networkRestricted) await this.network.assertAccountAllowed(this.accountOf(user), ip);
        throw new ForbiddenException(PIN_SETUP_REQUIRED);
      }
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        throw new UnauthorizedException(this.lockedMessage(user.lockedUntil));
      }
    }

    const passwordMatches = await argon2.verify(user.password, dto.password);
    if (!passwordMatches) {
      if (isFloorWorker) {
        // Công nhân: báo còn mấy lần thử / khoá ngay ở lần sai thứ MAX_FAILED_LOGINS (không để tới lần thứ 6 mới biết).
        const { lockedUntil, attemptsLeft } = await this.registerFailedAttempt(user.id);
        if (lockedUntil) throw new UnauthorizedException(this.lockedMessage(lockedUntil));
        if (attemptsLeft <= 2) {
          throw new UnauthorizedException(
            `Sai PIN - còn ${attemptsLeft} lần thử trước khi bị khoá tạm ${LOCK_MINUTES} phút`,
          );
        }
      }
      throw new UnauthorizedException('Invalid credentials');
    }
    if (isFloorWorker && (user.failedLoginCount > 0 || user.lockedUntil)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }
    // Kiểm tra mạng SAU khi mật khẩu/PIN đúng: người ngoài dò tài khoản không phân biệt được "tên không tồn tại" với "tài khoản
    // công nhân"; công nhân đúng PIN mà đang ở ngoài thì được báo rõ lý do. Không tính vào số lần sai.
    if (networkRestricted) await this.network.assertAccountAllowed(this.accountOf(user), ip);

    const { accessToken, refreshToken } = await this.issueTokenPair(user, ip);
    return { accessToken, refreshToken };
  }

  private accountOf(user: AuthUserProfile): { roles: string[]; mfgRole: string | null } {
    return { roles: deriveRoleNames(user), mfgRole: user.mfgRole };
  }

  /**
   * Màn đăng nhập công nhân hỏi trước khi hiện ô PIN: tài khoản này CHƯA CÓ PIN (phải tự đặt) hay đã có (chỉ nhập PIN)?
   * Chống dò tài khoản: CHỈ trả `needsPin: true` cho tài khoản công nhân đang chờ đặt PIN VÀ người hỏi đang ở trong mạng
   * công ty (cùng điều kiện với đường đăng nhập/đặt PIN). Mọi trường hợp khác - tên không tồn tại, đã khoá, không phải công
   * nhân, đã có PIN, ngoài mạng công ty - đều trả đúng cùng 1 kết quả `{ needsPin: false, expired: false }`, nên người lạ
   * không phân biệt được. `expired`: đang chờ nhưng quá hạn đặt PIN (FE báo ngay, khỏi để công nhân gõ PIN xong mới bị từ chối).
   */
  async pinStatus(username: string, ip?: string): Promise<{ needsPin: boolean; expired: boolean }> {
    const none = { needsPin: false, expired: false };
    const user = await this.usersService.findAuthProfileByUsername(username.trim().toLowerCase());
    if (!user || !user.isActive || !user.pinPending) return none;
    if (!user.roles.some((r) => r.role.name === BUSINESS_ROLES.FLOOR_WORKER)) return none;
    if (!(await this.network.isAccountAllowed(this.accountOf(user), ip))) return none;
    const expired = !user.pinClaimExpiresAt || user.pinClaimExpiresAt < new Date();
    return { needsPin: true, expired };
  }

  /**
   * Công nhân tự đặt PIN lần đầu (tài khoản QLSX vừa tạo / cho đặt lại, `pinPending`): nhập PIN 2 lần, đúng thì lưu hash và
   * đăng nhập luôn. QLSX không bao giờ biết PIN. Chỉ chạy được khi tài khoản đang chờ đặt PIN và chưa quá hạn.
   */
  async pinSetup(dto: PinSetupDto, ip?: string): Promise<AuthTokensDto> {
    if (dto.pin !== dto.confirmPin) {
      throw new BadRequestException('Hai lần nhập PIN không giống nhau');
    }
    if (isWeakPin(dto.pin)) {
      throw new BadRequestException('PIN quá dễ đoán (vd 123456, 000000, 121212) - chọn PIN khác');
    }
    const user = await this.usersService.findAuthProfileByUsername(
      dto.username.trim().toLowerCase(),
    );
    const isFloorWorker = !!user?.roles.some((r) => r.role.name === BUSINESS_ROLES.FLOOR_WORKER);
    if (!user || !user.isActive || !isFloorWorker || !user.pinPending) {
      throw new BadRequestException('Tài khoản này không ở trạng thái chờ đặt PIN - báo QLSX');
    }
    if (!user.pinClaimExpiresAt || user.pinClaimExpiresAt < new Date()) {
      throw new BadRequestException('Đã quá hạn đặt PIN - báo QLSX cho đặt lại');
    }
    await this.network.assertAccountAllowed(this.accountOf(user), ip);
    const password = await argon2.hash(dto.pin);
    // Điều kiện pinPending trong where: 2 người cùng đặt PIN 1 tài khoản chỉ người đến trước thắng.
    const { count } = await this.prisma.user.updateMany({
      where: { id: user.id, pinPending: true },
      data: {
        password,
        pinPending: false,
        pinClaimExpiresAt: null,
        pinSetAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    if (count === 0) {
      throw new BadRequestException('Tài khoản này vừa được đặt PIN - đăng nhập bằng PIN đó');
    }
    const fresh = await this.usersService.findAuthProfileById(user.id);
    const { accessToken, refreshToken } = await this.issueTokenPair(fresh ?? user, ip);
    return { accessToken, refreshToken };
  }

  /** Cộng 1 lần sai (nguyên tử); đủ MAX_FAILED_LOGINS thì khoá LOCK_MINUTES phút và đếm lại từ 0. */
  private async registerFailedAttempt(
    userId: string,
  ): Promise<{ lockedUntil: Date | null; attemptsLeft: number }> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    if (updated.failedLoginCount >= MAX_FAILED_LOGINS) {
      const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
      await this.prisma.user.update({
        where: { id: userId },
        data: { failedLoginCount: 0, lockedUntil },
      });
      this.logger.warn(
        `Floor worker ${userId} locked ${LOCK_MINUTES} min after ${MAX_FAILED_LOGINS} wrong PINs`,
      );
      return { lockedUntil, attemptsLeft: 0 };
    }
    return { lockedUntil: null, attemptsLeft: MAX_FAILED_LOGINS - updated.failedLoginCount };
  }

  private lockedMessage(until: Date): string {
    const min = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
    return `Nhập sai PIN quá ${MAX_FAILED_LOGINS} lần - tài khoản bị khoá tạm, thử lại sau ${min} phút hoặc báo QLSX mở khoá`;
  }

  async refresh(refreshToken: string, ip?: string): Promise<AuthTokensDto> {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Reuse detection: a token that was already rotated (revokedAt set BY the rotation itself -
    // replacedByTokenId non-null) being presented again means it leaked and someone is racing the
    // legitimate holder. A token revoked by logout/change-password (replacedByTokenId null) is not
    // reuse, just a normal expired session - only the rotation case indicates compromise. Revoke
    // every live token for this user so the thief's already-rotated session dies too, not just
    // reject this one request (OAuth Security BCP for refresh token rotation).
    if (stored.revokedAt && stored.replacedByTokenId) {
      const { count } = await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.warn(
        `Refresh token reuse detected for user ${stored.userId} (tokenId ${stored.id}) - revoked ${count} live token(s)`,
      );
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersService.findAuthProfileById(stored.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    // Công nhân ra khỏi mạng công ty thì không gia hạn phiên (không thu hồi token - về lại mạng công ty dùng tiếp được).
    if (this.isNetworkRestricted(user))
      await this.network.assertAccountAllowed(this.accountOf(user), ip);

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
