import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateSkuDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  salesOrderId?: string;

  /**
   * Chọn tường minh dòng SalesOrderItem cần ghim số lượng/hạn giao vào PI (khi caller đã biết
   * chắc) - PHẢI thuộc đúng salesOrderId + mfgProductId đang tạo SKU. Bỏ trống thì service tự dò
   * theo (salesOrderId, mfgProductId) - chỉ đáng tin khi 1 đơn hàng không có 2 dòng cùng sản
   * phẩm; nếu có, kết quả tự dò không đảm bảo đúng dòng người dùng thật sự muốn (audit
   * 2026-08-20, mục Medium "resolveProductionInvoice lấy dòng đầu tiên" - xác nhận với nghiệp vụ:
   * 1 đơn hàng CÓ THỂ có 2 dòng cùng sản phẩm, vd giao 2 đợt khác ngày).
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  salesOrderItemId?: string;

  @ApiProperty()
  @IsString()
  mfgProductId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerName?: string;
}
