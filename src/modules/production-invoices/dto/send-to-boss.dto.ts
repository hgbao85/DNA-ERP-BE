import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

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
}
