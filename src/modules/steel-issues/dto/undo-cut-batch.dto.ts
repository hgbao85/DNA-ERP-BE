import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { CutBatchSegmentDto } from './record-cut-batch.dto';

/**
 * Hoàn tác ĐÚNG lần "Lưu đợt cắt" gần nhất (2026-09-07) - FE gửi lại CHÍNH XÁC phần vừa cộng
 * (segments+qty đã submit ở recordCutBatch) để trừ lại. Chỉ hoàn tác được 1 CẤP DUY NHẤT (lần gần
 * nhất) - không phải undo stack nhiều lượt, xem doc comment SteelIssuesService.undoLastCutBatch().
 */
export class UndoCutBatchDto {
  @ApiProperty({ type: [CutBatchSegmentDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CutBatchSegmentDto)
  segments!: CutBatchSegmentDto[];
}
