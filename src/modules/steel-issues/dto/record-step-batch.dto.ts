import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ProcessStep } from '../../../generated/prisma/client';

export class StepBatchSegmentDto {
  @ApiProperty()
  @IsString()
  segmentSpecId!: string;

  /** Số đoạn đã gia công xong qua công đoạn này trong đợt - Phôi đếm tay, không suy từ định mức. */
  @ApiProperty()
  @IsInt()
  @Min(1)
  qty!: number;
}

/**
 * MỘT đợt báo "đã gia công" cho 1 công đoạn chi tiết SAU Cắt (append-only, cộng dồn) - mirror
 * RecordCutBatchDto nhưng KHÔNG có barCount/mauNguyenMm/proposalPatternId: bước này không tác
 * động lên cây sắt, chỉ xử lý tiếp trên các đoạn ĐÃ cắt ra. Không nhận step=CAT (dùng
 * RecordCutBatchDto qua route cut-batches).
 */
export class RecordStepBatchDto {
  @ApiProperty({ enum: ProcessStep })
  @IsEnum(ProcessStep)
  step!: ProcessStep;

  @ApiProperty({ type: [StepBatchSegmentDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StepBatchSegmentDto)
  segments!: StepBatchSegmentDto[];
}
