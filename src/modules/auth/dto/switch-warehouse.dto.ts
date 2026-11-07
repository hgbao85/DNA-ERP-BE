import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** Đợt 7: đổi "kho đang làm" của người giữ nhiều kho. */
export class SwitchWarehouseDto {
  @ApiProperty()
  @IsString()
  warehouseCode!: string;

  /** Refresh token của phiên hiện tại - gửi lên để thu hồi (cặp token mới thay thế). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
