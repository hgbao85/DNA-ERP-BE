import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, Min } from 'class-validator';

export class CreateBomAccessoryItemDto {
  @ApiProperty({ description: "Phải là material.kind='ACCESSORY' hoặc 'PACKAGING'" })
  @IsString()
  materialId!: string;

  @ApiProperty({
    description: 'Định mức cho 1 SKU - nhu cầu PO = qtyPerUnit × production_order.quantity',
  })
  @IsNumber()
  @Min(0)
  qtyPerUnit!: number;
}
