import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';

export class RejectPurchaseProposalDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  rejectionReason!: string;

  /// Tuỳ chọn (2026-08-25, "duyệt riêng từng người mua hàng") - id các PurchaseProposalItem đúng
  /// batch Sếp đang xem trên màn "So sánh giá" lúc bấm Từ chối, cùng lý do chống race đã ghi ở
  /// PurchaseProposalsService.approve(). Không gửi (tương thích ngược) thì áp dụng cho MỌI dòng
  /// đang SUBMITTED của đề xuất.
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  itemIds?: string[];
}
