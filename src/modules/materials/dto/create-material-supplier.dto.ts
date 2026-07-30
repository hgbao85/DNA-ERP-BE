import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateMaterialSupplierDto {
  @ApiProperty()
  @IsString()
  supplierId!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeDays?: number;
}
