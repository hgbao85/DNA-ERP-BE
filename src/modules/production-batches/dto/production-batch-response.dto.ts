import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { MfgStage, ProductionBatchStatus } from '../../../generated/prisma/client';

@Exclude()
export class ProductionBatchResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() productionOrderId!: string;
  @Expose() @ApiProperty() poNumber!: string;
  @Expose() @ApiProperty({ enum: MfgStage }) stage!: MfgStage;
  @Expose() @ApiProperty() partId!: string;
  @Expose() @ApiProperty() partCode!: string;
  @Expose() @ApiProperty() partName!: string;
  @Expose() @ApiProperty() reportedQty!: number;
  @Expose() @ApiProperty({ enum: ProductionBatchStatus }) status!: ProductionBatchStatus;
  @Expose() @ApiProperty() reportedAt!: Date;
  @Expose() @ApiProperty() reportedById!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) reworkOfId!: string | null;

  constructor(partial: Partial<ProductionBatchResponseDto>) {
    Object.assign(this, partial);
  }
}
