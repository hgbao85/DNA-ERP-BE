import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class PackagingIssueResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() productionOrderId!: string;
  @Expose() @ApiProperty() poNumber!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderCode!: string | null;
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  @Expose() @ApiProperty() issuedQty!: number;
  @Expose() @ApiProperty() issuedAt!: Date;
  @Expose() @ApiProperty() issuedById!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) note!: string | null;

  constructor(partial: Partial<PackagingIssueResponseDto>) {
    Object.assign(this, partial);
  }
}
