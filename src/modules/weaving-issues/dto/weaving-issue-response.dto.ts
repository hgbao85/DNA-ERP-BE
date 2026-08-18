import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class WeavingIssueResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() productionOrderId!: string;
  @Expose() @ApiProperty() poNumber!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderCode!: string | null;
  @Expose() @ApiProperty() pieceId!: string;
  @Expose() @ApiProperty() pieceCode!: string;
  @Expose() @ApiProperty() pieceName!: string;
  @Expose() @ApiProperty() weavingPointId!: string;
  @Expose() @ApiProperty() weavingPointCode!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) weavingPointName!: string | null;
  @Expose() @ApiProperty() qty!: number;
  @Expose() @ApiProperty() issuedAt!: Date;
  @Expose() @ApiProperty() issuedById!: string;

  constructor(partial: Partial<WeavingIssueResponseDto>) {
    Object.assign(this, partial);
  }
}
