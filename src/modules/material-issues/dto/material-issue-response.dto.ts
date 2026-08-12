import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { MaterialIssueStatus, MfgStage } from '../../../generated/prisma/client';

@Exclude()
export class MaterialIssueResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() productionOrderId!: string;
  @Expose() @ApiProperty() poNumber!: string;
  @Expose() @ApiProperty({ enum: MfgStage }) stage!: MfgStage;
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  @Expose() @ApiProperty() issuedQty!: number;
  @Expose() @ApiProperty({ enum: MaterialIssueStatus }) status!: MaterialIssueStatus;
  @Expose() @ApiProperty() issuedAt!: Date;
  @Expose() @ApiProperty() issuedById!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) receivedQty!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) receivedAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) receivedById!: string | null;

  constructor(partial: Partial<MaterialIssueResponseDto>) {
    Object.assign(this, partial);
  }
}
