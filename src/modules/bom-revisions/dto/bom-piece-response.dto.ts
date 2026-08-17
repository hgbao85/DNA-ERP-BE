import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class BomPieceResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() bomRevisionId!: string;
  @Expose() @ApiProperty() pieceId!: string;
  @Expose() @ApiProperty() pieceCode!: string;
  @Expose() @ApiProperty() qtyPerUnit!: number;
  @Expose() @ApiProperty() needsHan!: boolean;
  @Expose() @ApiProperty() needsSon!: boolean;

  constructor(partial: Partial<BomPieceResponseDto>) {
    Object.assign(this, partial);
  }
}
