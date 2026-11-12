import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class SupplierResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() name!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) phone!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) address!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) taxCode!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) contactName!: string | null;
  @Expose() @ApiProperty() isActive!: boolean;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiProperty() updatedAt!: Date;

  constructor(partial: Partial<SupplierResponseDto>) {
    Object.assign(this, partial);
  }
}
