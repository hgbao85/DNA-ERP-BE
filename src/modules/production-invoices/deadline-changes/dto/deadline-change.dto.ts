import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/** Sếp quyết 1 lô: các yêu cầu được duyệt (mảng id dạng chuỗi số); yêu cầu chờ còn lại bị từ chối và cần `rejectReason`. */
export class DecideDeadlineBatchDto {
  @ApiProperty({
    type: [String],
    description: 'Id các yêu cầu được DUYỆT trong lô (rỗng = từ chối hết).',
  })
  @IsArray()
  @IsString({ each: true })
  @Matches(/^\d+$/, { each: true, message: 'Id yêu cầu phải là chuỗi số' })
  approveRequestIds!: string[];

  @ApiPropertyOptional({ description: 'Bắt buộc (≥ 3 ký tự) khi có yêu cầu bị từ chối.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectReason?: string;
}

export class ListDeadlineBatchesQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'DECIDED', 'CANCELLED', 'ALL'], default: 'PENDING' })
  @IsOptional()
  @IsIn(['PENDING', 'DECIDED', 'CANCELLED', 'ALL'])
  status?: 'PENDING' | 'DECIDED' | 'CANCELLED' | 'ALL';

  @ApiPropertyOptional({ description: 'true = chỉ lô do chính mình gửi.' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  mine?: boolean;
}
