import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { WeavingPointAssignmentResponseDto } from './weaving-point-assignment-response.dto';

/** 1 điểm đan + toàn bộ (PO, mảnh) đang/đã giữ, gộp qua MỌI production order - dùng cho
 *  GET /weaving-issues/by-point ("Quản lý điểm đan", thay WeavingService.getByPoint() mock). Khác
 *  getIssuePlan() (scope theo 1 PO): endpoint này flat, không cần biết trước PO nào. */
@Exclude()
export class WeavingPointGroupResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() code!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) fullName!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) phone!: string | null;
  /** Σ assignments[].holding - tổng số mảnh điểm đan này đang giữ, chưa trả hết. */
  @Expose() @ApiProperty() totalHolding!: number;
  @Expose()
  @ApiProperty({ type: [WeavingPointAssignmentResponseDto] })
  assignments!: WeavingPointAssignmentResponseDto[];

  constructor(partial: Partial<WeavingPointGroupResponseDto>) {
    Object.assign(this, partial);
  }
}
