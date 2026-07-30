import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class ProductVariantResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() mfgProductId!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) customerId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) colorCode!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @Expose() @ApiProperty() isActive!: boolean;

  constructor(partial: Partial<ProductVariantResponseDto>) {
    Object.assign(this, partial);
  }
}
