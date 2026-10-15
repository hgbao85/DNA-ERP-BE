import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  username!: string;

  /** 6 = PIN 6 số của tài khoản công nhân xưởng (2026-10-13, FloorAdminService). Mật khẩu thường vẫn bắt
   *  tối thiểu 8 ở chỗ ĐẶT mật khẩu (CreateUserDto/ResetPasswordDto) - đây chỉ là form đăng nhập; dò mật khẩu
   *  bị chặn bởi @Throttle của /auth/login. */
  @ApiProperty()
  @IsString()
  @MinLength(6)
  password!: string;
}
