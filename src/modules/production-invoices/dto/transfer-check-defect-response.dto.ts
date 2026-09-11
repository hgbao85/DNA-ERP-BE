import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/**
 * 1 dòng lỗi trong danh sách Admin duyệt/sửa ảnh (GET production-invoices/transfer-check-defects) -
 * chỉ trả field cần cho màn quản lý (không join sâu sang tên PI/SKU, chấp nhận hiện ID thô cho gọn
 * phạm vi - xem plan "Admin quản lý tệp đính kèm").
 */
@Exclude()
export class TransferCheckDefectResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() transferCheckResultId!: string;
  @Expose() @ApiProperty() productionInvoiceItemId!: string;
  @Expose() @ApiProperty() pieceId!: string;
  @Expose() @ApiProperty() reason!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) imageUrl!: string | null;
  @Expose() @ApiProperty() checkedById!: string;
  @Expose() @ApiProperty() checkedAt!: Date;

  constructor(partial: Partial<TransferCheckDefectResponseDto>) {
    Object.assign(this, partial);
  }
}
