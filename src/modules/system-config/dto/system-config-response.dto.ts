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
  @Expose() @ApiProperty() updatedAt!: Date;

  constructor(partial: Partial<SystemConfigResponseDto>) {
    Object.assign(this, partial);
  }
}
