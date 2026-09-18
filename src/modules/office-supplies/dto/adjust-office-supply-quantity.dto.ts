import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { OfficeSupplyLedgerReason } from '../../../generated/prisma/client';

export class AdjustOfficeSupplyQuantityDto {
  @ApiProperty({ description: 'Số dương = nhập thêm, số âm = xuất dùng. Không được bằng 0.' })
  @IsNumber()
  @IsNotEmpty()
  changeQty!: number;

  @ApiProperty({
    enum: OfficeSupplyLedgerReason,
    description: 'INITIAL chỉ dùng nội bộ lúc tạo - route này chỉ nhận IMPORT/EXPORT/ADJUST',
  })
  @IsIn([
    OfficeSupplyLedgerReason.IMPORT,
    OfficeSupplyLedgerReason.EXPORT,
    OfficeSupplyLedgerReason.ADJUST,
  ])
  reason!: OfficeSupplyLedgerReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
