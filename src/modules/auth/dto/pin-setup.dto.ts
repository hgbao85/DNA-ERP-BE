import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MinLength } from 'class-validator';

/** Công nhân tự đặt PIN lần đầu (chưa có PIN) - POST /auth/pin-setup. Không cần đăng nhập: tài khoản chưa có PIN nào để đăng nhập. */
export class PinSetupDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  username!: string;

  @ApiProperty({ description: 'PIN 6 số' })
  @Matches(/^\d{6}$/, { message: 'PIN phải đúng 6 chữ số' })
  pin!: string;

  @ApiProperty({ description: 'Nhập lại PIN lần 2' })
  @Matches(/^\d{6}$/, { message: 'PIN phải đúng 6 chữ số' })
  confirmPin!: string;
}
