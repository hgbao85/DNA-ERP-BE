import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class ProductResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() factoryCode!: string;
  @Expose() @ApiProperty() name!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) description!: string | null;

  constructor(partial: Partial<ProductResponseDto>) {
    Object.assign(this, partial);
  }
}
