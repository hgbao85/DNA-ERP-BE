import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * Body của POST cut-bundles/:id/assign-order và step-bundles/:id/assign-order (2026-09-21) - gán SKU cho đợt
 * CŨ (tạo trước khi Phôi ghi theo SKU, productionOrderId đang null) ở PI có NHIỀU SKU, nơi hệ thống không tự
 * đoán được đợt đó của SKU nào. Chỉ gán được 1 LẦN (đợt đã có SKU thì 409).
 */
export class AssignProductionOrderDto {
  @ApiProperty()
  @IsString()
  productionOrderId!: string;
}
