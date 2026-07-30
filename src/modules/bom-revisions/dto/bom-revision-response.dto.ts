import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { BomRevisionStatus } from '../../../generated/prisma/client';

@Exclude()
export class BomRevisionResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() mfgProductId!: string;
  @Expose() @ApiProperty() revNo!: number;
  @Expose() @ApiProperty({ enum: BomRevisionStatus }) status!: BomRevisionStatus;
  @Expose() @ApiPropertyOptional({ nullable: true }) sourcePlanFormId!: string | null;
  @Expose() @ApiProperty() createdAt!: Date;

  constructor(partial: Partial<BomRevisionResponseDto>) {
    Object.assign(this, partial);
  }
}
