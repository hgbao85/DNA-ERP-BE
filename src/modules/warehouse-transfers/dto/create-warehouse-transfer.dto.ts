import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { CreateWarehouseTransferItemDto } from './create-warehouse-transfer-item.dto';

export class CreateWarehouseTransferDto {
  @ApiProperty()
  @IsString()
  fromWarehouseId!: string;

  @ApiProperty()
  @IsString()
  toWarehouseId!: string;

  @ApiPropertyOptional({ description: 'Chuẩn hoá từ pi_code hiện tại - trỏ tới SKU (PlanForm)' })
  @IsOptional()
  @IsString()
  planFormId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiProperty({ type: [CreateWarehouseTransferItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateWarehouseTransferItemDto)
  items!: CreateWarehouseTransferItemDto[];
}
