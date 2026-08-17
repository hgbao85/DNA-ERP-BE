import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateWarehouseTransferPieceItemDto {
  @ApiProperty()
  @IsString()
  productionOrderId!: string;

  @ApiProperty()
  @IsString()
  pieceId!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
