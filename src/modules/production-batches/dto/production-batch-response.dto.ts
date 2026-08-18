import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { MfgStage, ProductionBatchStatus } from '../../../generated/prisma/client';

@Exclude()
export class ProductionBatchResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() productionOrderId!: string;
  @Expose() @ApiProperty() poNumber!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderCode!: string | null;
  @Expose() @ApiProperty({ enum: MfgStage }) stage!: MfgStage;
  @Expose() @ApiProperty() pieceId!: string;
  @Expose() @ApiProperty() pieceCode!: string;
  @Expose() @ApiProperty() pieceName!: string;
  @Expose() @ApiProperty() reportedQty!: number;
  @Expose() @ApiProperty({ enum: ProductionBatchStatus }) status!: ProductionBatchStatus;
  @Expose() @ApiProperty() reportedAt!: Date;
  @Expose() @ApiProperty() reportedById!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) reworkOfId!: string | null;

  constructor(partial: Partial<ProductionBatchResponseDto>) {
    Object.assign(this, partial);
  }
}
