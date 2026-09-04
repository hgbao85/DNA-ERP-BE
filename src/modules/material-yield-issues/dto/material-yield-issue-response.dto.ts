import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { MaterialYieldIssueStatus } from '../../../generated/prisma/client';

@Exclude()
export class MaterialYieldIssueResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() productionOrderId!: string;
  @Expose() @ApiProperty() poNumber!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderCode!: string | null;
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  @Expose() @ApiProperty() issuedQty!: number;
  @Expose() @ApiProperty({ enum: MaterialYieldIssueStatus }) status!: MaterialYieldIssueStatus;
  @Expose() @ApiProperty() issuedAt!: Date;
  @Expose() @ApiProperty() issuedById!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) receivedQty!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) receivedAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) receivedById!: string | null;

  constructor(partial: Partial<MaterialYieldIssueResponseDto>) {
    Object.assign(this, partial);
  }
}
