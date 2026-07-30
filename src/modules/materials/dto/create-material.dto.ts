import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { MaterialKind } from '../../../generated/prisma/client';

export class CreateMaterialDto {
  @ApiProperty({ description: "vd 'SAT-25'" })
  @IsString()
  @MinLength(1)
  code!: string;

  @ApiProperty({ description: 'vd "Sắt Hộp 6 zem" - spec ghép giữ nguyên dạng text' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({
    enum: MaterialKind,
    default: MaterialKind.OTHER,
    description: 'Dùng lọc khi chọn cho segment_spec (chỉ STEEL_BAR) hay consumable_bom',
  })
  @IsOptional()
  @IsEnum(MaterialKind)
  kind?: MaterialKind;

  @ApiProperty({ description: 'cm, cây, kg, cuộn, bar, l, bottle...' })
  @IsString()
  @MinLength(1)
  unit!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  materialGroupId?: string;

  @ApiPropertyOptional({ description: 'Hệ số quy đổi đơn vị kho, vd 600 = mm/cây' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  khoUnitFactor?: number;
}
