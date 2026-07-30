import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsString, Min } from 'class-validator';
import { MfgStage } from '../../../generated/prisma/client';

export class CreateConsumableBomDto {
  @ApiProperty({ enum: MfgStage, description: 'HAN / SON' })
  @IsEnum(MfgStage)
  stage!: MfgStage;

  @ApiProperty({ description: "Phải là material.kind='CONSUMABLE' hoặc 'PAINT'" })
  @IsString()
  materialId!: string;

  @ApiProperty({
    description: 'Định mức cho 1 SKU - nhu cầu PO = qtyPerUnit × production_order.quantity',
  })
  @IsNumber()
  @Min(0)
  qtyPerUnit!: number;
}
