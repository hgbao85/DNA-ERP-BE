import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListOfficeSuppliesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Chỉ dùng khi caller KHÔNG có warehouseScope (Boss/Admin/tổng kho) để xem đúng 1 kho - thủ kho có scope thì field này bị bỏ qua, LUÔN lọc theo đúng kho của họ (xem OfficeSuppliesService.assertWarehouseScope). Bỏ trống + không có scope = xem gộp mọi kho.',
  })
  @IsOptional()
  @IsString()
  warehouseCode?: string;
}
