import { Body, Controller, Get, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UsersService } from '../users/users.service';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { AuthService } from './auth.service';
import { AuthTokensDto } from './dto/auth-tokens.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Ip() ip: string): Promise<AuthTokensDto> {
    return this.authService.login(dto, ip);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto, @Ip() ip: string): Promise<AuthTokensDto> {
    return this.authService.refresh(dto.refreshToken, ip);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Body() dto: RefreshTokenDto, @Ip() ip: string): Promise<void> {
    return this.authService.logout(dto.refreshToken, ip);
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
}
