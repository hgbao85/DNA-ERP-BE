import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateWarehouseTransferItemDto {
  /** Nullable - kế thừa hạn chế của mock (chưa ép chọn đúng Material thật, xem entity). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  materialId?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  materialName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  unit!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
