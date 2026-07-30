import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class WarehouseResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() code!: string;
  @Expose() @ApiProperty() name!: string;
  @Expose() @ApiProperty() isVirtual!: boolean;
  @Expose() @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @Expose() @ApiProperty() isActive!: boolean;

  constructor(partial: Partial<WarehouseResponseDto>) {
    Object.assign(this, partial);
  }
}
