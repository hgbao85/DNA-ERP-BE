import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { MaterialYieldIssueStatus } from '../../../generated/prisma/client';

@Exclude()
export class MaterialYieldRecipeIssueResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() productionInvoiceId!: string;
  @Expose() @ApiProperty() piCode!: string;
  @Expose() @ApiProperty() recipeId!: string;
  @Expose() @ApiProperty() inputMaterialId!: string;
  @Expose() @ApiProperty() inputMaterialCode!: string;
  @Expose() @ApiProperty() inputMaterialName!: string;
  @Expose() @ApiProperty() issuedQty!: number;
  @Expose() @ApiProperty({ enum: MaterialYieldIssueStatus }) status!: MaterialYieldIssueStatus;
  @Expose() @ApiProperty() issuedAt!: Date;
  @Expose() @ApiProperty() issuedById!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) receivedQty!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) receivedAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) receivedById!: string | null;

  constructor(partial: Partial<MaterialYieldRecipeIssueResponseDto>) {
    Object.assign(this, partial);
  }
}
