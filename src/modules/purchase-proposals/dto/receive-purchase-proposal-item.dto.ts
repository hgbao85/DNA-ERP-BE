import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';

export class ReceivePurchaseProposalItemDto {
  @ApiProperty({ description: 'Số lượng nhận theo material.unit (đơn vị tồn kho), vd cái' })
  @IsNumber()
  @Min(1)
  receivedQty!: number;

  @ApiPropertyOptional({
    description:
      'Số lượng nhận theo material.purchaseUnit (đơn vị mua hàng, vd kg) - chỉ để đối chiếu/audit, không dùng để tính tồn kho. Gửi kèm khi material có purchaseUnit.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  receivedQtyPurchaseUnit?: number;

  /** Để trống = đúng như phương án đã duyệt (item.stockLengthMm). Truyền lại khi thủ kho thực đo
   *  hàng NCC giao khác cỡ so với đề xuất - kế hoạch "chiều dài cây sắt" 2026-08-29, Bước 4. */
  @ApiPropertyOptional({
    description:
      'Cỡ cây sắt (mm) thực nhận - để trống nếu đúng như đề xuất đã duyệt (item.stockLengthMm), truyền lại nếu NCC giao khác cỡ',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockLengthMm?: number;
}
