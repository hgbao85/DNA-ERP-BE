import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/** 1 dòng vật tư (Dây/Đinh/Nút nhựa) thủ kho thực tế mang kèm mảnh - xem WeavingIssueMaterial.
 *  qty > 0 bắt buộc (dòng qty=0/rỗng thì FE không gửi lên, không phải "0 hợp lệ"). */
export class WeavingIssueMaterialLineDto {
  @ApiProperty()
  @IsString()
  materialId!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.0001)
  qty!: number;
}

export class CreateWeavingIssueDto {
  @ApiProperty()
  @IsString()
  pieceId!: string;

  @ApiProperty()
  @IsString()
  weavingPointId!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  qty!: number;

  @ApiPropertyOptional({
    type: [WeavingIssueMaterialLineDto],
    description:
      'Dây/Đinh/Nút nhựa THẬT thủ kho mang kèm mảnh lần xuất này (2026-09-11) - trừ tồn ngay, khác qty mảnh ở trên (không trừ tồn, xem WeavingIssuesService comment đầu file).',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WeavingIssueMaterialLineDto)
  materials?: WeavingIssueMaterialLineDto[];
}
