import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class SystemConfigResponseDto {
  @Expose() @ApiProperty() id!: number;
  @Expose() @ApiProperty() companyName!: string;
  @Expose() @ApiProperty({ nullable: true }) companyAddress!: string | null;
  @Expose() @ApiProperty({ nullable: true }) companyPhone!: string | null;
  @Expose() @ApiProperty({ nullable: true }) companyEmail!: string | null;
  @Expose() @ApiProperty({ nullable: true }) taxCode!: string | null;
  @Expose() @ApiProperty() defaultCurrency!: string;

  @Expose() @ApiProperty({ type: [Number] }) solverStockLengths!: number[];
  @Expose() @ApiProperty() solverTrimStartMm!: number;
  @Expose() @ApiProperty() solverBladeWidthMm!: number;
  @Expose() @ApiProperty() solverMaxWastePercentage!: number;
  @Expose() @ApiProperty() solverMaxSurplus!: number;
  @Expose() @ApiProperty() solverMinLengthMm!: number;
  @Expose() @ApiProperty() solverMaxLengthMm!: number;
  @Expose() @ApiProperty() solverLengthStepMm!: number;
  @Expose() @ApiProperty() solverTimeLimitSeconds!: number;

  @Expose() @ApiProperty() updatedAt!: Date;

  constructor(partial: Partial<SystemConfigResponseDto>) {
    Object.assign(this, partial);
  }
}
