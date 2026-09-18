import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * CHỈ sửa metadata (name/unit/note/isActive) - KHÔNG có field số lượng. Đổi tồn phải đi qua
 * POST /office-supplies/:id/adjust (OfficeSuppliesService.adjustQuantity) để luôn có 1 dòng
 * OfficeSupplyLedgerEntry đi kèm, không cho "sửa tồn chui" ngoài lịch sử.
 */
export class UpdateOfficeSupplyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
