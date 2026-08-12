import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsNumber, IsString, Min, MinLength, ValidateNested } from 'class-validator';

export class CreateManualPurchaseProposalItemDto {
  @ApiProperty({ description: 'InspectionKhoResultItem.id - dòng vật tư thiếu trong kho-result' })
  @IsString()
  @MinLength(1)
  itemId!: string;

  @ApiProperty({ description: 'Số lượng đề xuất mua - có thể lẻ (vd kg sơn)' })
  @IsNumber()
  @Min(0.0001)
  buyQty!: number;
}

export class CreateManualPurchaseProposalDto {
  @ApiProperty({ description: 'InspectionKhoResult.id đã SUBMITTED, còn thiếu vật tư' })
  @IsString()
  @MinLength(1)
  inspectionKhoResultId!: string;

  @ApiProperty({ type: [CreateManualPurchaseProposalItemDto] })
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateManualPurchaseProposalItemDto)
  items!: CreateManualPurchaseProposalItemDto[];
}
