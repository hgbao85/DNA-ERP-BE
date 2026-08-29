import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

/** POST /stock-ledger/adjust - ngoại lệ duy nhất được ghi stock_ledger trực tiếp qua HTTP. */
export class CreateStockAdjustmentDto {
  @ApiProperty()
  @IsString()
  fromWarehouseId!: string;

  @ApiProperty()
  @IsString()
  toWarehouseId!: string;

  @ApiPropertyOptional({ description: 'Đúng 1 trong 4 chân hàng bên dưới phải có giá trị' })
  @IsOptional()
  @IsString()
  materialId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  segmentSpecId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pieceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productVariantId?: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.0001)
  qty!: number;

  /** Chỉ có ý nghĩa khi materialId có giá trị (sắt). Để trống = mặc định bucket 0 - trừ vật tư
   *  nhóm STEEL_BAR, BE bắt buộc phải truyền rõ (xem StockLedgerService.resolveAdjustStockLengthMm). */
  @ApiPropertyOptional({ description: 'Cỡ cây sắt (mm) - chỉ áp dụng khi có materialId' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockLengthMm?: number;

  /** Vấn đề #25 audit 26/08/2026 - bắt buộc để sổ kho còn tra soát được sau này. Trước đây
   *  optional nên FE luôn gửi kèm 1 câu cố định giống hệt nhau (không mang thông tin gì) thay vì
   *  lý do thật - đã sửa FE bắt gõ tay qua AdjustReasonModal, giờ siết luôn ở BE cho chắc. */
  @ApiProperty({ description: 'Lý do điều chỉnh - bắt buộc, để tra soát sau này' })
  @IsString()
  @MinLength(1)
  note!: string;

  /// Optimistic-lock cho UI "sửa nhanh tồn kho" (nhập số tuyệt đối, FE tự tính delta) - phải đi
  /// kèm expectedCurrentQty. Phải trùng fromWarehouseId hoặc toWarehouseId của chính request này.
  @ApiPropertyOptional({
    description:
      'Kho cần assert tồn hiện tại (phải trùng fromWarehouseId hoặc toWarehouseId) - đi kèm expectedCurrentQty',
  })
  @IsOptional()
  @IsString()
  expectedWarehouseId?: string;

  @ApiPropertyOptional({
    description:
      'Tồn hiện tại mà client thấy lúc bắt đầu sửa (kho expectedWarehouseId) - BE từ chối nếu tồn thật đã đổi kể từ đó (2 người sửa cùng lúc)',
  })
  @IsOptional()
  @IsNumber()
  expectedCurrentQty?: number;
}
