import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CutBatchSegmentDto {
  @ApiProperty()
  @IsString()
  segmentSpecId!: string;

  /**
   * TỔNG số đoạn cỡ này cắt được trong đợt - KHÔNG phải "trên mỗi cây" (xem CutPatternSegment.qty).
   * Phôi đếm tay số đoạn thực tế; hệ thống không suy ra từ pattern nữa.
   */
  @ApiProperty()
  @IsInt()
  @Min(1)
  qty!: number;
}

/**
 * MỘT đợt cắt của tổ Phôi (append-only). Cắt cả lệnh trong 1 lần là hiếm - bình thường vài đợt
 * theo ca, mỗi lần gọi 1 lần, cộng dồn vào cột "Đã cắt" của bảng tiến độ.
 *
 * Thay `CompleteCuttingDto` cũ (2026-08-22): DTO cũ bắt chọn `proposalPatternId` rồi FE tự bung
 * danh sách đoạn từ pattern đã duyệt - tức là số liệu "thực cắt" thật ra được CHÉP từ kế hoạch,
 * không phải đo.
 */
export class RecordCutBatchDto {
  /** Số CÂY đã dùng trong đợt này. Cộng dồn mọi đợt không được vượt số cây kho đã giao. */
  @ApiProperty()
  @IsInt()
  @Min(1)
  barCount!: number;

  /**
   * Tổng chiều dài mẩu sắt còn NGUYÊN từ (các) cây cắt dở trong đợt (mm) - nhập lại kho, cắt được
   * cỡ bất kỳ sau này. KHÔNG phải phế liệu. Mặc định 0 = cắt hết cây, không còn mẩu nào.
   */
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  mauNguyenMm?: number;

  /**
   * Kiểu cắt đã duyệt mà đợt này bám theo - THUẦN THAM CHIẾU/audit, hệ thống KHÔNG dùng nó để suy
   * ra đoạn nào nữa. Null (mặc định) = không bám kiểu nào.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  proposalPatternId?: string;

  @ApiProperty({ type: [CutBatchSegmentDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CutBatchSegmentDto)
  segments!: CutBatchSegmentDto[];
}
