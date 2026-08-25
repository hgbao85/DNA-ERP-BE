import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator';

export class QcRecheckSegmentDto {
  @ApiProperty()
  @IsString()
  segmentSpecId!: string;

  /** Số đoạn CÒN HỎNG sau khi Phôi báo bù đủ - 0 = đạt hết, KHÔNG được vượt outstanding hiện tại
   *  (failedQty - resolvedQty), validate ở service vì cần đọc DB mới biết outstanding. */
  @ApiProperty()
  @IsInt()
  @Min(0)
  remainingFailedQty!: number;
}

/** KCS duyệt lại các cỡ đoạn Phôi đã báo "Bù đủ" (report-segment-done) - CHỈ cho những cỡ đang
 *  chờ duyệt lại (phoiReportedAt != null). Không đạt hết thì remainingFailedQty > 0, segment quay
 *  lại "chờ Phôi bù" (phoiReportedAt reset về null) cho tới khi Phôi báo lại. */
export class QcRecheckDto {
  @ApiProperty({ type: [QcRecheckSegmentDto] })
  @IsArray()
  @ArrayUnique((s: QcRecheckSegmentDto) => s.segmentSpecId)
  @ValidateNested({ each: true })
  @Type(() => QcRecheckSegmentDto)
  segments!: QcRecheckSegmentDto[];
}
