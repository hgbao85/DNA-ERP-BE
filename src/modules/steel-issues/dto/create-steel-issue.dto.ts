import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

export class CreateSteelIssueDto {
  /// Client (thủ kho) tự chọn loại sắt cần xuất - gộp theo cả PI (xem changelog
  /// 2026-08-18-xuat-sat-po-pi-vat-tu.md mục 2), không còn gắn 1 mảnh cụ thể nào.
  @ApiProperty()
  @IsString()
  materialId!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  barLengthMm!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  barCount!: number;
}
