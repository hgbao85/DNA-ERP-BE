import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class MaterialSupplierResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() supplierId!: string;
  @Expose() @ApiProperty() supplierName!: string;
  @Expose() @ApiProperty() price!: number;
  @Expose() @ApiPropertyOptional({ nullable: true }) leadTimeDays!: number | null;

  constructor(partial: Partial<MaterialSupplierResponseDto>) {
    Object.assign(this, partial);
  }
}
