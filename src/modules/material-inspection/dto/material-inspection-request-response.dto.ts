import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { InspectionKhoResultResponseDto } from './inspection-kho-result-response.dto';

@Exclude()
export class MaterialInspectionRequestResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() planFormId!: string;
  @Expose() @ApiProperty() poNumber!: string;
  @Expose() @ApiProperty() mfgProductCode!: string;
  @Expose() @ApiProperty() mfgProductName!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) deliveryDeadline!: Date | null;
  @Expose() @ApiProperty() productionStarted!: boolean;
  @Expose() @ApiPropertyOptional({ nullable: true }) productionStartedAt!: Date | null;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose()
  @ApiProperty({ type: [InspectionKhoResultResponseDto] })
  @Type(() => InspectionKhoResultResponseDto)
  khoResults!: InspectionKhoResultResponseDto[];

  constructor(partial: Partial<MaterialInspectionRequestResponseDto>) {
    Object.assign(this, partial);
  }
}
