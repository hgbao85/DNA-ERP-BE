import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/** 1 dòng vật tư Dây/Đinh trong định mức của mảnh (PieceMaterialItem) - mirror
 *  toPieceMaterialLine() ở SkusService, chỉ giữ lại các field cần cho màn hình xuất đan. */
@Exclude()
export class WeavingPieceMaterialLineResponseDto {
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) materialSpec!: string | null;
  @Expose() @ApiProperty() materialUnit!: string;
  @Expose() @ApiProperty() qtyPerPiece!: number;

  constructor(partial: Partial<WeavingPieceMaterialLineResponseDto>) {
    Object.assign(this, partial);
  }
}
