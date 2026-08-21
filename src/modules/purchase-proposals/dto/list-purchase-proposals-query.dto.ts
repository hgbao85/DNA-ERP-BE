import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListPurchaseProposalsQueryDto extends PaginationQueryDto {
  /**
   * true = chỉ trả các phiếu CHƯA đóng (mọi status trừ PURCHASED) - dùng cho các màn hàng đợi xử
   * lý (Lệnh mua NCC/Theo dõi mua hàng) để phiếu cũ không bị đẩy khỏi top-`limit` bởi phiếu
   * PURCHASED tích luỹ vô hạn theo thời gian. Bỏ trống = giữ hành vi cũ (không lọc status).
   */
  @ApiPropertyOptional({
    description:
      'true = chỉ phiếu chưa đóng (khác PURCHASED) - dùng cho màn hàng đợi xử lý, tránh bị phiếu PURCHASED tích luỹ đẩy khỏi trang',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  activeOnly?: boolean;
}
