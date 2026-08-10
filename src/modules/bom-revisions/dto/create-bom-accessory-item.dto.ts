import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsString, Min } from 'class-validator';
import { AccessoryItemKind } from '../../../generated/prisma/client';

export class CreateBomAccessoryItemDto {
  @ApiProperty({ description: 'Phải thuộc nhóm vật tư systemKey OTHER ("Vật tư khác")' })
  @IsString()
  materialId!: string;

  @ApiProperty({
    enum: AccessoryItemKind,
    description: 'Phụ kiện hay Bao bì - không còn suy được từ nhóm vật tư (2 tab dùng chung OTHER)',
  })
  @IsEnum(AccessoryItemKind)
  kind!: AccessoryItemKind;

  @ApiProperty({
    description: 'Định mức cho 1 SKU - nhu cầu PO = qtyPerUnit × production_order.quantity',
  })
  @IsNumber()
  @Min(0)
  qtyPerUnit!: number;
}
