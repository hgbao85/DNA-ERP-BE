import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateSystemConfigDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  companyName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  companyAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  companyPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  companyEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taxCode?: string;

  @ApiPropertyOptional({ minLength: 3, maxLength: 3, example: 'VND' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  defaultCurrency?: string;

  @ApiPropertyOptional({
    type: [Number],
    example: [6000],
    description:
      'Các chiều dài thanh sắt nguyên chuẩn (mm) dùng cho Đề xuất cắt sắt. CHỈ điền chiều ' +
      'dài NCC thực sự có sẵn hàng - xem doc comment SystemConfig.solverStockLengths.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(100, { each: true })
  @Type(() => Number)
  solverStockLengths?: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  solverTrimStartMm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  solverBladeWidthMm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  solverMaxWastePercentage?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  solverMaxSurplus?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(100)
  solverMinLengthMm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(100)
  solverMaxLengthMm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  solverLengthStepMm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  solverTimeLimitSeconds?: number;

  @ApiPropertyOptional({
    example: 0,
    description:
      'Dung sai giao THỪA khi Thủ kho nhận hàng mua về, tính theo % của số lượng đặt mua ' +
      '(buyQty). Trong dung sai thì ghi nhận đúng số thực nhận kể cả khi vượt buyQty; vượt ' +
      'dung sai thì chặn và báo lỗi. 0 = không cho nhận thừa dòng nào.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  purchaseOverReceiptTolerancePercent?: number;
}
