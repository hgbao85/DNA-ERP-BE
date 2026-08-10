import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { AccessoryItemKind } from '../../../generated/prisma/client';

@Exclude()
export class BomAccessoryItemResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() bomRevisionId!: string;
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty({ enum: AccessoryItemKind }) kind!: AccessoryItemKind;
  @Expose() @ApiProperty() qtyPerUnit!: number;

  constructor(partial: Partial<BomAccessoryItemResponseDto>) {
    Object.assign(this, partial);
  }
}
