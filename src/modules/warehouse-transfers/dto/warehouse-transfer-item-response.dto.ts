import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class WarehouseTransferItemResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) materialId!: string | null;
  /** Mã vật tư (in cột "Mã vật tư" trên phiếu chuyển) - null cho dòng "ghi tự do" cũ. */
  @Expose() @ApiPropertyOptional({ nullable: true, type: String }) materialCode!: string | null;
  @Expose() @ApiProperty() materialName!: string;
  /// Quy cách vật tư (Material.spec) - null cho dòng "ghi tự do" cũ (materialId null, trước
  /// 09/09/2026, không có Material để join) và vật tư chưa khai báo quy cách.
  @Expose() @ApiPropertyOptional({ nullable: true }) materialSpec!: string | null;
  @Expose() @ApiProperty() unit!: string;
  /** Chờ nhận: số gửi. Đã nhận: số thực nhận (v8 4.7). */
  @Expose() @ApiProperty() quantity!: number;
  /** Số kho giao gửi khi thực nhận ít hơn; null = nhận đủ. */
  @Expose() @ApiPropertyOptional({ nullable: true, type: Number }) sentQty!: number | null;
  /** Chiều dài cây (sắt) - phiếu chuyển hàng của lệnh đổi xưởng; 0 = không chia theo chiều dài. */
  @Expose() @ApiProperty() stockLengthMm!: number;
  @Expose() @ApiPropertyOptional({ nullable: true }) note!: string | null;

  constructor(partial: Partial<WarehouseTransferItemResponseDto>) {
    Object.assign(this, partial);
  }
}
