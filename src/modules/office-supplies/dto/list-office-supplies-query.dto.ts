import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListOfficeSuppliesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Chỉ dùng khi caller KHÔNG có warehouseScope (Boss/Admin/tổng kho) để xem đúng 1 kho - thủ kho có scope thì field này bị bỏ qua, LUÔN lọc theo đúng kho của họ (xem OfficeSuppliesService.assertWarehouseScope). Bỏ trống + không có scope = xem gộp mọi kho.',
  })
  @IsOptional()
  @IsString()
  warehouseCode?: string;

  @ApiPropertyOptional({
    enum: ['true'],
    description:
      "true = trả về CẢ vật tư đã xóa (soft-delete) lẫn còn hoạt động, để tra lịch sử vật tư cũ - mặc định (bỏ trống) chỉ trả vật tư đang hoạt động. Nhận string 'true' (không phải boolean thật) để tránh gotcha coercion của class-transformer. Không giới hạn theo role ở tầng BE (cùng tiền lệ WAREHOUSE:CREATE isAdmin-gated ở FE) - FE chỉ hiện nút bật cho Admin.",
  })
  @IsOptional()
  @IsIn(['true'])
  includeDeleted?: string;
}
