import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class WarehouseTransferItemResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) materialId!: string | null;
  @Expose() @ApiProperty() materialName!: string;
  @Expose() @ApiProperty() unit!: string;
  @Expose() @ApiProperty() quantity!: number;
  @Expose() @ApiPropertyOptional({ nullable: true }) note!: string | null;

  constructor(partial: Partial<WarehouseTransferItemResponseDto>) {
    Object.assign(this, partial);
  }
}
