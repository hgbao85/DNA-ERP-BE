import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

// Admin-initiated reset: the admin sets a new password for another user (e.g. one who
// forgot theirs). No currentPassword here - the admin doesn't know it. Contrast with
// ChangePasswordDto (self-service), which verifies the current password.
export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
