import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { WEAVING_ROW_STATUSES, WeavingRowStatus } from '../weaving-coordination.rules';

const ID = /^[1-9]\d*$/;
const ID_MESSAGE = 'Mã phải là số nguyên dương';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Đ1: lọc bảng theo dõi. Không truyền `status` = mọi dòng còn giữ hàng; `status=DONE` = dòng đã trả đủ. */
export class WeavingBoardQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(ID, { message: ID_MESSAGE })
  weavingPointId?: string;

  @ApiPropertyOptional({ enum: WEAVING_ROW_STATUSES })
  @IsOptional()
  @IsIn(WEAVING_ROW_STATUSES)
  status?: WeavingRowStatus;
}

/** Đ2: lịch sử ghi chú theo điểm đan (và tuỳ chọn đúng 1 dòng lệnh × mảnh). */
export class WeavingFollowUpQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(ID, { message: ID_MESSAGE })
  weavingPointId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(ID, { message: ID_MESSAGE })
  productionOrderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(ID, { message: ID_MESSAGE })
  pieceId?: string;
}

/** Đ2: ghi chú làm việc + (tuỳ chọn) lời hẹn trả. Số hẹn và ngày hẹn cùng có hoặc cùng không. */
export class CreateWeavingFollowUpDto {
  @ApiProperty()
  @Matches(ID, { message: ID_MESSAGE })
  weavingPointId!: string;

  @ApiProperty()
  @Matches(ID, { message: ID_MESSAGE })
  productionOrderId!: string;

  @ApiProperty()
  @Matches(ID, { message: ID_MESSAGE })
  pieceId!: string;

  @ApiProperty({ description: 'Nội dung trao đổi với điểm đan' })
  @IsString()
  @MinLength(1, { message: 'Nội dung trao đổi bắt buộc' })
  @MaxLength(2000)
  content!: string;

  @ApiPropertyOptional({ description: 'Số mảnh hẹn trả (> 0, ≤ số đang giữ)' })
  @IsOptional()
  @IsInt()
  @Min(1, { message: 'Số mảnh hẹn trả phải lớn hơn 0' })
  promisedQty?: number;

  @ApiPropertyOptional({ description: 'Ngày hẹn trả (YYYY-MM-DD, giờ VN)' })
  @IsOptional()
  @Matches(DAY, { message: 'Ngày hẹn phải dạng YYYY-MM-DD' })
  promisedDate?: string;
}
