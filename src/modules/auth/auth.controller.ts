import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AppConfig } from '../../config/configuration';
import { UsersService } from '../users/users.service';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { AuthService } from './auth.service';
import { setAuthCookies, clearAuthCookies } from './auth-cookie.util';
import { AuthTokensDto } from './dto/auth-tokens.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  // Chặt hơn ThrottlerGuard global (100 req/60s dùng chung mọi endpoint) - brute-force mật khẩu
  // khả thi hơn ở endpoint này vì chính sách mật khẩu chỉ yêu cầu tối thiểu 8 ký tự.
  //
  // Trả CẢ cookie httpOnly LẪN token trong JSON body (giai đoạn chuyển tiếp - xem
  // docs kế hoạch migrate localStorage->cookie): FE cũ (chưa deploy bản dùng cookie) vẫn đọc
  // được accessToken/refreshToken từ body như trước, không bị gãy khi BE deploy trước FE.
  // Bỏ hẳn token khỏi body ở đợt dọn dẹp sau, sau khi xác nhận FE mới đã chạy ổn định.
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokensDto> {
    const tokens = await this.authService.login(dto, ip);
    setAuthCookies(res, tokens, this.configService);
    return tokens;
  }

  // Ưu tiên đọc refresh_token từ cookie httpOnly (browser tự đính kèm); fallback về body cho
  // Swagger "Try it out"/Postman/script không chạy qua cookie, hoặc FE cũ chưa deploy bản mới.
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Body() dto: RefreshTokenDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokensDto> {
    const refreshToken = (req.cookies?.['refresh_token'] as string | undefined) ?? dto.refreshToken;
    if (!refreshToken) throw new UnauthorizedException('Missing refresh token');
    const tokens = await this.authService.refresh(refreshToken, ip);
    setAuthCookies(res, tokens, this.configService);
    return tokens;
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Body() dto: RefreshTokenDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const refreshToken = (req.cookies?.['refresh_token'] as string | undefined) ?? dto.refreshToken;
    if (refreshToken) await this.authService.logout(refreshToken, ip);
    clearAuthCookies(res);
  }

  // Not @Public() - requires a valid access token, same as any other endpoint.
  // FE calls this right after login (and again on every app reload) to restore the
  // session: it's the one place that returns roles[]/mfgRole/warehouseScope/flags as
  // plain JSON - the access token also carries them, but only inside its JWT payload.
  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser('id') userId: string): Promise<UserResponseDto> {
    return this.usersService.findOne(userId);
  }

  // Self-service only - a user changes their own password, verified against the
  // current one. Admin-reset-for-another-user is a separate concern, not covered here.
  @ApiBearerAuth()
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(@CurrentUser('id') userId: string, @Body() dto: ChangePasswordDto): Promise<void> {
    return this.authService.changePassword(userId, dto);
  }
}
