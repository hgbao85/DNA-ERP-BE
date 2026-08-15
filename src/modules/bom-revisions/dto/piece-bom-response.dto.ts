import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class PieceBomResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() bomRevisionId!: string;
  @Expose() @ApiProperty() pieceId!: string;
  @Expose() @ApiProperty() pieceCode!: string;
  @Expose() @ApiProperty() segmentSpecId!: string;
  @Expose() @ApiProperty() segmentSpecLabel!: string;
  @Expose() @ApiProperty() qtyPerPiece!: number;
  @Expose() @ApiProperty({ nullable: true }) note!: string | null;

  constructor(partial: Partial<PieceBomResponseDto>) {
    Object.assign(this, partial);
  }
}
