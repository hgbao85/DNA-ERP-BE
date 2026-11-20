import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { IsSystemUploadUrl } from '../../../common/validators/system-upload-url.validator';

export class CreateQcReviewDto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  failedQty!: number;

  /** P1 (18/11/2026): số KCS ghi THIẾU so với số báo (đã trừ, không tính lỗi, không làm bù). Mặc định 0. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  shortQty?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  defectReasonId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsSystemUploadUrl()
  photoUrl?: string;
}
