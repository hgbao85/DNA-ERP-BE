import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { ProductionOrderStatus } from '../../../generated/prisma/client';

@Exclude()
export class ProductionOrderResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() poNumber!: string;
  @Expose() @ApiProperty() productionInvoiceItemId!: string;
  @Expose() @ApiProperty() mfgProductId!: string;
  @Expose() @ApiProperty() bomRevisionId!: string;
  @Expose() @ApiProperty() quantity!: number;
  @Expose() @ApiProperty({ enum: ProductionOrderStatus }) status!: ProductionOrderStatus;
  @Expose() @ApiPropertyOptional({ nullable: true }) releasedAt!: Date | null;
  @Expose() @ApiProperty() createdAt!: Date;

  constructor(partial: Partial<ProductionOrderResponseDto>) {
    Object.assign(this, partial);
  }
}
