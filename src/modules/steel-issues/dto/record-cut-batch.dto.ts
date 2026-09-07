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
  /**
   * Số CÂY đã dùng trong đợt này - KHÔNG còn bắt buộc từ 2026-09-05 (bỏ hẳn ô nhập ở màn Phôi
   * theo yêu cầu nghiệp vụ): 1 loại sắt giờ gộp nhiều lần kho giao thành 1 mục ở màn lệnh sản
   * xuất, bắt Phôi tách "đợt cắt này ăn mấy cây của lần giao nào" là tuỳ tiện, không ai đếm nổi.
   * Vắng mặt = 0. Hệ quả đã trao đổi và được chốt: mất cân bằng vật chất (không tính được phế
   * liệu) và mất chặn "khai vượt số cây kho giao" - kiểm soát dồn hết về KCS, đúng triết lý
   * "không cap lúc báo, KCS mới là bước kiểm soát" của module này.
   */
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  barCount?: number;

  /**
   * Tổng chiều dài mẩu sắt còn NGUYÊN từ (các) cây cắt dở trong đợt (mm). Cũng bỏ ô nhập cùng đợt
   * 2026-09-05 (mẩu nguyên là mẩu VẬT LÝ ở xưởng, không thuộc riêng lần giao nào). Vắng mặt = 0.
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
