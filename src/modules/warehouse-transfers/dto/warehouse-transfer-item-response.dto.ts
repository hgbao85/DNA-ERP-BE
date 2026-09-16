import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class WarehouseTransferItemResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) materialId!: string | null;
  @Expose() @ApiProperty() materialName!: string;
  /// Quy cách vật tư (Material.spec) - null cho dòng "ghi tự do" cũ (materialId null, trước
  /// 09/09/2026, không có Material để join) và vật tư chưa khai báo quy cách.
  @Expose() @ApiPropertyOptional({ nullable: true }) materialSpec!: string | null;
  @Expose() @ApiProperty() unit!: string;
  @Expose() @ApiProperty() quantity!: number;
  @Expose() @ApiPropertyOptional({ nullable: true }) note!: string | null;

  constructor(partial: Partial<WarehouseTransferItemResponseDto>) {
    Object.assign(this, partial);
  }
}
