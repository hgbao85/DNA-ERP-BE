import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { SteelIssueStatus } from '../../../generated/prisma/client';

/**
 * Query cho GET /steel-issues (flat, không cần productionOrderId) - PHOI_STAFF/KCS_STAFF chỉ có
 * STEEL_ISSUE:VIEW (KHÔNG có PRODUCTION_ORDER:VIEW/SKU:VIEW - xem role-permissions.constant.ts)
 * nên không thể tự resolve productionOrderId như FE phía kho (WAREHOUSE_STAFF, master-detail theo
 * SKU/PO). Cùng idiom ListMaterialIssuesQueryDto/ListProductionBatchesQueryDto.
 */
export class ListSteelIssuesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SteelIssueStatus, enumName: 'SteelIssueStatus' })
  @IsOptional()
  @IsEnum(SteelIssueStatus)
  status?: SteelIssueStatus;

  /**
   * 'true' = chỉ trả PI có ÍT NHẤT 1 SKU đang ProductionOrder.floorStage=ACTIVE (QLSX đã bấm "Bắt
   * đầu" ở Bảng thống kê) - dùng riêng cho LenhSanXuatPhoi.tsx ("Lệnh sản xuất — Công đoạn Phôi",
   * 2026-08-31). Optional + mặc định KHÔNG lọc để không ảnh hưởng các nơi khác đang gọi chung
   * endpoint này (Xác nhận nhận sắt, KcsPhoiPage) - chỉ FE nào chủ động truyền mới bị lọc. Nhận
   * string 'true' thay vì boolean thật để tránh gotcha coercion của class-transformer
   * (Boolean('false') === true).
   */
  @ApiPropertyOptional({ enum: ['true'] })
  @IsOptional()
  @IsIn(['true'])
  activeOnly?: 'true';
}
