import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const ID = /^[1-9]\d*$/;
const ID_MESSAGE = 'Mã phải là số nguyên dương';
const URL_OPTS = { protocols: ['https', 'http'], require_protocol: true };

/** Màn quét: chọn lệnh (SKU) để xem mảnh / số đóng được. */
export class CkDgScanQueryDto {
  @ApiPropertyOptional({ description: 'Id dòng SKU (ProductionInvoiceItem) đang chọn' })
  @IsOptional()
  @IsString()
  @Matches(ID, { message: ID_MESSAGE })
  itemId?: string;
}

/** C1: công nhân chuyền kiểm báo 1 đợt cho (SKU, mảnh). Header Idempotency-Key bắt buộc. */
export class ReportTransferCheckBatchDto {
  @ApiProperty({ description: 'Id dòng SKU (ProductionInvoiceItem)' })
  @IsString()
  @Matches(ID, { message: ID_MESSAGE })
  itemId!: string;

  @ApiProperty()
  @IsString()
  @Matches(ID, { message: ID_MESSAGE })
  pieceId!: string;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  passedQty!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  defectQty!: number;

  @ApiPropertyOptional({
    description: 'Nguyên nhân lỗi (danh mục lý do lỗi) - bắt buộc khi defectQty > 0',
  })
  @IsOptional()
  @IsString()
  @Matches(ID, { message: ID_MESSAGE })
  defectReasonId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Ảnh lỗi (URL từ /uploads/image) - ít nhất 1 khi defectQty > 0',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl(URL_OPTS, { each: true, message: 'Ảnh lỗi phải là đường dẫn hợp lệ' })
  photoUrls?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** C2/C4: KCS chuyền kiểm chấm 1 đợt. đạt + làm lại + bỏ = số công nhân báo (đạt + lỗi), đạt <= báo đạt. */
export class GradeTransferCheckBatchDto {
  @ApiProperty({ minimum: 0, description: 'Số đạt thật (không quá số công nhân báo đạt)' })
  @IsInt()
  @Min(0)
  passedQty!: number;

  @ApiProperty({ minimum: 0, description: 'Trong phần lỗi: số làm lại (sửa xong báo lại)' })
  @IsInt()
  @Min(0)
  reworkQty!: number;

  @ApiProperty({ minimum: 0, description: 'Trong phần lỗi: số bỏ' })
  @IsInt()
  @Min(0)
  scrapQty!: number;

  @ApiPropertyOptional({
    description: 'Nguyên nhân cho phần KCS chấm lỗi thêm (bắt buộc khi đạt KCS < báo đạt)',
  })
  @IsOptional()
  @IsString()
  @Matches(ID, { message: ID_MESSAGE })
  defectReasonId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl(URL_OPTS, { message: 'Ảnh phải là đường dẫn hợp lệ' })
  photoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** D1: công nhân đóng gói báo số bộ đã đóng cho 1 SKU. Header Idempotency-Key bắt buộc. */
export class ReportPackingDto {
  @ApiProperty({ description: 'Id dòng SKU (ProductionInvoiceItem)' })
  @IsString()
  @Matches(ID, { message: ID_MESSAGE })
  itemId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  qty!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    description:
      'Ô kho vừa quét (WarehouseLocation.id) - bắt buộc khi bật VI_TRI_KHO_ENABLED: báo đóng gói = cất vào ô này',
  })
  @IsOptional()
  @IsString()
  @Matches(ID, { message: ID_MESSAGE })
  locationId?: string;
}

/** D4: thủ kho Thành phẩm huỷ lần báo đóng gói sai - lý do bắt buộc. */
export class CancelPackingReportDto {
  @ApiProperty()
  @IsString()
  @MinLength(3, { message: 'Ghi lý do huỷ (ít nhất 3 ký tự)' })
  @MaxLength(500)
  reason!: string;
}

/** Danh sách đợt chuyền kiểm (KCS chuyền kiểm / màn kho Thành phẩm). */
export class ListTransferCheckBatchesQueryDto {
  @ApiPropertyOptional({ enum: ['AWAITING_KCS', 'KCS_DONE'] })
  @IsOptional()
  @IsIn(['AWAITING_KCS', 'KCS_DONE'])
  status?: 'AWAITING_KCS' | 'KCS_DONE';

  @ApiPropertyOptional({ description: 'Lọc theo dòng SKU' })
  @IsOptional()
  @IsString()
  @Matches(ID, { message: ID_MESSAGE })
  itemId?: string;
}

/** Danh sách lần báo đóng gói (màn kho Thành phẩm). */
export class ListPackingReportsQueryDto {
  @ApiPropertyOptional({ description: 'Lọc theo dòng SKU' })
  @IsOptional()
  @IsString()
  @Matches(ID, { message: ID_MESSAGE })
  itemId?: string;
}
