import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { InspectionKhoStatus } from '../../../generated/prisma/client';

@Exclude()
export class InspectionKhoResultItemResponseDto {
  @Expose() @ApiProperty() id!: string;
  /// null = dòng không map được vật tư thật (hiếm) - actualStock của dòng này phải nhập tay qua
  /// SubmitInspectionKhoDto.overrides, không tra StockQuant được.
  @Expose() @ApiPropertyOptional({ nullable: true }) materialId!: string | null;
  @Expose() @ApiProperty() materialName!: string;
  @Expose() @ApiProperty() materialUnit!: string;
  @Expose() @ApiProperty() required!: number;
  @Expose() @ApiPropertyOptional({ nullable: true }) actualStock!: number | null;
  /** max(0, required - actualStock) - tính sẵn để FE không phải suy lại. */
  @Expose() @ApiProperty() shortage!: number;

  constructor(partial: Partial<InspectionKhoResultItemResponseDto>) {
    Object.assign(this, partial);
  }
}

@Exclude()
export class InspectionKhoResultResponseDto {
  @Expose() @ApiProperty() warehouseCode!: string;
  @Expose() @ApiProperty({ enum: InspectionKhoStatus }) status!: InspectionKhoStatus;
  @Expose() @ApiPropertyOptional({ nullable: true }) submittedAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) submittedById!: string | null;
  /** true khi kho này đã có PurchaseProposal (tạo qua POST /purchase-proposals). */
  @Expose() @ApiProperty() proposalCreated!: boolean;
  @Expose() @ApiPropertyOptional({ nullable: true }) purchaseProposalId!: string | null;
  @Expose()
  @ApiProperty({ type: [InspectionKhoResultItemResponseDto] })
  @Type(() => InspectionKhoResultItemResponseDto)
  items!: InspectionKhoResultItemResponseDto[];

  constructor(partial: Partial<InspectionKhoResultResponseDto>) {
    Object.assign(this, partial);
  }
}
