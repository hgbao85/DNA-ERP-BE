import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * QLSX chọn kho thành phẩm làm điểm cuối trước khi gửi Sếp duyệt - mirror sendItemToBoss()
 * mock. `warehouseCode` là warehouseScope (chuỗi tự do gắn trên User, vd 'thanh-pham-2'),
 * KHÔNG phải id của bảng Warehouse - xem ghi chú tại ProductionInvoiceItem trong schema.prisma.
 */
export class SendToBossDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  warehouseCode!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  warehouseName!: string;

  /**
   * Phần A – Đợt 2: xưởng cơ khí làm lệnh (Workshop.id). Khai optional để thiếu thì service trả câu 400 rõ ràng ("tải lại
   * trang") thay vì lỗi validate chung - FE bản cũ không gửi field này.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  workshopId?: string;
}
