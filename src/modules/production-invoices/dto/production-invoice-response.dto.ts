import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { ProductionInvoiceStatus } from '../../../generated/prisma/client';
import { ProductionInvoiceItemResponseDto } from './production-invoice-item-response.dto';

@Exclude()
export class ProductionInvoiceResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() code!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderCode!: string | null;
  @Expose() @ApiProperty({ enum: ProductionInvoiceStatus }) status!: ProductionInvoiceStatus;
  /**
   * true = KHSX gộp nhiều SKU để cắt chung một đợt. FE dùng để đổi cách hiển thị (nhóm SKU theo
   * PO) và đổi cách duyệt (Sếp duyệt/từ chối CẢ CỤM, không duyệt lẻ từng SKU).
   */
  @Expose() @ApiProperty() isMerged!: boolean;
  @Expose() @ApiPropertyOptional({ nullable: true }) deadline!: Date | null;
  /** Thông số cắt KHSX đề nghị cho đợt này lúc gộp/cắt riêng ở "Tối ưu cắt sắt" (2026-09-14).
   *  FE hiện 3 field này lên màn Sếp duyệt lệnh sản xuất để Sếp biết mình đang chấp thuận cái gì -
   *  null hết = không xin gì đặc biệt, không hiện gì cả. */
  @Expose()
  @ApiPropertyOptional({
    nullable: true,
    description: 'Ngưỡng hao hụt đặc cách (%) xin cho đợt này',
  })
  solverMaxWastePctOverride!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) solverAllowCustomLength!: boolean | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) solverOverrideReason!: string | null;
  /** Chiều dài cây (mm) KHSX chọn cho đợt này theo từng quy cách: { "<materialId>": <mm> }.
   *  null = mọi loại sắt dùng chiều dài chuẩn của công ty. FE hiện lại đúng lựa chọn đó ở
   *  header PI để Sếp biết đợt này cắt trên cây nào trước khi duyệt. */
  @Expose()
  @ApiPropertyOptional({ nullable: true, example: { '5': 5850 } })
  solverStockLengthsByMaterial!: Record<string, number> | null;
  /** Bằng chứng chụp lúc KHSX xin - loại sắt vướng nhất + ước tính hao hụt + ngưỡng thường. Để Sếp
   *  thấy con số xin là hợp lý hay thừa, ngay trên màn duyệt (solver chưa chạy nên chưa có số thật). */
  @Expose()
  @ApiPropertyOptional({ nullable: true })
  solverOverrideEvidence!: {
    materialCode: string;
    estimatedWastePct: number;
    normalThresholdPct: number;
    /** Cây mà estimatedWastePct được tính trên đó. Thiếu (bản ghi cũ) = cây chuẩn công ty. */
    stockLengthMm?: number | null;
  } | null;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiProperty() updatedAt!: Date;
  @Expose()
  @ApiProperty({ type: [ProductionInvoiceItemResponseDto] })
  @Type(() => ProductionInvoiceItemResponseDto)
  items!: ProductionInvoiceItemResponseDto[];

  constructor(partial: Partial<ProductionInvoiceResponseDto>) {
    Object.assign(this, partial);
  }
}
