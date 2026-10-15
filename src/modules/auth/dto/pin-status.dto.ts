import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/** Màn đăng nhập công nhân hỏi "tài khoản này đã có PIN chưa" - POST /auth/pin-status. Không cần đăng nhập. */
export class PinStatusDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  username!: string;
}
