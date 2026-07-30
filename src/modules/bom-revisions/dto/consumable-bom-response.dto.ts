import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { MfgStage } from '../../../generated/prisma/client';

@Exclude()
export class ConsumableBomResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() bomRevisionId!: string;
  @Expose() @ApiProperty({ enum: MfgStage }) stage!: MfgStage;
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() qtyPerUnit!: number;

  constructor(partial: Partial<ConsumableBomResponseDto>) {
    Object.assign(this, partial);
  }
}
