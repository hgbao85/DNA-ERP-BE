import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * Xác nhận đã nhận 1 đợt sắt (2026-10-12) - người nhận ĐẾM rồi tự điền số cây thực nhận (Sếp chốt:
 * "người thợ nhận bao nhiêu tự điền"). Bỏ trống = nhận đúng bằng số kho xuất (`barCount`) - giữ tương
 * thích FE cũ gọi không body. Lệch `barCount` (thiếu hoặc thừa) vẫn nhận, nhưng báo kho + QLSX
 * (xem SteelIssuesService.receive()). Tối thiểu 1: không nhận được cây nào thì đừng xác nhận, báo kho.
 */
export class ReceiveSteelIssueDto {
  @ApiPropertyOptional({ description: 'Số cây thực nhận - mặc định = số kho xuất', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  receivedBarCount?: number;
}
