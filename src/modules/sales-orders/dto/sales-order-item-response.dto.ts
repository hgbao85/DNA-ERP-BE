import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { ContainerLoadDto } from '../../../common/dto/container-load.dto';
import { SalesOrderItemStatus } from '../../../generated/prisma/client';
import { MaterialChoiceRefDto } from '../../../common/utils/material-choice-ref.util';

@Exclude()
export class SalesOrderItemResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() salesOrderId!: string;
  @Expose() @ApiProperty() mfgProductId!: string;
  @Expose() @ApiProperty() factoryCode!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) skuName!: string | null;
  /** Phần A – Đợt 1 (YC9): thùng + load cont của SKU. */
  @Expose()
  @Type(() => ContainerLoadDto)
  @ApiPropertyOptional({ type: ContainerLoadDto, nullable: true })
  containerLoad!: ContainerLoadDto | null;
  @Expose() @ApiProperty() totalQty!: number;
  @Expose() @ApiProperty() shippedQty!: number;
  @Expose() @ApiProperty({ enum: SalesOrderItemStatus }) status!: SalesOrderItemStatus;
  @Expose() @ApiPropertyOptional({ nullable: true }) deliveryDate!: Date | null;
  @Expose()
  @ApiPropertyOptional({ type: MaterialChoiceRefDto, nullable: true })
  wireMaterial!: MaterialChoiceRefDto | null;
  @Expose()
  @ApiPropertyOptional({ type: MaterialChoiceRefDto, nullable: true })
  cushionMaterial!: MaterialChoiceRefDto | null;

  constructor(partial: Partial<SalesOrderItemResponseDto>) {
    Object.assign(this, partial);
  }
}
