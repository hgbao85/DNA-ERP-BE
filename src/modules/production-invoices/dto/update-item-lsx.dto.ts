import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * Phần A – Đợt 2: KHSX/Admin nhập số LSX (vd MY-313) cho 1 dòng SKU. `null` (hoặc chuỗi rỗng) = xoá số. THIẾU field -> 400
 * (undefined không lọt qua ValidateIf nên rơi vào IsString). Dạng đúng/tiền tố/trùng do service kiểm.
 */
export class UpdateItemLsxDto {
  @ApiProperty({ type: String, nullable: true, example: 'MY-313' })
  @ValidateIf((o: UpdateItemLsxDto) => o.lsxCode !== null)
  @IsString()
  @MaxLength(20)
  lsxCode!: string | null;
}
