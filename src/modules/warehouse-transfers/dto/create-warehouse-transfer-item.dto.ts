import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateWarehouseTransferItemDto {
  // Bắt buộc từ 09/09/2026 (audit toàn diện, mục Trung bình "phiếu ghi tự do") - trước đây field
  // này optional (kế thừa hạn chế của mock), cho phép tạo dòng "ghi tự do" (chỉ materialName gõ
  // tay, không gắn Material thật) mà confirm() âm thầm bỏ qua lúc ghi StockLedger (không đụng tồn
  // kho) trong khi cả phiếu vẫn lên CONFIRMED như các dòng khác - dòng này không còn tạo được nữa.
  @ApiProperty()
  @IsString()
  @MinLength(1)
  materialId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  materialName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  unit!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
