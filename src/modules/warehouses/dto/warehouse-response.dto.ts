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
  /** Đợt 7 - loại kho: PHOI/HAN/SON/PHU_KIEN/THANH_PHAM, null = kho ảo/chưa phân loại. */
  @Expose() @ApiPropertyOptional({ nullable: true }) kind!: string | null;
  /** Đợt 7 - xưởng sở hữu (chỉ kho Phôi/Hàn gắn xưởng), null = dùng chung. */
  @Expose() @ApiPropertyOptional({ nullable: true }) workshopId!: string | null;

  constructor(partial: Partial<WarehouseResponseDto>) {
    Object.assign(this, partial);
  }
}
