import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class InspectionKhoItemOverrideDto {
  @ApiProperty({ description: 'InspectionKhoResultItem.id' })
  @IsString()
  @MinLength(1)
  itemId!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  actualStock!: number;
}

export class SubmitInspectionKhoDto {
  /// Chỉ dùng cho dòng KHÔNG có materialId (không tra được StockQuant) - dòng có materialId
  /// luôn lấy tồn thật từ StockQuant, service từ chối override đè lên dòng đó.
  @ApiPropertyOptional({ type: [InspectionKhoItemOverrideDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InspectionKhoItemOverrideDto)
  overrides?: InspectionKhoItemOverrideDto[];
}
