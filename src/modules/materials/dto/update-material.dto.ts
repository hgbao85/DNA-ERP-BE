import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateMaterialDto } from './create-material.dto';

export class UpdateMaterialDto extends PartialType(
  OmitType(CreateMaterialDto, ['materialGroupId', 'warehouseId', 'buyerId'] as const),
) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // 3 field dưới đây ghi đè lại type của CreateMaterialDto (PartialType chỉ làm optional, không
  // đổi nullability) để thêm `| null` - đính chính audit độc lập 09/09 (Cao/H1): PATCH cần phân
  // biệt được "field không có trong body" (undefined - giữ nguyên, xem MaterialsService.update())
  // với "field có trong body nhưng giá trị null" (chủ động gỡ gán) - trước đây cả 2 case đều bị xử
  // lý giống hệt nhau ở service (coi null như falsy = undefined), nên gỡ gán không bao giờ có tác
  // dụng qua PATCH. `@IsOptional()` của class-validator vốn đã bỏ qua validate khi giá trị là
  // null hoặc undefined, chỉ cần khai lại type ở đây cho khớp thực tế.
  @ApiPropertyOptional({ nullable: true, description: 'null = gỡ khỏi Nhóm vật tư' })
  @IsOptional()
  materialGroupId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'null = gỡ khỏi Kho' })
  @IsOptional()
  warehouseId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'null = gỡ Người phụ trách mua' })
  @IsOptional()
  buyerId?: string | null;
}
