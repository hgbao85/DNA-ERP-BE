import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class PieceResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() mfgProductId!: string;
  @Expose() @ApiProperty() code!: string;
  @Expose() @ApiProperty() groupNumber!: number;
  @Expose() @ApiPropertyOptional({ nullable: true }) pieceNumber!: number | null;
  @Expose() @ApiProperty() name!: string;
  @Expose() @ApiProperty() isWoven!: boolean;
  @Expose() @ApiPropertyOptional({ nullable: true }) weavingPrice!: number | null;

  constructor(partial: Partial<PieceResponseDto>) {
    Object.assign(this, partial);
  }
}
